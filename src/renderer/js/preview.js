// プレビュー：すべてを 1 枚のキャンバスに合成して表示する「キャンバスコンポジタ」方式。
// <video> は音声＋フレーム供給のデコーダとして裏で使い、表示は不透明キャンバスが担う
// （GPU の video 合成に依存しないため確実に映る。書き出しとも完全一致）。
import { fileUrl, clamp, fmtTime } from './util.js';
import {
  getProject, on, emit, mediaById, totalDuration, baseTrack, clipAtTimeOnTrack,
  baseClipAtTime, clipEnd, clipDur, tracksBottomToTop, clipFadeAlpha, clipSpeed, transformAt, hasKeyframes, setKeyframe,
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
let guidesOn = (typeof localStorage !== 'undefined' && localStorage.getItem('telora.guides') === '1');
const imgCache = new Map();
const audioEls = new Map(); // 音声クリップ id -> HTMLAudioElement
const trackVideoEls = new Map(); // 非ベース動画トラック id -> HTMLVideoElement
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
    // 非ベース visual トラック以外の <video> は破棄（ベースは #previewVideo を使う）
    const vtrackIds = new Set(getProject().tracks.filter((tr) => tr.kind === 'visual' && !tr.base).map((tr) => tr.id));
    for (const [id, el] of trackVideoEls) if (!vtrackIds.has(id)) { try { el.pause(); el.removeAttribute('src'); el.remove(); } catch (_) {} trackVideoEls.delete(id); }
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
    const sp = clipSpeed(base.clip);
    const desired = clamp(base.clip.in + (t - base.clip.start) * sp, 0, m ? m.duration : 1e9);
    try { video.playbackRate = sp; } catch (_) {}
    if (video.readyState >= 1) {
      const tol = shouldPlay ? 0.12 : 0.04;
      if (pendingSeek || Math.abs(video.currentTime - desired) > tol) { try { video.currentTime = desired; } catch (_) {} pendingSeek = false; }
    } else { pendingSeek = true; }
    try { video.volume = clipFadeAlpha(base.clip, t); } catch (_) {} // ベース動画音声のフェード
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
      a.volume = clamp((c.volume != null ? c.volume : 1) * clipFadeAlpha(c, t), 0, 1);
      const sp = clipSpeed(c); try { a.playbackRate = sp; } catch (_) {}
      const desired = clamp(c.in + (t - c.start) * sp, 0, m.duration || 1e9);
      if (a.readyState >= 1 && Math.abs(a.currentTime - desired) > 0.15) { try { a.currentTime = desired; } catch (_) {} }
      if (a.paused) a.play().catch(() => {});
      activeIds.add(c.id);
    }
  }
  for (const [id, a] of audioEls) { if (!activeIds.has(id) && !a.paused) a.pause(); }
}
function stopAllAudio() { for (const [, a] of audioEls) { if (!a.paused) a.pause(); } }

// 非ベース動画トラック用の <video> 要素（デコーダ）。表示はキャンバス合成で行う。
function getTrackVideoEl(trackId) {
  let el = trackVideoEls.get(trackId);
  if (!el) {
    el = document.createElement('video');
    // 非ベース動画も音声を鳴らす（2層目以降の動画の音声が無音にならないように）
    el.muted = false; el.preload = 'auto'; el.playsInline = true;
    // DOM に接続しておくと一時停止中のシークでも確実にフレームをデコードする（非表示）
    el.style.cssText = 'position:absolute;left:-99999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    (stage || document.body).appendChild(el);
    trackVideoEls.set(trackId, el);
  }
  return el;
}
function syncVideoTracks(t, shouldPlay) {
  const base = baseTrack();
  for (const track of getProject().tracks) {
    if (track.kind !== 'visual' || track === base) continue;
    const el = getTrackVideoEl(track.id);
    const c = clipAtTimeOnTrack(track, t);
    if (c && c.kind === 'video') {
      const m = mediaById(c.mediaId);
      if (m && el._mediaId !== m.id) { el._mediaId = m.id; el._pending = true; el.src = fileUrl(m.path); el.load(); }
      el.volume = clamp((c.volume != null ? c.volume : 1) * clipFadeAlpha(c, t), 0, 1);
      const sp = clipSpeed(c); try { el.playbackRate = sp; } catch (_) {}
      const desired = clamp(c.in + (t - c.start) * sp, 0, m ? m.duration : 1e9);
      if (el.readyState >= 1) {
        const tol = shouldPlay ? 0.12 : 0.04;
        if (el._pending || Math.abs(el.currentTime - desired) > tol) { try { el.currentTime = desired; } catch (_) {} el._pending = false; }
      } else { el._pending = true; }
      if (shouldPlay) { if (el.paused) el.play().catch(() => {}); } else if (!el.paused) el.pause();
    } else if (!el.paused) el.pause();
  }
}
function stopAllTrackVideos() { for (const [, el] of trackVideoEls) { if (!el.paused) el.pause(); } }

