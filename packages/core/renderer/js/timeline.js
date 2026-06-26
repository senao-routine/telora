// タイムライン描画 + 操作（複数トラック、配置/移動/トリム、スクラブ、スナップ）
import { el, clamp, fmtRuler, fmtTime, basename, uid } from './util.js';
import {
  getProject, on, emit, getZoom, setZoom, getPlayhead, setPlayhead,
  getSelection, setSelection, isSelected, toggleSelect, getSelectedIds, setMultiSelection, totalDuration, clipDur, clipEnd, clipSpeed, getTrack,
  mediaById, pushHistory, noteDirty, isPlaying, getTracks, MIN_CLIP, clipMaxOut, removeTrack, toggleTrackMute,
  getTool, getRange, setRange, getMarkers,
} from './state.js';
import { getThumb, addClipFromMedia, findFreeSlot } from './media.js';
import { ensureWaveform, drawClipWaveform } from './waveform.js';
import { getFrame, requestFrame, FRAME_W } from './filmstrip.js';
import { resolveOverwrite, splitAtPlayhead, cutBefore, cutAfter, duplicateSelection, deleteSelection } from './edit.js';
import { silenceCut, fillerCut } from './cut-tools.js';
import { showContextMenu } from './context-menu.js';
import { seek } from './preview.js';

const MIN_TEXT = 0.2;
const DRAG_THRESHOLD = 4;
const SNAP_PX = 8;
const TRACK_H = { visual: 64, audio: 54 };
// トラックは種別に縛られないので、ヘッダのアイコンは中身から推定して表示する
function trackIcon(track) {
  if (track.kind === 'audio') return '🔊';
  const kinds = new Set(track.clips.map((c) => c.kind));
  if (kinds.has('video')) return '🎞';
  if (kinds.has('image')) return '🖼';
  if (kinds.has('text')) return '🅣';
  return '🎬';
}
const RULER_H = 26;

let content, scrollEl, tracksEl, headersEl, ruler, playheadEl, playheadTimeEl, rangeBandEl, marqueeEl;
let drag = null;

export function initTimeline() {
  content = document.getElementById('timelineContent');
  scrollEl = document.getElementById('timelineScroll');
  tracksEl = document.getElementById('tracks');
  headersEl = document.getElementById('trackHeaders');
  ruler = document.getElementById('ruler');
  playheadEl = document.getElementById('playhead');
  playheadTimeEl = document.getElementById('playheadTime');
  rangeBandEl = document.getElementById('rangeBand');
  marqueeEl = document.getElementById('marquee');

  on('project', render);
  on('selection', renderSelectionOnly);
  on('zoom', render);
  on('waveform', render);
  on('filmstrip', render);
  on('playhead', updatePlayhead);
  on('range', updateRangeBand);
  on('tool', updateToolCursor);

  ruler.addEventListener('pointerdown', (e) => startScrub(e));
  scrollEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList && (e.target.classList.contains('track') || e.target === content || e.target === tracksEl)) startBodyDrag(e);
  });
  playheadEl.addEventListener('pointerdown', (e) => { e.stopPropagation(); startScrub(e, true); });

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  scrollEl.addEventListener('wheel', (e) => {
    // トラックパッドのピンチ（2本指の広げ/狭め）は ctrlKey 付き wheel として届く → 滑らかに拡縮
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomAround(e.clientX, getZoom() * Math.exp(-e.deltaY * 0.01));
      return;
    }
    // 横方向の2本指スワイプはネイティブ横スクロール。縦ホイールは横パンへ変換
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  render();
}

function px() { return getZoom(); }
function contentSeconds() { return Math.max(totalDuration(), 10); }

function render() {
  const P = px();
  const cw = Math.max(contentSeconds() * P + 240, scrollEl.clientWidth);
  content.style.width = cw + 'px';
  renderRuler(cw, P);
  renderTracks(P);
  renderHeaders();
  updatePlayhead();
  updateRangeBand();
  updateZoomLabel();
}

