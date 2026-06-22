// XML（FCP7 / Premiere 互換の xmeml）取り込み → メイントラックのクリップ化
import { getProject, mutate, baseTrack, findClip, setSelection } from './state.js';
import { importMedia } from './media.js';
import { uid } from './util.js';
import { toast } from './ui.js';

function decodePathUrl(u) {
  if (!u) return null;
  let s = u.trim().replace(/^file:\/\/(localhost)?/, '');
  try { s = decodeURIComponent(s); } catch (_) { /* noop */ }
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1); // Windows: /C:/... → C:/...
  return s;
}

export function parseFcpXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return { fps: 30, items: [] };

  let fps = 30;
  const tb = doc.querySelector('sequence rate timebase') || doc.querySelector('rate timebase');
  if (tb) fps = parseFloat(tb.textContent) || 30;

  // file id → pathurl
  const fileMap = new Map();
  doc.querySelectorAll('file').forEach((f) => {
    const id = f.getAttribute('id');
    const pu = f.querySelector('pathurl');
    if (id && pu) fileMap.set(id, decodePathUrl(pu.textContent));
  });

  const num = (cl, sel) => {
    const e = cl.querySelector(':scope > ' + sel);
    if (!e) return null;
    const v = parseFloat(e.textContent);
    return isNaN(v) ? null : v;
  };

  const items = [];
  doc.querySelectorAll('clipitem').forEach((cl) => {
    if (cl.closest('audio')) return; // 映像クリップのみ
    const file = cl.querySelector('file');
    let path = null, name = null;
    if (file) {
      const pu = file.querySelector('pathurl');
      if (pu) path = decodePathUrl(pu.textContent);
      else { const id = file.getAttribute('id'); if (id && fileMap.has(id)) path = fileMap.get(id); }
      const nm = file.querySelector('name'); if (nm) name = nm.textContent;
    }
    if (!path) return;
    const inF = num(cl, 'in'), outF = num(cl, 'out'), startF = num(cl, 'start'), endF = num(cl, 'end');
    const inSec = inF != null && inF >= 0 ? inF / fps : 0;
    let durSec = null;
    if (startF != null && endF != null && endF > startF) durSec = (endF - startF) / fps;
    else if (outF != null && outF >= 0) durSec = (outF - (inF >= 0 ? inF : 0)) / fps;
    const startSec = startF != null && startF >= 0 ? startF / fps : null;
    items.push({ path, name, inSec, durSec, startSec });
  });
  return { fps, items };
}

export async function importXmlFromFile() {
  const dlg = await window.api.openFileDialog({ title: '編集データ (XML) を開く', filters: [{ name: 'XML (FCP7/Premiere)', extensions: ['xml', 'fcpxml', 'xmeml'] }] });
  if (dlg.canceled || !dlg.filePath) return;
  const res = await window.api.readFile(dlg.filePath);
  if (!res.ok) { toast('読み込みに失敗しました: ' + res.error, 'err'); return; }
  await importXmlText(res.content);
}

export async function importXmlText(xml) {
  const parsed = parseFcpXml(xml);
  if (!parsed.items.length) { toast('XML から素材が見つかりませんでした', 'err'); return; }

  const paths = [...new Set(parsed.items.map((i) => i.path).filter(Boolean))];
  await importMedia(paths, { addToTimeline: false });

  const project = getProject();
  let count = 0, lastId = null;
  mutate(() => {
    const base = baseTrack();
    if (!base) return;
    let cursor = base.clips.reduce((m, c) => Math.max(m, c.start + Math.max(0, c.out - c.in)), 0);
    const items = [...parsed.items].sort((a, b) => (a.startSec ?? 1e9) - (b.startSec ?? 1e9));
    for (const it of items) {
      const media = project.media.find((m) => m.path === it.path);
      if (!media) continue;
      const inSec = Math.max(0, it.inSec || 0);
      let dur = it.durSec;
      if (dur == null || dur <= 0) dur = (media.duration ? media.duration - inSec : 5) || 5;
      let outSec = inSec + dur;
      if (media.type === 'video' && media.duration) outSec = Math.min(outSec, media.duration);
      const start = it.startSec != null && it.startSec >= 0 ? it.startSec : cursor;
      const clip = {
        id: uid('clip'),
        kind: media.type === 'image' ? 'image' : 'video',
        mediaId: media.id, in: inSec, out: outSec, start,
        transform: { x: 0.5, y: 0.5, scale: 1 },
      };
      base.clips.push(clip);
      cursor = start + (outSec - inSec);
      lastId = clip.id; count++;
    }
    base.clips.sort((a, b) => a.start - b.start);
  });

  if (lastId) { const f = findClip(lastId); if (f) setSelection({ trackId: f.track.id, clipId: lastId }); }
  if (count > 0) toast(`${count} 件のクリップを XML から取り込みました`, 'ok');
  else toast('取り込めるクリップがありませんでした（素材ファイルが見つからない可能性）', 'err');
}
