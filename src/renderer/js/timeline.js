// タイムライン描画 + 操作（複数トラック、配置/移動/トリム、スクラブ、スナップ）
import { el, clamp, fmtRuler, fmtTime, basename, uid } from './util.js';
import {
  getProject, on, emit, getZoom, setZoom, getPlayhead, setPlayhead,
  getSelection, setSelection, totalDuration, clipDur, clipEnd, getTrack,
  mediaById, pushHistory, noteDirty, isPlaying, getTracks, MIN_CLIP, clipMaxOut, removeTrack,
  getTool, getRange, setRange,
} from './state.js';
import { getThumb, addClipFromMedia, findFreeSlot } from './media.js';
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

let content, scrollEl, tracksEl, headersEl, ruler, playheadEl, playheadTimeEl, rangeBandEl;
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

  on('project', render);
  on('selection', renderSelectionOnly);
  on('zoom', render);
  on('playhead', updatePlayhead);
  on('range', updateRangeBand);
  on('tool', updateToolCursor);

  ruler.addEventListener('pointerdown', (e) => startScrub(e));
  scrollEl.addEventListener('pointerdown', (e) => {
    if (e.target.classList && (e.target.classList.contains('track') || e.target === content || e.target === tracksEl)) startScrub(e);
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
    if (!track.base) {
      children.push(el('button', { class: 'th-del', title: 'この層を削除', onClick: (e) => { e.stopPropagation(); if (track.clips.length === 0 || confirm(`「${track.name}」を削除しますか？`)) removeTrack(track.id); } }, ['✕']));
    }
    headersEl.appendChild(el('div', { class: `th-row th-${track.kind}`, style: `height:${TRACK_H[track.kind]}px` }, children));
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
  const selected = sel && sel.clipId === clip.id;
  const kindClass = clip.kind === 'text' ? 'clip-text' : clip.kind === 'image' ? 'clip-image' : clip.kind === 'audio' ? 'clip-audio' : 'clip-video';
  const children = [el('div', { class: 'trim left', 'data-trim': 'left' })];

  if (clip.kind === 'text') {
    children.push(el('div', { class: 'clip-label', text: (clip.text || '').split('\n')[0] || 'テロップ' }));
  } else {
    const m = mediaById(clip.mediaId);
    const thumb = m ? getThumb(m.id) : null;
    if (thumb) children.push(el('div', { class: 'clip-thumb', style: `background-image:url(${thumb})` }));
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
  return node;
}

function renderSelectionOnly() {
  const sel = getSelection();
  tracksEl.querySelectorAll('.clip').forEach((n) => {
    const isText = n.classList.contains('clip-text');
    const on = !!sel && (sel.allTelops ? isText : sel.clipId === n.dataset.id);
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
  setSelection({ trackId: track.id, clipId: clip.id });
  // 履歴は実際に動かした瞬間に積む（単なる選択クリックで undo 履歴を汚さない）
  drag = {
    kind: trim ? 'trim' : 'move', side: trim,
    trackId: track.id, clipId: clip.id, startX: e.clientX, startY: e.clientY, moved: false, historyPushed: false,
    alt: e.altKey, duplicated: false,
    origStart: clip.start, origIn: clip.in, origOut: clip.out, origEnd: clip.end,
  };
}

function onMove(e) {
  if (!drag) return;
  const P = px();
  if (drag.kind === 'scrub') { seek(timeAtClientX(e.clientX)); return; }
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
      if (drag.side === 'left') {
        let ni = clamp(drag.origIn + dt, 0, drag.origOut - MIN_CLIP);
        let ns = drag.origStart + (ni - drag.origIn);
        // 左端スナップ
        const snapped = snapTime(ns, clip.id);
        if (snapped !== ns) { ni = clamp(drag.origIn + (snapped - drag.origStart), 0, drag.origOut - MIN_CLIP); ns = drag.origStart + (ni - drag.origIn); }
        clip.in = ni; clip.start = ns;
      } else {
        const maxOut = clipMaxOut(clip);
        let no = clamp(drag.origOut + dt, drag.origIn + MIN_CLIP, maxOut);
        // 右トリム中は start/in は不変なので原点(orig)基準で算出（左トリムと一貫）
        const rightEdge = snapTime(drag.origStart + (no - drag.origIn), clip.id);
        no = clamp(drag.origIn + (rightEdge - drag.origStart), drag.origIn + MIN_CLIP, maxOut);
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
  playheadEl.classList.remove('scrubbing');
  if (drag.kind === 'range') { drag = null; return; } // 範囲は保持
  const wasEdit = drag.kind !== 'scrub';
  const trackId = drag.trackId;
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
    // クリップを start 順に整列（重なりはそのまま許容）
    const track = trackId ? getTrack(trackId) : null;
    if (track) track.clips.sort((a, b) => a.start - b.start);
    emit('project');
  }
  if (!isPlaying()) seek(getPlayhead());
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
