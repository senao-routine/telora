// プロジェクトの保存・読み込み（.tceproj = JSON）。v1 → v2 移行に対応。
import { getProject, getUI, setProject, clearDirty, defaultTextClip, emit, freshTracks } from './state.js';
import { basename, uid } from './util.js';
import { toast } from './ui.js';
import { ensureThumbnails, renderMediaBin } from './media.js';

export async function saveProject({ forceDialog = false } = {}) {
  const ui = getUI();
  const project = getProject();
  let filePath = ui.projectPath;
  if (!filePath || forceDialog) {
    const name = (project.name && project.name !== '無題のプロジェクト' ? project.name : 'project') + '.tceproj';
    const dlg = await window.api.saveProjectDialog(name);
    if (dlg.canceled || !dlg.filePath) return false;
    filePath = dlg.filePath;
    project.name = basename(filePath).replace(/\.(tceproj|json)$/i, '');
  }
  const res = await window.api.writeFile(filePath, JSON.stringify(project, null, 2));
  if (!res.ok) { toast('保存に失敗しました: ' + res.error, 'err'); return false; }
  ui.projectPath = filePath; clearDirty(); updateTitle();
  toast('プロジェクトを保存しました', 'ok');
  return true;
}

export async function openProject() {
  const dlg = await window.api.openProjectDialog();
  if (dlg.canceled || !dlg.filePath) return;
  const res = await window.api.readFile(dlg.filePath);
  if (!res.ok) { toast('読み込みに失敗しました: ' + res.error, 'err'); return; }
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { toast('プロジェクトファイルが壊れています', 'err'); return; }

  setProject(normalizeProject(parsed));
  getUI().projectPath = dlg.filePath; getUI().playhead = 0; clearDirty();
  emit('playhead'); emit('settings'); updateTitle();
  renderMediaBin(); ensureThumbnails();
  toast('プロジェクトを読み込みました', 'ok');
}

function normalizeProject(p) {
  const settings = Object.assign({ width: 1280, height: 720, fps: 30 }, p.settings || {});
  const media = (Array.isArray(p.media) ? p.media : []).map((m) => Object.assign({ type: 'video', duration: 0, width: 1280, height: 720, fps: 30, hasAudio: true }, m));

  let tracks;
  if (Array.isArray(p.tracks)) {
    // v2
    tracks = p.tracks.map((t) => ({
      id: t.id || uid('trk'),
      kind: t.kind || 'video',
      name: t.name || (t.kind === 'text' ? 'テロップ' : 'トラック'),
      base: !!t.base,
      clips: (t.clips || []).map((c) => normalizeClip(c, t.kind)),
    }));
  } else {
    // v1 → v2 移行
    tracks = freshTracks();
    const textTrack = tracks.find((t) => t.kind === 'text');
    const mainTrack = tracks.find((t) => t.base);
    let cursor = 0;
    for (const c of (p.clips || [])) {
      const dur = Math.max(0, (c.out || 0) - (c.in || 0));
      mainTrack.clips.push({ id: c.id || uid('clip'), kind: 'video', mediaId: c.mediaId, in: c.in || 0, out: c.out || 0, start: cursor, transform: { x: 0.5, y: 0.5, scale: 1 } });
      cursor += dur;
    }
    for (const tp of (p.telops || [])) {
      textTrack.clips.push(Object.assign(defaultTextClip(tp.start || 0), tp, { kind: 'text', id: tp.id || uid('text') }));
    }
  }
  return { version: 2, name: p.name || '無題のプロジェクト', settings, media, tracks };
}

function normalizeClip(c, trackKind) {
  if (c.kind === 'text' || trackKind === 'text') {
    return Object.assign(defaultTextClip(c.start || 0), c, { kind: 'text' });
  }
  if (c.kind === 'audio' || trackKind === 'audio') {
    return Object.assign({ in: 0, out: 0, start: 0, volume: 1 }, c, { kind: 'audio' });
  }
  return Object.assign(
    { in: 0, out: 0, start: 0, transform: { x: 0.5, y: 0.5, scale: 1 } },
    c,
    { kind: c.kind === 'image' ? 'image' : 'video' },
  );
}

export function updateTitle() {
  const ui = getUI(); const project = getProject();
  const nameEl = document.getElementById('projName');
  if (nameEl) nameEl.textContent = project.name + (ui.dirty ? ' ●' : '');
  document.title = `${project.name}${ui.dirty ? ' *' : ''} — Telora`;
}
