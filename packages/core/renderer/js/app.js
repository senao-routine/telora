// アプリ起動・全モジュールの結線
import { initPreview, togglePlay, play, pause, seek, toggleGuides, getGuides } from './preview.js';
import { initTimeline, zoomIn, zoomOut, zoomFit, ensurePlayheadVisible } from './timeline.js';
import { initInspector } from './inspector.js';
import { renderMediaBin, pickAndImport, importMedia, isSupportedMedia } from './media.js';
import {
  splitAtPlayhead, deleteSelection, addTelopAtPlayhead, cutBefore, cutAfter, deleteSelectedRange,
  copySelection, pasteClipboard, cutSelection, duplicateSelection, applyCrossfade,
} from './edit.js';
import { runExport } from './export-ui.js';
import { saveProject, openProject, openProjectPath, getRecents, updateTitle } from './project-io.js';
import { importSrtFromFile, exportSrt } from './import-srt.js';
import { importXmlFromFile } from './import-xml.js';
import { runTranscribe } from './transcribe-ui.js';
import { toggleProxy, proxyEnabled } from './proxy.js';
import { toggleRecording, setRecorderListener } from './recorder.js';
import {
  on, emit, getUI, getProject, undo, redo, getPlayhead, setPlayhead, totalDuration,
  isPlaying, pushHistory, noteDirty, addTrack, selectAllTelops, newProject,
  getTool, setTool, toggleRangeTool, toggleMarkerAtPlayhead, nextEditPoint,
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
  wirePanelResize();
  wireHome();
  applyLibView();
  // ②MCP / AI版: MCP ブリッジを起動（外部AIエージェントの操作を EditCommands へ橋渡し）
  const _model = (window.api && window.api.model) || 'base';
  if (_model === 'mcp' || _model === 'ai') {
    import('./mcp-bridge.js').then((m) => m.initMcpBridge()).catch((e) => console.log('[mcp-bridge] load failed', e));
  }
  // ③チャット / AI版: アプリ内AIチャットパネルを起動
  if (_model === 'chat' || _model === 'ai') {
    import('./chat-panel.js').then((m) => m.initChatPanel()).catch((e) => console.log('[chat-panel] load failed', e));
  }
  // ポップオーバーの外側クリック / Esc で閉じる
  window.addEventListener('click', () => closeAllPopovers());
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllPopovers(); }, true);

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
  $('btnTranscribe').onclick = () => runTranscribe();
  $('btnProxy').onclick = async () => { const on = await toggleProxy(); $('btnProxy').classList.toggle('active', on); };
  $('btnProxy').classList.toggle('active', proxyEnabled());
  $('btnOpen').onclick = () => openProject();
  $('btnSave').onclick = () => saveProject();
  $('btnExport').onclick = () => runExport();

  // 書き出し設定ポップオーバー（解像度・画質・形式・HW・静止画・SRT書き出しをまとめて整理）
  setupPopover('btnExportSettings', 'exportSettings');
  $('btnExportSrtMenu').onclick = () => { closeAllPopovers(); exportSrt(); };

  // メディア「＋」＝読み込みメニュー（素材／字幕SRT／編集XML を1か所に集約）
  setupPopover('btnLibImport', 'libImportMenu');
  $('libImportMenu').querySelectorAll('.popover-item').forEach((b) => {
    b.onclick = () => {
      closeAllPopovers();
      const act = b.dataset.act;
      if (act === 'media') pickAndImport();
      else if (act === 'srt') importSrtFromFile();
      else if (act === 'xml') importXmlFromFile();
    };
  });
  $('btnLibView').onclick = () => toggleLibView();

  $('btnSnapshot').onclick = async () => {
    closeAllPopovers();
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

// ---- ポップオーバー（書き出し設定・読み込みメニュー） ----
function closeAllPopovers() {
  document.querySelectorAll('.popover:not([hidden])').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('.popover-wrap .open').forEach((b) => b.classList.remove('open'));
}
function setupPopover(btnId, popId) {
  const btn = $(btnId), pop = document.getElementById(popId);
  if (!btn || !pop) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    closeAllPopovers();
    pop.hidden = !willOpen;
    btn.classList.toggle('open', willOpen);
  });
  pop.addEventListener('click', (e) => e.stopPropagation()); // 内部クリックで閉じない
}
// メディア一覧の表示モード：一覧 → グリッド小 → グリッド大 を循環。
// アイコンは現在のモード（中身フレームが並ぶ様子）を示すグリフで表す。
const LIB_VIEWS = ['list', 'grid', 'grid-lg'];
const LIB_VIEW_META = {
  list:    { cls: '',             ico: '☰',  title: '表示: 一覧（クリックでグリッド小）' },
  grid:    { cls: 'view-grid',    ico: '▦',  title: '表示: グリッド小（クリックでグリッド大）' },
  'grid-lg': { cls: 'view-grid-lg', ico: '▣', title: '表示: グリッド大（クリックで一覧）' },
};
function getLibView() {
  let v = 'list';
  try { v = localStorage.getItem('tce.libView') || 'list'; } catch (_) {}
  return LIB_VIEWS.includes(v) ? v : 'list'; // 旧値(compact等)は list 扱い
}
function setLibView(v) {
  if (!LIB_VIEWS.includes(v)) v = 'list';
  const list = document.getElementById('mediaList');
  if (list) {
    LIB_VIEWS.forEach((m) => { const c = LIB_VIEW_META[m].cls; if (c) list.classList.remove(c); });
    const cls = LIB_VIEW_META[v].cls; if (cls) list.classList.add(cls);
  }
  const b = $('btnLibView'); if (b) { b.textContent = LIB_VIEW_META[v].ico; b.title = LIB_VIEW_META[v].title; }
  try { localStorage.setItem('tce.libView', v); } catch (_) {}
}
function toggleLibView() {
  const cur = getLibView();
  const next = LIB_VIEWS[(LIB_VIEWS.indexOf(cur) + 1) % LIB_VIEWS.length];
  setLibView(next);
}
function applyLibView() { setLibView(getLibView()); }

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
  $('btnCrossfade').onclick = () => applyCrossfade();
  $('btnAddTrack').onclick = () => { addTrack('visual'); toast('トラックを追加しました（動画・画像・テロップを自由に配置できます）'); };
  $('btnAddAudioLayer').onclick = () => { addTrack('audio'); toast('音声トラックを追加しました'); };
  // マイク録音（押すたびに開始/停止）。状態に応じてボタン表示を更新。
  const recBtn = $('btnRecord');
  setRecorderListener((st, extra) => {
    if (st === 'recording') { recBtn.classList.add('recording'); const s = Math.floor((extra && extra.seconds) || 0); recBtn.innerHTML = `<span class="ico">■</span> 停止 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
    else if (st === 'saving') { recBtn.classList.remove('recording'); recBtn.innerHTML = '<span class="ico">⏳</span> 保存中…'; }
    else { recBtn.classList.remove('recording'); recBtn.innerHTML = '<span class="ico">🎤</span> 録音'; }
  });
  recBtn.onclick = () => toggleRecording();
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
    // ↓＝次のクリップ境界（前方）へ、↑＝前のクリップ境界（戻る）へジャンプ
    if (e.key === 'ArrowDown') { e.preventDefault(); const p = nextEditPoint(getPlayhead(), +1); if (p != null) seek(p); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); const p = nextEditPoint(getPlayhead(), -1); if (p != null) seek(p); return; }
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

// 左メディアパネル / 右インスペクタの幅をドラッグで調整（localStorage に保持）
function wirePanelResize() {
  const ws = document.querySelector('.workspace');
  const lib = document.querySelector('.library');
  const insp = $('inspector');
  if (!ws) return;
  const lw = parseFloat(localStorage.getItem('tce.libW') || '');
  if (isFinite(lw)) ws.style.setProperty('--lib-w', clampN(lw, 160, 520) + 'px');
  const iw = parseFloat(localStorage.getItem('tce.inspW') || '');
  if (isFinite(iw)) ws.style.setProperty('--insp-w', clampN(iw, 180, 560) + 'px');
  setupSplitter($('libResize'), () => lib.offsetWidth, (w) => ws.style.setProperty('--lib-w', w + 'px'), 160, 520, +1, 'tce.libW');
  setupSplitter($('inspResize'), () => insp.offsetWidth, (w) => ws.style.setProperty('--insp-w', w + 'px'), 180, 560, -1, 'tce.inspW');
}
function setupSplitter(handle, getW, setW, min, max, dir, key) {
  if (!handle) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startW = getW();
    handle.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => { if (!dragging) return; setW(clampN(startW + dir * (e.clientX - startX), min, max)); });
  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false; handle.classList.remove('dragging');
    const w = clampN(getW(), min, max); setW(w);
    try { localStorage.setItem(key, String(Math.round(w))); } catch (_) {}
    emit('settings'); // プレビューのステージ寸法を再計算
  });
}

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
