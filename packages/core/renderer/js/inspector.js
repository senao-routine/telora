// インスペクタ（プロパティ）パネル — クリップ種別ごとに編集 UI を出し分け
import { el, fmtTime, clamp } from './util.js';
import {
  getProject, on, emit, getSelection, mediaById, clipDur, clipEnd, findClip, clipSpeed,
  pushHistory, noteDirty, totalDuration, clipMaxOut, MIN_CLIP, getPlayhead,
  transformAt, hasKeyframes, setKeyframe, clearKeyframes,
  TELOP_PRESETS, TELOP_ANIMS, applyTelopPreset, getTextClips, setSelection, unlinkLinkedClip,
} from './state.js';
import { splitAtPlayhead, deleteSelection, addTelopAtPlayhead, cutBefore, cutAfter, duplicateSelection } from './edit.js';
import { silenceCut, fillerCut } from './cut-tools.js';
import { toast } from './ui.js';

let body, titleEl, inspectorEl;
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
  inspectorEl = body.closest('.inspector');
  on('selection', renderInspector);
  on('edit-focus', focusEditField);            // ダブルクリックで編集パネルへ
  on('telop-live', syncFields);
  on('playhead', syncFields); // キーフレーム編集中はスクラブで実効値スライダーを追従
  renderInspector();
}