function renderRuler(cw, P) {
  ruler.innerHTML = '';
  ruler.style.height = RULER_H + 'px';
  const step = niceStep(P);
  const secs = cw / P;
  for (let t = 0; t <= secs; t += step) {
    const left = t * P;
    ruler.appendChild(el('div', { class: 'tick', style: `left:${left}px` }));
    ruler.appendChild(el('div', { class: 'tick-label', style: `left:${left}px`, text: fmtRuler(t) }));
  }
  // マーカー（クリックで移動）
  for (const mk of getMarkers()) {
    const m = el('div', { class: 'tl-marker', style: `left:${mk.t * P}px`, title: `マーカー ${fmtTime(mk.t)}` });
    m.addEventListener('pointerdown', (e) => { e.stopPropagation(); seek(mk.t); });
    ruler.appendChild(m);
  }
}
function niceStep(P) {
  const target = 70 / P;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  for (const s of steps) if (s >= target) return s;
  return 1800;
}

function renderHeaders() {
  headersEl.innerHTML = '';
  headersEl.appendChild(el('div', { class: 'th-ruler', style: `height:${RULER_H}px` }));
  for (const track of getTracks()) {
    const children = [el('span', { class: 'th-ico', text: trackIcon(track) }), el('span', { class: 'th-name', text: track.name })];
    // ミュート（音声オフ＝映像だけ流す）。音声を持ちうる層に表示。
    const muteBtn = el('button', {
      class: 'th-mute' + (track.muted ? ' muted' : ''),
      title: track.muted ? '音声オフ（クリックで解除）' : '音声をミュート（映像だけ流す）',
      onClick: (e) => { e.stopPropagation(); const on = toggleTrackMute(track.id); muteBtn.classList.toggle('muted', on); muteBtn.textContent = on ? '🔇' : '🔊'; },
    }, [track.muted ? '🔇' : '🔊']);
    children.push(muteBtn);
    if (!track.base) {
      children.push(el('button', { class: 'th-del', title: 'この層を削除', onClick: (e) => { e.stopPropagation(); if (track.clips.length === 0 || confirm(`「${track.name}」を削除しますか？`)) removeTrack(track.id); } }, ['✕']));
    }
    headersEl.appendChild(el('div', { class: `th-row th-${track.kind}${track.muted ? ' is-muted' : ''}`, style: `height:${TRACK_H[track.kind]}px` }, children));
  }
}

function renderTracks(P) {
  const sel = getSelection();
  tracksEl.innerHTML = '';
  for (const track of getTracks()) {
    const row = el('div', { class: `track track-${track.kind}`, style: `height:${TRACK_H[track.kind]}px`, 'data-track': track.id });
    for (const clip of track.clips) {
      row.appendChild(renderClip(track, clip, P, sel));
    }
    // ライブラリからのドロップ
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; row.classList.add('drop-hover'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-hover'));
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drop-hover');
      const id = e.dataTransfer.getData('text/media-id');
      if (id) {
        const start = Math.max(0, (e.clientX - content.getBoundingClientRect().left) / P);
        addClipFromMedia(id, { trackId: track.id, start });
      }
    });
    tracksEl.appendChild(row);
  }
}

