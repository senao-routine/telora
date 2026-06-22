// 編集コマンド層（EditCommands）— モデル②MCP・③AIチャットが共有する心臓部。
// 既存の state.js / edit.js / cut-tools.js / media.js / export-ui.js を、
// JSON入出力・undo整合・{ok,result,error} 返却の安定APIにラップする。
//
// 設計原則:
//  - 入出力はJSONシリアライズ可能なプリミティブのみ（DOM/関数を跨がせない）。
//  - 破壊的コマンドは mutate / 既存関数経由で必ず履歴(undo)に乗せる。
//  - 検証は mutate の外（読み取り）で行い、不正なら mutate 前に throw（不要な履歴を積まない）。
import {
  getProject, getTracks, getTrack, totalDuration, getPlayhead, setPlayhead,
  setSelection, getSelection, findClip, getTextClips, defaultTextClip, mutate, undo, redo,
  toggleTrackMute, clipEnd, clipDur, mediaById, slotFree,
} from '../state.js';
import { splitAtPlayhead, cutBefore as editCutBefore, cutAfter as editCutAfter, deleteSelection, applyCrossfade } from '../edit.js';
import { silenceCut, fillerCut } from '../cut-tools.js';
import { importMedia, addClipFromMedia } from '../media.js';
import { buildExportPayload } from '../export-ui.js';
import { uid } from '../util.js';

const r3 = (x) => Math.round((x || 0) * 1000) / 1000; // 秒を ms 精度に丸める

// ---- 読み取り ----
function getTimeline() {
  const p = getProject();
  return {
    settings: { width: p.settings.width, height: p.settings.height, fps: p.settings.fps || 30 },
    playhead: r3(getPlayhead()),
    duration: r3(totalDuration()),
    tracks: getTracks().map((t) => ({
      id: t.id, name: t.name, kind: t.kind, base: !!t.base, muted: !!t.muted,
      clips: t.clips.map((c) => ({
        id: c.id, kind: c.kind,
        start: r3(c.start), end: r3(clipEnd(c)), dur: r3(clipDur(c)),
        media: c.mediaId ? ((mediaById(c.mediaId) || {}).name || null) : null,
        text: c.kind === 'text' ? c.text : undefined,
      })),
    })),
  };
}

function getTranscript({ clipId } = {}) {
  let clips = getTextClips();
  if (clipId) clips = clips.filter((c) => c.id === clipId);
  return { cues: clips.map((c) => ({ id: c.id, start: r3(c.start), end: r3(c.end), text: c.text })) };
}

// ---- 選択 ----
function selectClip({ trackId, clipId }) {
  if (!clipId) throw new Error('clipId は必須です');
  if (!findClip(clipId)) throw new Error('clip が見つかりません: ' + clipId);
  setSelection({ trackId, clipId });
  return { selected: clipId };
}

// ---- カット（再生位置基準の既存操作を時刻指定で呼ぶ） ----
function splitAt({ time }) {
  if (time == null) throw new Error('time は必須です');
  setPlayhead(time); splitAtPlayhead();
  return { at: r3(getPlayhead()) };
}
function cutBeforeCmd({ time }) {
  if (time != null) setPlayhead(time);
  editCutBefore();
  return { at: r3(getPlayhead()) };
}
function cutAfterCmd({ time }) {
  if (time != null) setPlayhead(time);
  editCutAfter();
  return { at: r3(getPlayhead()) };
}

function deleteClip({ clipId }) {
  const f = findClip(clipId);
  if (!f) throw new Error('clip が見つかりません: ' + clipId);
  setSelection({ trackId: f.track.id, clipId });
  deleteSelection();
  return { deleted: clipId };
}

// 指定 start（必要なら別トラック）へクリップを移動。後続は動かさない局所処理。
function moveClip({ clipId, start, trackId }) {
  if (clipId == null || start == null) throw new Error('clipId と start は必須です');
  const f = findClip(clipId);
  if (!f) throw new Error('clip が見つかりません: ' + clipId);
  if (trackId && trackId !== f.track.id) {
    const to = getTrack(trackId);
    if (!to) throw new Error('trackId が見つかりません: ' + trackId);
    if (to.kind !== f.track.kind) throw new Error('種別の異なるトラックへは移動できません');
  }
  const ns = Math.max(0, start);
  mutate((p) => {
    let from = null, clip = null;
    for (const t of p.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) { from = t; clip = c; break; } }
    const textDur = clip.kind === 'text' ? (clip.end - clip.start) : 0;
    let target = from;
    if (trackId && trackId !== from.id) {
      const to = p.tracks.find((t) => t.id === trackId);
      from.clips = from.clips.filter((x) => x.id !== clipId);
      to.clips.push(clip); target = to;
    }
    clip.start = ns;
    if (clip.kind === 'text') clip.end = ns + textDur;
    target.clips.sort((a, b) => a.start - b.start);
  });
  return { clipId, start: r3(ns), trackId: trackId || f.track.id };
}

