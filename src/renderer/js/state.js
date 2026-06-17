// 中央ステート管理 + イベントバス + 履歴(undo/redo)
// v2: 複数トラック（動画/画像トラック・オーバーレイ・テロップ）モデル
import { uid } from './util.js';

export const DEFAULT_IMAGE_DUR = 5;   // 画像クリップの既定表示秒数
export const IMAGE_MAX_DUR = 3600;    // 画像クリップの最大尺
export const MIN_CLIP = 0.1;

// トラック構成（配列の先頭が最前面レイヤ。合成は末尾＝最背面から行う）
function freshTracks() {
  // 上から：テロップ → オーバーレイ → メイン動画 → 音声（Filmora 風に映像が上・音声が下）
  return [
    { id: uid('trk'), kind: 'text', name: 'テロップ', clips: [] },
    { id: uid('trk'), kind: 'overlay', name: 'オーバーレイ', clips: [] },
    { id: uid('trk'), kind: 'video', name: 'メイン', clips: [], base: true },
    { id: uid('trk'), kind: 'audio', name: 'オーディオ', clips: [] },
  ];
}

function freshProject() {
  return {
    version: 2,
    name: '無題のプロジェクト',
    settings: { width: 1280, height: 720, fps: 30 },
    media: [],   // { id, name, path, type:'video'|'image', duration, width, height, fps, hasAudio }
    tracks: freshTracks(),
  };
}

const state = {
  project: freshProject(),
  ui: {
    playhead: 0,
    selection: null,     // { trackId, clipId }
    pxPerSec: 80,
    playing: false,
    projectPath: null,
    dirty: false,
    tool: 'select',   // 'select' | 'range'
    range: null,      // { start, end }
  },
};

// ---- イベントバス ----
const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, payload) {
  const set = listeners.get(event);
  if (set) for (const fn of [...set]) fn(payload);
}

// ---- 履歴 ----
const past = [];
const future = [];
const HISTORY_LIMIT = 80;
function snapshot() { return JSON.stringify(state.project); }
function restore(json) { state.project = JSON.parse(json); }

export function pushHistory() {
  const snap = snapshot();
  if (past.length > 0 && past[past.length - 1] === snap) return;
  past.push(snap);
  if (past.length > HISTORY_LIMIT) past.shift();
  future.length = 0;
}
export function undo() {
  if (past.length === 0) return false;
  future.push(snapshot());
  restore(past.pop());
  sanitizeSelection(); markDirty(); emit('project'); emit('selection'); return true;
}
export function redo() {
  if (future.length === 0) return false;
  past.push(snapshot());
  restore(future.pop());
  sanitizeSelection(); markDirty(); emit('project'); emit('selection'); return true;
}
export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }

export function mutate(fn, { history = true } = {}) {
  if (history) pushHistory();
  fn(state.project);
  markDirty();
  emit('project');
}

function markDirty() { state.ui.dirty = true; emit('dirty'); }
export function clearDirty() { state.ui.dirty = false; emit('dirty'); }
export function noteDirty() { markDirty(); }

// ---- アクセサ ----
export function getState() { return state; }
export function getProject() { return state.project; }
export function getUI() { return state.ui; }

export function setProject(p) {
  state.project = p;
  past.length = 0; future.length = 0;
  emit('project'); emit('selection');
}
export function newProject() {
  setProject(freshProject());
  state.ui.playhead = 0; state.ui.selection = null; state.ui.projectPath = null;
  clearDirty(); emit('playhead');
}

// ---- 選択 ----
export function setSelection(sel) { state.ui.selection = sel; emit('selection'); }
export function getSelection() { return state.ui.selection; }
function sanitizeSelection() {
  const sel = state.ui.selection;
  if (!sel || sel.allTelops) return;
  if (!findClip(sel.clipId)) state.ui.selection = null;
}

// 全テロップ選択（一括編集モード）
export function selectAllTelops() { setSelection({ allTelops: true }); }
export function getTextClips() {
  const out = [];
  for (const tr of state.project.tracks) if (tr.kind === 'text') for (const c of tr.clips) out.push(c);
  return out;
}

// ---- 再生位置 ----
export function setPlayhead(t, { emitEvent = true } = {}) {
  const total = totalDuration();
  state.ui.playhead = Math.max(0, Math.min(total, t));
  if (emitEvent) emit('playhead');
}
export function getPlayhead() { return state.ui.playhead; }

