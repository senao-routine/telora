// インスペクタ（プロパティ）パネル — クリップ種別ごとに編集 UI を出し分け
import { el, fmtTime, clamp } from './util.js';
import {
  getProject, on, emit, getSelection, mediaById, clipDur, clipEnd, findClip,
  pushHistory, noteDirty, totalDuration, clipMaxOut, MIN_CLIP,
  TELOP_PRESETS, TELOP_ANIMS, applyTelopPreset, getTextClips, setSelection,
} from './state.js';
import { splitAtPlayhead, deleteSelection, addTelopAtPlayhead, cutBefore, cutAfter, duplicateSelection } from './edit.js';

let body, titleEl;
let fieldRefs = {};
let currentClipId = null;

let pendingHistory = false;
function captureHistory() { if (!pendingHistory) { pushHistory(); pendingHistory = true; } }
function bindHistory(node) { node.addEventListener('focus', captureHistory); node.addEventListener('pointerdown', captureHistory); }
window.addEventListener('pointerup', () => { pendingHistory = false; });
window.addEventListener('focusout', () => { pendingHistory = false; });

const FONT_OPTIONS = [
  { v: '"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif', label: 'ゴシック体' },
  { v: '"Hiragino Mincho ProN","Yu Mincho","MS Mincho",serif', label: '明朝体' },
  { v: '"Arial Black",sans-serif', label: 'Arial Black' },
  { v: 'Impact,sans-serif', label: 'Impact' },
  { v: 'monospace', label: '等幅' },
];

export function initInspector() {
  body = document.getElementById('inspectorBody');
  titleEl = document.getElementById('inspectorTitle');
  on('selection', renderInspector);
  on('telop-live', syncFields);
  renderInspector();
}

function renderInspector() {
  const sel = getSelection();
  fieldRefs = {}; currentClipId = null; body.innerHTML = '';
  if (!sel) {
    titleEl.textContent = 'プロパティ';
    body.appendChild(el('div', { class: 'empty-hint' }, [
      el('p', { html: 'クリップやテロップを選択すると<br/>ここで編集できます' }),
      el('button', { class: 'btn btn-primary', onClick: () => addTelopAtPlayhead() }, ['＋ テロップを追加']),
    ]));
    return;
  }
  if (sel.allTelops) return renderBulkTextInspector();
  const f = findClip(sel.clipId);
  if (!f) { setSelectionNull(); return; }
  currentClipId = sel.clipId;
  if (f.clip.kind === 'text') renderTextInspector(f.clip);
  else renderMediaInspector(f.clip, f.track);
}
function setSelectionNull() { titleEl.textContent = 'プロパティ'; body.innerHTML = ''; }