function renderClip(track, clip, P, sel) {
  const left = clip.start * P;
  const width = Math.max(6, clipDur(clip) * P);
  const selected = isSelected(clip.id);
  const kindClass = clip.kind === 'text' ? 'clip-text' : clip.kind === 'image' ? 'clip-image' : clip.kind === 'audio' ? 'clip-audio' : 'clip-video';
  const children = [el('div', { class: 'trim left', 'data-trim': 'left' })];

  if (clip.kind === 'text') {
    children.push(el('div', { class: 'clip-label', text: (clip.text || '').split('\n')[0] || 'テロップ' }));
  } else {
    const m = mediaById(clip.mediaId);
    if (clip.kind === 'video' && m && m.path) {
      // 動画：複数フレームを横に並べたフィルムストリップ（中身が一目で分かる）
      const span = Math.max(0, clip.out - clip.in);
      const count = Math.max(1, Math.min(16, Math.floor(width / FRAME_W)));
      const strip = el('div', { class: 'clip-filmstrip' });
      for (let i = 0; i < count; i++) {
        const srcT = clip.in + ((i + 0.5) / count) * span;
        let url = getFrame(m.id, srcT);
        if (!url) { requestFrame(m.id, m.path, srcT); url = getThumb(m.id); } // 取得までは代表サムネ
        strip.appendChild(el('div', { class: 'film-cell', style: url ? `background-image:url(${url})` : '' }));
      }
      children.push(strip);
      // 動画は映像＋音声を1本の帯で表示：下部に音声波形を重ねる（音声を持つ素材のみ）。
      if (m.hasAudio !== false) {
        ensureWaveform(m);
        const wh = 16;
        const wc = el('canvas', { class: 'clip-wave clip-wave-video', width: Math.max(1, Math.round(width)), height: wh });
        drawClipWaveform(wc, m.id, clip.in, clip.out, 'rgba(120,200,255,0.9)');
        children.push(wc);
      }
    } else if (clip.kind === 'image') {
      const thumb = m ? getThumb(m.id) : null;
      if (thumb) children.push(el('div', { class: 'clip-thumb', style: `background-image:url(${thumb})` }));
    } else if (clip.kind === 'audio' && m) {
      // 音声クリップ：波形をしっかり表示（クリップ高さいっぱい・明るい色）
      ensureWaveform(m);
      const wc = el('canvas', { class: 'clip-wave', width: Math.max(1, Math.round(width)), height: 48 });
      drawClipWaveform(wc, m.id, clip.in, clip.out, 'rgba(228,238,255,0.96)');
      children.push(wc);
    }
    children.push(el('div', { class: 'clip-dur', text: `${clipDur(clip).toFixed(1)}s` }));
    children.push(el('div', { class: 'clip-label', text: (clip.kind === 'audio' ? '🎵 ' : '') + (m ? m.name : '(欠落素材)') }));
    if (clip.kind === 'image') children.push(el('div', { class: 'clip-badge', text: 'IMG' }));
  }
  children.push(el('div', { class: 'trim right', 'data-trim': 'right' }));

  const node = el('div', {
    class: `clip ${kindClass}${selected ? ' selected' : ''}`,
    style: `left:${left}px;width:${width}px`,
    'data-id': clip.id,
  }, children);
  node.addEventListener('pointerdown', (e) => startClipDrag(e, track, clip));
  // ダブルクリック＝選択して編集パネルへフォーカス（直感的に編集を開く）
  node.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    setSelection({ trackId: track.id, clipId: clip.id });
    emit('edit-focus', clip.id);
  });
  // 右クリック／2本指タップ＝編集メニュー
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault(); e.stopPropagation();
    setSelection({ trackId: track.id, clipId: clip.id });
    showContextMenu(e.clientX, e.clientY, clipContextItems(track, clip));
  });
  return node;
}

// クリップ右クリックメニューの項目（種別に応じて出し分け）
function clipContextItems(track, clip) {
  const sel = () => setSelection({ trackId: track.id, clipId: clip.id });
  const items = [
    { label: '✏️ プロパティを編集', onClick: () => { sel(); emit('edit-focus', clip.id); } },
    { sep: true },
    { label: '✂ 再生位置で分割', onClick: () => { sel(); splitAtPlayhead(); } },
    { label: '⟕ 再生位置より前をカット', onClick: () => { sel(); cutBefore(); } },
    { label: '⟖ 再生位置より後ろをカット', onClick: () => { sel(); cutAfter(); } },
    { label: '⧉ 複製', onClick: () => { sel(); duplicateSelection(); } },
  ];
  if (clip.kind === 'video' || clip.kind === 'audio') {
    const m = mediaById(clip.mediaId);
    if (m && m.hasAudio !== false) {
      items.push({ sep: true });
      items.push({ label: '🔇 無音をカット', onClick: () => silenceCut(clip.id) });
      items.push({ label: '🗣 フィラーをカット', onClick: () => fillerCut(clip.id) });
    }
  }
  items.push({ sep: true });
  items.push({ label: '🗑 削除', danger: true, onClick: () => { sel(); deleteSelection(); } });
  return items;
}

function renderSelectionOnly() {
  const sel = getSelection();
  tracksEl.querySelectorAll('.clip').forEach((n) => {
    const isText = n.classList.contains('clip-text');
    const on = (!!sel && sel.allTelops && isText) || isSelected(n.dataset.id);
    n.classList.toggle('selected', on);
  });
}

