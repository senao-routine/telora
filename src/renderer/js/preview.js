// プレビュー：すべてを 1 枚のキャンバスに合成して表示する「キャンバスコンポジタ」方式。
// <video> は音声＋フレーム供給のデコーダとして裏で使い、表示は不透明キャンバスが担う
// （GPU の video 合成に依存しないため確実に映る。書き出しとも完全一致）。
import { fileUrl, clamp, fmtTime } from './util.js';
import {
  getProject, on, emit, mediaById, totalDuration, baseTrack, clipAtTimeOnTrack,
  baseClipAtTime, clipEnd, clipDur, tracksBottomToTop,
  setPlayhead, getPlayhead, setPlaying, isPlaying, getSelection, setSelection,
  pushHistory, noteDirty,
} from './state.js';
import { drawTelop } from './render-telop.js';

const ANIM_DUR = 0.45; // アニメーションの基本秒数

let video, canvas, ctx, stage, stageEmpty, previewWrap, previewStatusEl;
let ffError = null;
let loadedMediaId = null;
let pendingSeek = false;
let rafId = null;
let wallStartPerf = 0, wallStartT = 0;
let hitBoxes = [];
let dragState = null;
const imgCache = new Map();
const audioEls = new Map(); // 音声クリップ id -> HTMLAudioElement
// <video> がデコードできないコーデック用の FFmpeg フレームフォールバック
let loadStartPerf = 0;
const ffFrames = new Map();  // `${mediaId}|${t}` -> HTMLImageElement
const ffPending = new Set();
let ffLastImg = null;

export function initPreview() {
  video = document.getElementById('previewVideo');
  canvas = document.getElementById('overlay');
  ctx = canvas.getContext('2d');
  stage = document.getElementById('previewStage');
  stageEmpty = document.getElementById('stageEmpty');
  previewWrap = document.getElementById('previewWrap');
  previewStatusEl = document.getElementById('previewStatus');

  // <video> はデコーダ専用：不透明キャンバスが上に乗るので視覚的には隠れる
  video.muted = false;
  video.addEventListener('error', () => { /* 状態は render の診断表示で扱う */ });

  applyStageAspect();
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => applyStageAspect()); ro.observe(previewWrap); }
  window.addEventListener('resize', applyStageAspect);

  on('project', () => {
    applyStageAspect(); resizeCanvas(); ensureImages();
    // 削除された音声クリップの <audio> 要素を破棄（リーク防止）
    const ids = new Set();
    for (const tr of getProject().tracks) if (tr.kind === 'audio') for (const c of tr.clips) ids.add(c.id);
    for (const [id, a] of audioEls) if (!ids.has(id)) { try { a.pause(); } catch (_) {} audioEls.delete(id); }
    // 使われなくなった画像も破棄（VRAM リーク防止）
    const mids = new Set(getProject().media.map((m) => m.id));
    for (const id of [...imgCache.keys()]) if (!mids.has(id)) imgCache.delete(id);
    if (!isPlaying()) { syncBaseVideo(getPlayhead(), false); render(getPlayhead()); }
  });
  on('selection', () => { if (!isPlaying()) render(getPlayhead()); });
  on('telop-live', () => { if (!isPlaying()) render(getPlayhead()); });
  on('settings', () => { applyStageAspect(); resizeCanvas(); render(getPlayhead()); });

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  video.addEventListener('loadeddata', () => { if (!isPlaying()) { syncBaseVideo(getPlayhead(), false); render(getPlayhead()); } });
  video.addEventListener('seeked', () => { if (!isPlaying()) render(getPlayhead()); });

  resizeCanvas();
  ensureImages();
  syncBaseVideo(0, false);
  render(0);
  startTick(); // 常時稼働の描画ループを開始
}

