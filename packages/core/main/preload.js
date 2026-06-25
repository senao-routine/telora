'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // FFmpeg / FFprobe の確認
  checkTools: () => ipcRenderer.invoke('check-tools'),
  probe: (filePath) => ipcRenderer.invoke('probe', filePath),
  extractFrame: (opts) => ipcRenderer.invoke('extract-frame', opts),

  // ファイルダイアログ
  openVideos: () => ipcRenderer.invoke('open-videos'),
  saveProjectDialog: (defaultName) => ipcRenderer.invoke('save-project-dialog', defaultName),
  openProjectDialog: () => ipcRenderer.invoke('open-project-dialog'),
  exportDialog: (defaultName) => ipcRenderer.invoke('export-dialog', defaultName),
  saveFileDialog: (opts) => ipcRenderer.invoke('save-file-dialog', opts),
  openFileDialog: (opts) => ipcRenderer.invoke('open-file-dialog', opts),

  // ファイル入出力
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  writeDataUrl: (filePath, dataUrl) => ipcRenderer.invoke('write-dataurl', filePath, dataUrl),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  makeProxy: (srcPath) => ipcRenderer.invoke('make-proxy', srcPath),
  extractAudio: (opts) => ipcRenderer.invoke('extract-audio', opts),
  audioPeaks: (opts) => ipcRenderer.invoke('audio-peaks', opts),
  detectSilence: (opts) => ipcRenderer.invoke('detect-silence', opts),
  saveRecording: (opts) => ipcRenderer.invoke('save-recording', opts),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  // 書き出し
  exportVideo: (payload) => ipcRenderer.invoke('export', payload),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),

  detectStt: () => ipcRenderer.invoke('detect-stt'),
  transcribe: (payload) => ipcRenderer.invoke('transcribe', payload),
  transcribeWords: (payload) => ipcRenderer.invoke('transcribe-words', payload),
  cancelTranscribe: () => ipcRenderer.invoke('cancel-transcribe'),
  onTranscribeProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('transcribe-progress', handler);
    return () => ipcRenderer.removeListener('transcribe-progress', handler);
  },
  onExportProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('export-progress', handler);
    return () => ipcRenderer.removeListener('export-progress', handler);
  },

  // モデル種別（base / mcp / chat）。main から additionalArguments で渡される。
  model: (() => { const a = (process.argv || []).find((x) => x.startsWith('--telora-model=')); return a ? a.split('=')[1] : 'base'; })(),

  // MCP ブリッジ（モデル②）：main の MCPサーバ ↔ renderer の EditCommands を往復させる。
  onMcpInvoke: (cb) => { const h = (_e, msg) => cb(msg); ipcRenderer.on('mcp-invoke', h); return () => ipcRenderer.removeListener('mcp-invoke', h); },
  sendMcpResult: (payload) => ipcRenderer.send('mcp-result', payload),

  // モデル③: アプリ内AIチャットの LLM 中継。APIキーは main 側でのみ保持。
  llmChat: (payload) => ipcRenderer.invoke('llm-chat', payload),
  llmConfigGet: () => ipcRenderer.invoke('llm-config-get'),
  llmConfigSet: (cfg) => ipcRenderer.invoke('llm-config-set', cfg),

  // シェル連携
  showItem: (filePath) => ipcRenderer.invoke('show-item', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // メニュー → レンダラ
  onMenu: (channel, cb) => {
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },

  platform: process.platform,
});
