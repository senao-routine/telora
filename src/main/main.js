'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { checkTools, probe, exportTimeline, extractFrame } = require('./export');
const { transcribe, detectEngine, cancel: cancelTranscribe } = require('./transcribe');

app.setName('Telora'); // メニュー等のアプリ名

let mainWindow = null;
let currentExportProc = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#1e1f26',
    title: 'Telora',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // デバッグ用：レンダラのコンソール / 読み込み失敗を標準出力へ
  if (process.env.TCE_DEBUG) {
    const wc = mainWindow.webContents;
    wc.on('console-message', (_e, level, message, line, source) => {
      console.log(`[renderer:${level}] ${message} (${source}:${line})`);
    });
    wc.on('did-fail-load', (_e, code, desc, url) => {
      console.log(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    wc.on('render-process-gone', (_e, details) => {
      console.log(`[render-process-gone] ${JSON.stringify(details)}`);
    });
    wc.on('did-finish-load', () => {
      console.log('[did-finish-load] renderer loaded');
      // 自動スモークテスト: 実行時エラーを集めて出力し終了
      if (process.env.TCE_SMOKE) {
        wc.executeJavaScript('JSON.stringify(window.__errors||[])').then((errs) => {
          console.log('[smoke] window.__errors = ' + errs);
          setTimeout(() => app.quit(), 300);
        });
      }
      // 任意スクリプト評価（レンダラ統合テスト用）。TCE_CAPTURE 指定時は実画面を PNG 保存。
      if (process.env.TCE_EVAL) {
        let code = '';
        try { code = fs.readFileSync(process.env.TCE_EVAL, 'utf8'); } catch (e) { console.log('[eval] read error ' + e); }
        wc.executeJavaScript(`(async()=>{try{return await (${code})()}catch(e){return {evalError:String(e&&e.stack||e)}}})()`)
          .then(async (r) => {
            console.log('[eval-result] ' + JSON.stringify(r));
            if (process.env.TCE_CAPTURE) {
              try {
                await new Promise((res) => setTimeout(res, 400));
                const img = await wc.capturePage();
                fs.writeFileSync(process.env.TCE_CAPTURE, img.toPNG());
                console.log('[capture] saved ' + process.env.TCE_CAPTURE + ' size=' + img.getSize().width + 'x' + img.getSize().height);
              } catch (e) { console.log('[capture-err] ' + e); }
            }
            setTimeout(() => app.quit(), 200);
          })
          .catch((e) => { console.log('[eval-throw] ' + e); setTimeout(() => app.quit(), 200); });
      }
    });
  }

  // 動画ファイルをローカル読込するため webSecurity の file:// 制限は許容
  mainWindow.on('closed', () => { mainWindow = null; });

  buildMenu();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel) => () => { if (mainWindow) mainWindow.webContents.send(channel); };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `${app.name} について` },
        { type: 'separator' },
        { role: 'hide', label: '隠す' },
        { role: 'hideOthers', label: 'ほかを隠す' },
        { role: 'unhide', label: 'すべて表示' },
        { type: 'separator' },
        { role: 'quit', label: '終了' },
      ],
    }] : []),
    {
      label: 'ファイル',
      submenu: [
        { label: '動画・画像を読み込む…', accelerator: 'CmdOrCtrl+I', click: send('menu-import') },
        { label: '音声から文字起こし（テロップ自動生成）…', click: send('menu-transcribe') },
        { label: 'SRT字幕を取り込む…', click: send('menu-import-srt') },
        { label: '編集データ(XML)を取り込む…', click: send('menu-import-xml') },
        { type: 'separator' },
        { label: 'プロジェクトを開く…', accelerator: 'CmdOrCtrl+O', click: send('menu-open') },
        { label: 'プロジェクトを保存…', accelerator: 'CmdOrCtrl+S', click: send('menu-save') },
        { type: 'separator' },
        { label: '動画を書き出す…', accelerator: 'CmdOrCtrl+E', click: send('menu-export') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: '終了' }]),
      ],
    },
    {
      label: '編集',
      submenu: [
        { label: '再生 / 一時停止', accelerator: 'Space', click: send('menu-playpause') },
        { label: 'クリップを分割', accelerator: 'CmdOrCtrl+B', click: send('menu-split') },
        { label: '再生位置より前をカット', click: send('menu-cut-before') },
        { label: '再生位置より後ろをカット', click: send('menu-cut-after') },
        { label: '選択を削除', accelerator: 'Delete', click: send('menu-delete') },
        { type: 'separator' },
        { label: 'テロップを追加', accelerator: 'CmdOrCtrl+T', click: send('menu-add-telop') },
      ],
    },
    {
      label: '表示',
      submenu: [
        { role: 'reload', label: '再読み込み' },
        { role: 'toggleDevTools', label: '開発者ツール' },
        { type: 'separator' },
        { role: 'resetZoom', label: '実際のサイズ' },
        { role: 'zoomIn', label: '拡大' },
        { role: 'zoomOut', label: '縮小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'フルスクリーン' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC ハンドラ ----

ipcMain.handle('check-tools', async () => {
  return await checkTools();
});

ipcMain.handle('probe', async (_e, filePath) => {
  return await probe(filePath);
});

ipcMain.handle('extract-frame', async (_e, { path: p, time, width }) => {
  return await extractFrame(p, time, width);
});

ipcMain.handle('detect-stt', async () => {
  const e = await detectEngine();
  return { available: !!e && e.type !== 'cpp-nomodel', engine: e ? e.type : null };
});

ipcMain.handle('transcribe', async (event, payload) => {
  const onProgress = (ratio, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) event.sender.send('transcribe-progress', { ratio, message });
  };
  return await transcribe(payload, onProgress);
});

ipcMain.handle('cancel-transcribe', async () => ({ ok: cancelTranscribe() }));

ipcMain.handle('open-videos', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '動画を読み込む',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '動画ファイル', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg'] },
      { name: 'すべてのファイル', extensions: ['*'] },
    ],
  });
  if (res.canceled) return { canceled: true, files: [] };
  return { canceled: false, files: res.filePaths };
});

