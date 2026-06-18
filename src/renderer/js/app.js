// アプリ起動・全モジュールの結線
import { initPreview, togglePlay, play, pause, seek, toggleGuides, getGuides } from './preview.js';
import { initTimeline, zoomIn, zoomOut, zoomFit, ensurePlayheadVisible } from './timeline.js';
import { initInspector } from './inspector.js';
import { renderMediaBin, pickAndImport, importMedia, isSupportedMedia } from './media.js';
import {
  splitAtPlayhead, deleteSelection, addTelopAtPlayhead, cutBefore, cutAfter, deleteSelectedRange,
  copySelection, pasteClipboard, cutSelection, duplicateSelection,
} from './edit.js';
import { runExport } from './export-ui.js';
import { saveProject, openProject, openProjectPath, getRecents, updateTitle } from './project-io.js';
import { importSrtFromFile, exportSrt } from './import-srt.js';
import { importXmlFromFile } from './import-xml.js';
import { runTranscribe } from './transcribe-ui.js';
import {
  on, emit, getUI, getProject, undo, redo, getPlayhead, setPlayhead, totalDuration,
  isPlaying, pushHistory, noteDirty, addTrack, selectAllTelops, newProject,
  getTool, setTool, toggleRangeTool, toggleMarkerAtPlayhead,
} from './state.js';
import { toast } from './ui.js';

function $(id) { return document.getElementById(id); }

window.addEventListener('DOMContentLoaded', async () => {
  initPreview();
  initTimeline();
  initInspector();
  renderMediaBin();
  updateTitle();

  wireTopbar();
  wireTransport();
  wireTimelineToolbar();
  wireMenu();
  wireKeyboard();
  wireFileDrop();
  wireTimelineResize();
  wireHome();

  on('dirty', updateTitle);
  on('project', updateTitle);
  on('playhead', () => { if (isPlaying()) ensurePlayheadVisible(); });
  on('playing', updatePlayButton);
  on('settings', syncResoSelect);
  syncResoSelect();

  showHome(); // 起動時はホーム（スタート）画面を表示

  try {
    const tools = await window.api.checkTools();
    if (!tools.ffmpeg) toast('注意: FFmpeg が見つかりません。書き出しには FFmpeg が必要です。', 'err');
  } catch (_) { /* noop */ }
});

// ---- ホーム（スタート）画面 ----
function showHome() { renderRecents(); $('homeScreen').hidden = false; }
function enterEditor() {
  $('homeScreen').hidden = true;
  emit('settings'); // プレビューのステージ寸法を再計算
}
function fmtDate(ts) {
  try {
    const d = new Date(ts); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (_) { return ''; }
}
function renderRecents() {
  const ul = $('recentList');
  if (!ul) return;
  ul.innerHTML = '';
  const recents = getRecents();
  if (!recents.length) {
    const li = document.createElement('li');
    li.className = 'recent-empty';
    li.textContent = 'まだプロジェクトがありません。「新規プロジェクト」から始めましょう。';
    ul.appendChild(li);
    return;
  }
  for (const r of recents) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    const name = document.createElement('div'); name.className = 'recent-name'; name.textContent = r.name || '(無題)';
    const date = document.createElement('div'); date.className = 'recent-date'; date.textContent = fmtDate(r.ts);
    const path = document.createElement('div'); path.className = 'recent-path'; path.textContent = r.path;
    li.append(name, date, path);
    li.onclick = async () => { const ok = await openProjectPath(r.path); if (ok) enterEditor(); else renderRecents(); };
    ul.appendChild(li);
  }
}
function wireHome() {
  $('homeNew').onclick = () => { newProject(); enterEditor(); };
  $('homeOpen').onclick = async () => { const ok = await openProject(); if (ok) enterEditor(); };
  $('homeImport').onclick = () => { newProject(); enterEditor(); pickAndImport(); };
  $('btnHome').onclick = () => {
    if (getUI().dirty && !confirm('保存していない変更があります。ホームに戻りますか？')) return;
    showHome();
  };
}

