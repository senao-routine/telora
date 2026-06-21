// マイク録音：MediaRecorder で録音 → FFmpeg で wav 化（main）→ 素材として取り込み、再生位置の音声トラックへ挿入。
import { importMedia, addClipFromMedia } from './media.js';
import { getPlayhead } from './state.js';
import { toast } from './ui.js';

let recorder = null;
let chunks = [];
let stream = null;
let startedAt = 0;
let tick = null;
let onStateChange = null; // (state) => void  state: 'recording'|'idle'|'saving'

export function isRecording() { return !!recorder && recorder.state === 'recording'; }

export function setRecorderListener(fn) { onStateChange = fn; }
function emitState(s, extra) { if (onStateChange) onStateChange(s, extra); }

// 録音の開始/停止トグル
export async function toggleRecording() {
  if (isRecording()) { stopRecording(); return; }
  await startRecording();
}

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('この環境ではマイクを利用できません', 'err'); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    toast('マイクへのアクセスが許可されませんでした', 'err'); return;
  }
  chunks = [];
  let mime = '';
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const c of cands) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) { mime = c; break; } }
  try { recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
  catch (e) { toast('録音を開始できませんでした', 'err'); cleanupStream(); return; }

  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = onRecordingStop;
  recorder.start();
  startedAt = performance.now();
  emitState('recording', { seconds: 0 });
  tick = setInterval(() => emitState('recording', { seconds: (performance.now() - startedAt) / 1000 }), 200);
  toast('録音中… もう一度押すと停止します');
}

function stopRecording() {
  if (tick) { clearInterval(tick); tick = null; }
  try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
}

async function onRecordingStop() {
  emitState('saving');
  cleanupStream();
  const type = (recorder && recorder.mimeType) || 'audio/webm';
  const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'mp4' : 'webm';
  recorder = null;
  const blob = new Blob(chunks, { type });
  chunks = [];
  if (!blob.size) { toast('録音データが空でした', 'err'); emitState('idle'); return; }
  try {
    const buf = await blob.arrayBuffer();
    const base64 = base64FromBuffer(buf);
    const res = await window.api.saveRecording({ base64, ext });
    if (!res || !res.ok) { toast('録音の保存に失敗しました', 'err'); emitState('idle'); return; }
    const added = await importMedia([res.path], { addToTimeline: false });
    const media = added && added[0];
    if (media) { addClipFromMedia(media.id, { start: getPlayhead(), silent: true }); toast('録音を音声トラックに挿入しました', 'ok'); }
    else toast('録音の取り込みに失敗しました', 'err');
  } catch (e) {
    toast('録音処理でエラーが発生しました: ' + String(e), 'err');
  }
  emitState('idle');
}

function cleanupStream() { if (stream) { for (const t of stream.getTracks()) { try { t.stop(); } catch (_) {} } stream = null; } }

// ArrayBuffer → base64（大きすぎない録音想定。チャンクで変換しスタック超過を防ぐ）
function base64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
