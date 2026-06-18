// 編集操作：分割・削除・テロップ追加・再生位置での前後カット
import {
  getProject, mutate, getPlayhead, getSelection, setSelection, findClip,
  clipDur, clipEnd, baseClipAtTime, defaultTextClip, getTracks, totalDuration,
  slotFree, MIN_CLIP,
} from './state.js';
import { uid } from './util.js';
import { findFreeSlot } from './media.js';
import { toast } from './ui.js';

const MIN = MIN_CLIP;

// 再生位置にかかっている対象クリップ（選択優先、無ければベース動画）
function targetClipAtPlayhead() {
  const t = getPlayhead();
  const sel = getSelection();
  if (sel) {
    const f = findClip(sel.clipId);
    if (f && t > f.clip.start + 1e-6 && t < clipEnd(f.clip) - 1e-6) return f;
  }
  const base = baseClipAtTime(t);
  if (base) return findClip(base.clip.id);
  return null;
}

// 分割
export function splitAtPlayhead() {
  const t = getPlayhead();
  const target = targetClipAtPlayhead();
  if (!target) { toast('分割位置にクリップがありません', 'err'); return; }
  const { clip } = target;
  const local = t - clip.start;
  if (local < MIN || local > clipDur(clip) - MIN) { toast('クリップの端では分割できません', 'err'); return; }

  let newId = null;
  mutate((p) => {
    const f = findClip(clip.id);
    const tr = f.track; const idx = f.index; const c = f.clip;
    let second;
    if (c.kind === 'text') {
      second = Object.assign({}, c, { id: uid('text'), start: t, end: c.end });
      c.end = t;
    } else {
      const srcSplit = c.in + local;
      second = { id: uid('clip'), kind: c.kind, mediaId: c.mediaId, in: srcSplit, out: c.out, start: t, transform: Object.assign({}, c.transform) };
      c.out = srcSplit;
    }
    tr.clips.splice(idx + 1, 0, second);
    newId = second.id;
    track_sort(tr);
  });
  if (newId) { const f = findClip(newId); if (f) setSelection({ trackId: f.track.id, clipId: newId }); }
  toast('クリップを分割しました');
}

// 再生位置より前をカット（先頭をトリム）
export function cutBefore() {
  const t = getPlayhead();
  const target = targetClipAtPlayhead();
  if (!target) { toast('再生位置にクリップがありません', 'err'); return; }
  const { clip } = target;
  // 残るクリップ(t〜末尾)が MIN 未満にならないようにする
  if (t <= clip.start + MIN || t >= clipEnd(clip) - MIN) { toast('カットできる位置ではありません', 'err'); return; }
  mutate(() => {
    const c = findClip(clip.id).clip;
    if (c.kind === 'text') { c.start = t; }
    else { c.in = c.in + (t - c.start); c.start = t; }
  });
  toast('再生位置より前をカットしました');
}

// 再生位置より後ろをカット（末尾をトリム）
export function cutAfter() {
  const t = getPlayhead();
  const target = targetClipAtPlayhead();
  if (!target) { toast('再生位置にクリップがありません', 'err'); return; }
  const { clip } = target;
  // 残るクリップ(先頭〜t)が MIN 未満にならないようにする
  if (t <= clip.start + MIN || t >= clipEnd(clip) - MIN) { toast('カットできる位置ではありません', 'err'); return; }
  mutate(() => {
    const c = findClip(clip.id).clip;
    if (c.kind === 'text') { c.end = t; }
    else { c.out = c.in + (t - c.start); }
  });
  toast('再生位置より後ろをカットしました');
}

// 選択削除
export function deleteSelection() {
  const sel = getSelection();
  if (!sel) { toast('削除する対象を選択してください', 'err'); return; }
  const f = findClip(sel.clipId);
  if (!f) { toast('対象が見つかりません', 'err'); return; }
  mutate(() => {
    const ff = findClip(sel.clipId);
    ff.track.clips.splice(ff.index, 1);
  });
  setSelection(null);
  toast('削除しました');
}

