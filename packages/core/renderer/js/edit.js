// 編集操作：分割・削除・テロップ追加・再生位置での前後カット
import {
  getProject, mutate, getPlayhead, getSelection, setSelection, findClip,
  clipDur, clipEnd, baseClipAtTime, defaultTextClip, getTracks, totalDuration,
  slotFree, MIN_CLIP, getSelectedIds, getSelectedClips, setMultiSelection, clipSpeed,
} from './state.js';
import { uid } from './util.js';
import { findFreeSlot } from './media.js';
import { toast } from './ui.js';

const MIN = MIN_CLIP;

// 上書き（オーバーライト）編集：同一トラックで winnerIds のクリップが重なる区間の
// 他クリップを削る/分割して、重なりをなくす（移動・配置したクリップが勝つ）。track.clips を直接書き換える。
function subClipPart(c, s, e) {
  if (c.kind === 'text') return Object.assign({}, c, { id: uid('text'), start: s, end: e });
  const sp = clipSpeed(c);
  const inP = c.in + (s - c.start) * sp;
  return Object.assign({}, c, { id: uid('clip'), in: inP, out: inP + (e - s) * sp, start: s, transform: c.transform ? JSON.parse(JSON.stringify(c.transform)) : undefined });
}
export function resolveOverwrite(track, winnerIds) {
  const wins = track.clips.filter((c) => winnerIds.includes(c.id)).map((c) => [c.start, clipEnd(c)]);
  if (!wins.length) return false;
  let changed = false;
  const out = [];
  for (const c of track.clips) {
    if (winnerIds.includes(c.id)) { out.push(c); continue; }
    let segs = [[c.start, clipEnd(c)]];
    for (const [ws, we] of wins) {
      const next = [];
      for (const [s, e] of segs) {
        if (we <= s + 1e-4 || ws >= e - 1e-4) { next.push([s, e]); continue; } // 重ならない
        if (ws > s + 1e-4) next.push([s, ws]);   // 左片
        if (we < e - 1e-4) next.push([we, e]);    // 右片（覆われた中央は消える）
        changed = true;
      }
      segs = next;
    }
    if (segs.length === 1 && Math.abs(segs[0][0] - c.start) < 1e-4 && Math.abs(segs[0][1] - clipEnd(c)) < 1e-4) {
      out.push(c); // 変化なし
    } else {
      for (const [s, e] of segs) { if (e - s > 0.05) out.push(subClipPart(c, s, e)); else changed = true; }
    }
  }
  if (changed) { track.clips = out; track.clips.sort((a, b) => a.start - b.start); }
  return changed;
}

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
// リンク相手（映像↔音声）の幾何（in/out/start/speed）を c に合わせる（mutate 内から呼ぶ）。
// トリム・前後カット時に、もう片方も同じ素材区間/位置へ追従させる。
function mirrorLinkedGeometry(p, c) {
  const partnerId = c && (c.linkedAudioId || c.linkedVideoId);
  if (!partnerId) return;
  for (const tr of p.tracks) {
    const pc = tr.clips.find((x) => x.id === partnerId);
    if (!pc) continue;
    if (pc.kind === 'text') { const d = pc.end - pc.start; pc.start = Math.max(0, c.start); pc.end = pc.start + d; }
    else { pc.start = Math.max(0, c.start); if (c.kind !== 'text') { if (c.in != null) pc.in = c.in; if (c.out != null) pc.out = c.out; if (c.speed != null) pc.speed = c.speed; } }
    tr.clips.sort((a, b) => a.start - b.start);
    return;
  }
}

