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
  addRecent(filePath, project.name);
  toast('プロジェクトを保存しました', 'ok');
  return true;
}

export async function openProject() {
  const dlg = await window.api.openProjectDialog();
  if (dlg.canceled || !dlg.filePath) return false;
  return openProjectPath(dlg.filePath);
}

// パス指定でプロジェクトを開く（ホームの最近一覧から直接開く用）
export async function openProjectPath(filePath) {
  const res = await window.api.readFile(filePath);
  if (!res.ok) { toast('読み込みに失敗しました: ' + res.error, 'err'); removeRecent(filePath); return false; }
  let parsed;
  try { parsed = JSON.parse(res.content); } catch (e) { toast('プロジェクトファイルが壊れています', 'err'); return false; }

  setProject(normalizeProject(parsed));
  getUI().projectPath = filePath; getUI().playhead = 0; clearDirty();
  emit('playhead'); emit('settings'); updateTitle();
  renderMediaBin(); ensureThumbnails();
  addRecent(filePath, getProject().name);
  toast('プロジェクトを読み込みました', 'ok');
  return true;
}

// ---- 最近のプロジェクト（localStorage 永続化）----
const RECENTS_KEY = 'telora.recents';
export function getRecents() {
  try { const a = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}
export function addRecent(filePath, name) {
  if (!filePath) return;
  let list = getRecents().filter((r) => r.path !== filePath);
  list.unshift({ path: filePath, name: name || basename(filePath).replace(/\.(tceproj|json)$/i, ''), ts: Date.now() });
  list = list.slice(0, 12);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list)); } catch (_) {}
}
export function removeRecent(filePath) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(getRecents().filter((r) => r.path !== filePath))); } catch (_) {}
}

function normalizeProject(p) {
  const settings = Object.assign({ width: 1280, height: 720, fps: 30 }, p.settings || {});
  const media = (Array.isArray(p.media) ? p.media : []).map((m) => Object.assign({ type: 'video', duration: 0, width: 1280, height: 720, fps: 30, hasAudio: true }, m));

  let tracks;
  if (Array.isArray(p.tracks)) {
    // 旧 kind（video/overlay/text）→ visual、audio→audio に統合
    tracks = p.tracks.map((t) => {
      const kind = t.kind === 'audio' ? 'audio' : 'visual';
      return {
        id: t.id || uid('trk'),
        kind,
        name: t.name || (kind === 'audio' ? 'A1' : 'V1'),
        clips: (t.clips || []).map((c) => normalizeClip(c, t.kind)),
      };
    });
    // 最下段の visual をベースに
    const vis = tracks.filter((t) => t.kind === 'visual');
    tracks.forEach((t) => { delete t.base; });
    if (vis.length) vis[vis.length - 1].base = true;
    if (!tracks.some((t) => t.kind === 'visual')) tracks.unshift({ id: uid('trk'), kind: 'visual', name: 'V1', clips: [], base: true });
    if (!tracks.some((t) => t.kind === 'audio')) tracks.push({ id: uid('trk'), kind: 'audio', name: 'A1', clips: [] });
  } else {
    // v1 → 新モデル移行
    tracks = freshTracks();
    const mainTrack = tracks.find((t) => t.base);
    let cursor = 0;
    for (const c of (p.clips || [])) {
      const dur = Math.max(0, (c.out || 0) - (c.in || 0));
      mainTrack.clips.push({ id: c.id || uid('clip'), kind: 'video', mediaId: c.mediaId, in: c.in || 0, out: c.out || 0, start: cursor, transform: { x: 0.5, y: 0.5, scale: 1 } });
      cursor += dur;
    }
    if ((p.telops || []).length) {
      const tt = { id: uid('trk'), kind: 'visual', name: 'V2', clips: [] };
      for (const tp of p.telops) tt.clips.push(Object.assign(defaultTextClip(tp.start || 0), tp, { kind: 'text', id: tp.id || uid('text') }));
      tracks.unshift(tt); // テロップは上位 visual トラックへ
    }
  }
  const markers = Array.isArray(p.markers) ? p.markers.filter((m) => m && isFinite(m.t)) : [];
  return { version: 2, name: p.name || '無題のプロジェクト', settings, media, tracks, markers };
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
