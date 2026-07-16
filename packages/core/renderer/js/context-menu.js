// 右クリック／トラックパッド2本指タップで開くコンテキストメニュー（共通部品）。
// items: [{ label, onClick, danger?, disabled?, shortcut? } | { sep:true }]
// キーボード操作: ↑↓で項目ハイライト・Enterで実行・Escapeで閉じる（PPのメニュー操作感）
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
function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
  if (!current) return;
  const items = [...current.querySelectorAll('.ctx-item:not(.disabled)')];
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    let idx = items.findIndex((n) => n.classList.contains('focused'));
    idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx <= 0 ? items.length - 1 : idx - 1);
    items.forEach((n) => n.classList.remove('focused'));
    items[idx].classList.add('focused');
  } else if (e.key === 'Enter') {
    e.preventDefault(); e.stopPropagation();
    const f = items.find((n) => n.classList.contains('focused'));
    if (f) f.click();
  }
}

export function showContextMenu(x, y, items) {
  close();
  const menu = el('div', { class: 'ctx-menu' }, (items || []).map((it) => (
    it && it.sep
      ? el('div', { class: 'ctx-sep' })
      : el('div', {
        class: 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : ''),
        onClick: () => { if (it.disabled) return; close(); try { it.onClick && it.onClick(); } catch (_) {} },
      }, it.shortcut
        ? [el('span', { class: 'ctx-label', text: it.label }), el('span', { class: 'ctx-key', text: it.shortcut })]
        : [it.label])
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
