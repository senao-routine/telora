// 右クリック／トラックパッド2本指タップで開くコンテキストメニュー（共通部品）。
// items: [{ label, onClick, danger? } | { sep:true }]
import { el } from './util.js';

let current = null;
function close() {
  if (!current) return;
  current.remove(); current = null;
  document.removeEventListener('pointerdown', onDocDown, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', close);
}
function onDocDown(e) { if (current && !current.contains(e.target)) close(); }
function onKey(e) { if (e.key === 'Escape') close(); }

export function showContextMenu(x, y, items) {
  close();
  const menu = el('div', { class: 'ctx-menu' }, (items || []).map((it) => (
    it && it.sep
      ? el('div', { class: 'ctx-sep' })
      : el('div', {
        class: 'ctx-item' + (it.danger ? ' danger' : ''),
        onClick: () => { close(); try { it.onClick && it.onClick(); } catch (_) {} },
      }, [it.label])
  )));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);
  current = menu;
  // 画面端からはみ出さないよう補正
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(4, window.innerWidth - r.width - 6) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(4, window.innerHeight - r.height - 6) + 'px';
  // 開いた直後の同一イベントで閉じないよう次フレームで購読
  setTimeout(() => {
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  }, 0);
}

export function closeContextMenu() { close(); }
