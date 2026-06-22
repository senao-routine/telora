// 文字起こし → テロップ自動生成（ローカル Whisper）。
// 「選択クリップから」または「タイムライン全体から」を選び、対象区間の音声を抽出/ミックスして文字起こしする。
import { getProject, getSelection, findClip, mediaById, totalDuration } from './state.js';
import { importSrtText } from './import-srt.js';
import { toast } from './ui.js';

let unsub = null;

// タイムライン全体の音声セグメント（音声クリップ＋音声を持つ動画）を集める
function gatherTimelineAudio() {
  const segs = [];
  for (const tr of getProject().tracks) {
    for (const c of tr.clips) {
      if (c.kind === 'audio') {
        const m = mediaById(c.mediaId);
        if (m) segs.push({ path: m.path, in: c.in, out: c.out, start: c.start, volume: c.volume != null ? c.volume : 1 });
      } else if (c.kind === 'video') {
        const m = mediaById(c.mediaId);
        if (m && m.hasAudio !== false) segs.push({ path: m.path, in: c.in, out: c.out, start: c.start, volume: 1 });
      }
    }
  }
  return segs;
}

// 対象（選択クリップ / タイムライン全体）を選ぶダイアログ
function chooseSource() {
  return new Promise((resolve) => {
    modal().hidden = false;
    document.getElementById('exportTitle').textContent = '🎙 どこから文字起こししますか？';
    document.getElementById('exportBar').style.width = '0%';
    document.getElementById('exportMsg').textContent = '選択中のクリップの音声だけ、またはタイムライン全体の音声から、自動でテロップを作成します。';
    const actions = document.getElementById('exportActions');
    actions.innerHTML = '';
    const mk = (label, val, primary) => { const b = document.createElement('button'); b.className = 'btn' + (primary ? ' btn-primary' : ''); b.textContent = label; b.onclick = () => resolve(val); return b; };
    const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'キャンセル'; cancel.onclick = () => { hideModal(); resolve(null); };
    actions.append(mk('選択クリップから', 'clip', false), mk('タイムライン全体から', 'timeline', true), cancel);
  });
}

export async function runTranscribe() {
  const mode = await chooseSource();
  if (!mode) return;

  let segments, offset = 0, duration = 0;
  if (mode === 'clip') {
    const sel = getSelection();
    const f = sel && findClip(sel.clipId);
    if (!f || (f.clip.kind !== 'video' && f.clip.kind !== 'audio')) { showError('文字起こしする動画/音声クリップを選択してください'); return; }
    const m = mediaById(f.clip.mediaId);
    if (!m) { showError('素材が見つかりません'); return; }
    segments = [{ path: m.path, in: f.clip.in, out: f.clip.out, start: 0, volume: 1 }];
    offset = f.clip.start;                       // テロップを当該クリップの位置へ
    duration = Math.max(0, f.clip.out - f.clip.in);
  } else {
    segments = gatherTimelineAudio();
    if (!segments.length) { showError('タイムラインに音声がありません'); return; }
    offset = 0; duration = totalDuration();
  }

  showModal('文字起こししています');
  setProgress(0, '音声を準備しています…');
  let ext;
  try { ext = await window.api.extractAudio({ segments, duration }); }
  catch (e) { ext = { ok: false, error: String(e) }; }
  if (!ext || !ext.ok) { showError('音声の抽出に失敗しました\n' + (ext && ext.error || '')); return; }

  setProgress(0.1, 'エンジンを確認しています…');
  if (unsub) unsub();
  unsub = window.api.onTranscribeProgress(({ ratio, message }) => setProgress(0.1 + (ratio || 0) * 0.9, message));

  let res;
  try { res = await window.api.transcribe({ mediaPath: ext.path, language: 'ja' }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (unsub) { unsub(); unsub = null; }

  if (res.ok) {
    hideModal();
    importSrtText(res.srt, { offset }); // タイムライン位置に合わせて配置
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
