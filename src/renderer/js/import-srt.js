// SRT / WebVTT 字幕の取り込み → テロップ（テキスト）クリップ化
import { mutate, defaultTextClip, setSelection, getTextClips } from './state.js';
import { uid } from './util.js';
import { toast } from './ui.js';

// 秒 → "HH:MM:SS,mmm"
function fmtSrtTime(t) {
  t = Math.max(0, t);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

// テロップ配列 → SRT 文字列（純粋関数・テスト用にエクスポート）
export function buildSrt(clips) {
  const sorted = clips.slice().sort((a, b) => a.start - b.start);
  return sorted.map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${(c.text || '').trim()}`).join('\n\n') + '\n';
}

// テロップを SRT 字幕として書き出す
export async function exportSrt() {
  const clips = getTextClips();
  if (!clips.length) { toast('書き出すテロップがありません', 'err'); return; }
  const srt = buildSrt(clips);
  const dlg = await window.api.saveFileDialog({ title: '字幕(SRT)を書き出す', defaultName: 'subtitle.srt', filters: [{ name: 'SRT 字幕', extensions: ['srt'] }] });
  if (dlg.canceled || !dlg.filePath) return;
  const res = await window.api.writeFile(dlg.filePath, srt);
  if (res.ok) toast(`${clips.length} 件の字幕を書き出しました`, 'ok');
  else toast('書き出しに失敗しました: ' + res.error, 'err');
}

// "HH:MM:SS,mmm" / "MM:SS.mmm" などを秒へ
function parseTimestamp(s) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s.trim());
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, '0'), 10);
  return h * 3600 + min * 60 + sec + ms / 1000;
}

export function parseSrt(text) {
  const out = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/^﻿/, '');
  const blocks = normalized.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx === -1) continue;
    const [a, b] = lines[arrowIdx].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b);
    if (start == null || end == null || end <= start) continue;
    const textLines = lines.slice(arrowIdx + 1);
    const content = textLines.join('\n')
      .replace(/<[^>]+>/g, '')        // タグ除去
      .replace(/\{[^}]+\}/g, '')      // ASS 風タグ除去
      .trim();
    if (!content) continue;
    out.push({ start, end, text: content });
  }
  return out;
}

export async function importSrtFromFile() {
  const dlg = await window.api.openFileDialog({ title: '字幕ファイル (SRT) を開く', filters: [{ name: '字幕', extensions: ['srt', 'vtt'] }] });
  if (dlg.canceled || !dlg.filePath) return;
  const res = await window.api.readFile(dlg.filePath);
  if (!res.ok) { toast('読み込みに失敗しました: ' + res.error, 'err'); return; }
  importSrtText(res.content);
}

export function importSrtText(text) {
  const cues = parseSrt(text);
  if (cues.length === 0) { toast('字幕が見つかりませんでした', 'err'); return; }

  // 字幕は専用の visual トラックを最上段に作ってまとめて配置する
  let lastId = null, trackId = null;
  mutate((p) => {
    const track = { id: uid('trk'), kind: 'visual', name: '字幕', clips: [] };
    p.tracks.unshift(track);
    for (const cue of cues) {
      const clip = defaultTextClip(cue.start);
      clip.start = cue.start;
      clip.end = cue.end;
      clip.text = cue.text;
      track.clips.push(clip);
      lastId = clip.id;
    }
    track.clips.sort((a, b) => a.start - b.start);
    trackId = track.id;
  });
  if (lastId) setSelection({ trackId, clipId: lastId });
  toast(`${cues.length} 件のテロップを取り込みました`, 'ok');
}
