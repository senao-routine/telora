// オーディオ波形：素材を一度デコードしてピーク列を作りキャッシュ。タイムラインのクリップに表示する。
import { emit } from './state.js';

let actx = null;
const PEAKS = 2400; // 素材あたりのピーク数
const cache = new Map();   // mediaId -> { peaks: Float32Array, duration }
const pending = new Set();

function ctx() {
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; actx = AC ? new AC() : null; }
  return actx;
}

export function getWaveform(mediaId) { return cache.get(mediaId) || null; }

// 素材の波形ピークを用意（非同期・一度だけ）。完了時に 'waveform' を emit。
export async function ensureWaveform(media) {
  if (!media || media.type === 'image') return;
  if (media.hasAudio === false) return;
  if (cache.has(media.id) || pending.has(media.id)) return;
  if (!ctx()) return;
  pending.add(media.id);
  try {
    const res = await window.api.readFileBuffer(media.path);
    if (!res || !res.ok) { pending.delete(media.id); return; }
    const bin = atob(res.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const buf = await ctx().decodeAudioData(bytes.buffer);
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const n = Math.min(PEAKS, ch0.length);
    const peaks = new Float32Array(n);
    const step = Math.max(1, Math.floor(ch0.length / n));
    for (let i = 0; i < n; i++) {
      let m = 0; const s = i * step;
      for (let j = 0; j < step; j++) {
        const a = Math.abs(ch0[s + j] || 0); if (a > m) m = a;
        if (ch1) { const b = Math.abs(ch1[s + j] || 0); if (b > m) m = b; }
      }
      peaks[i] = m;
    }
    cache.set(media.id, { peaks, duration: buf.duration || (ch0.length / buf.sampleRate) });
    emit('waveform', media.id);
  } catch (_) { /* デコード不可は無視 */ }
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