// ---- 合成描画（ユーザーに見える唯一のレイヤ）----
function drawScaled(src, sw, sh) {
  if (!sw || !sh) return;
  const W = canvas.width, H = canvas.height;
  const r = sw / sh;
  let dw = W, dh = W / r;
  if (dh > H) { dh = H; dw = H * r; }
  try { ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch (_) {}
}

// クロップ（各辺を 0..1 で内側へ）から、ソースの可視矩形を返す
function croppedSrc(sw, sh, crop) {
  const c = crop || {}; const l = c.l || 0, t = c.t || 0, r = c.r || 0, b = c.b || 0;
  return { sx: sw * l, sy: sh * t, cw: Math.max(1, sw * (1 - l - r)), ch: Math.max(1, sh * (1 - t - b)) };
}

// transform（中心x,y・scale・回転・不透明度・クロップ）付きで描画（動画・画像 共通）
function drawTransformed(src, sw, sh, transform) {
  if (!sw || !sh) return;
  const W = canvas.width, H = canvas.height;
  const tr = transform || { x: 0.5, y: 0.5, scale: 1 };
  const cr = croppedSrc(sw, sh, tr.crop);
  const mr = cr.cw / cr.ch;
  let bw = W, bh = W / mr;
  if (bh > H) { bh = H; bw = H * mr; }
  const w = bw * tr.scale, h = bh * tr.scale;
  const op = tr.opacity != null ? tr.opacity : 1;
  if (op <= 0.001) return;
  const cx = tr.x * W, cy = tr.y * H;
  const rot = tr.rotation ? tr.rotation * Math.PI / 180 : 0;
  ctx.save();
  if (op < 1) ctx.globalAlpha *= op;
  if (rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy); }
  const chroma = tr.chroma;
  if (chroma && chroma.on) {
    // クロマキー：描画先サイズのオフスクリーンへ描いてキー色を透過
    const dw = Math.max(1, Math.round(Math.abs(w))), dh = Math.max(1, Math.round(Math.abs(h)));
    const tmp = getChromaCanvas(dw, dh); const tctx = tmp.getContext('2d');
    tctx.clearRect(0, 0, dw, dh);
    try { tctx.drawImage(src, cr.sx, cr.sy, cr.cw, cr.ch, 0, 0, dw, dh); keyOut(tctx, dw, dh, chroma); ctx.drawImage(tmp, cx - w / 2, cy - h / 2, w, h); } catch (_) {}
  } else {
    try { ctx.drawImage(src, cr.sx, cr.sy, cr.cw, cr.ch, cx - w / 2, cy - h / 2, w, h); } catch (_) {}
  }
  ctx.restore();
}

// クロマキー用オフスクリーンとキー処理
let _chromaCv = null;
function getChromaCanvas(w, h) { if (!_chromaCv) _chromaCv = document.createElement('canvas'); if (_chromaCv.width !== w) _chromaCv.width = w; if (_chromaCv.height !== h) _chromaCv.height = h; return _chromaCv; }
function hexToRgb(hex) { const h = (hex || '#00ff00').replace('#', ''); return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 }; }
function keyOut(tctx, w, h, chroma) {
  const k = hexToRgb(chroma.key || '#00ff00');
  const sim = (chroma.similarity != null ? chroma.similarity : 0.3) * 441; // 最大色距離 sqrt(3*255^2)
  const img = tctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.sqrt((d[i] - k.r) ** 2 + (d[i + 1] - k.g) ** 2 + (d[i + 2] - k.b) ** 2);
    if (dist < sim) d[i + 3] = 0;
  }
  tctx.putImageData(img, 0, 0);
}