function updatePlayhead() {
  playheadEl.style.left = (getPlayhead() * px()) + 'px';
  if (playheadTimeEl) playheadTimeEl.textContent = fmtTime(getPlayhead());
}
function updateZoomLabel() { const l = document.getElementById('zoomLabel'); if (l) l.textContent = Math.round(getZoom() / 80 * 100) + '%'; }

// ---- 座標 ----
function contentX(clientX) { return clientX - content.getBoundingClientRect().left; }
function timeAtClientX(clientX) { return clamp(contentX(clientX) / px(), 0, totalDuration()); }

// スナップ候補（0・再生位置・各クリップ端）
function snapTime(t, ignoreId) {
  const P = px();
  const cands = [0, getPlayhead()];
  for (const track of getTracks()) {
    for (const c of track.clips) {
      if (c.id === ignoreId) continue;
      cands.push(c.start, clipEnd(c));
    }
  }
  let best = t, bestPx = SNAP_PX;
  for (const c of cands) {
    const d = Math.abs((c - t) * P);
    if (d < bestPx) { bestPx = d; best = c; }
  }
  return best;
}

// ---- スクラブ / 範囲ドラッグ ----
function startScrub(e, fromKnob = false) {
  e.preventDefault();
  if (!fromKnob && getTool() === 'range') { startRangeDrag(e); return; }
  drag = { kind: 'scrub' };
  playheadEl.classList.add('scrubbing');
  if (!fromKnob) setSelection(null);
  seek(fromKnob ? getPlayhead() : timeAtClientX(e.clientX));
}

function startRangeDrag(e) {
  e.preventDefault();
  const t0 = timeAtClientX(e.clientX);
  drag = { kind: 'range', t0 };
  setRange({ start: t0, end: t0 });
}

// トラック領域のドラッグ＝マーキー（矩形）選択。範囲ツール時は時間バンド。クリックはシーク。
function startBodyDrag(e) {
  e.preventDefault();
  if (getTool() === 'range') { startRangeDrag(e); return; }
  drag = { kind: 'marquee', startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY, moved: false };
}
function updateMarquee(x0, y0, x1, y1) {
  if (!marqueeEl || !content) return;
  const cr = content.getBoundingClientRect();
  const left = Math.min(x0, x1) - cr.left, top = Math.min(y0, y1) - cr.top;
  marqueeEl.hidden = false;
  marqueeEl.style.left = left + 'px';
  marqueeEl.style.top = top + 'px';
  marqueeEl.style.width = Math.abs(x1 - x0) + 'px';
  marqueeEl.style.height = Math.abs(y1 - y0) + 'px';
}
function hideMarquee() { if (marqueeEl) marqueeEl.hidden = true; }
// 矩形（クライアント座標）に触れたクリップを選択
function selectClipsInBox(x0, y0, x1, y1) {
  const bx0 = Math.min(x0, x1), bx1 = Math.max(x0, x1), by0 = Math.min(y0, y1), by1 = Math.max(y0, y1);
  const ids = [];
  tracksEl.querySelectorAll('.clip').forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.right >= bx0 && r.left <= bx1 && r.bottom >= by0 && r.top <= by1) ids.push(n.dataset.id);
  });
  setMultiSelection(ids);
}

function updateRangeBand() {
  if (!rangeBandEl) return;
  const r = getRange();
  if (!r || r.end - r.start < 1e-6) { rangeBandEl.hidden = true; return; }
  rangeBandEl.hidden = false;
  rangeBandEl.style.left = (r.start * px()) + 'px';
  rangeBandEl.style.width = ((r.end - r.start) * px()) + 'px';
}
function updateToolCursor() {
  if (scrollEl) scrollEl.classList.toggle('range-mode', getTool() === 'range');
}