// ---- テロップ ----
function addTelop({ text, start, end, style }) {
  const s = Math.max(0, start != null ? start : getPlayhead());
  const e = Math.max(s + 0.2, end != null ? end : s + 3);
  let id = null, trackId = null;
  mutate((p) => {
    const tp = defaultTextClip(s);
    tp.start = s; tp.end = e;
    if (text != null) tp.text = String(text);
    if (style && typeof style === 'object') Object.assign(tp, style);
    const dur = e - s;
    const visuals = p.tracks.filter((t) => t.kind === 'visual');
    let track = visuals.find((t) => slotFree(t, s, dur));
    if (!track) { track = { id: uid('trk'), kind: 'visual', name: 'V' + (visuals.length + 1), clips: [] }; p.tracks.unshift(track); }
    track.clips.push(tp); track.clips.sort((a, b) => a.start - b.start);
    id = tp.id; trackId = track.id;
  });
  if (id) setSelection({ trackId, clipId: id });
  return { clipId: id, trackId, start: r3(s), end: r3(e) };
}

function setTelop({ clipId, text, style }) {
  const f = findClip(clipId);
  if (!f || f.clip.kind !== 'text') throw new Error('テロップが見つかりません: ' + clipId);
  mutate((p) => {
    let clip = null;
    for (const t of p.tracks) { const c = t.clips.find((x) => x.id === clipId); if (c) { clip = c; break; } }
    if (text != null) clip.text = String(text);
    if (style && typeof style === 'object') Object.assign(clip, style);
  });
  return { updated: clipId };
}

// ---- カット支援（既存 cut-tools をそのまま） ----
async function cutSilence({ clipId, noiseDb, minDur }) {
  if (!clipId) throw new Error('clipId は必須です');
  const opts = {};
  if (noiseDb != null) opts.noiseDb = noiseDb;
  if (minDur != null) opts.minDur = minDur;
  const res = await silenceCut(clipId, opts);
  return res || { made: 0 };
}
async function cutFillers({ clipId }) {
  if (!clipId) throw new Error('clipId は必須です');
  const res = await fillerCut(clipId);
  return res || { ok: false };
}

// ---- トラック ----
function setTrackMute({ trackId, muted }) {
  const tr = getTrack(trackId);
  if (!tr) throw new Error('trackId が見つかりません: ' + trackId);
  const want = !!muted;
  if (!!tr.muted !== want) toggleTrackMute(trackId);
  return { trackId, muted: want };
}

// ---- その他 ----
function addCrossfade({ duration } = {}) {
  applyCrossfade(duration != null ? duration : 0.6); // 選択クリップを直前に重ねてクロスフェード（要・事前 selectClip）
  return { ok: true };
}
async function importMediaCmd({ paths }) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('paths（配列）は必須です');
  const added = await importMedia(paths, { addToTimeline: false });
  return { media: (added || []).map((m) => ({ id: m.id, name: m.name, type: m.type, duration: r3(m.duration) })) };
}
// 読み込み済み素材をタイムラインへ配置（addClipFromMedia は選択を新クリップへ移すので、それから id を得る）
function addClip({ mediaId, start, trackId }) {
  if (!mediaId) throw new Error('mediaId は必須です');
  if (!mediaById(mediaId)) throw new Error('media が見つかりません: ' + mediaId);
  addClipFromMedia(mediaId, { start: start != null ? start : getPlayhead(), trackId: trackId || null, silent: true });
  const sel = getSelection();
  return { clipId: sel ? sel.clipId : null, trackId: sel ? sel.trackId : null };
}
async function exportCmd(args = {}) {
  const { outputPath, format, quality, hwaccel, range } = args;
  if (!outputPath) throw new Error('outputPath は必須です（コマンドからの書き出しは保存先を明示してください）');
  const built = await buildExportPayload({ format, quality, hwaccel, range, outputPath });
  if (!built.ok) throw new Error(built.error);
  const result = await window.api.exportVideo(built.payload);
  if (!result || !result.ok) throw new Error((result && result.error) || '書き出しに失敗しました');
  return { outputPath: result.outputPath };
}
function undoCmd() { undo(); return { ok: true }; }
function redoCmd() { redo(); return { ok: true }; }

// ---- ディスパッチ ----
const HANDLERS = {
  getTimeline, getTranscript, selectClip,
  splitAt, cutBefore: cutBeforeCmd, cutAfter: cutAfterCmd, deleteClip, moveClip,
  addTelop, setTelop, cutSilence, cutFillers, setTrackMute,
  addCrossfade, importMedia: importMediaCmd, addClip, export: exportCmd, undo: undoCmd, redo: redoCmd,
};

// コマンド実行。常に {ok, result?} / {ok:false, error} を返す（例外は構造化エラーへ）。
export async function run(name, args = {}) {
  const fn = HANDLERS[name];
  if (!fn) return { ok: false, error: 'unknown command: ' + name };
  try {
    const result = await fn(args || {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export function listCommands() { return Object.keys(HANDLERS); }