// テロップ追加：再生位置に置く。上半分(visual)の空いているトラックを上から探し、
// 無ければ最上段に新しい visual トラックを自動追加する（他ソフト同様の柔軟レイヤ）。
export function addTelopAtPlayhead() {
  const t = getPlayhead();
  const dur = 3;
  let id = null, trackId = null;
  mutate((p) => {
    const tp = defaultTextClip(t);
    tp.start = t; tp.end = t + dur;
    const visuals = p.tracks.filter((x) => x.kind === 'visual');
    let track = visuals.find((tr) => slotFree(tr, t, dur));
    if (!track) {
      track = { id: uid('trk'), kind: 'visual', name: `V${visuals.length + 1}`, clips: [] };
      p.tracks.unshift(track); // 最上段へ自動追加
    }
    track.clips.push(tp);
    track_sort(track);
    id = tp.id; trackId = track.id;
  });
  if (id) setSelection({ trackId, clipId: id });
  toast('テロップを追加しました');
  return id;
}

function track_sort(tr) { tr.clips.sort((a, b) => a.start - b.start); }

// ---- コピー / 貼り付け / 複製 ----
let clipboard = null;
export function copySelection() {
  const sel = getSelection();
  if (!sel || sel.allTelops) { toast('コピーするクリップを選択してください', 'err'); return; }
  const f = findClip(sel.clipId);
  if (!f) return;
  clipboard = { clip: JSON.parse(JSON.stringify(f.clip)), trackId: f.track.id, trackKind: f.track.kind };
  toast('コピーしました（Cmd/Ctrl+V で貼り付け）');
}
export function cutSelection() {
  const sel = getSelection();
  if (!sel || sel.allTelops) { toast('切り取るクリップを選択してください', 'err'); return; }
  copySelection();
  deleteSelection();
}
function placeClone(srcClip, trackId, trackKind, atStart) {
  let track = getTracks().find((t) => t.id === trackId) || getTracks().find((t) => t.kind === trackKind);
  if (!track) { toast('貼り付け先のトラックがありません', 'err'); return null; }
  let newId = null;
  mutate(() => {
    const tr = getTracks().find((x) => x.id === track.id);
    const c = JSON.parse(JSON.stringify(srcClip));
    c.id = uid(c.kind === 'text' ? 'text' : 'clip');
    const dur = c.kind === 'text' ? (c.end - c.start) : (c.out - c.in);
    const start = findFreeSlot(tr, Math.max(0, atStart), dur, null);
    if (c.kind === 'text') { c.start = start; c.end = start + dur; } else c.start = start;
    tr.clips.push(c);
    tr.clips.sort((a, b) => a.start - b.start);
    newId = c.id;
  });
  if (newId) { const f = findClip(newId); if (f) setSelection({ trackId: f.track.id, clipId: newId }); }
  return newId;
}
// 貼り付け：再生位置(カーソル)に置く。元と同じ位置（カーソル未移動）で重なる場合は
// 1つ上のトラックへ繰り上げて配置する（無ければ最上段に新規トラックを自動作成）。他ソフト同様。
export function pasteClipboard() {
  if (!clipboard) { toast('コピーされたクリップがありません', 'err'); return; }
  const c0 = clipboard.clip;
  const start = Math.max(0, getPlayhead());
  const dur = c0.kind === 'text' ? (c0.end - c0.start) : (c0.out - c0.in);
  let newId = null, finalTrackId = null;
  mutate((p) => {
    const c = JSON.parse(JSON.stringify(c0));
    c.id = uid(c.kind === 'text' ? 'text' : 'clip');
    if (c.kind === 'text') { c.start = start; c.end = start + dur; } else c.start = start;

    if (c.kind === 'audio') {
      const audios = p.tracks.filter((t) => t.kind === 'audio');
      const src = p.tracks.find((t) => t.id === clipboard.trackId && t.kind === 'audio');
      let track = (src && slotFree(src, start, dur)) ? src : (audios.find((t) => slotFree(t, start, dur)) || null);
      if (!track) { track = { id: uid('trk'), kind: 'audio', name: 'A' + (audios.length + 1), clips: [] }; p.tracks.push(track); }
      track.clips.push(c); track.clips.sort((a, b) => a.start - b.start);
      newId = c.id; finalTrackId = track.id;
      return;
    }
    // 映像系：同位置が空いていれば元トラック、埋まっていれば1つ上の visual トラックへ
    const src = p.tracks.find((t) => t.id === clipboard.trackId && t.kind === 'visual');
    let track = (src && slotFree(src, start, dur)) ? src : null;
    if (!track) {
      const startIdx = src ? p.tracks.indexOf(src) : p.tracks.length;
      for (let i = startIdx - 1; i >= 0; i--) { const t = p.tracks[i]; if (t.kind === 'visual' && slotFree(t, start, dur)) { track = t; break; } }
    }
    if (!track) { track = { id: uid('trk'), kind: 'visual', name: 'V' + (p.tracks.filter((t) => t.kind === 'visual').length + 1), clips: [] }; p.tracks.unshift(track); }
    track.clips.push(c); track.clips.sort((a, b) => a.start - b.start);
    newId = c.id; finalTrackId = track.id;
  });
  if (newId) setSelection({ trackId: finalTrackId, clipId: newId });
  toast('貼り付けました');
}
export function duplicateSelection() {
  const sel = getSelection();
  if (!sel || sel.allTelops) { toast('複製するクリップを選択してください', 'err'); return; }
  const f = findClip(sel.clipId);
  if (!f) return;
  if (placeClone(f.clip, f.track.id, f.track.kind, clipEnd(f.clip))) toast('複製しました');
}