// ---- クリップ操作 ----
function startClipDrag(e, track, clip) {
  e.stopPropagation();
  if (getTool() === 'range') { startRangeDrag(e); return; }
  const trim = e.target && e.target.dataset ? e.target.dataset.trim : null;
  // Shift/Cmd/Ctrl クリック：選択に追加/解除（ドラッグはしない）
  if (!trim && (e.shiftKey || e.metaKey || e.ctrlKey)) { toggleSelect(track.id, clip.id); return; }
  // 既に複数選択に含まれるクリップを掴んだら、選択を保ったままグループ移動
  const inMulti = !trim && getSelectedIds().length > 1 && isSelected(clip.id);
  if (!inMulti) setSelection({ trackId: track.id, clipId: clip.id });
  let groupOrig = null;
  if (inMulti) {
    groupOrig = {};
    for (const id of getSelectedIds()) { const f = getTrackClip(id); if (f) groupOrig[id] = { start: f.clip.start, end: f.clip.end }; }
  }
  // 履歴は実際に動かした瞬間に積む（単なる選択クリックで undo 履歴を汚さない）
  drag = {
    kind: trim ? 'trim' : 'move', side: trim,
    trackId: track.id, clipId: clip.id, startX: e.clientX, startY: e.clientY, moved: false, historyPushed: false,
    alt: e.altKey, duplicated: false,
    group: inMulti ? getSelectedIds().slice() : null, groupOrig,
    origStart: clip.start, origIn: clip.in, origOut: clip.out, origEnd: clip.end,
  };
}

function onMove(e) {
  if (!drag) return;
  const P = px();
  if (drag.kind === 'scrub') { seek(timeAtClientX(e.clientX)); return; }
  if (drag.kind === 'marquee') {
    drag.curX = e.clientX; drag.curY = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    updateMarquee(drag.startX, drag.startY, e.clientX, e.clientY);
    return;
  }
  if (drag.kind === 'range') {
    const t = timeAtClientX(e.clientX);
    setRange({ start: Math.min(drag.t0, t), end: Math.max(drag.t0, t) });
    return;
  }

  const dt = (e.clientX - drag.startX) / P;
  // 横・縦どちらの動きでもドラッグ開始とみなす（縦＝トラック間移動のため）
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD && !drag.moved && drag.kind === 'move') return;
  drag.moved = true;
  if (!drag.historyPushed) { pushHistory(); drag.historyPushed = true; }

  // 複数選択のグループ移動（横方向のみ。primary をスナップした delta を全選択へ適用）
  if (drag.group) {
    let ns = Math.max(0, snapTime(Math.max(0, drag.origStart + dt), drag.clipId));
    let appliedDt = ns - drag.origStart;
    for (const id of drag.group) { const o = drag.groupOrig[id]; if (o) appliedDt = Math.max(appliedDt, -o.start); }
    for (const id of drag.group) {
      const f = getTrackClip(id); const o = drag.groupOrig[id]; if (!f || !o) continue;
      if (f.clip.kind === 'text') { const d = o.end - o.start; f.clip.start = o.start + appliedDt; f.clip.end = f.clip.start + d; }
      else f.clip.start = o.start + appliedDt;
    }
    noteDirty(); emit('project');
    return;
  }

  // Alt+ドラッグ：移動開始時にクリップを複製し、コピー側を動かす（元は残す）
  if (drag.kind === 'move' && drag.alt && !drag.duplicated) {
    const cur = getTrackClip(drag.clipId);
    if (cur) {
      const copy = JSON.parse(JSON.stringify(cur.clip));
      copy.id = uid(copy.kind === 'text' ? 'text' : 'clip');
      cur.track.clips.push(copy);
      drag.clipId = copy.id;
      drag.duplicated = true;
      // 以降の移動計算はコピーの初期値を基準にする
      drag.origStart = copy.start; drag.origEnd = copy.end; drag.origIn = copy.in; drag.origOut = copy.out;
      setSelection({ trackId: cur.track.id, clipId: copy.id });
    }
  }

  // 複製後は drag.clipId が差し替わるため、ここで対象クリップを確定する
  const found = getTrackClip(drag.clipId);
  if (!found) return;
  const { clip } = found;

  if (drag.kind === 'move') {
    moveClipVertically(e, found, clip); // 縦方向＝トラック間移動（最上段より上なら新規トラック生成）
    let ns = snapTime(Math.max(0, drag.origStart + dt), clip.id);
    ns = Math.max(0, ns);
    if (clip.kind === 'text') { const d = drag.origEnd - drag.origStart; clip.start = ns; clip.end = ns + d; }
    else clip.start = ns;
  } else if (drag.kind === 'trim') {
    if (clip.kind === 'text') {
      if (drag.side === 'left') clip.start = clamp(snapTime(drag.origStart + dt, clip.id), 0, drag.origEnd - MIN_TEXT);
      else clip.end = Math.max(clip.start + MIN_TEXT, snapTime(drag.origEnd + dt, clip.id));
    } else {
      // 速度を考慮：タイムライン上の移動 dt は素材上では dt*sp 進む
      const sp = clipSpeed(clip);
      if (drag.side === 'left') {
        let ni = clamp(drag.origIn + dt * sp, 0, drag.origOut - MIN_CLIP * sp);
        let ns = drag.origStart + (ni - drag.origIn) / sp;
        const snapped = snapTime(ns, clip.id);
        if (snapped !== ns) { ni = clamp(drag.origIn + (snapped - drag.origStart) * sp, 0, drag.origOut - MIN_CLIP * sp); ns = drag.origStart + (ni - drag.origIn) / sp; }
        clip.in = ni; clip.start = ns;
      } else {
        const maxOut = clipMaxOut(clip);
        let no = clamp(drag.origOut + dt * sp, drag.origIn + MIN_CLIP * sp, maxOut);
        const rightEdge = snapTime(drag.origStart + (no - drag.origIn) / sp, clip.id);
        no = clamp(drag.origIn + (rightEdge - drag.origStart) * sp, drag.origIn + MIN_CLIP * sp, maxOut);
        clip.out = no;
      }
    }
  }
  noteDirty();
  emit('project');
  if (clip.kind === 'text') emit('telop-live', clip.id);
}

