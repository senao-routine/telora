// 文字起こし → テロップ自動生成（ローカル Whisper）。結果の SRT は既存のインポートでテロップ化する。
import { getProject, getSelection, findClip, mediaById } from './state.js';
import { importSrtText } from './import-srt.js';
import { toast } from './ui.js';

let unsub = null;

// 文字起こし対象の素材を選ぶ：選択クリップ(動画/音声) → 最初の音声 → 最初の動画
function pickSourceMedia() {
  const sel = getSelection();
  if (sel) {
    const f = findClip(sel.clipId);
    if (f && (f.clip.kind === 'video' || f.clip.kind === 'audio')) {
      const m = mediaById(f.clip.mediaId);
      if (m) return m;
    }
  }
  const project = getProject();
  return project.media.find((m) => m.type === 'audio')
    || project.media.find((m) => m.type === 'video')
    || null;
}

export async function runTranscribe() {
  const m = pickSourceMedia();
  if (!m) { toast('文字起こしする音声/動画を読み込んでください', 'err'); return; }

  showModal('文字起こししています');
  setProgress(0, 'エンジンを確認しています…');

  if (unsub) unsub();
  unsub = window.api.onTranscribeProgress(({ ratio, message }) => setProgress(ratio, message));

  let res;
  try { res = await window.api.transcribe({ mediaPath: m.path, language: 'ja' }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (unsub) { unsub(); unsub = null; }

  if (res.ok) {
    hideModal();
    importSrtText(res.srt); // 既存の SRT→テロップ生成を再利用
  } else if (res.needSetup) {
    showSetup(res.error);
  } else {
    showError(res.error || '文字起こしに失敗しました');
  }
}

// ---- モーダル（書き出しモーダルの DOM を再利用）----
function modal() { return document.getElementById('exportModal'); }
function showModal(title) {
  modal().hidden = false;
  document.getElementById('exportTitle').textContent = title;
  document.getElementById('exportBar').style.width = '0%';
  const actions = document.getElementById('exportActions');
  actions.innerHTML = '';
  const cancel = document.createElement('button');
  cancel.className = 'btn'; cancel.textContent = 'キャンセル';
  cancel.onclick = async () => { await window.api.cancelTranscribe(); hideModal(); };
  actions.appendChild(cancel);
}
function hideModal() { modal().hidden = true; }
function setProgress(ratio, message) {
  document.getElementById('exportBar').style.width = Math.round((ratio || 0) * 100) + '%';
  if (message) document.getElementById('exportMsg').textContent = message;
}
function showSetup(msg) {
  document.getElementById('exportTitle').textContent = '🎙 文字起こしには Whisper が必要です';
  document.getElementById('exportMsg').textContent = msg || '';
  closeOnly();
}
function showError(msg) {
  document.getElementById('exportTitle').textContent = '⚠️ 文字起こしに失敗しました';
  document.getElementById('exportMsg').textContent = (msg || '').slice(0, 500);
  closeOnly();
}
function closeOnly() {
  const actions = document.getElementById('exportActions');
  actions.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'btn'; close.textContent = '閉じる';
  close.onclick = hideModal;
  actions.appendChild(close);
}