// 編集パネルを目立たせる短いパルス（選択時のフィードバック）
function flashInspector() {
  if (!inspectorEl) return;
  inspectorEl.classList.remove('just-updated');
  void inspectorEl.offsetWidth; // リフローでアニメをやり直す
  inspectorEl.classList.add('just-updated');
}
// ダブルクリック時：パネル先頭へ戻し、主要な編集欄へフォーカス（テロップ＝本文、素材＝数値）
function focusEditField() {
  if (inspectorEl) inspectorEl.scrollTop = 0;
  flashInspector();
  const t = fieldRefs.text;
  if (t && t.focus) { t.focus(); if (t.select) t.select(); return; }
  const first = body.querySelector('.range-num, input[type=number]');
  if (first && first.focus) first.focus();
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
  flashInspector();
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
    const sp = clipSpeed(clip);
    const maxDur = (clipMaxOut(clip) - clip.in) / sp;
    const d = clamp(v, MIN_CLIP, maxDur);
    clip.out = clip.in + d * sp; live(clip); emit('project');
  });
  fieldRefs.start = startIn; fieldRefs.dur = durIn;
  body.appendChild(el('div', { class: 'row' }, [field('開始 (秒)', startIn), field('長さ (秒)', durIn)]));

  // 速度（動画・音声）
  if (clip.kind === 'video' || clip.kind === 'audio') {
    if (clip.speed == null) clip.speed = 1;
    body.appendChild(el('div', { class: 'inspector-section-title', text: '速度' }));
    body.appendChild(rangeField('再生速度', 0.25, 4, 0.05, clip.speed, (v) => { clip.speed = Math.max(0.1, v); live(clip); emit('project'); }, (v) => v.toFixed(2) + '×', 'speed'));
  }

  // 音量（音声のみ）
  if (clip.kind === 'audio') {
    if (clip.volume == null) clip.volume = 1;
    body.appendChild(el('div', { class: 'inspector-section-title', text: '音量' }));
    body.appendChild(rangeField('ボリューム', 0, 2, 0.05, clip.volume, (v) => { clip.volume = v; live(clip); }, pct, 'volume'));
  }

  // 変形（画像・動画＝ベース動画含む）：位置・サイズ・回転・不透明度（キーフレーム対応）
  if (clip.kind === 'image' || clip.kind === 'video') {
    if (!clip.transform) clip.transform = { x: 0.5, y: 0.5, scale: 1 };
    const tr = clip.transform;
    if (tr.opacity == null) tr.opacity = 1;
    if (tr.rotation == null) tr.rotation = 0;
    // キーフレームがあれば再生位置の実効値を編集対象にする
    const localT = () => getPlayhead() - clip.start;
    const eff = () => transformAt(clip, localT());
    const setTf = (prop, v) => { if (hasKeyframes(clip)) setKeyframe(clip, localT(), { [prop]: v }); else tr[prop] = v; live(clip); };
    const e0 = eff();
    body.appendChild(el('div', { class: 'inspector-section-title', text: '位置・サイズ' }));
    body.appendChild(rangeField('左右 (X)', 0, 1, 0.01, e0.x, (v) => setTf('x', v), pct, 'tx', PCT));
    body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, e0.y, (v) => setTf('y', v), pct, 'ty', PCT));
    body.appendChild(rangeField('拡大率', 0.1, 2, 0.01, e0.scale, (v) => setTf('scale', v), pct, 'tscale', PCT));
    body.appendChild(rangeField('回転 (°)', -180, 180, 1, e0.rotation || 0, (v) => setTf('rotation', v), (v) => `${Math.round(v)}°`, 'trot', { scale: 1, dec: 0, suffix: '°', step: 1 }));
    body.appendChild(rangeField('不透明度', 0, 1, 0.01, e0.opacity != null ? e0.opacity : 1, (v) => setTf('opacity', v), pct, 'topacity', PCT));
    // キーフレーム（アニメーション）
    const kfCount = (tr.keyframes || []).length;
    body.appendChild(el('div', { class: 'inspector-section-title', text: `キーフレーム${kfCount ? `（${kfCount}）` : ''}` }));
    body.appendChild(el('div', { class: 'btn-group' }, [
      el('button', { onClick: () => { captureHistory(); setKeyframe(clip, localT()); live(clip); emit('project'); renderInspector(); } }, ['＋ 再生位置に追加']),
      el('button', { onClick: () => { captureHistory(); clearKeyframes(clip); live(clip); emit('project'); renderInspector(); } }, ['クリア']),
    ]));
    // クロップ（各辺をトリミング）
    if (!tr.crop) tr.crop = { l: 0, t: 0, r: 0, b: 0 };
    body.appendChild(el('div', { class: 'inspector-section-title', text: 'クロップ（トリミング）' }));
    body.appendChild(rangeField('左', 0, 0.45, 0.01, tr.crop.l, (v) => { tr.crop.l = v; live(clip); }, pct, 'crL'));
    body.appendChild(rangeField('右', 0, 0.45, 0.01, tr.crop.r, (v) => { tr.crop.r = v; live(clip); }, pct, 'crR'));
    body.appendChild(rangeField('上', 0, 0.45, 0.01, tr.crop.t, (v) => { tr.crop.t = v; live(clip); }, pct, 'crT'));
    body.appendChild(rangeField('下', 0, 0.45, 0.01, tr.crop.b, (v) => { tr.crop.b = v; live(clip); }, pct, 'crB'));
    // クロマキー（グリーンバック等の背景透過）
    if (!tr.chroma) tr.chroma = { on: false, key: '#00ff00', similarity: 0.3, blend: 0.1 };
    const ch = tr.chroma;
    body.appendChild(el('div', { class: 'inspector-section-title', text: 'クロマキー（背景透過）' }));
    const chChk = checkbox(ch.on, (v) => { ch.on = v; live(clip); emit('project'); });
    body.appendChild(el('label', { class: 'toggle-row' }, [chChk, '有効にする']));
    body.appendChild(field('キー色', colorInput(ch.key || '#00ff00', (v) => { ch.key = v; live(clip); })));
    body.appendChild(rangeField('類似度', 0.01, 0.8, 0.01, ch.similarity != null ? ch.similarity : 0.3, (v) => { ch.similarity = v; live(clip); }, pct, 'chSim'));
    body.appendChild(rangeField('境界ブレンド', 0, 0.5, 0.01, ch.blend != null ? ch.blend : 0.1, (v) => { ch.blend = v; live(clip); }, pct, 'chBlend'));
  }

  // フェード（映像・音声共通）
  appendFadeFields(clip);

  // 映像↔音声リンクの状態と解除（リンク中のクリップのみ）
  if (clip.linkedAudioId || clip.linkedVideoId) {
    body.appendChild(el('div', { class: 'inspector-section-title', text: '映像・音声リンク' }));
    body.appendChild(el('div', { class: 'hint-text', text: '🔗 この映像と音声はリンクしています（移動・トリム・分割・削除が連動）。' }));
    body.appendChild(el('button', { class: 'btn full-btn', onClick: () => { unlinkLinkedClip(clip.id); renderInspector(); emit('project'); } }, ['🔓 リンクを解除（個別に編集）']));
  }

  // カット支援（動画/音声で音声を持つ素材のみ）：無音カット・フィラーカット
  if ((clip.kind === 'video' || clip.kind === 'audio') && m && m.hasAudio !== false) {
    appendCutAssist(clip);
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

// カット支援：無音カット／フィラーカット（音声を持つ動画・音声クリップ向け）
function appendCutAssist(clip) {
  body.appendChild(el('div', { class: 'inspector-section-title', text: 'カット支援' }));
  const silenceBtn = el('button', { class: 'btn full-btn' }, ['🔇 無音をカット']);
  silenceBtn.onclick = async () => {
    silenceBtn.disabled = true; const t0 = silenceBtn.textContent; silenceBtn.textContent = '解析中…';
    try { await silenceCut(clip.id); renderInspector(); }
    finally { silenceBtn.disabled = false; silenceBtn.textContent = t0; }
  };
  const fillerBtn = el('button', { class: 'btn full-btn', style: 'margin-top:6px' }, ['🗣 フィラー語をカット']);
  fillerBtn.onclick = async () => {
    fillerBtn.disabled = true; const t0 = fillerBtn.textContent;
    try {
      const res = await fillerCut(clip.id, (msg) => { fillerBtn.textContent = msg; });
      if (res && res.needSetup) toast('フィラーカットには文字起こしエンジン(Whisper)が必要です', 'err');
      else if (res && res.ok) renderInspector();
    } finally { fillerBtn.disabled = false; fillerBtn.textContent = t0; }
  };
  body.appendChild(el('div', { class: 'btn-col' }, [silenceBtn, fillerBtn]));
  body.appendChild(el('div', { class: 'hint-text', text: '無音や「えー/あの」などの言いよどみを自動で取り除き、テンポを整えます。' }));
}

// フェードイン/アウト（秒）スライダー。映像・音声・テロップ共通。
function appendFadeFields(clip) {
  if (clip.fadeIn == null) clip.fadeIn = 0;
  if (clip.fadeOut == null) clip.fadeOut = 0;
  const fmax = Math.max(0.5, Math.min(5, clipDur(clip)));
  body.appendChild(el('div', { class: 'inspector-section-title', text: 'フェード（秒）' }));
  body.appendChild(rangeField('フェードイン', 0, fmax, 0.1, clip.fadeIn, (v) => { clip.fadeIn = v; live(clip); }, (v) => v.toFixed(1) + 's', 'fadeIn'));
  body.appendChild(rangeField('フェードアウト', 0, fmax, 0.1, clip.fadeOut, (v) => { clip.fadeOut = v; live(clip); }, (v) => v.toFixed(1) + 's', 'fadeOut'));
}

function infoRow(k, v) { return el('div', { class: 'clip-info-row' }, [el('span', { text: k }), el('span', { text: v })]); }
function pct(v) { return `${Math.round(v * 100)}%`; }
const PCT = { scale: 100, dec: 0, suffix: '%', step: 1 };   // 数値入力（％）
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

  body.appendChild(rangeField('文字サイズ', 0.03, 0.25, 0.005, tp.size, (v) => { tp.size = v; live(tp); }, pct, 'size', PCT));
  if (tp.opacity == null) tp.opacity = 1;
  body.appendChild(rangeField('不透明度', 0, 1, 0.01, tp.opacity, (v) => { tp.opacity = v; live(tp); }, pct, 'topacity', PCT));

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
  body.appendChild(rangeField('左右 (X)', 0, 1, 0.01, tp.x, (v) => { tp.x = v; live(tp); }, pct, 'x', PCT));
  body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, tp.y, (v) => { tp.y = v; live(tp); }, pct, 'y', PCT));

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

  appendFadeFields(tp); // フェードイン/アウト

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
    (v) => bulkApply((c) => { c.size = v; }), pct, null, PCT));

  // 位置・色
  body.appendChild(el('div', { class: 'inspector-section-title', text: '位置・色（全体）' }));
  body.appendChild(rangeField('左右 (X)', 0, 1, 0.01, clips[0].x != null ? clips[0].x : 0.5,
    (v) => bulkApply((c) => { c.x = v; }), pct, null, PCT));
  body.appendChild(rangeField('上下 (Y)', 0, 1, 0.01, clips[0].y != null ? clips[0].y : 0.88,
    (v) => bulkApply((c) => { c.y = v; }), pct, null, PCT));
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
    for (const tr of getProject().tracks) tr.clips = tr.clips.filter((c) => c.kind !== 'text');
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
  if (c.transform) {
    const tf = hasKeyframes(c) ? transformAt(c, getPlayhead() - c.start) : c.transform;
    setRange(fieldRefs.tx, tf.x, pct); setRange(fieldRefs.ty, tf.y, pct); setRange(fieldRefs.tscale, tf.scale, pct);
    if (fieldRefs.trot) setRange(fieldRefs.trot, tf.rotation || 0, (v) => `${Math.round(v)}°`);
    if (fieldRefs.topacity) setRange(fieldRefs.topacity, tf.opacity != null ? tf.opacity : 1, pct);
    if (c.transform.crop) {
      setRange(fieldRefs.crL, c.transform.crop.l || 0, pct); setRange(fieldRefs.crR, c.transform.crop.r || 0, pct);
      setRange(fieldRefs.crT, c.transform.crop.t || 0, pct); setRange(fieldRefs.crB, c.transform.crop.b || 0, pct);
    }
    if (c.transform.chroma) { setRange(fieldRefs.chSim, c.transform.chroma.similarity != null ? c.transform.chroma.similarity : 0.3, pct); setRange(fieldRefs.chBlend, c.transform.chroma.blend != null ? c.transform.chroma.blend : 0.1, pct); }
  }
  if (c.kind === 'text' && fieldRefs.topacity) setRange(fieldRefs.topacity, c.opacity != null ? c.opacity : 1, pct);
  if (fieldRefs.fadeIn) setRange(fieldRefs.fadeIn, c.fadeIn || 0, (v) => v.toFixed(1) + 's');
  if (fieldRefs.fadeOut) setRange(fieldRefs.fadeOut, c.fadeOut || 0, (v) => v.toFixed(1) + 's');
  if (fieldRefs.speed) setRange(fieldRefs.speed, c.speed || 1, (v) => v.toFixed(2) + '×');
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
// num={scale,dec,suffix,step} を渡すと右側が数値入力（表示=value*scale）になり、キーボードで直接編集できる
function rangeField(label, min, max, step, value, onChange, fmt, refKey, num) {
  const range = el('input', { type: 'range', min, max, step, value });
  bindHistory(range);
  let valEl, wrapRight;
  const disp = (v) => (v * num.scale).toFixed(num.dec || 0);
  if (num) {
    valEl = el('input', { type: 'number', class: 'range-num', step: num.step != null ? num.step : 1, value: disp(value) });
    bindHistory(valEl);
    const commit = () => {
      const n = parseFloat(valEl.value);
      if (!isFinite(n)) { valEl.value = disp(parseFloat(range.value)); return; }
      const v = clamp(n / num.scale, min, max);
      range.value = v; valEl.value = disp(v); onChange(v);
    };
    valEl.addEventListener('change', commit);
    range.addEventListener('input', () => { const v = parseFloat(range.value); valEl.value = disp(v); onChange(v); });
    wrapRight = num.suffix ? el('div', { class: 'range-numwrap' }, [valEl, el('span', { class: 'range-suffix', text: num.suffix })]) : valEl;
  } else {
    valEl = el('span', { class: 'range-val', text: fmt(value) });
    range.addEventListener('input', () => { const v = parseFloat(range.value); valEl.textContent = fmt(v); onChange(v); });
    wrapRight = valEl;
  }
  const wrap = el('div', { class: 'field' }, [el('label', { text: label }), el('div', { class: 'range-row' }, [range, wrapRight])]);
  if (refKey) fieldRefs[refKey] = { range, valLabel: valEl, num };
  return wrap;
}
function setRange(ref, value, fmt) {
  if (!ref || !ref.range) return;
  if (document.activeElement === ref.range || document.activeElement === ref.valLabel) return;
  ref.range.value = value;
  if (ref.num) ref.valLabel.value = (value * ref.num.scale).toFixed(ref.num.dec || 0);
  else ref.valLabel.textContent = fmt(value);
}
function styleToggle(label, active, onClick) { return el('button', { class: active ? 'active' : '', onClick: () => { captureHistory(); onClick(); } }, [label]); }
function refreshToggle(btn, active) { btn.classList.toggle('active', active); }
