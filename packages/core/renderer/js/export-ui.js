// 書き出し：レイヤを収集 → テロップ/オーバーレイ画像をフルフレームPNG化 → FFmpeg 実行
import {
  getProject, mediaById, clipDur, clipEnd, totalDuration, baseTrack, tracksBottomToTop, getRange,
  transformAt, hasKeyframes, clipSpeed,
} from './state.js';
import { renderTelopPng } from './render-telop.js';
import { fileUrl } from './util.js';
import { toast } from './ui.js';

let unsubProgress = null;

// 画像クリップを出力解像度のフルフレーム透過PNGとして描画（preview と同じ変形ロジック）
function renderImageOverlayPng(clip, media, W, H) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const cc = tr.crop || {}; const cl = cc.l || 0, ct = cc.t || 0, cr2 = cc.r || 0, cb = cc.b || 0;
        const sx = sw * cl, sy = sh * ct, csw = Math.max(1, sw * (1 - cl - cr2)), csh = Math.max(1, sh * (1 - ct - cb));
        const mr = csw / csh;
        let bw = W, bh = W / mr;
        if (bh > H) { bh = H; bw = H * mr; }
        const w = bw * tr.scale, h = bh * tr.scale;
        const cx = tr.x * W, cy = tr.y * H;
        const op = tr.opacity != null ? tr.opacity : 1;
        const rot = tr.rotation ? tr.rotation * Math.PI / 180 : 0;
        if (op < 1) ctx.globalAlpha = Math.max(0, op);
        if (rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy); }
        ctx.drawImage(img, sx, sy, csw, csh, cx - w / 2, cy - h / 2, w, h);
        resolve(c.toDataURL('image/png'));
      } catch (_) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = fileUrl(media.path);
  });
}

// transform（中心x,y・拡大率scale）から配置矩形 pw/ph/x/y を算出（preview の drawTransformed と同式・偶数/画面内クランプ）
function pipRect(m, transform, W, H) {
  const tr = transform || { x: 0.5, y: 0.5, scale: 1 };
  const cc = tr.crop || {}; const cl = cc.l || 0, ct = cc.t || 0, cr2 = cc.r || 0, cb = cc.b || 0;
  const cw = (m.width || 16) * (1 - cl - cr2), ch = (m.height || 9) * (1 - ct - cb);
  const mr = cw / ch;
  let bw = W, bh = W / mr; if (bh > H) { bh = H; bw = H * mr; }
  let pw = Math.round(bw * tr.scale), ph = Math.round(bh * tr.scale);
  pw = Math.min(W, Math.max(2, pw - (pw % 2))); ph = Math.min(H, Math.max(2, ph - (ph % 2)));
  let x = Math.round(tr.x * W - pw / 2), y = Math.round(tr.y * H - ph / 2);
  x = Math.max(0, Math.min(W - pw, x)); y = Math.max(0, Math.min(H - ph, y));
  x -= x % 2; y -= y % 2;
  return { pw, ph, x, y };
}

// キーフレームありクリップを書き出し用に時間サンプリングしてサブセグメント配列へ展開。
// 各サブセグメントは補間 transform から rect/opacity を持つ（速度・クロップ・クロマ・回転も反映）。
export function expandClipForExport(clip, m, W, H, kind) {
  const sp = clipSpeed(clip);
  const mk = (rectTf, inS, outS, startS, fIn, fOut) => {
    const rect = pipRect(m, rectTf, W, H);
    return {
      type: kind, path: m.path, in: inS, out: outS, start: startS, ...rect,
      opacity: rectTf.opacity != null ? rectTf.opacity : 1, rotation: rectTf.rotation || 0,
      crop: rectTf.crop || null, chroma: rectTf.chroma || null, speed: sp,
      fadeIn: fIn || 0, fadeOut: fOut || 0,
    };
  };
  if (!hasKeyframes(clip)) {
    return [mk(clip.transform || {}, clip.in, clip.out, clip.start, clip.fadeIn || 0, clip.fadeOut || 0)];
  }
  const dur = clipDur(clip);
  const n = Math.max(1, Math.ceil(dur / 0.12)); // ~0.12秒ごとにサンプリング
  const segDur = dur / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = i * segDur, t1 = (i + 1) * segDur, mid = (t0 + t1) / 2;
    const tf = transformAt(clip, mid);
    out.push(mk(tf, clip.in + t0 * sp, clip.in + t1 * sp, clip.start + t0,
      i === 0 ? (clip.fadeIn || 0) : 0, i === n - 1 ? (clip.fadeOut || 0) : 0));
  }
  return out;
}

