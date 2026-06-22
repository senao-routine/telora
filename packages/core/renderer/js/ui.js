// 小さな共有 UI ヘルパ（トースト通知など）

let toastTimer = null;
export function toast(message, kind = '') {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.className = 'toast' + (kind ? ' ' + kind : '');
  node.hidden = false;
  node.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.style.opacity = '0';
    setTimeout(() => { node.hidden = true; }, 320);
  }, kind === 'err' ? 4200 : 2400);
}