// 範囲 [a,b] を全トラックから削除し、後続を左へ詰める（リップル削除）
import { getRange, clearRange } from './state.js';
function makeSub(c, t0, t1, newStart) {
  const ns = newStart != null ? newStart : t0;
  const dur = Math.max(0, t1 - t0);
  if (c.kind === 'text') return Object.assign({}, c, { id: uid('text'), start: ns, end: ns + dur });
  const srcIn = c.in + (t0 - c.start);
  return Object.assign({}, c, { id: uid('clip'), in: srcIn, out: srcIn + dur, start: ns, transform: c.transform ? Object.assign({}, c.transform) : undefined });
}
export function deleteSelectedRange() {
  const r = getRange();
  if (!r || (r.end - r.start) < 0.02) { toast('範囲を選択してください（範囲ツールでドラッグ）', 'err'); return; }
  const a = r.start, b = r.end, len = b - a;
  mutate((p) => {
    for (const track of p.tracks) {
      const out = [];
      for (const c of track.clips) {
        const cs = c.start, ce = clipEnd(c);
        if (ce <= a + 1e-6) { out.push(c); continue; }              // 範囲より前
        if (cs >= b - 1e-6) { c.start -= len; out.push(c); continue; } // 範囲より後 → 左へ詰める
        if (cs >= a - 1e-6 && ce <= b + 1e-6) continue;             // 範囲内 → 削除
        const spansBoth = cs < a - 1e-6 && ce > b + 1e-6;
        if (spansBoth) { out.push(makeSub(c, cs, a)); out.push(makeSub(c, b, ce, a)); }
        else if (cs < a) { out.push(makeSub(c, cs, a)); }           // 左片だけ残す
        else { out.push(makeSub(c, b, ce, a)); }                    // 右片 → a へ詰める
      }
      out.sort((x, y) => x.start - y.start);
      track.clips = out;
    }
  });
  clearRange();
  setSelection(null);
  toast(`範囲 ${(len).toFixed(1)}秒 を削除しました`);
}
