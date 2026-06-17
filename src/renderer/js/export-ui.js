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
        const mr = img.naturalWidth / img.naturalHeight;
        let bw = W, bh = W / mr;
        if (bh > H) { bh = H; bw = H * mr; }
        const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
        const w = bw * tr.scale, h = bh * tr.scale;
        ctx.drawImage(img, tr.x * W - w / 2, tr.y * H - h / 2, w, h);
        resolve(c.toDataURL('image/png'));
      } catch (_) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = fileUrl(media.path);
  });
}

export async function runExport() {
  const project = getProject();
  const W = project.settings.width, H = project.settings.height, fps = project.settings.fps || 30;
  const base = baseTrack();

  // メイントラックのクリップ
  const baseClips = [];
  if (base) {
    for (const c of base.clips) {
      const m = mediaById(c.mediaId);
      if (!m || clipDur(c) <= 0.02) continue;
      baseClips.push({ type: c.kind, path: m.path, in: c.in, out: c.out, start: c.start });
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

  const overlays = [];
  for (const track of tracksBottomToTop()) {
    if (track.base) continue;
    if (track.kind === 'text') {
      for (const clip of track.clips) {
        if (clipDur(clip) <= 0) continue;
        overlays.push({ dataUrl: renderTelopPng(clip, W, H), start: clip.start, end: clipEnd(clip), anim: clip.anim || 'none' });
      }
    } else {
      for (const clip of track.clips) {
        if (clip.kind !== 'image' || clipDur(clip) <= 0) continue;
        const m = mediaById(clip.mediaId);
        if (!m) continue;
        // eslint-disable-next-line no-await-in-loop
        const dataUrl = await renderImageOverlayPng(clip, m, W, H);
        if (dataUrl) overlays.push({ dataUrl, start: clip.start, end: clipEnd(clip), anim: 'none' });
      }
    }
  }

  // 非ベース動画トラック（PIP・重ね合成）。下→上の順で各レイヤをまとめる。
  const videoLayers = [];
  for (const track of tracksBottomToTop()) {
    if (track.base || track.kind !== 'video') continue;
    const clips = [];
    for (const clip of track.clips) {
      const m = mediaById(clip.mediaId);
      if (!m || clipDur(clip) <= 0.02) continue;
      // PIP の配置・サイズを preview の drawTransformed と同じ式で算出（偶数・画面内クランプ）
      const mr = (m.width || 16) / (m.height || 9);
      let bw = W, bh = W / mr; if (bh > H) { bh = H; bw = H * mr; }
      const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1 };
      let pw = Math.round(bw * tr.scale), ph = Math.round(bh * tr.scale);
      pw = Math.min(W, Math.max(2, pw - (pw % 2))); ph = Math.min(H, Math.max(2, ph - (ph % 2)));
      let x = Math.round(tr.x * W - pw / 2), y = Math.round(tr.y * H - ph / 2);
      x = Math.max(0, Math.min(W - pw, x)); y = Math.max(0, Math.min(H - ph, y));
      x -= x % 2; y -= y % 2;
      clips.push({ type: clip.kind, path: m.path, in: clip.in, out: clip.out, start: clip.start, pw, ph, x, y });
    }
    if (clips.length) videoLayers.push(clips);
  }

  // 音声トラックのクリップ（BGM・ナレーション等）
  const audioClips = [];
  for (const track of project.tracks) {
    if (track.kind !== 'audio') continue;
    for (const clip of track.clips) {
      const m = mediaById(clip.mediaId);
      if (!m || clipDur(clip) <= 0.02) continue;
      audioClips.push({ path: m.path, in: clip.in, out: clip.out, start: clip.start, volume: clip.volume != null ? clip.volume : 1 });
    }
  }

  if (baseClips.length === 0 && overlays.length === 0 && audioClips.length === 0 && videoLayers.length === 0) {
    hideModal();
    toast('書き出す内容がありません。', 'err');
    return;
  }

  const payload = { output: { width: W, height: H, fps }, duration, baseClips, videoLayers, overlays, audioClips, outputPath: dlg.filePath };

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