function applyStageAspect() {
  if (!previewWrap) return;
  const s = getProject().settings;
  const ratio = s.width / s.height;
  const cs = getComputedStyle(previewWrap);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const availW = Math.max(0, previewWrap.clientWidth - padX);
  const availH = Math.max(0, previewWrap.clientHeight - padY);
  if (availW <= 0 || availH <= 0) { // レイアウト未確定時は次フレームで再試行
    if (window.requestAnimationFrame) requestAnimationFrame(applyStageAspect);
    return;
  }
  let w = availW, h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  stage.style.width = Math.round(w) + 'px';
  stage.style.height = Math.round(h) + 'px';
  stage.style.aspectRatio = 'auto';
}

function resizeCanvas() {
  const s = getProject().settings;
  if (canvas.width !== s.width || canvas.height !== s.height) { canvas.width = s.width; canvas.height = s.height; }
}

function ensureImages() {
  for (const m of getProject().media) {
    if (m.type !== 'image' || imgCache.has(m.id)) continue;
    const img = new Image();
    img.onload = () => { if (!isPlaying()) render(getPlayhead()); };
    img.src = fileUrl(m.path);
    imgCache.set(m.id, img);
  }
}

function showEmpty(show) { if (stageEmpty) stageEmpty.style.display = show ? 'flex' : 'none'; }

// ベース動画（デコーダ）の同期。表示はしないが再生・シークでフレームと音声を供給する。
function syncBaseVideo(t, shouldPlay) {
  const base = baseClipAtTime(t);
  if (base && base.clip.kind === 'video') {
    const m = mediaById(base.clip.mediaId);
    if (m && loadedMediaId !== m.id) { loadedMediaId = m.id; pendingSeek = true; loadStartPerf = performance.now(); ffLastImg = null; video.src = fileUrl(m.path); video.load(); }
    const desired = clamp(base.clip.in + (t - base.clip.start), 0, m ? m.duration : 1e9);
    if (video.readyState >= 1) {
      const tol = shouldPlay ? 0.12 : 0.04;
      if (pendingSeek || Math.abs(video.currentTime - desired) > tol) { try { video.currentTime = desired; } catch (_) {} pendingSeek = false; }
    } else { pendingSeek = true; }
    if (shouldPlay) { if (video.paused) safePlay(); } else if (!video.paused) video.pause();
  } else {
    if (!video.paused) video.pause();
  }
}

function safePlay() {
  const p = video.play();
  if (p && typeof p.catch === 'function') p.catch((err) => { if (err && err.name === 'AbortError') return; setPlaying(false); });
}

// 音声トラックのクリップを再生位置に同期（再生中のみ鳴らす）
function syncAudioClips(t, shouldPlay) {
  const activeIds = new Set();
  for (const track of getProject().tracks) {
    if (track.kind !== 'audio') continue;
    for (const c of track.clips) {
      if (!shouldPlay) continue;
      if (t < c.start - 1e-6 || t >= clipEnd(c) - 1e-6) continue;
      const m = mediaById(c.mediaId);
      if (!m) continue;
      let a = audioEls.get(c.id);
      if (!a) { a = new Audio(); a.src = fileUrl(m.path); a.preload = 'auto'; audioEls.set(c.id, a); }
      a.volume = clamp(c.volume != null ? c.volume : 1, 0, 1);
      const desired = clamp(c.in + (t - c.start), 0, m.duration || 1e9);
      if (a.readyState >= 1 && Math.abs(a.currentTime - desired) > 0.15) { try { a.currentTime = desired; } catch (_) {} }
      if (a.paused) a.play().catch(() => {});
      activeIds.add(c.id);
    }
  }
  for (const [id, a] of audioEls) { if (!activeIds.has(id) && !a.paused) a.pause(); }
}
function stopAllAudio() { for (const [, a] of audioEls) { if (!a.paused) a.pause(); } }