// 書き出しペイロードを構築する（DOM非依存・純データ）。runExport と編集コマンド層（export）から共有。
// opts: { format, quality, hwaccel, range, muteBase?, outputPath? }。muteBase 省略時はベース層の muted を採用。
// 返り値: { ok, payload } / { ok:false, error }
export async function buildExportPayload(opts = {}) {
  const project = getProject();
  const W = project.settings.width, H = project.settings.height, fps = project.settings.fps || 30;
  const base = baseTrack();

  // ベーストラック（最下段 visual）の背景クリップ＝動画・画像。テロップはオーバーレイへ。
  const baseClips = [];
  if (base) {
    for (const c of base.clips) {
      if (c.kind === 'text') continue;
      const m = mediaById(c.mediaId);
      if (!m || clipDur(c) <= 0.02) continue;
      for (const seg of expandClipForExport(c, m, W, H, c.kind)) baseClips.push(seg);
    }
  }

  const duration = totalDuration();
  if (duration <= 0) return { ok: false, error: '書き出す内容がありません。素材を追加してください。' };

  const format = opts.format || 'mp4';
  const quality = opts.quality || 'normal';
  const hwaccel = !!opts.hwaccel;
  const range = opts.range || null;

  // 合成レイヤを「下→上」のトラック順で1本のリストにまとめる（上の不透明クリップが下を隠す）。
  const layers = [];
  const audioClips = []; // 音声トラック＋非ベース動画クリップの音声をここに集約
  for (const track of tracksBottomToTop()) {
    if (track.kind !== 'visual') continue;
    const isBase = !!track.base;
    const videoClips = [];
    const pngs = [];
    for (const clip of track.clips) {
      if (clipDur(clip) <= 0) continue;
      if (clip.kind === 'text') {
        pngs.push({ kind: 'png', dataUrl: renderTelopPng(clip, W, H, clip.opacity != null ? clip.opacity : 1), start: clip.start, end: clipEnd(clip), anim: clip.anim || 'none', fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
      } else if (clip.kind === 'image' && !isBase) {
        const m = mediaById(clip.mediaId);
        if (!m) continue;
        // eslint-disable-next-line no-await-in-loop
        const dataUrl = await renderImageOverlayPng(clip, m, W, H);
        if (dataUrl) pngs.push({ kind: 'png', dataUrl, start: clip.start, end: clipEnd(clip), anim: 'none', fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
      } else if (clip.kind === 'video' && !isBase) {
        const m = mediaById(clip.mediaId);
        if (!m || clipDur(clip) <= 0.02) continue;
        for (const seg of expandClipForExport(clip, m, W, H, clip.kind)) videoClips.push(seg);
        if (m.hasAudio !== false && !track.muted) audioClips.push({ path: m.path, in: clip.in, out: clip.out, start: clip.start, volume: clip.volume != null ? clip.volume : 1, speed: clip.speed || 1, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
      }
    }
    if (videoClips.length) layers.push({ kind: 'video', clips: videoClips });
    for (const p of pngs) layers.push(p);
  }

  // 音声トラックのクリップ（BGM・ナレーション等）。ミュート層は除外。
  for (const track of project.tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const clip of track.clips) {
      const m = mediaById(clip.mediaId);
      if (!m || clipDur(clip) <= 0.02) continue;
      audioClips.push({ path: m.path, in: clip.in, out: clip.out, start: clip.start, volume: clip.volume != null ? clip.volume : 1, speed: clip.speed || 1, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
    }
  }

  if (baseClips.length === 0 && layers.length === 0 && audioClips.length === 0) return { ok: false, error: '書き出す内容がありません。' };

  const muteBase = opts.muteBase != null ? !!opts.muteBase : !!(base && base.muted);
  const payload = { output: { width: W, height: H, fps }, duration, baseClips, layers, audioClips, outputPath: opts.outputPath || null, options: { format, quality, hwaccel, range, muteBase } };
  return { ok: true, payload };
}

export async function runExport() {
  const project = getProject();
  const duration = totalDuration();
  if (duration <= 0) { toast('書き出す内容がありません。素材を追加してください。', 'err'); return; }

  const tools = await window.api.checkTools();
  if (!tools.ffmpeg) { toast('FFmpeg が見つかりません。書き出しには FFmpeg が必要です。', 'err'); return; }

  // 書き出しオプション（形式・品質・HW・範囲）をUIから取得
  const fmtEl = document.getElementById('formatSelect');
  const qEl = document.getElementById('qualitySelect');
  const hwEl = document.getElementById('hwCheck');
  const format = (fmtEl && fmtEl.value) || 'mp4';
  const quality = (qEl && qEl.value) || 'normal';
  const hwaccel = !!(hwEl && hwEl.checked);
  const ext = format === 'mp3' ? 'mp3' : format === 'webm' ? 'webm' : 'mp4';
  let range = null;
  const r = getRange();
  if (r && (r.end - r.start) > 0.1) {
    range = { start: r.start, end: r.end };
    if (!confirm(`選択範囲 ${(r.end - r.start).toFixed(1)}秒 のみを書き出します。\n（キャンセルすると全体を書き出します）`)) range = null;
  }

  const baseName = (project.name && project.name !== '無題のプロジェクト' ? project.name : 'export');
  const dlg = await window.api.saveFileDialog({ title: '書き出し', defaultName: `${baseName}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (dlg.canceled || !dlg.filePath) return;

  showModal();
  setProgress(0, 'レイヤを準備しています…');

  const built = await buildExportPayload({ format, quality, hwaccel, range, outputPath: dlg.filePath });
  if (!built.ok) { hideModal(); toast(built.error, 'err'); return; }
  const payload = built.payload;

  if (unsubProgress) unsubProgress();
  unsubProgress = window.api.onExportProgress(({ ratio, message }) => setProgress(ratio, message));

  setProgress(0, '書き出しを開始しています…');
  let result;
  try { result = await window.api.exportVideo(payload); }
  catch (err) { result = { ok: false, error: String(err) }; }
  if (unsubProgress) { unsubProgress(); unsubProgress = null; }

  if (result.ok) { setProgress(1, '完了しました'); showDone(result.outputPath); }
  else if (result.canceled) { hideModal(); toast('書き出しをキャンセルしました'); }
  else showError(result.error || '書き出しに失敗しました');
}

// ---- モーダル ----
function modal() { return document.getElementById('exportModal'); }
function showModal() {
  modal().hidden = false;
  document.getElementById('exportTitle').textContent = '動画を書き出しています';
  const actions = document.getElementById('exportActions');
  actions.innerHTML = '';
  const cancel = document.createElement('button');
  cancel.className = 'btn'; cancel.textContent = 'キャンセル';
  cancel.onclick = async () => { await window.api.cancelExport(); };
  actions.appendChild(cancel);
}
function hideModal() { modal().hidden = true; }
function setProgress(ratio, message) {
  document.getElementById('exportBar').style.width = Math.round((ratio || 0) * 100) + '%';
  if (message) document.getElementById('exportMsg').textContent = message;
}
function showDone(outputPath) {
  document.getElementById('exportTitle').textContent = '✅ 書き出しが完了しました';
  document.getElementById('exportMsg').textContent = outputPath;
  const actions = document.getElementById('exportActions');
  actions.innerHTML = '';
  const openBtn = document.createElement('button'); openBtn.className = 'btn btn-primary'; openBtn.textContent = '動画を開く'; openBtn.onclick = () => window.api.openPath(outputPath);
  const folderBtn = document.createElement('button'); folderBtn.className = 'btn'; folderBtn.textContent = 'フォルダを表示'; folderBtn.onclick = () => window.api.showItem(outputPath);
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn'; closeBtn.textContent = '閉じる'; closeBtn.onclick = hideModal;
  actions.append(openBtn, folderBtn, closeBtn);
  toast('書き出しが完了しました', 'ok');
}
function showError(msg) {
  document.getElementById('exportTitle').textContent = '⚠️ 書き出しに失敗しました';
  document.getElementById('exportMsg').textContent = (msg || '').slice(0, 400);
  const actions = document.getElementById('exportActions');
  actions.innerHTML = '';
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn'; closeBtn.textContent = '閉じる'; closeBtn.onclick = hideModal;
  actions.appendChild(closeBtn);
}