// ---- ズーム ----
export function setZoom(px) { state.ui.pxPerSec = Math.max(0.3, Math.min(600, px)); emit('zoom'); }
export function getZoom() { return state.ui.pxPerSec; }

// ---- 再生状態 ----
export function setPlaying(p) { state.ui.playing = p; emit('playing'); }
export function isPlaying() { return state.ui.playing; }

// ---- ツールモード / 範囲選択 ----
export function getTool() { return state.ui.tool; }
export function setTool(t) { state.ui.tool = t; if (t !== 'range') state.ui.range = null; emit('tool'); emit('range'); }
export function toggleRangeTool() { setTool(state.ui.tool === 'range' ? 'select' : 'range'); }
export function getRange() { return state.ui.range; }
export function setRange(r) { state.ui.range = r; emit('range'); }
export function clearRange() { state.ui.range = null; emit('range'); }

// ---- トラック / クリップ計算 ----
export function getTracks() { return state.project.tracks; }
export function getTrack(id) { return state.project.tracks.find((t) => t.id === id) || null; }
export function baseTrack() {
  const v = state.project.tracks.filter((t) => t.kind === 'video');
  return v.length ? v[v.length - 1] : null; // 最背面の動画トラック
}
export function tracksBottomToTop() { return [...state.project.tracks].reverse(); }

export function clipDur(c) {
  if (c.kind === 'text') return Math.max(0, c.end - c.start);
  return Math.max(0, c.out - c.in);
}
export function clipEnd(c) { return c.start + clipDur(c); }

export function mediaById(id) { return state.project.media.find((m) => m.id === id) || null; }

// 全クリップから ID で検索
export function findClip(clipId) {
  for (const track of state.project.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx >= 0) return { track, clip: track.clips[idx], index: idx };
  }
  return null;
}

// あるトラックで時刻 t に有効なクリップ
export function clipAtTimeOnTrack(track, t) {
  for (const c of track.clips) {
    if (t >= c.start - 1e-6 && t < clipEnd(c) - 1e-6) return c;
  }
  // 末尾ぴったりも拾う
  for (const c of track.clips) {
    if (Math.abs(clipEnd(c) - t) < 1e-6 && clipDur(c) > 0) return c;
  }
  return null;
}

// ベース（メイン動画）トラック上の時刻 t のクリップ情報
export function baseClipAtTime(t) {
  const tr = baseTrack();
  if (!tr) return null;
  const clip = clipAtTimeOnTrack(tr, t);
  if (!clip) return null;
  return { track: tr, clip, sourceTime: clip.in + (t - clip.start) };
}

// タイムライン総尺（全トラック・全クリップの最大終端）
export function totalDuration() {
  let max = 0;
  for (const track of state.project.tracks) {
    for (const c of track.clips) max = Math.max(max, clipEnd(c));
  }
  return max;
}

// メイントラックの長さ（書き出し基準）
export function baseDuration() {
  const tr = baseTrack();
  if (!tr) return 0;
  let max = 0;
  for (const c of tr.clips) max = Math.max(max, clipEnd(c));
  return max;
}

// クリップの最大アウト点（素材尺。画像は上限を緩める）
export function clipMaxOut(clip) {
  if (clip.kind === 'image') return IMAGE_MAX_DUR;
  const m = mediaById(clip.mediaId);
  return m ? m.duration : clip.out;
}

// ---- クリップ生成 ----
export function makeClipFromMedia(media, start = 0) {
  if (media.type === 'image') {
    return {
      id: uid('clip'), kind: 'image', mediaId: media.id,
      in: 0, out: DEFAULT_IMAGE_DUR, start,
      transform: { x: 0.5, y: 0.5, scale: 1 },
    };
  }
  if (media.type === 'audio') {
    return { id: uid('clip'), kind: 'audio', mediaId: media.id, in: 0, out: media.duration || 0, start, volume: 1 };
  }
  return {
    id: uid('clip'), kind: 'video', mediaId: media.id,
    in: 0, out: media.duration || 0, start,
    transform: { x: 0.5, y: 0.5, scale: 1 },
  };
}