// ---- 動画 / 画像 / 音声クリップ ----
function renderMediaInspector(clip, track) {
  const m = mediaById(clip.mediaId);
  const typeLabel = clip.kind === 'image' ? '画像' : clip.kind === 'audio' ? '音声' : '動画';
  titleEl.textContent = `${typeLabel}クリップ`;

  const infoRows = [infoRow('素材', m ? m.name : '(欠落)'), infoRow('種類', typeLabel)];
  if (clip.kind !== 'audio') infoRows.push(infoRow('解像度', m ? `${m.width}×${m.height}` : '-'));
  body.appendChild(el('div', {}, infoRows));

  // タイミング
  body.appendChild(el('div', { class: 'inspector-section-title', text: '配置・長さ' }));
  const startIn = numberInput(clip.start, (v) => { clip.start = Math.max(0, v); live(clip); emit('project'); });
  const durIn = numberInput(clipDur(clip), (v) => {
    const maxDur = clipMaxOut(clip) - clip.in;
    const d = clamp(v, MIN_CLIP, maxDur);
    clip.out = clip.in + d; live(clip); emit('project');
  });
  fieldRefs.start = startIn; fieldRefs.dur = durIn;
  body.appendChild(el('div', { class: 'row' }, [field('開始 (秒)', startIn), field('長さ (秒)', durIn)]));

  // 音量（音声のみ）
  if (clip.kind === 'audio') {
    if (clip.volume == null) clip.volume = 1;
    body.appendChild(el('div', { class: 'inspector-section-title', text: '音量' }));
    body.appendChild(rangeField('ボリューム', 0, 2, 0.05, clip.volume, (v) => { clip.volume = v; live(clip); }, pct, 'volume'));
  }

  // 変形（画像、またはベース以外の動画＝PIP）：位置・サイズ
  if (clip.kind === 'image' || (clip.kind === 'video' && !track.base)) {
    if (!clip.transform) clip.transform = { x: 0.5, y: 0.5, scale: 1 };
    body.appendChild(el('div', { class: 'inspector-section-title', text: '位置・サイズ' }));
    body.appendChild(rangeField('左右 (X)', 0, 1, 0.01, clip.transform.x, (v) => { clip.transform.x = v; live(clip); }, pct, 'tx'));
    body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, clip.transform.y, (v) => { clip.transform.y = v; live(clip); }, pct, 'ty'));
    body.appendChild(rangeField('拡大率', 0.1, 2, 0.01, clip.transform.scale, (v) => { clip.transform.scale = v; live(clip); }, pct, 'tscale'));
  }

  // 操作
  body.appendChild(el('div', { class: 'inspector-section-title', text: '操作' }));
  body.appendChild(el('div', { class: 'btn-col' }, [
    el('button', { class: 'btn full-btn', onClick: () => duplicateSelection() }, ['⧉ 複製（Cmd/Ctrl+D）']),
    el('button', { class: 'btn full-btn', onClick: () => splitAtPlayhead() }, ['✂ 再生位置で分割']),
    el('button', { class: 'btn full-btn', onClick: () => cutBefore() }, ['⟕ 再生位置より前をカット']),
    el('button', { class: 'btn full-btn', onClick: () => cutAfter() }, ['⟖ 再生位置より後ろをカット']),
  ]));
  body.appendChild(el('button', { class: 'danger-btn', style: 'margin-top:8px', onClick: () => deleteSelection() }, ['このクリップを削除']));
}

function infoRow(k, v) { return el('div', { class: 'clip-info-row' }, [el('span', { text: k }), el('span', { text: v })]); }
function pct(v) { return `${Math.round(v * 100)}%`; }
function numberInput(value, onChange) {
  const inp = el('input', { type: 'number', step: '0.1', min: '0', value: (+value).toFixed(1) });
  inp.dataset.last = (+value).toFixed(1);
  bindHistory(inp);
  inp.addEventListener('change', () => {
    const v = parseFloat(inp.value);
    if (!isFinite(v)) { inp.value = inp.dataset.last; return; } // 不正入力は直前値へ戻す
    inp.dataset.last = String(v);
    onChange(v);
  });
  return inp;
}

