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
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  // 書き出し
  exportVideo: (payload) => ipcRenderer.invoke('export', payload),
  cancelExport: () => ipcRenderer.invoke('cancel-export'),

  detectStt: () => ipcRenderer.invoke('detect-stt'),
  transcribe: (payload) => ipcRenderer.invoke('transcribe', payload),
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

  // シェル連携
  showItem: (filePath) => ipcRenderer.invoke('show-item', filePath),
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),

  // メニュー → レンダラ
  onMenu: (channel, cb) => {
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },

  platform: process.platform,
});