function onUp() {
  if (!drag) return;
  if (drag.kind === 'marquee') {
    if (drag.moved) selectClipsInBox(drag.startX, drag.startY, drag.curX, drag.curY); // 矩形に触れたクリップを選択
    else { setSelection(null); seek(timeAtClientX(drag.startX)); }                    // クリック=シーク＋選択解除
    hideMarquee(); drag = null; return;
  }
  playheadEl.classList.remove('scrubbing');
  if (drag.kind === 'range') { drag = null; return; } // 範囲は保持
  const wasEdit = drag.kind !== 'scrub';
  const wasMove = drag.kind === 'move';
  const wasTrim = drag.kind === 'trim';
  const trackId = drag.trackId;
  const movedClipId = drag.clipId;
  const groupIds = drag.group;
  const spawnedTopId = drag.spawnedTopId;
  drag = null;
  if (wasEdit) {
    // 上ドラッグで生成したが結局空になったトラックは片付ける
    if (spawnedTopId) {
      const st = getTrack(spawnedTopId);
      if (st && !st.base && st.clips.length === 0) {
        const arr = getTracks(); const i = arr.indexOf(st); if (i >= 0) arr.splice(i, 1);
      }
    }
    // 整列＋同一トラックの重なりを上書き解決（移動/配置したクリップが勝ち、下のクリップの重なり区間を削る）
    if (groupIds) {
      for (const tr of getTracks()) {
        tr.clips.sort((a, b) => a.start - b.start);
        const tw = tr.clips.filter((c) => groupIds.includes(c.id)).map((c) => c.id);
        if (tw.length) resolveOverwrite(tr, tw);
      }
    } else {
      const track = trackId ? getTrack(trackId) : null;
      if (track) { track.clips.sort((a, b) => a.start - b.start); if (movedClipId) resolveOverwrite(track, [movedClipId]); }
    }
    // リンクした映像/音声をセットで移動・トリム（片方を動かす/端を詰めたらもう片方も追従）
    if ((wasMove || wasTrim) && !groupIds && movedClipId) syncLinkedPartner(movedClipId);
    emit('project');
  }
  if (!isPlaying()) seek(getPlayhead());
}