function wireTopbar() {
  $('btnImport').onclick = pickAndImport;
  $('btnLibImport').onclick = pickAndImport;
  $('btnTranscribe').onclick = () => runTranscribe();
  $('btnImportSrt').onclick = () => importSrtFromFile();
  $('btnExportSrt').onclick = () => exportSrt();
  $('btnImportXml').onclick = () => importXmlFromFile();
  $('btnOpen').onclick = () => openProject();
  $('btnSave').onclick = () => saveProject();
  $('btnExport').onclick = () => runExport();
  $('btnSnapshot').onclick = async () => {
    const cv = document.getElementById('overlay');
    if (!cv) return;
    const dataUrl = cv.toDataURL('image/png');
    const dlg = await window.api.saveFileDialog({ title: '静止画を保存', defaultName: 'frame.png', filters: [{ name: 'PNG 画像', extensions: ['png'] }] });
    if (dlg.canceled || !dlg.filePath) return;
    const res = await window.api.writeDataUrl(dlg.filePath, dataUrl);
    toast(res.ok ? '静止画を保存しました' : ('保存に失敗しました: ' + res.error), res.ok ? 'ok' : 'err');
  };
  $('resoSelect').addEventListener('change', (e) => {
    const [w, h] = e.target.value.split('x').map(Number);
    pushHistory();
    const p = getProject(); p.settings.width = w; p.settings.height = h;
    noteDirty(); emit('settings'); emit('project');
  });
}

function syncResoSelect() {
  const s = getProject().settings;
  const sel = $('resoSelect');
  const val = `${s.width}x${s.height}`;
  [...sel.options].forEach((o) => { if (o.dataset.custom) o.remove(); });
  if (![...sel.options].some((o) => o.value === val)) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = `カスタム (${s.width}×${s.height})`; opt.dataset.custom = '1';
    sel.appendChild(opt);
  }
  sel.value = val;
}

function wireTransport() {
  $('btnPlay').onclick = togglePlay;
  $('btnToStart').onclick = () => seek(0);
  $('btnToEnd').onclick = () => seek(totalDuration());
  $('btnBack').onclick = () => seek(getPlayhead() - 1);
  $('btnFwd').onclick = () => seek(getPlayhead() + 1);
}
function updatePlayButton() { const b = $('btnPlay'); if (b) b.textContent = isPlaying() ? '⏸' : '▶'; }

function wireTimelineToolbar() {
  $('btnUndo').onclick = () => undo();
  $('btnRedo').onclick = () => redo();
  $('btnSplit').onclick = splitAtPlayhead;
  $('btnCutBefore').onclick = cutBefore;
  $('btnCutAfter').onclick = cutAfter;
  $('btnDelete').onclick = deleteSelection;
  $('btnRangeTool').onclick = () => toggleRangeTool();
  $('btnDeleteRange').onclick = () => deleteSelectedRange();
  on('tool', () => { const b = $('btnRangeTool'); if (b) b.classList.toggle('active', getTool() === 'range'); });
  $('btnAddTelop').onclick = () => addTelopAtPlayhead();
  $('btnSelectAllTelops').onclick = () => { selectAllTelops(); toast('全テロップを選択しました（右で一括編集）'); };
  $('btnAddTrack').onclick = () => { addTrack('visual'); toast('トラックを追加しました（動画・画像・テロップを自由に配置できます）'); };
  $('btnAddAudioLayer').onclick = () => { addTrack('audio'); toast('音声トラックを追加しました'); };
  $('btnMarker').onclick = () => { toggleMarkerAtPlayhead(); };
  $('btnGuides').onclick = () => { const on = toggleGuides(); $('btnGuides').classList.toggle('active', on); };
  $('btnGuides').classList.toggle('active', getGuides());
  $('btnZoomIn').onclick = zoomIn;
  $('btnZoomOut').onclick = zoomOut;
  $('btnZoomFit').onclick = zoomFit;
}