// ---- 合成描画（ユーザーに見える唯一のレイヤ）----
function drawScaled(src, sw, sh) {
  if (!sw || !sh) return;
  const W = canvas.width, H = canvas.height;
  const r = sw / sh;
  let dw = W, dh = W / r;
  if (dh > H) { dh = H; dw = H * r; }
  try { ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (_) {}
}

// 戻り値: 'ok' | 'loading' | 'ffloading' | 'fferror' （診断表示用）
function drawVideoFrame(clip, t) {
  // 通常パス：<video> が復号できていればそのフレームを描画
  if (video.videoWidth && video.videoHeight && video.readyState >= 2) {
    drawScaled(video, video.videoWidth, video.videoHeight);
    return 'ok';
  }
  // フォールバック：内蔵プレーヤーで映らない場合は FFmpeg で抽出したフレームを描画
  const m = clip && mediaById(clip.mediaId);
  if (!m) return null;
  const elapsed = performance.now() - loadStartPerf;
  const failed = (video.error != null) || (elapsed > 800);
  if (!failed) return elapsed > 300 ? 'loading' : null; // 読み込み中（短時間ならメッセージ抑制）
  const srcT = clip.in + (t - clip.start);
  const img = getFfFrame(m, srcT);
  if (img) { drawScaled(img, img.naturalWidth, img.naturalHeight); ffLastImg = img; return 'ok'; }
  if (ffLastImg && ffLastImg.naturalWidth) { drawScaled(ffLastImg, ffLastImg.naturalWidth, ffLastImg.naturalHeight); return 'ok'; }
  return ffError ? 'fferror' : 'ffloading';
}

// FFmpeg 抽出フレームをキャッシュ付きで取得（無ければ非同期要求）
function getFfFrame(media, srcT) {
  const key = media.id + '|' + Math.max(0, srcT).toFixed(2);
  const cached = ffFrames.get(key);
  if (cached) return (cached.complete && cached.naturalWidth) ? cached : null;
  if (ffPending.size > 2 || !window.api || !window.api.extractFrame) return null;
  ffPending.add(key);
  const placeholder = new Image();
  ffFrames.set(key, placeholder);
  window.api.extractFrame({ path: media.path, time: srcT, width: canvas.width }).then((res) => {
    ffPending.delete(key);
    if (res && res.ok) {
      placeholder.onload = () => { render(getPlayhead()); };
      placeholder.src = res.dataUrl;
      ffError = null;
    } else {
      ffFrames.delete(key);
      ffError = (res && res.error) ? String(res.error).split('\n').filter(Boolean).slice(-1)[0] : 'フレーム抽出に失敗（FFmpeg 未検出の可能性）';
    }
    if (ffFrames.size > 80) { const k0 = ffFrames.keys().next().value; ffFrames.delete(k0); }
  }).catch((e) => { ffPending.delete(key); ffFrames.delete(key); ffError = String(e); });
  return null;
}

function drawMediaClip(clip) {
  const img = imgCache.get(clip.mediaId);
  if (!img || !img.complete || !img.naturalWidth) return;
  const W = canvas.width, H = canvas.height;
  const mr = img.naturalWidth / img.naturalHeight;
  let bw = W, bh = W / mr;
  if (bh > H) { bh = H; bw = H * mr; }
  const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
  const w = bw * tr.scale, h = bh * tr.scale;
  ctx.drawImage(img, tr.x * W - w / 2, tr.y * H - h / 2, w, h);
}

function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

// テロップのアニメーション状態（プレビュー）。export 側はフェードで近似。
export function animState(c, t) {
  const anim = c.anim || 'none';
  if (anim === 'none') return { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
  const half = Math.max(0.08, Math.min(ANIM_DUR, clipDur(c) / 2));
  const inP = clamp((t - c.start) / half, 0, 1);
  const outP = clamp((clipEnd(c) - t) / half, 0, 1);
  switch (anim) {
    case 'fade': return { alpha: Math.min(inP, outP), dx: 0, dy: 0, scale: 1, reveal: 1 };
    case 'slideUp': return { alpha: Math.min(1, inP * 1.3, outP * 1.3), dx: 0, dy: (1 - inP) * 0.12, scale: 1, reveal: 1 };
    case 'slideDown': return { alpha: Math.min(1, inP * 1.3, outP * 1.3), dx: 0, dy: -(1 - inP) * 0.12, scale: 1, reveal: 1 };
    case 'slideLeft': return { alpha: Math.min(1, inP * 1.3, outP * 1.3), dx: (1 - inP) * 0.18, dy: 0, scale: 1, reveal: 1 };
    case 'slideRight': return { alpha: Math.min(1, inP * 1.3, outP * 1.3), dx: -(1 - inP) * 0.18, dy: 0, scale: 1, reveal: 1 };
    case 'pop': return { alpha: Math.min(1, inP * 2, outP * 2), dx: 0, dy: 0, scale: inP < 1 ? 0.5 + 0.5 * easeOutBack(inP) : 1, reveal: 1 };
    case 'zoom': return { alpha: Math.min(inP, outP), dx: 0, dy: 0, scale: 0.7 + 0.3 * Math.min(inP, 1), reveal: 1 };
    case 'typewriter': return { alpha: Math.min(1, outP * 1.5), dx: 0, dy: 0, scale: 1, reveal: inP };
    default: return { alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
  }
}

function drawTextClipAnimated(c, t) {
  const a = animState(c, t);
  if (a.alpha <= 0.01) return;
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.globalAlpha *= a.alpha;
  if (a.dx || a.dy || a.scale !== 1) {
    const cx = c.x * W, cy = c.y * H;
    ctx.translate(cx + a.dx * W, cy + a.dy * H);
    ctx.scale(a.scale, a.scale);
    ctx.translate(-cx, -cy);
  }
  const bbox = drawTelop(ctx, c, W, H, a.reveal);
  ctx.restore();
  return bbox;
}

export function render(t) {
  resizeCanvas();
  const W = canvas.width, H = canvas.height;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H); // 不透明な黒ベース
  hitBoxes = [];

  const hasAny = totalDuration() > 0;
  showEmpty(!hasAny);
  let baseStatus = null;

  for (const track of tracksBottomToTop()) {
    if (track.kind === 'text') {
      for (const c of track.clips) {
        if (t >= c.start - 1e-6 && t < clipEnd(c) + 1e-6) {
          // 当たり判定用は素の bbox を別途取得（アニメ変形前）
          const bbox = drawTextClipAnimated(c, t) || measureTelop(c);
          hitBoxes.push({ clip: c, trackId: track.id, bbox });
        }
      }
    } else if (track.base) {
      const c = clipAtTimeOnTrack(track, t);
      if (c) { if (c.kind === 'video') baseStatus = drawVideoFrame(c, t); else drawMediaClip(c); }
    } else {
      for (const c of track.clips) {
        if (c.kind === 'image' && t >= c.start - 1e-6 && t < clipEnd(c) + 1e-6) drawMediaClip(c);
      }
    }
  }

  // 選択枠
  const sel = getSelection();
  if (sel) {
    const hit = hitBoxes.find((h) => h.clip.id === sel.clipId);
    if (hit && hit.bbox) {
      ctx.save();
      ctx.strokeStyle = '#5b8cff'; ctx.setLineDash([8, 6]); ctx.lineWidth = Math.max(2, H * 0.004);
      ctx.strokeRect(hit.bbox.x, hit.bbox.y, hit.bbox.w, hit.bbox.h);
      ctx.restore();
    }
  }
  updateStatus(baseStatus);
  updateReadout(t);
}
export { render as drawComposite };

// プレビューの状態を画面に表示（黒画面の原因が分かるように）
function updateStatus(status) {
  if (!previewStatusEl) return;
  let msg = '';
  if (status === 'loading') msg = '映像を読み込み中…';
  else if (status === 'ffloading') msg = 'フレームを取得中…\n（内蔵プレーヤー非対応コーデックのため FFmpeg で表示）';
  else if (status === 'fferror') {
    const ec = video && video.error ? `（内蔵プレーヤー: code ${video.error.code}）` : '';
    msg = `プレビューを表示できません ${ec}\n${ffError || ''}\nFFmpeg が見つからない可能性があります（書き出しにも必要）。`;
  }
  if (msg) { previewStatusEl.textContent = msg; previewStatusEl.hidden = false; }
  else previewStatusEl.hidden = true;
}

// アニメ無しの位置で bbox を測るための補助（選択枠用）
function measureTelop(c) {
  const W = canvas.width, H = canvas.height;
  ctx.save(); ctx.globalAlpha = 0;
  const bbox = drawTelop(ctx, c, W, H, 1);
  ctx.restore();
  return bbox;
}

function updateReadout(t) {
  const cur = document.getElementById('curTime'); const tot = document.getElementById('totalTime');
  if (cur) cur.textContent = fmtTime(t);
  if (tot) tot.textContent = fmtTime(totalDuration());
}

// ---- 再生制御：常時稼働の描画ループ ----
// イベントのタイミングに依存せず毎フレーム合成するため、プレビューが確実に映る。
let running = false;
function startTick() { running = true; if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick); }
function tick() {
  if (!running) return;
  if (isPlaying()) {
    const total = totalDuration();
    const t = wallStartT + (performance.now() - wallStartPerf) / 1000;
    if (t >= total) {
      setPlayhead(total); syncBaseVideo(total, false); syncAudioClips(total, false); render(total); setPlaying(false);
      if (video && !video.paused) video.pause();
    } else {
      setPlayhead(t); syncBaseVideo(t, true); syncAudioClips(t, true); render(t);
    }
  } else {
    // 停止中も毎フレーム再描画（同期は drift>tol のときだけシークするので安定）
    syncBaseVideo(getPlayhead(), false);
    syncAudioClips(getPlayhead(), false);
    render(getPlayhead());
  }
  rafId = requestAnimationFrame(tick);
}

export function play() {
  if (isPlaying()) return;
  dragState = null;
  const total = totalDuration();
  if (total <= 0) return;
  if (getPlayhead() >= total - 0.02) setPlayhead(0);
  wallStartPerf = performance.now();
  wallStartT = getPlayhead();
  setPlaying(true);
}
export function pause() { if (video && !video.paused) video.pause(); stopAllAudio(); setPlaying(false); }
export function stop() { pause(); }
export function togglePlay() { if (isPlaying()) pause(); else play(); }

export function seek(t, { play: doPlay = false } = {}) {
  dragState = null;
  t = clamp(t, 0, totalDuration());
  setPlayhead(t);
  if (doPlay) { wallStartPerf = performance.now(); wallStartT = t; setPlaying(true); }
  else { setPlaying(false); syncBaseVideo(t, false); render(t); }
}

// ---- テロップのドラッグ移動 ----
function clientToFrame(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width * canvas.width, y: (e.clientY - rect.top) / rect.height * canvas.height };
}
function onPointerDown(e) {
  const p = clientToFrame(e);
  let hit = null;
  for (let i = hitBoxes.length - 1; i >= 0; i--) {
    const b = hitBoxes[i].bbox;
    if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { hit = hitBoxes[i]; break; }
  }
  if (!hit) return;
  e.preventDefault();
  setSelection({ trackId: hit.trackId, clipId: hit.clip.id });
  // オフセットは正規化座標で保持（途中で解像度が変わってもズレない）
  dragState = { clip: hit.clip, historyPushed: false, offNX: p.x / canvas.width - hit.clip.x, offNY: p.y / canvas.height - hit.clip.y };
  canvas.setPointerCapture(e.pointerId);
}
function onPointerMove(e) {
  if (!dragState) return;
  if (!dragState.historyPushed) { pushHistory(); dragState.historyPushed = true; }
  const p = clientToFrame(e);
  dragState.clip.x = clamp(p.x / canvas.width - dragState.offNX, 0, 1);
  dragState.clip.y = clamp(p.y / canvas.height - dragState.offNY, 0, 1);
  noteDirty();
  render(getPlayhead());
  emit('telop-live', dragState.clip.id);
}
function onPointerUp() { if (dragState) dragState = null; }
