// オーディオ波形：FFmpeg(main)で素材のピーク列を抽出してキャッシュ。タイムラインのクリップに表示する。
// ファイル全体を renderer に読み込まずストリーム処理するため、大きな動画でも安全（以前の OOM クラッシュを回避）。
import { emit } from './state.js';

const PEAKS = 2400; // 素材あたりのピーク数
const cache = new Map();   // mediaId -> { peaks: number[], duration }
const pending = new Set();

export function getWaveform(mediaId) { return cache.get(mediaId) || null; }

// 素材の波形ピークを用意（非同期・一度だけ）。完了時に 'waveform' を emit。動画・音声どちらも対応。
export async function ensureWaveform(media) {
  if (!media || media.type === 'image') return;
  if (media.hasAudio === false) return;
  if (cache.has(media.id) || pending.has(media.id)) return;
  pending.add(media.id);
  try {
    const res = await window.api.audioPeaks({ path: media.path, buckets: PEAKS });
    if (res && res.ok && res.peaks && res.peaks.length) {
      cache.set(media.id, { peaks: res.peaks, duration: res.duration || media.duration || 1 });
      emit('waveform', media.id);
    }
  } catch (_) { /* 抽出不可は無視（無音/音声なし等） */ }
  pending.delete(media.id);
}

// クリップの [in,out] 区間の波形を canvas へ描画する
export function drawClipWaveform(canvas, mediaId, inSec, outSec, color) {
  const wf = cache.get(mediaId);
  if (!wf || !canvas) return false;
  const cx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  cx.clearRect(0, 0, W, H);
  const dur = wf.duration || 1;
  const i0 = Math.max(0, Math.floor(inSec / dur * wf.peaks.length));
  const i1 = Math.min(wf.peaks.length, Math.ceil(outSec / dur * wf.peaks.length));
  const span = Math.max(1, i1 - i0);
  cx.fillStyle = color || 'rgba(255,255,255,0.55)';
  const mid = H / 2;
  for (let x = 0; x < W; x++) {
    const pi = i0 + Math.floor(x / W * span);
    const v = wf.peaks[pi] || 0;
    const bh = Math.max(1, v * (H - 2));
    cx.fillRect(x, mid - bh / 2, 1, bh);
  }
  return true;
}