// ---- テロップ ----
function renderTextInspector(tp) {
  titleEl.textContent = 'テロップ';

  const textArea = el('textarea', { spellcheck: 'false' });
  textArea.value = tp.text;
  bindHistory(textArea);
  textArea.addEventListener('input', () => { tp.text = textArea.value; live(tp); emit('project'); });
  body.appendChild(field('テキスト', textArea));
  fieldRefs.text = textArea;

  // デザインプリセット（8種）
  const presetGrid = el('div', { class: 'preset-grid' }, TELOP_PRESETS.map((pr, i) =>
    el('button', { class: 'preset-btn', title: pr.name, onClick: () => { applyTelopPreset(tp.id, i); renderInspector(); } }, [pr.name])));
  body.appendChild(field('デザインプリセット', presetGrid));

  // アニメーション
  const animSel = el('select', { class: 'select', style: 'width:100%' },
    TELOP_ANIMS.map((a) => el('option', { value: a.v, ...(tp.anim === a.v ? { selected: 'selected' } : {}) }, [a.label])));
  bindHistory(animSel);
  animSel.addEventListener('change', () => { tp.anim = animSel.value; live(tp); emit('project'); });
  body.appendChild(field('アニメーション', animSel));

  const fontSel = el('select', { class: 'select', style: 'width:100%' },
    FONT_OPTIONS.map((o) => el('option', { value: o.v, ...(tp.fontFamily === o.v ? { selected: 'selected' } : {}) }, [o.label])));
  bindHistory(fontSel);
  fontSel.addEventListener('change', () => { tp.fontFamily = fontSel.value; live(tp); });
  body.appendChild(field('フォント', fontSel));

  body.appendChild(rangeField('文字サイズ', 0.03, 0.25, 0.005, tp.size, (v) => { tp.size = v; live(tp); }, pct, 'size'));

  const boldBtn = styleToggle('B', tp.bold, () => { tp.bold = !tp.bold; live(tp); refreshToggle(boldBtn, tp.bold); });
  boldBtn.style.fontWeight = '800';
  const italicBtn = styleToggle('I', tp.italic, () => { tp.italic = !tp.italic; live(tp); refreshToggle(italicBtn, tp.italic); });
  italicBtn.style.fontStyle = 'italic';
  body.appendChild(field('スタイル', el('div', { class: 'btn-group' }, [boldBtn, italicBtn])));

  const colorIn = el('input', { type: 'color', value: tp.color });
  bindHistory(colorIn);
  colorIn.addEventListener('input', () => { tp.color = colorIn.value; live(tp); });
  body.appendChild(field('文字色', colorIn));

  const aligns = ['left', 'center', 'right'];
  const alignLabels = { left: '左', center: '中央', right: '右' };
  const alignGroup = el('div', { class: 'btn-group' }, aligns.map((a) =>
    el('button', { class: tp.align === a ? 'active' : '', onClick: () => {
      captureHistory(); tp.align = a; live(tp);
      [...alignGroup.children].forEach((c, i) => c.classList.toggle('active', aligns[i] === a));
    } }, [alignLabels[a]])));
  body.appendChild(field('整列', alignGroup));

  body.appendChild(el('div', { class: 'inspector-section-title', text: '位置' }));
  body.appendChild(rangeField('左右 (X)', 0, 1, 0.01, tp.x, (v) => { tp.x = v; live(tp); }, pct, 'x'));
  body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, tp.y, (v) => { tp.y = v; live(tp); }, pct, 'y'));

  body.appendChild(el('div', { class: 'inspector-section-title', text: '背景' }));
  const bgChk = checkbox(tp.bg, (v) => { tp.bg = v; live(tp); });
  body.appendChild(el('label', { class: 'toggle-row', style: 'margin-bottom:10px' }, [bgChk, '背景を表示']));
  const bgColor = colorInput(tp.bgColor, (v) => { tp.bgColor = v; live(tp); });
  body.appendChild(field('背景色', bgColor));
  body.appendChild(rangeField('背景の不透明度', 0, 1, 0.05, tp.bgOpacity, (v) => { tp.bgOpacity = v; live(tp); }, pct, 'bgOpacity'));

  body.appendChild(el('div', { class: 'inspector-section-title', text: 'フチ取り' }));
  const olChk = checkbox(tp.outline, (v) => { tp.outline = v; live(tp); });
  body.appendChild(el('label', { class: 'toggle-row', style: 'margin-bottom:10px' }, [olChk, 'フチを付ける']));
  const olColor = colorInput(tp.outlineColor, (v) => { tp.outlineColor = v; live(tp); });
  body.appendChild(field('フチの色', olColor));
  body.appendChild(rangeField('フチの太さ', 0, 0.2, 0.01, tp.outlineWidth, (v) => { tp.outlineWidth = v; live(tp); }, pct, 'outlineWidth'));
  const shChk = checkbox(tp.shadow !== false, (v) => { tp.shadow = v; live(tp); });
  body.appendChild(el('label', { class: 'toggle-row', style: 'margin-top:4px' }, [shChk, '影をつける']));

  body.appendChild(el('div', { class: 'inspector-section-title', text: '表示タイミング' }));
  const startIn = el('input', { type: 'number', step: '0.1', min: '0', value: tp.start.toFixed(1) });
  const endIn = el('input', { type: 'number', step: '0.1', min: '0', value: tp.end.toFixed(1) });
  bindHistory(startIn); bindHistory(endIn);
  startIn.addEventListener('change', () => {
    const parsed = parseFloat(startIn.value);
    if (!isFinite(parsed)) { startIn.value = tp.start.toFixed(1); return; }
    const v = clamp(parsed, 0, tp.end - 0.2); tp.start = v; startIn.value = v.toFixed(1); live(tp); emit('project');
  });
  endIn.addEventListener('change', () => {
    const parsed = parseFloat(endIn.value);
    if (!isFinite(parsed)) { endIn.value = tp.end.toFixed(1); return; }
    const total = Math.max(totalDuration(), tp.start + 0.2);
    const v = clamp(parsed, tp.start + 0.2, total); tp.end = v; endIn.value = v.toFixed(1); live(tp); emit('project');
  });
  fieldRefs.tstart = startIn; fieldRefs.tend = endIn;
  body.appendChild(el('div', { class: 'row' }, [field('開始 (秒)', startIn), field('終了 (秒)', endIn)]));

  body.appendChild(el('button', { class: 'btn full-btn', style: 'margin-top:14px', onClick: () => duplicateSelection() }, ['⧉ 複製（Cmd/Ctrl+D）']));
  body.appendChild(el('button', { class: 'danger-btn', style: 'margin-top:8px', onClick: () => deleteSelection() }, ['このテロップを削除']));
}