function wireMenu() {
  const api = window.api;
  api.onMenu('menu-import', () => pickAndImport());
  api.onMenu('menu-transcribe', () => runTranscribe());
  api.onMenu('menu-import-srt', () => importSrtFromFile());
  api.onMenu('menu-import-xml', () => importXmlFromFile());
  api.onMenu('menu-open', () => openProject());
  api.onMenu('menu-save', () => saveProject());
  api.onMenu('menu-export', () => runExport());
  api.onMenu('menu-playpause', () => togglePlay());
  api.onMenu('menu-split', () => splitAtPlayhead());
  api.onMenu('menu-cut-before', () => cutBefore());
  api.onMenu('menu-cut-after', () => cutAfter());
  api.onMenu('menu-delete', () => deleteSelection());
  api.onMenu('menu-add-telop', () => addTelopAtPlayhead());
}

function isTyping(e) {
  const t = e.target;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = isTyping(e);
    // テキスト編集中は標準のコピー/貼付/切取/Undo を OS に任せる
    if (typing && mod && ['z', 'y', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }   // コピー
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }   // 貼り付け
    if (mod && e.key.toLowerCase() === 'x') { e.preventDefault(); cutSelection(); return; }      // 切り取り
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; } // 複製
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject({ forceDialog: e.shiftKey }); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); runExport(); return; }
    if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); pickAndImport(); return; }
    if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); addTelopAtPlayhead(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); splitAtPlayhead(); return; }

    if (typing) return;
    if (mod) return; // 単独キーのショートカットは修飾キー併用時は無効化

    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (e.key.toLowerCase() === 'r') { e.preventDefault(); toggleRangeTool(); return; }   // 範囲選択モード切替
    if (e.key === 'Escape') { e.preventDefault(); setTool('select'); return; }              // 選択モードへ戻す
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; } // Backspace: 削除
    if (e.key.toLowerCase() === 's') { e.preventDefault(); splitAtPlayhead(); return; }  // S: 分割
    if (e.key.toLowerCase() === 'a') { e.preventDefault(); cutBefore(); return; }         // A: 前をカット
    if (e.key.toLowerCase() === 'd') { e.preventDefault(); cutAfter(); return; }          // D: 後ろをカット
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); toggleMarkerAtPlayhead(); return; } // M: マーカー

    const fps = getProject().settings.fps || 30;
    if (e.key === 'ArrowLeft') { e.preventDefault(); seek(getPlayhead() - (e.shiftKey ? 1 : 1 / fps)); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(getPlayhead() + (e.shiftKey ? 1 : 1 / fps)); return; }
    if (e.key === 'Home') { e.preventDefault(); seek(0); return; }
    if (e.key === 'End') { e.preventDefault(); seek(totalDuration()); return; }
  });
}

// タイムラインの高さをドラッグで調整（localStorage に保持）
function wireTimelineResize() {
  const handle = $('tlResize');
  const app = $('app');
  if (!handle || !app) return;
  // workspace に最低 240px を残してタイムライン高さを制限
  const maxH = () => Math.max(190, window.innerHeight - 50 - 240);
  const apply = (h) => { app.style.gridTemplateRows = `50px minmax(240px, 1fr) ${Math.round(h)}px`; };
  const saved = parseFloat(localStorage.getItem('tce.timelineH') || '');
  if (isFinite(saved) && saved >= 160) apply(clampN(saved, 160, maxH()));

  let dragging = false, startY = 0, startH = 0;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY;
    startH = document.querySelector('.timeline-panel').getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId); e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const h = clampN(startH + (startY - e.clientY), 160, maxH());
    apply(h);
  });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const h = document.querySelector('.timeline-panel').getBoundingClientRect().height;
    localStorage.setItem('tce.timelineH', String(Math.round(h)));
  });
}
function clampN(v, min, max) { return Math.max(min, Math.min(max, v)); }

function wireFileDrop() {
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    const paths = files.map((f) => f.path).filter((p) => p && isSupportedMedia(p));
    if (paths.length) importMedia(paths);
    else if (files.length) toast('対応していないファイル形式です', 'err');
  });
}