// drawTransformed と同じ式で「描画される矩形」を返す（当たり判定・選択枠用）
function transformedBBox(sw, sh, transform) {
  const W = canvas.width, H = canvas.height;
  const tr = transform || { x: 0.5, y: 0.5, scale: 1 };
  const cr = croppedSrc(sw || 16, sh || 9, tr.crop);
  const mr = cr.cw / cr.ch;
  let bw = W, bh = W / mr;
  if (bh > H) { bh = H; bw = H * mr; }
  const w = bw * tr.scale, h = bh * tr.scale;
  return { x: tr.x * W - w / 2, y: tr.y * H - h / 2, w, h };
}
// drawScaled（フィット・中央）と同じ式の矩形（ベース動画の選択用）
function scaledBBox(sw, sh) {
  const W = canvas.width, H = canvas.height;
  const r = (sw || 16) / (sh || 9);
  let dw = W, dh = W / r;
  if (dh > H) { dh = H; dw = H * r; }
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
}

// 戻り値: 'ok' | 'loading' | 'ffloading' | 'fferror' （診断表示用）
// ベース動画も transform（位置・サイズ）を反映する。scale=1・中央なら全画面フィットと同じ。
function drawVideoFrame(clip, t) {
  const tr = transformAt(clip, t - clip.start);
  // 通常パス：<video> が復号できていればそのフレームを描画
  if (video.videoWidth && video.videoHeight && video.readyState >= 2) {
    drawTransformed(video, video.videoWidth, video.videoHeight, tr);
    return 'ok';
  }
  // フォールバック：内蔵プレーヤーで映らない場合は FFmpeg で抽出したフレームを描画
  const m = clip && mediaById(clip.mediaId);
  if (!m) return null;
  const elapsed = performance.now() - loadStartPerf;
  const failed = (video.error != null) || (elapsed > 800);
  if (!failed) return elapsed > 300 ? 'loading' : null; // 読み込み中（短時間ならメッセージ抑制）
  const srcT = clip.in + (t - clip.start) * clipSpeed(clip);
  const img = getFfFrame(m, srcT);
  if (img) { drawTransformed(img, img.naturalWidth, img.naturalHeight, tr); ffLastImg = img; return 'ok'; }
  if (ffLastImg && ffLastImg.naturalWidth) { drawTransformed(ffLastImg, ffLastImg.naturalWidth, ffLastImg.naturalHeight, tr); return 'ok'; }
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

function drawMediaClip(clip, tf) {
  const img = imgCache.get(clip.mediaId);
  if (!img || !img.complete || !img.naturalWidth) return;
  drawTransformed(img, img.naturalWidth, img.naturalHeight, tf || clip.transform);
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
  ctx.globalAlpha *= a.alpha * (c.opacity != null ? c.opacity : 1);
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

  // 下から上へ各 visual トラックを合成。トラックは種別に縛られず、
  // クリップの kind（video/image/text）ごとに描画する。
  for (const track of tracksBottomToTop()) {
    if (track.kind !== 'visual') continue; // audio は描画対象外
    const isBase = !!track.base;
    for (const c of track.clips) {
      if (t < c.start - 1e-6 || t >= clipEnd(c) + 1e-6) continue;
      const fa = clipFadeAlpha(c, t); // フェードイン/アウトのアルファ
      if (fa <= 0.001) continue;
      ctx.globalAlpha = fa;
      if (c.kind === 'text') {
        // 当たり判定用は素の bbox を別途取得（アニメ変形前）
        const bbox = drawTextClipAnimated(c, t) || measureTelop(c);
        hitBoxes.push({ clip: c, trackId: track.id, bbox, kind: 'text', isBase });
      } else if (c.kind === 'image') {
        const tf = transformAt(c, t - c.start);
        drawMediaClip(c, tf);
        const img = imgCache.get(c.mediaId);
        if (img && img.complete && img.naturalWidth) {
          hitBoxes.push({ clip: c, trackId: track.id, bbox: transformedBBox(img.naturalWidth, img.naturalHeight, tf), kind: 'image', isBase });
        }
      } else if (c.kind === 'video') {
        const tf = transformAt(c, t - c.start);
        if (isBase) {
          baseStatus = drawVideoFrame(c, t); // ベースは #previewVideo（音声・コーデックフォールバック）
          const bb = (video.videoWidth && video.videoHeight)
            ? transformedBBox(video.videoWidth, video.videoHeight, tf)
            : { x: 0, y: 0, w: canvas.width, h: canvas.height };
          hitBoxes.push({ clip: c, trackId: track.id, bbox: bb, kind: 'video', isBase: true });
        } else {
          const el = getTrackVideoEl(track.id);
          if (el.videoWidth && el.readyState >= 2) drawTransformed(el, el.videoWidth, el.videoHeight, tf);
          hitBoxes.push({ clip: c, trackId: track.id, bbox: transformedBBox(el.videoWidth, el.videoHeight, tf), kind: 'video', isBase: false });
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // 選択枠＋四隅のリサイズハンドル
  const sel = getSelection();
  if (sel) {
    const hit = hitBoxes.find((h) => h.clip.id === sel.clipId);
    if (hit && hit.bbox) {
      ctx.save();
      ctx.strokeStyle = '#5b8cff'; ctx.setLineDash([8, 6]); ctx.lineWidth = Math.max(2, H * 0.004);
      ctx.strokeRect(hit.bbox.x, hit.bbox.y, hit.bbox.w, hit.bbox.h);
      ctx.restore();
      if (isDraggable(hit)) drawHandles(hit.bbox); // 大きさ変更用の丸ハンドル
    }
  }
  if (guidesOn) drawGuides();
  updateStatus(baseStatus);
  updateReadout(t);
}

// セーフゾーン・三分割グリッド・中央十字のガイド
export function toggleGuides() {
  guidesOn = !guidesOn;
  try { localStorage.setItem('telora.guides', guidesOn ? '1' : '0'); } catch (_) {}
  render(getPlayhead());
  return guidesOn;
}
export function getGuides() { return guidesOn; }
function drawGuides() {
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.lineWidth = Math.max(1, H * 0.0015);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.setLineDash([7, 7]);
  for (const a of [0.05, 0.1]) ctx.strokeRect(W * a, H * a, W * (1 - 2 * a), H * (1 - 2 * a));
  ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  for (let i = 1; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(W * i / 3, 0); ctx.lineTo(W * i / 3, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H * i / 3); ctx.lineTo(W, H * i / 3); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath(); ctx.moveTo(W / 2, H * 0.45); ctx.lineTo(W / 2, H * 0.55);
  ctx.moveTo(W * 0.46, H / 2); ctx.lineTo(W * 0.54, H / 2); ctx.stroke();
  ctx.restore();
}

// 四隅の丸ハンドル（リサイズ用）を描画
function handleRadius() { return Math.max(5, Math.min(canvas.width, canvas.height) * 0.013); }
function bboxCorners(b) { return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]; }
function drawHandles(b) {
  const r = handleRadius();
  ctx.save();
  for (const [cx, cy] of bboxCorners(b)) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.35); ctx.strokeStyle = '#5b8cff'; ctx.stroke();
  }
  ctx.restore();
}
// 指定点が選択クリップの四隅ハンドル上か（リサイズ開始判定）
function cornerAt(b, p) {
  const tol = handleRadius() * 1.8;
  const corners = bboxCorners(b);
  for (let i = 0; i < corners.length; i++) {
    if (Math.hypot(p.x - corners[i][0], p.y - corners[i][1]) <= tol) return i;
  }
  return null;
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
      setPlayhead(total); syncBaseVideo(total, false); syncVideoTracks(total, false); syncAudioClips(total, false); render(total); setPlaying(false);
      if (video && !video.paused) video.pause();
    } else {
      setPlayhead(t); syncBaseVideo(t, true); syncVideoTracks(t, true); syncAudioClips(t, true); render(t);
    }
  } else {
    // 停止中も毎フレーム再描画（同期は drift>tol のときだけシークするので安定）
    const t = getPlayhead();
    syncBaseVideo(t, false);
    syncVideoTracks(t, false);
    syncAudioClips(t, false);
    render(t);
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
export function pause() { if (video && !video.paused) video.pause(); stopAllAudio(); stopAllTrackVideos(); setPlaying(false); }
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
// クリップの中心位置（正規化）。テロップは x,y、画像・動画は transform.x,y。
function clipPos(clip) {
  if (clip.kind === 'text') return { x: clip.x, y: clip.y };
  const tr = transformAt(clip, getPlayhead() - clip.start);
  return { x: tr.x, y: tr.y };
}
function setClipPos(clip, x, y) {
  if (clip.kind === 'text') { clip.x = x; clip.y = y; return; }
  if (!clip.transform) clip.transform = { x: 0.5, y: 0.5, scale: 1 };
  if (hasKeyframes(clip)) setKeyframe(clip, getPlayhead() - clip.start, { x, y }); // キーフレーム編集
  else { clip.transform.x = x; clip.transform.y = y; }
}
// ドラッグで位置・サイズを変えられるか（テロップ・画像・動画＝ベース含む）
function isDraggable(hit) { return hit && (hit.kind === 'text' || hit.kind === 'image' || hit.kind === 'video'); }
// 指定座標で最前面（配列末尾＝上の層）のクリップを返す
function hitAt(p) {
  for (let i = hitBoxes.length - 1; i >= 0; i--) {
    const b = hitBoxes[i].bbox;
    if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return hitBoxes[i];
  }
  return null;
}

function onPointerDown(e) {
  const p = clientToFrame(e);
  // 1) 選択中クリップの四隅ハンドル → リサイズ開始
  const sel = getSelection();
  if (sel) {
    const selHit = hitBoxes.find((h) => h.clip.id === sel.clipId);
    if (selHit && isDraggable(selHit) && cornerAt(selHit.bbox, p) != null) {
      e.preventDefault();
      const b = selHit.bbox;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const clip = selHit.clip;
      dragState = {
        mode: 'resize', clip, historyPushed: false, cx, cy,
        d0: Math.max(1, Math.hypot(p.x - cx, p.y - cy)),
        origScale: clip.kind === 'text' ? null : (transformAt(clip, getPlayhead() - clip.start).scale || 1),
        origSize: clip.kind === 'text' ? clip.size : null,
      };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
  }
  // 2) 通常ヒット（選択＋移動）。上の層が優先（hitBoxes は下→上の順で push）
  const hit = hitAt(p);
  if (!hit) return;
  e.preventDefault();
  setSelection({ trackId: hit.trackId, clipId: hit.clip.id });
  if (!isDraggable(hit)) return; // ベース動画などは選択のみ
  // オフセットは正規化座標で保持（途中で解像度が変わってもズレない）
  const c = clipPos(hit.clip);
  dragState = { mode: 'move', clip: hit.clip, historyPushed: false, offNX: p.x / canvas.width - c.x, offNY: p.y / canvas.height - c.y };
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
}
function onPointerMove(e) {
  if (!dragState) {
    // ホバー時のカーソル：四隅ハンドル上は resize、クリップ本体上は move
    if (canvas) {
      const p = clientToFrame(e);
      let cursor = 'default';
      const sel = getSelection();
      if (sel) { const sh = hitBoxes.find((h) => h.clip.id === sel.clipId); if (sh && isDraggable(sh) && cornerAt(sh.bbox, p) != null) cursor = 'nwse-resize'; }
      if (cursor === 'default' && isDraggable(hitAt(p))) cursor = 'move';
      canvas.style.cursor = cursor;
    }
    return;
  }
  if (!dragState.historyPushed) { pushHistory(); dragState.historyPushed = true; }
  const p = clientToFrame(e);
  if (dragState.mode === 'resize') {
    // 中心からの距離比でサイズを変える（テロップ=文字サイズ, 動画/画像=拡大率）
    const ratio = Math.hypot(p.x - dragState.cx, p.y - dragState.cy) / dragState.d0;
    if (dragState.clip.kind === 'text') {
      dragState.clip.size = clamp(dragState.origSize * ratio, 0.02, 0.5);
    } else {
      const clip = dragState.clip;
      if (!clip.transform) clip.transform = { x: 0.5, y: 0.5, scale: 1 };
      const sc = clamp(dragState.origScale * ratio, 0.05, 4);
      if (hasKeyframes(clip)) setKeyframe(clip, getPlayhead() - clip.start, { scale: sc });
      else clip.transform.scale = sc;
    }
  } else {
    const nx = clamp(p.x / canvas.width - dragState.offNX, 0, 1);
    const ny = clamp(p.y / canvas.height - dragState.offNY, 0, 1);
    setClipPos(dragState.clip, nx, ny);
  }
  noteDirty();
  render(getPlayhead());
  emit('telop-live', dragState.clip.id); // プレビュー再描画＋インスペクタのスライダー同期
}
function onPointerUp() { if (dragState) dragState = null; }
