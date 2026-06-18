// 書き出し：レイヤを収集 → テロップ/オーバーレイ画像をフルフレームPNG化 → FFmpeg 実行
import {
  getProject, mediaById, clipDur, clipEnd, totalDuration, baseTrack, tracksBottomToTop,
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

export async function runExport() {
  const project = getProject();
  const W = project.settings.width, H = project.settings.height, fps = project.settings.fps || 30;
  const base = baseTrack();

  // ベーストラック（最下段 visual）の背景クリップ＝動画・画像。テロップはオーバーレイへ。
  // transform（位置・サイズ）も pw/ph/x/y にして渡す（scale=1・中央なら全画面フィット）。
  const baseClips = [];
  if (base) {
    for (const c of base.clips) {
      if (c.kind === 'text') continue; // テロップは overlays で処理
      const m = mediaById(c.mediaId);
      if (!m || clipDur(c) <= 0.02) continue;
      const rect = pipRect(m, c.transform, W, H);
      const op = (c.transform && c.transform.opacity != null) ? c.transform.opacity : 1;
      const rotation = (c.transform && c.transform.rotation) || 0;
      const crop = (c.transform && c.transform.crop) || null;
      const chroma = (c.transform && c.transform.chroma) || null;
      baseClips.push({ type: c.kind, path: m.path, in: c.in, out: c.out, start: c.start, opacity: op, rotation, crop, chroma, speed: c.speed || 1, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, ...rect });
    }
  }

  // オーバーレイ（下→上の順）：テロップ・オーバーレイ画像をフルフレームPNG化
  const duration = totalDuration();
  if (duration <= 0) { toast('書き出す内容がありません。素材を追加してください。', 'err'); return; }

  const tools = await window.api.checkTools();
  if (!tools.ffmpeg) { toast('FFmpeg が見つかりません。書き出しには FFmpeg が必要です。', 'err'); return; }

  const defaultName = (project.name && project.name !== '無題のプロジェクト' ? project.name : 'export') + '.mp4';
  const dlg = await window.api.exportDialog(defaultName);
  if (dlg.canceled || !dlg.filePath) return;

  showModal();
  setProgress(0, 'レイヤを準備しています…');

  // 合成レイヤを「下→上」のトラック順で1本のリストにまとめる。これにより上のトラックの
  // 不透明クリップ（動画・画像）が下を隠し、書き出しもプレビューと同じ重なり順になる（他ソフト同様）。
  // 各 visual トラック内では「動画レイヤ → 画像/テロップPNG」の順（同トラック内は時間が重ならない）。
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
        const { pw, ph, x, y } = pipRect(m, clip.transform, W, H);
        const op = (clip.transform && clip.transform.opacity != null) ? clip.transform.opacity : 1;
        const rotation = (clip.transform && clip.transform.rotation) || 0;
        const crop = (clip.transform && clip.transform.crop) || null;
        const chroma = (clip.transform && clip.transform.chroma) || null;
        videoClips.push({ type: clip.kind, path: m.path, in: clip.in, out: clip.out, start: clip.start, pw, ph, x, y, opacity: op, rotation, crop, chroma, speed: clip.speed || 1, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
        // 非ベース動画の音声もミックス対象に（音声を持つ素材のみ）
        if (m.hasAudio !== false) audioClips.push({ path: m.path, in: clip.in, out: clip.out, start: clip.start, volume: clip.volume != null ? clip.volume : 1, speed: clip.speed || 1, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
      }
    }
    if (videoClips.length) layers.push({ kind: 'video', clips: videoClips });
    for (const p of pngs) layers.push(p);
  }

  // 音声トラックのクリップ（BGM・ナレーション等）
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      const m = mediaById(clip.mediaId);
      if (!m || clipDur(clip) <= 0.02) continue;
      audioClips.push({ path: m.path, in: clip.in, out: clip.out, start: clip.start, volume: clip.volume != null ? clip.volume : 1, speed: clip.speed || 1, fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
    }
  }

  if (baseClips.length === 0 && layers.length === 0 && audioClips.length === 0) {
    hideModal();
    toast('書き出す内容がありません。', 'err');
    return;
  }

  const payload = { output: { width: W, height: H, fps }, duration, baseClips, layers, audioClips, outputPath: dlg.filePath };

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
