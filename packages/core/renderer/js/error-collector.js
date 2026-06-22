// 起動時の実行時エラーを収集（デバッグ / スモークテスト用）
window.__errors = window.__errors || [];
window.addEventListener('error', (e) => {
  window.__errors.push({ type: 'error', message: e.message, source: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  window.__errors.push({ type: 'rejection', message: String(e.reason && e.reason.message || e.reason) });
});
