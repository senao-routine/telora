// カット支援：無音カット・フィラーワードカット。
// 共通コア＝「クリップの素材区間 [in,out] から remove 範囲を取り除き、残す区間（kept）に分割」。
import { getProject, mutate, findClip, clipSpeed, clipEnd, MIN_CLIP } from './state.js';
import { uid } from './util.js';
import { toast } from './ui.js';

// ---- 純粋関数（テスト可能）----

// remove 範囲（素材時刻）を [inS,outS] から差し引いた「残す区間」を返す。
// ranges: [{start,end}]（素材時刻）。minKeep 秒未満の細切れは捨てる。返り値: [{in,out}]
export function keptSegmentsByRemoving(inS, outS, ranges, minKeep = 0.12) {
  const rs = (ranges || [])
    .map((r) => ({ start: Math.max(inS, Math.min(outS, r.start)), end: Math.max(inS, Math.min(outS, r.end)) }))
    .filter((r) => r.end - r.start > 1e-3)
    .sort((a, b) => a.start - b.start);
  // 重なり統合
  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1e-3) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }
  const kept = [];
  let cur = inS;
  for (const r of merged) {
    if (r.start > cur + 1e-3) kept.push({ in: cur, out: r.start });
    cur = Math.max(cur, r.end);
  }
  if (outS > cur + 1e-3) kept.push({ in: cur, out: outS });
  return kept.filter((k) => k.out - k.in >= minKeep);
}

// 日本語＋英語のよくあるフィラー（言いよどみ）語。
export const FILLER_WORDS = [
  'えー', 'えーと', 'えっと', 'えと', 'あの', 'あのー', 'あのう', 'その', 'そのー',
  'まあ', 'まぁ', 'なんか', 'ええと', 'うーん', 'んー', 'ええ', 'はい', 'うん',
  'um', 'uh', 'erm', 'ah', 'er', 'hmm', 'like', 'you know',
];
function normalize(s) { return (s || '').toLowerCase().replace(/[、。,.\s!?！？「」]/g, '').trim(); }
// 単語がフィラーかどうか
export function isFiller(word) {
  const w = normalize(word);
  if (!w) return false;
  return FILLER_WORDS.some((f) => normalize(f) === w);
}

// ---- クリップ書き換え ----

// kept 区間でクリップを置き換える。元クリップ start から詰めて並べ、無音/フィラー分だけ尺が縮む。
// 後続クリップは動かさない（局所的でシンプル）。返り値: 新しく作られたクリップ数。
function rebuildClip(track, clip, kept) {
  const idx = track.clips.indexOf(clip);
  if (idx < 0) return 0;
  const sp = clipSpeed(clip);
  const newClips = [];
  let tl = clip.start;
  for (const k of kept) {
    const dur = (k.out - k.in) / sp;            // タイムライン尺（速度考慮）
    const c = Object.assign({}, clip, {
      id: uid(clip.kind === 'text' ? 'text' : 'clip'),
      in: k.in, out: k.out, start: tl,
      transform: clip.transform ? JSON.parse(JSON.stringify(clip.transform)) : undefined,
    });
    if (clip.kind === 'text') c.end = tl + dur;
    newClips.push(c);
    tl += dur;
  }
  track.clips.splice(idx, 1, ...newClips);
  track.clips.sort((a, b) => a.start - b.start);
  return newClips.length;
}

function selClipMedia(clipId) {
  const f = findClip(clipId);
  if (!f) return null;
  const m = getProject().media.find((x) => x.id === f.clip.mediaId);
  return { track: f.track, clip: f.clip, media: m };
}