// 分割時、リンク相手も同じ位置で分割し、左右どうしを対応づけ直す（detachedAudio を維持＝二重音声を防ぐ）。
function splitLinkedPartner(p, c, second, t) {
  if (c.kind === 'text') return;
  const partnerId = c.linkedAudioId || c.linkedVideoId;
  if (!partnerId) return;
  let pTrack = null, pClip = null, pIdx = -1;
  for (const tr of p.tracks) { const i = tr.clips.findIndex((x) => x.id === partnerId); if (i >= 0) { pTrack = tr; pClip = tr.clips[i]; pIdx = i; break; } }
  if (!pClip || pClip.kind === 'text') return;
  const pLocal = t - pClip.start;
  if (pLocal <= MIN || pLocal >= clipDur(pClip) - MIN) return;
  const pSplit = pClip.in + pLocal * clipSpeed(pClip);
  const pSecond = { id: uid('clip'), kind: pClip.kind, mediaId: pClip.mediaId, in: pSplit, out: pClip.out, start: t, speed: pClip.speed, volume: pClip.volume, fadeIn: 0, fadeOut: pClip.fadeOut, transform: pClip.transform ? Object.assign({}, pClip.transform) : undefined };
  pClip.out = pSplit; pClip.fadeOut = 0;
  pTrack.clips.splice(pIdx + 1, 0, pSecond);
  if (c.kind === 'video') {
    c.detachedAudio = true; c.linkedAudioId = pClip.id; pClip.linkedVideoId = c.id;
    second.detachedAudio = true; second.linkedAudioId = pSecond.id; pSecond.linkedVideoId = second.id;
  } else {
    c.linkedVideoId = pClip.id; pClip.detachedAudio = true; pClip.linkedAudioId = c.id;
    second.linkedVideoId = pSecond.id; pSecond.detachedAudio = true; pSecond.linkedAudioId = second.id;
  }
  track_sort(pTrack);
}

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
      const srcSplit = c.in + local * clipSpeed(c); // 速度を考慮して素材分割点を算出
      second = { id: uid('clip'), kind: c.kind, mediaId: c.mediaId, in: srcSplit, out: c.out, start: t, speed: c.speed, volume: c.volume, fadeIn: 0, fadeOut: c.fadeOut, transform: c.transform ? Object.assign({}, c.transform) : undefined };
      c.out = srcSplit; c.fadeOut = 0;
    }
    tr.clips.splice(idx + 1, 0, second);
    newId = second.id;
    track_sort(tr);
    splitLinkedPartner(p, c, second, t); // リンク音声も同位置で分割し左右を対応づけ
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
  mutate((p) => {
    const c = findClip(clip.id).clip;
    if (c.kind === 'text') { c.start = t; }
    else { c.in = c.in + (t - c.start) * clipSpeed(c); c.start = t; }
    mirrorLinkedGeometry(p, c); // リンク相手も同じ区間/位置へ
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
  mutate((p) => {
    const c = findClip(clip.id).clip;
    if (c.kind === 'text') { c.end = t; }
    else { c.out = c.in + (t - c.start) * clipSpeed(c); }
    mirrorLinkedGeometry(p, c); // リンク相手も同じ区間/位置へ
  });
  toast('再生位置より後ろをカットしました');
}

// 選択削除（複数選択に対応）
export function deleteSelection() {
  const ids = getSelectedIds();
  if (!ids.length) { toast('削除する対象を選択してください', 'err'); return; }
  // リンクした映像/音声はセットで削除（detachedAudio の動画とその音声クリップ）
  const all = new Set(ids);
  for (const tr of getTracks()) {
    for (const c of tr.clips) {
      if (!all.has(c.id)) continue;
      if (c.linkedAudioId) all.add(c.linkedAudioId);
      if (c.linkedVideoId) all.add(c.linkedVideoId);
    }
  }
  const del = [...all];
  mutate((p) => {
    for (const tr of p.tracks) tr.clips = tr.clips.filter((c) => !del.includes(c.id));
  });
  setSelection(null);
  toast(del.length > 1 ? `${del.length}件を削除しました` : '削除しました');
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

// トランジション（クロスフェード）：選択クリップを直前の隣接クリップへ重ねて溶け込ませる。
// 映像はクリップを1つ上の visual トラックへ移し、duration ぶん前へずらして fadeIn（重なり区間で前のクリップにディゾルブ）。
export function applyCrossfade(duration = 0.6) {
  const sel = getSelection();
  if (!sel || !sel.clipId) { toast('クリップを選択してください', 'err'); return; }
  if (!findClip(sel.clipId)) return;
  let ok = false;
  mutate((p) => {
    const cur = findClip(sel.clipId); if (!cur) return;
    const tr = cur.track, c = cur.clip;
    // 直前の隣接クリップ（同トラックで c の開始以前に終わるもののうち最後）
    const prev = tr.clips.filter((x) => x.id !== c.id && clipEnd(x) <= c.start + 0.05).sort((a, b) => clipEnd(b) - clipEnd(a))[0];
    if (!prev) { return; }
    const d = Math.min(duration, clipDur(c) - 0.1, clipDur(prev) - 0.1);
    if (d <= 0.05) return;
    if (c.kind === 'audio') {
      c.start = Math.max(0, c.start - d); c.fadeIn = d; // 音声は重ねて fadeIn＝クロスフェード
    } else {
      // 1つ上の visual トラックへ移動（無ければ最上段に作成）し、d 秒前へ重ねて fadeIn
      const idx = p.tracks.indexOf(tr);
      let up = null;
      for (let i = idx - 1; i >= 0; i--) { if (p.tracks[i].kind === 'visual') { up = p.tracks[i]; break; } }
      if (!up || !slotFree(up, c.start - d, clipDur(c) + d, c.id)) {
        up = { id: uid('trk'), kind: 'visual', name: 'V' + (p.tracks.filter((t) => t.kind === 'visual').length + 1), clips: [] };
        p.tracks.unshift(up);
      }
      const ci = tr.clips.indexOf(c); if (ci >= 0) tr.clips.splice(ci, 1);
      c.start = Math.max(0, c.start - d); c.fadeIn = d;
      up.clips.push(c); up.clips.sort((a, b) => a.start - b.start);
      sel.trackId = up.id;
    }
    ok = true;
  });
  if (ok) { setSelection({ trackId: sel.trackId, clipId: sel.clipId }); toast('クロスフェードを適用しました'); }
  else toast('直前に隣接クリップがありません（クロスフェード不可）', 'err');
}

// ---- コピー / 貼り付け / 複製（複数選択対応）----
let clipboard = null; // { anchor, items:[{clip, trackId}] }
export function copySelection() {
  const items = getSelectedClips();
  if (!items.length) { toast('コピーするクリップを選択してください', 'err'); return; }
  const anchor = Math.min(...items.map((f) => f.clip.start));
  clipboard = { anchor, items: items.map((f) => ({ clip: JSON.parse(JSON.stringify(f.clip)), trackId: f.track.id })) };
  toast(items.length > 1 ? `${items.length}件をコピーしました` : 'コピーしました（Cmd/Ctrl+V で貼り付け）');
}
export function cutSelection() {
  if (!getSelectedIds().length) { toast('切り取るクリップを選択してください', 'err'); return; }
  copySelection();
  deleteSelection();
}
// 1クリップを配置：同位置が空けば元トラック、埋まっていれば1つ上(visual)/別(audio)、無ければ新規トラック
function placeBumped(p, c, srcTrackId, start, dur) {
  if (c.kind === 'audio') {
    const audios = p.tracks.filter((t) => t.kind === 'audio');
    const src = p.tracks.find((t) => t.id === srcTrackId && t.kind === 'audio');
    // 動画と同様：元トラックが埋まっていれば隣接する上の音声トラックへ繰り上げ、無ければ新階層を作る
    let track = (src && slotFree(src, start, dur)) ? src : null;
    if (!track) {
      const startIdx = src ? p.tracks.indexOf(src) : p.tracks.length;
      for (let i = startIdx - 1; i >= 0; i--) { const t = p.tracks[i]; if (t.kind === 'audio' && slotFree(t, start, dur)) { track = t; break; } }
    }
    if (!track) {
      track = { id: uid('trk'), kind: 'audio', name: 'A' + (audios.length + 1), clips: [] };
      const firstAudioIdx = p.tracks.findIndex((t) => t.kind === 'audio'); // 音声グループの先頭へ＝映像のすぐ下に新階層
      if (firstAudioIdx >= 0) p.tracks.splice(firstAudioIdx, 0, track); else p.tracks.push(track);
    }
    track.clips.push(c); track.clips.sort((a, b) => a.start - b.start);
    return track;
  }
  const src = p.tracks.find((t) => t.id === srcTrackId && t.kind === 'visual');
  let track = (src && slotFree(src, start, dur)) ? src : null;
  if (!track) {
    const startIdx = src ? p.tracks.indexOf(src) : p.tracks.length;
    for (let i = startIdx - 1; i >= 0; i--) { const t = p.tracks[i]; if (t.kind === 'visual' && slotFree(t, start, dur)) { track = t; break; } }
  }
  if (!track) { track = { id: uid('trk'), kind: 'visual', name: 'V' + (p.tracks.filter((t) => t.kind === 'visual').length + 1), clips: [] }; p.tracks.unshift(track); }
  track.clips.push(c); track.clips.sort((a, b) => a.start - b.start);
  return track;
}
function cloneClip(c0, start, dur) {
  const c = JSON.parse(JSON.stringify(c0));
  c.id = uid(c.kind === 'text' ? 'text' : 'clip');
  if (c.kind === 'text') { c.start = start; c.end = start + dur; } else c.start = start;
  return c;
}
// 貼り付け：再生位置を基準に相対オフセットを保って配置。重なる場合は上トラックへ繰り上げ。
export function pasteClipboard() {
  if (!clipboard || !clipboard.items.length) { toast('コピーされたクリップがありません', 'err'); return; }
  const ph = Math.max(0, getPlayhead());
  const newIds = [];
  mutate((p) => {
    for (const it of clipboard.items) {
      const c0 = it.clip;
      const dur = c0.kind === 'text' ? (c0.end - c0.start) : (c0.out - c0.in);
      const start = Math.max(0, ph + (c0.start - clipboard.anchor));
      const c = cloneClip(c0, start, dur);
      placeBumped(p, c, it.trackId, start, dur);
      newIds.push(c.id);
    }
  });
  if (newIds.length) setMultiSelection(newIds);
  toast(newIds.length > 1 ? `${newIds.length}件を貼り付けました` : '貼り付けました');
}
export function duplicateSelection() {
  const items = getSelectedClips();
  if (!items.length) { toast('複製するクリップを選択してください', 'err'); return; }
  const newIds = [];
  mutate((p) => {
    for (const f of items) {
      const c0 = f.clip;
      const dur = c0.kind === 'text' ? (c0.end - c0.start) : (c0.out - c0.in);
      const start = clipEnd(c0); // 直後へ
      const c = cloneClip(c0, start, dur);
      placeBumped(p, c, f.track.id, start, dur);
      newIds.push(c.id);
    }
  });
  if (newIds.length) setMultiSelection(newIds);
  toast(newIds.length > 1 ? `${newIds.length}件を複製しました` : '複製しました');
}

// 範囲 [a,b] を全トラックから削除し、後続を左へ詰める（リップル削除）
import { getRange, clearRange } from './state.js';
function makeSub(c, t0, t1, newStart) {
  const ns = newStart != null ? newStart : t0;
  const dur = Math.max(0, t1 - t0);
  if (c.kind === 'text') return Object.assign({}, c, { id: uid('text'), start: ns, end: ns + dur });
  const sp = clipSpeed(c);
  const srcIn = c.in + (t0 - c.start) * sp;
  return Object.assign({}, c, { id: uid('clip'), in: srcIn, out: srcIn + dur * sp, start: ns, transform: c.transform ? Object.assign({}, c.transform) : undefined });
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