ipcMain.handle('save-project-dialog', async (_e, defaultName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'プロジェクトを保存',
    defaultPath: defaultName || 'project.tceproj',
    filters: [{ name: 'Telop Cut Editor プロジェクト', extensions: ['tceproj', 'json'] }],
  });
  if (res.canceled) return { canceled: true };
  return { canceled: false, filePath: res.filePath };
});

ipcMain.handle('open-project-dialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'プロジェクトを開く',
    properties: ['openFile'],
    filters: [{ name: 'Telop Cut Editor プロジェクト', extensions: ['tceproj', 'json'] }],
  });
  if (res.canceled) return { canceled: true };
  return { canceled: false, filePath: res.filePaths[0] };
});

ipcMain.handle('write-file', async (_e, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('write-dataurl', async (_e, filePath, dataUrl) => {
  try {
    const b64 = String(dataUrl).replace(/^data:[^,]+,/, '');
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('read-file-buffer', async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { ok: true, base64: buf.toString('base64') };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('read-file', async (_e, filePath) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('open-file-dialog', async (_e, { title, filters } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: title || 'ファイルを開く',
    properties: ['openFile'],
    filters: filters || [{ name: 'すべてのファイル', extensions: ['*'] }],
  });
  if (res.canceled) return { canceled: true };
  return { canceled: false, filePath: res.filePaths[0] };
});

ipcMain.handle('export-dialog', async (_e, defaultName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '動画を書き出す',
    defaultPath: defaultName || 'export.mp4',
    filters: [{ name: 'MP4 動画', extensions: ['mp4'] }],
  });
  if (res.canceled) return { canceled: true };
  return { canceled: false, filePath: res.filePath };
});

// 汎用の保存ダイアログ（SRT・静止画など）
ipcMain.handle('save-file-dialog', async (_e, { title, defaultName, filters } = {}) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: title || '保存',
    defaultPath: defaultName || 'file',
    filters: filters || [{ name: 'すべてのファイル', extensions: ['*'] }],
  });
  if (res.canceled) return { canceled: true };
  return { canceled: false, filePath: res.filePath };
});

let exportCanceled = false;

ipcMain.handle('export', async (event, payload) => {
  exportCanceled = false;
  const onProgress = (ratio, message) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      event.sender.send('export-progress', { ratio, message });
    }
  };
  const registerProc = (proc) => { currentExportProc = proc; };
  const result = await exportTimeline(payload, onProgress, registerProc);
  currentExportProc = null;
  // ユーザーがキャンセルした場合はエラーではなくキャンセル扱いにする
  if (exportCanceled && !result.ok) return { ok: false, canceled: true };
  return result;
});

ipcMain.handle('cancel-export', async () => {
  exportCanceled = true;
  if (currentExportProc) {
    try { currentExportProc.kill('SIGKILL'); } catch (_) { /* noop */ }
    currentExportProc = null;
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('show-item', async (_e, filePath) => {
  try { shell.showItemInFolder(filePath); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('open-path', async (_e, filePath) => {
  try { await shell.openPath(filePath); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err) }; }
});

// ---- アプリライフサイクル ----

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