// リンク相手（detachedAudio の映像とその音声クリップ）の位置と素材区間（in/out/start）を揃える
function syncLinkedPartner(clipId) {
  const f = getTrackClip(clipId);
  if (!f || !f.clip) return;
  const partnerId = f.clip.linkedAudioId || f.clip.linkedVideoId;
  if (!partnerId) return;
  const pf = getTrackClip(partnerId);
  if (!pf || !pf.clip) return;
  const c = f.clip, pc = pf.clip;
  if (pc.kind === 'text') { const d = pc.end - pc.start; pc.start = Math.max(0, c.start); pc.end = pc.start + d; }
  else { pc.start = Math.max(0, c.start); if (c.kind !== 'text') { if (c.in != null) pc.in = c.in; if (c.out != null) pc.out = c.out; if (c.speed != null) pc.speed = c.speed; } }
  pf.track.clips.sort((a, b) => a.start - b.start);
  resolveOverwrite(pf.track, [partnerId]);
}

function getTrackClip(clipId) {
  for (const track of getTracks()) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

// ポインタの Y 座標があるトラック行の id を返す（行外は最寄りにクランプ）
function trackRowAtY(clientY) {
  const rows = tracksEl.querySelectorAll('.track');
  if (!rows.length) return null;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) return row.dataset.track;
  }
  const first = rows[0].getBoundingClientRect();
  return (clientY < first.top ? rows[0] : rows[rows.length - 1]).dataset.track;
}

// クリップとトラックの種別が両立するか（音声は audio トラック、映像系は visual トラック）
function trackCompatible(clip, track) {
  return track.kind === 'audio' ? clip.kind === 'audio' : clip.kind !== 'audio';
}

function relocate(fromTrack, toTrack, clip) {
  const i = fromTrack.clips.indexOf(clip);
  if (i >= 0) fromTrack.clips.splice(i, 1);
  toTrack.clips.push(clip);
}

// 縦ドラッグでのトラック間移動。最上段より上へドラッグした視覚クリップは
// 新しい最上位 visual トラックを自動生成して移動する（1ドラッグにつき1つだけ）。
function moveClipVertically(e, found, clip) {
  const rows = tracksEl.querySelectorAll('.track');
  const aboveTop = clip.kind !== 'audio' && rows.length && e.clientY < rows[0].getBoundingClientRect().top;
  if (aboveTop) {
    // すでに今回生成したトップトラック上にいるなら追加生成しない
    if (!drag.spawnedTopId || found.track.id !== drag.spawnedTopId) {
      const tracks = getTracks();
      const nt = { id: uid('trk'), kind: 'visual', name: 'V' + (tracks.filter((t) => t.kind === 'visual').length + 1), clips: [] };
      tracks.unshift(nt);
      relocate(found.track, nt, clip);
      drag.spawnedTopId = nt.id; drag.trackId = nt.id;
      setSelection({ trackId: nt.id, clipId: clip.id });
    }
    return;
  }
  const tgtId = trackRowAtY(e.clientY);
  if (tgtId && tgtId !== found.track.id) {
    const tgt = getTrack(tgtId);
    if (tgt && trackCompatible(clip, tgt)) {
      relocate(found.track, tgt, clip);
      drag.trackId = tgt.id;
      setSelection({ trackId: tgt.id, clipId: clip.id });
    }
  }
}

// ---- ズーム ----
export function zoomIn() { setZoom(getZoom() * 1.25); }
export function zoomOut() { setZoom(getZoom() / 1.25); }
export function zoomFit() {
  const total = totalDuration();
  if (total <= 0) { setZoom(80); return; }
  setZoom(clamp((scrollEl.clientWidth - 40) / total, 0.3, 600));
  scrollEl.scrollLeft = 0;
}
function zoomAround(clientX, newZoom) {
  const before = timeAtClientX(clientX);
  setZoom(newZoom);
  const rect = content.getBoundingClientRect();
  scrollEl.scrollLeft = before * px() - (clientX - rect.left - scrollEl.scrollLeft);
}

export function ensurePlayheadVisible() {
  const x = getPlayhead() * px();
  const left = scrollEl.scrollLeft, right = left + scrollEl.clientWidth;
  if (x < left + 40) scrollEl.scrollLeft = Math.max(0, x - 40);
  else if (x > right - 60) scrollEl.scrollLeft = x - scrollEl.clientWidth + 60;
}
