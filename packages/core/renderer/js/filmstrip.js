// タイムライン上の動画クリップに「フィルムストリップ」（複数フレームのサムネ）を表示する。
// FFmpeg (window.api.extractFrame) でソース時刻のフレームを抽出し、ソース時刻を量子化してキャッシュ共有する。
import { emit } from './state.js';

export const FRAME_W = 78;     // フィルムストリップ1コマの表示幅(px)の目安
const THUMB_W = 160;           // 抽出する画像の幅(px)。クリップ高さに合わせて縮小表示
const BUCKET = 0.5;            // ソース時刻を 0.5s 単位に量子化 → ズーム変更でもキャッシュ再利用
const MAX_CONCURRENT = 2;      // 同時に走らせる ffmpeg 数（重くなりすぎないよう抑制）

const cache = new Map();       // key -> dataUrl文字列 / 'pending'
const failed = new Set();      // 失敗した key（再試行しない）
const queue = [];
let running = 0;
let emitTimer = null;

function bucketOf(t) { return Math.max(0, Math.round((t || 0) / BUCKET) * BUCKET); }
function key(mediaId, b) { return `${mediaId}@${b.toFixed(2)}`; }

// 取得済みフレームの dataUrl を返す（無ければ null）
export function getFrame(mediaId, t) {
  const v = cache.get(key(mediaId, bucketOf(t)));
  return (typeof v === 'string' && v !== 'pending') ? v : null;
}

// 未取得なら抽出キューに積む
export function requestFrame(mediaId, path, t) {
  if (!path) return;
  const b = bucketOf(t);
  const k = key(mediaId, b);
  if (cache.has(k) || failed.has(k)) return;
  cache.set(k, 'pending');
  queue.push({ k, mediaId, path, time: b });
  pump();
}

function scheduleEmit() {
  if (emitTimer) return;
  emitTimer = setTimeout(() => { emitTimer = null; emit('filmstrip'); }, 140); // まとめて再描画
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    Promise.resolve(window.api.extractFrame({ path: job.path, time: job.time, width: THUMB_W }))
      .then((res) => {
        if (res && res.ok && res.dataUrl) { cache.set(job.k, res.dataUrl); scheduleEmit(); }
        else { cache.delete(job.k); failed.add(job.k); }
      })
      .catch(() => { cache.delete(job.k); failed.add(job.k); })
      .finally(() => { running--; pump(); });
  }
}