// ---- 無音カット ----
export async function silenceCut(clipId, { noiseDb = -30, minDur = 0.35, pad = 0.06 } = {}) {
  const ctx = selClipMedia(clipId);
  if (!ctx || !ctx.media) { toast('カットする動画/音声クリップを選択してください', 'err'); return; }
  const { track, clip, media } = ctx;
  if (clip.kind !== 'video' && clip.kind !== 'audio') { toast('無音カットは動画/音声クリップで使えます', 'err'); return; }
  if (media.hasAudio === false) { toast('この素材には音声がありません', 'err'); return; }

  toast('無音を解析しています…');
  let res;
  try { res = await window.api.detectSilence({ path: media.path, noiseDb, minDur, inSec: clip.in, outSec: clip.out }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res || !res.ok) { toast('無音解析に失敗しました', 'err'); return; }

  // 端を少し残す（pad）ことで切りすぎを防ぐ
  const ranges = (res.silences || []).map((s) => ({ start: s.start + pad, end: s.end - pad })).filter((s) => s.end - s.start > 0.05);
  if (!ranges.length) { toast('カットできる無音区間は見つかりませんでした'); return; }

  const kept = keptSegmentsByRemoving(clip.in, clip.out, ranges, Math.max(MIN_CLIP, 0.12));
  if (!kept.length) { toast('発話区間が検出できませんでした'); return; }

  const before = clipEnd(clip);
  let made = 0;
  mutate(() => { made = rebuildClip(track, clip, kept); });
  const after = made ? null : 0;
  const removed = ranges.reduce((s, r) => s + (r.end - r.start), 0);
  toast(`無音 ${removed.toFixed(1)}秒 を ${ranges.length}か所カットしました（${made}クリップに分割）`, 'ok');
  return { made, removed, before, after };
}

// クリップの音声を単語タイムスタンプ付きで文字起こし → フィラー語を検出してカット。
// 戻り値: {ok, made, count} または {ok:false, needSetup, error}
export async function fillerCut(clipId, onStatus) {
  const ctx = selClipMedia(clipId);
  if (!ctx || !ctx.media) { toast('カットする動画/音声クリップを選択してください', 'err'); return { ok: false }; }
  const { clip, media } = ctx;
  if (clip.kind !== 'video' && clip.kind !== 'audio') { toast('フィラーカットは動画/音声クリップで使えます', 'err'); return { ok: false }; }
  if (media.hasAudio === false) { toast('この素材には音声がありません', 'err'); return { ok: false }; }

  if (onStatus) onStatus('音声を抽出しています…');
  // クリップ区間だけを wav 化（words は区間先頭=0 基準で返るので clip.in を足して素材時刻へ）
  let ext;
  try { ext = await window.api.extractAudio({ segments: [{ path: media.path, in: clip.in, out: clip.out, start: 0, volume: 1 }], duration: Math.max(0, clip.out - clip.in) }); }
  catch (e) { ext = { ok: false, error: String(e) }; }
  if (!ext || !ext.ok) { toast('音声の抽出に失敗しました', 'err'); return { ok: false, error: ext && ext.error }; }

  if (onStatus) onStatus('フィラー語を解析しています…');
  let res;
  try { res = await window.api.transcribeWords({ mediaPath: ext.path, language: 'ja' }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res || !res.ok) return { ok: false, needSetup: res && res.needSetup, error: res && res.error };

  const words = (res.words || []).map((w) => ({ word: w.word, start: w.start + clip.in, end: w.end + clip.in }));
  const r = fillerCutWithWords(clipId, words);
  return { ok: true, made: r ? r.made : 0, count: r ? r.count : 0 };
}

// ---- フィラーワードカット（コア）----
// words: [{word,start,end}]（素材時刻）。エンジンから取得できた単語列を渡す。
export function fillerCutWithWords(clipId, words) {
  const ctx = selClipMedia(clipId);
  if (!ctx) { toast('クリップを選択してください', 'err'); return; }
  const { track, clip } = ctx;
  const ranges = (words || []).filter((w) => isFiller(w.word)).map((w) => ({ start: w.start, end: w.end }));
  if (!ranges.length) { toast('フィラー語は見つかりませんでした'); return { made: 0, count: 0 }; }
  const kept = keptSegmentsByRemoving(clip.in, clip.out, ranges, Math.max(MIN_CLIP, 0.05));
  let made = 0;
  mutate(() => { made = rebuildClip(track, clip, kept); });
  toast(`フィラー語 ${ranges.length}個 をカットしました`, 'ok');
  return { made, count: ranges.length };
}