export function defaultTextClip(start) {
  const total = totalDuration();
  const s = Math.max(0, start);
  const end = Math.min(total > 0 ? Math.max(total, s + 3) : s + 3, s + 3);
  return {
    id: uid('text'),
    kind: 'text',
    start: s,
    end: end > s ? end : s + 3,
    text: 'テロップ',
    x: 0.5, y: 0.88,
    size: 0.08,
    color: '#ffffff',
    fontFamily: '"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif',
    bold: true, italic: false, align: 'center',
    bg: false, bgColor: '#000000', bgOpacity: 0.45,
    outline: true, outlineColor: '#000000', outlineWidth: 0.08,
    shadow: true,
    anim: 'none',
  };
}

// テロップのデザインプリセット（8種）。style を選択中テロップへ適用する。
export const TELOP_PRESETS = [
  { name: 'シンプル白', style: { color: '#ffffff', bold: true, outline: true, outlineColor: '#000000', outlineWidth: 0.06, bg: false, shadow: true } },
  { name: '太フチ白', style: { color: '#ffffff', bold: true, outline: true, outlineColor: '#000000', outlineWidth: 0.14, bg: false, shadow: true } },
  { name: '黄色強調', style: { color: '#ffe14a', bold: true, outline: true, outlineColor: '#000000', outlineWidth: 0.10, bg: false, shadow: true } },
  { name: '黒帯字幕', style: { color: '#ffffff', bold: true, outline: false, bg: true, bgColor: '#000000', bgOpacity: 0.62, shadow: false } },
  { name: 'ニュース風', style: { color: '#ffffff', bold: true, outline: false, bg: true, bgColor: '#1740c8', bgOpacity: 0.9, shadow: false } },
  { name: 'ポップ赤', style: { color: '#ffffff', bold: true, outline: true, outlineColor: '#e0483d', outlineWidth: 0.16, bg: false, shadow: true } },
  { name: 'ネオン緑', style: { color: '#6dffa0', bold: true, outline: true, outlineColor: '#06351f', outlineWidth: 0.12, bg: false, shadow: true } },
  { name: 'ミニマル黒', style: { color: '#1b1b1b', bold: true, outline: true, outlineColor: '#ffffff', outlineWidth: 0.08, bg: false, shadow: false } },
];

export const TELOP_ANIMS = [
  { v: 'none', label: 'なし' },
  { v: 'fade', label: 'フェード' },
  { v: 'slideUp', label: 'スライド↑' },
  { v: 'slideDown', label: 'スライド↓' },
  { v: 'slideLeft', label: 'スライド←' },
  { v: 'slideRight', label: 'スライド→' },
  { v: 'pop', label: 'ポップ' },
  { v: 'zoom', label: 'ズーム' },
  { v: 'typewriter', label: 'タイプライター' },
];

export function applyTelopPreset(clipId, presetIndex) {
  const preset = TELOP_PRESETS[presetIndex];
  if (!preset) return;
  const f = findClip(clipId);
  if (!f || f.clip.kind !== 'text') return;
  pushHistory();
  Object.assign(f.clip, preset.style);
  markDirty();
  emit('project');
  emit('telop-live', clipId);
}

// ---- トラック（レイヤ）操作 ----
export function addTrack(kind) {
  pushHistory();
  const baseName = kind === 'text' ? 'テロップ' : kind === 'overlay' ? 'オーバーレイ' : '動画';
  const count = state.project.tracks.filter((t) => t.kind === kind).length;
  const track = { id: uid('trk'), kind, name: count > 0 ? `${baseName}${count + 1}` : baseName, clips: [] };
  const tracks = state.project.tracks;
  if (kind === 'text') {
    tracks.unshift(track); // テキストは最前面（上）へ
  } else if (kind === 'audio') {
    tracks.push(track); // 音声は最下部（映像の下）へ
  } else {
    const baseIdx = tracks.findIndex((t) => t.base);
    tracks.splice(baseIdx >= 0 ? baseIdx : tracks.length, 0, track); // ベースの直上へ
  }
  markDirty();
  emit('project');
  return track.id;
}

export function removeTrack(id) {
  const tr = state.project.tracks.find((t) => t.id === id);
  if (!tr || tr.base) return false; // ベーストラックは削除不可
  pushHistory();
  state.project.tracks = state.project.tracks.filter((t) => t.id !== id);
  sanitizeSelection();
  markDirty();
  emit('project');
  emit('selection');
  return true;
}

// メイントラック末尾の時刻（順次追加用）
export function mainTrackEnd() {
  const tr = baseTrack();
  if (!tr || tr.clips.length === 0) return 0;
  return tr.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export { freshProject, freshTracks };