// ---- 全テロップ一括編集 ----
function bulkApply(fn) {
  const clips = getTextClips();
  if (clips.length === 0) return;
  pushHistory();
  clips.forEach(fn);
  noteDirty();
  emit('project');
  emit('telop-live', null);
}

function renderBulkTextInspector() {
  const clips = getTextClips();
  titleEl.textContent = `全テロップ一括編集（${clips.length}件）`;
  if (clips.length === 0) {
    body.appendChild(el('div', { class: 'empty-hint' }, [el('p', { text: 'テロップがありません' })]));
    return;
  }

  // 文字サイズ（相対拡大縮小）
  body.appendChild(el('div', { class: 'inspector-section-title', text: '文字サイズ（全体）' }));
  body.appendChild(el('div', { class: 'btn-group' }, [
    el('button', { onClick: () => bulkApply((c) => { c.size = clamp(c.size * 0.88, 0.02, 0.4); }) }, ['－ 小さく']),
    el('button', { onClick: () => bulkApply((c) => { c.size = clamp(c.size * 1.14, 0.02, 0.4); }) }, ['＋ 大きく']),
  ]));
  // 統一サイズ
  body.appendChild(rangeField('全テロップを同じサイズに', 0.03, 0.25, 0.005, clips[0].size || 0.08,
    (v) => bulkApply((c) => { c.size = v; }), (v) => `${Math.round(v * 100)}%`));

  // 位置・色
  body.appendChild(el('div', { class: 'inspector-section-title', text: '位置・色（全体）' }));
  body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, clips[0].y != null ? clips[0].y : 0.88,
    (v) => bulkApply((c) => { c.y = v; }), (v) => `${Math.round(v * 100)}%`));
  const colorIn = el('input', { type: 'color', value: clips[0].color || '#ffffff' });
  colorIn.addEventListener('input', () => bulkApply((c) => { c.color = colorIn.value; }));
  body.appendChild(field('文字色', colorIn));

  // アニメーション一括
  const animSel = el('select', { class: 'select', style: 'width:100%' },
    TELOP_ANIMS.map((a) => el('option', { value: a.v }, [a.label])));
  animSel.addEventListener('change', () => bulkApply((c) => { c.anim = animSel.value; }));
  body.appendChild(field('アニメーション', animSel));

  // プリセット一括適用
  body.appendChild(el('div', { class: 'inspector-section-title', text: 'デザインプリセット（全体に適用）' }));
  body.appendChild(el('div', { class: 'preset-grid' }, TELOP_PRESETS.map((pr, i) =>
    el('button', { class: 'preset-btn', title: pr.name, onClick: () => bulkApply((c) => Object.assign(c, pr.style)) }, [pr.name]))));

  // 全削除
  body.appendChild(el('button', { class: 'danger-btn', style: 'margin-top:14px', onClick: () => {
    if (!confirm(`${clips.length}件のテロップをすべて削除しますか？`)) return;
    pushHistory();
    for (const tr of getProject().tracks) { if (tr.kind === 'text') tr.clips = []; }
    setSelection(null); noteDirty(); emit('project'); emit('selection');
  } }, ['全テロップを削除']));
}

