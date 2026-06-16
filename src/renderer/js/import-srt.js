// SRT / WebVTT 字幕の取り込み → テロップ（テキスト）クリップ化
import { getTracks, mutate, defaultTextClip, findClip, setSelection } from './state.js';
import { toast } from './ui.js';

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
  const textTrack = getTracks().find((t) => t.kind === 'text');
  if (!textTrack) { toast('テロップトラックがありません', 'err'); return; }

  let lastId = null;
  mutate(() => {
    const tr = getTracks().find((t) => t.kind === 'text');
    for (const cue of cues) {
      const clip = defaultTextClip(cue.start);
      clip.start = cue.start;
      clip.end = cue.end;
      clip.text = cue.text;
      tr.clips.push(clip);
      lastId = clip.id;
    }
    tr.clips.sort((a, b) => a.start - b.start);
  });
  if (lastId) { const f = findClip(lastId); if (f) setSelection({ trackId: f.track.id, clipId: lastId }); }
  toast(`${cues.length} 件のテロップを取り込みました`, 'ok');
}