function live(clip) { noteDirty(); emit('telop-live', clip.id); }

function syncFields() {
  if (!currentClipId) return;
  const f = findClip(currentClipId);
  if (!f) return;
  const c = f.clip;
  setRange(fieldRefs.x, c.x, pct); setRange(fieldRefs.y, c.y, pct); setRange(fieldRefs.size, c.size, pct);
  setRange(fieldRefs.bgOpacity, c.bgOpacity, pct); setRange(fieldRefs.outlineWidth, c.outlineWidth, pct);
  if (c.transform) { setRange(fieldRefs.tx, c.transform.x, pct); setRange(fieldRefs.ty, c.transform.y, pct); setRange(fieldRefs.tscale, c.transform.scale, pct); }
  if (fieldRefs.volume && isFinite(c.volume)) setRange(fieldRefs.volume, c.volume, pct);
  if (fieldRefs.start && document.activeElement !== fieldRefs.start) fieldRefs.start.value = (+c.start).toFixed(1);
  if (fieldRefs.dur && document.activeElement !== fieldRefs.dur) fieldRefs.dur.value = clipDur(c).toFixed(1);
  if (fieldRefs.tstart && document.activeElement !== fieldRefs.tstart) fieldRefs.tstart.value = (+c.start).toFixed(1);
  if (fieldRefs.tend && document.activeElement !== fieldRefs.tend) fieldRefs.tend.value = (+c.end).toFixed(1);
}

// ---- 部品 ----
function field(label, control) { return el('div', { class: 'field' }, [el('label', { text: label }), control]); }
function checkbox(checked, onChange) {
  const c = el('input', { type: 'checkbox', ...(checked ? { checked: 'checked' } : {}) });
  bindHistory(c);
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}
function colorInput(value, onChange) {
  const c = el('input', { type: 'color', value });
  bindHistory(c);
  c.addEventListener('input', () => onChange(c.value));
  return c;
}
function rangeField(label, min, max, step, value, onChange, fmt, refKey) {
  const range = el('input', { type: 'range', min, max, step, value });
  const valLabel = el('span', { class: 'range-val', text: fmt(value) });
  bindHistory(range);
  range.addEventListener('input', () => { const v = parseFloat(range.value); valLabel.textContent = fmt(v); onChange(v); });
  const wrap = el('div', { class: 'field' }, [el('label', { text: label }), el('div', { class: 'range-row' }, [range, valLabel])]);
  if (refKey) fieldRefs[refKey] = { range, valLabel };
  return wrap;
}
function setRange(ref, value, fmt) {
  if (!ref || !ref.range || document.activeElement === ref.range) return;
  ref.range.value = value; ref.valLabel.textContent = fmt(value);
}
function styleToggle(label, active, onClick) { return el('button', { class: active ? 'active' : '', onClick: () => { captureHistory(); onClick(); } }, [label]); }
function refreshToggle(btn, active) { btn.classList.toggle('active', active); }
