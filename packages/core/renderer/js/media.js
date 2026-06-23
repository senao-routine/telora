// メディア（素材）管理：動画・画像の読み込み、メタ取得、サムネイル、メディアビン表示
import { el, basename, fileUrl, fmtTime, uid } from './util.js';
import {
  getProject, mutate, mediaById, setSelection, baseTrack, getTrack, getTracks,
  makeClipFromMedia, mainTrackEnd, clipEnd, clipDur, getPlayhead,
} from './state.js';
import { toast } from './ui.js';
import { ensureWaveform } from './waveform.js';

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'mpg', 'mpeg', 'ts'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'aif', 'aiff'];

export function mediaKind(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return null;
}
export function isSupportedMedia(path) { return mediaKind(path) !== null; }

const thumbs = new Map(); // mediaId -> dataURL
export function getThumb(mediaId) { return thumbs.get(mediaId) || null; }

// ---- サムネイル生成 ----
let thumbQueue = Promise.resolve();
function generateVideoThumb(path) {
  const task = () => new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto';
    let done = false;
    const finish = (val) => { if (done) return; done = true; cleanup(); resolve(val); };
    const onLoaded = () => {
      const d = v.duration && isFinite(v.duration) ? v.duration : 2;
      try { v.currentTime = Math.min(1.0, d * 0.1); } catch (_) { finish(null); }
    };
    const onSeeked = () => {
      try {
        const vw = v.videoWidth || 160, vh = v.videoHeight || 90;
        const w = 160, h = Math.max(40, Math.round(160 * (vh / vw)));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        finish(c.toDataURL('image/jpeg', 0.72));
      } catch (_) { finish(null); }
    };
    const onErr = () => finish(null);
    function cleanup() {
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('error', onErr);
      v.removeAttribute('src'); v.load();
    }
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('error', onErr);
    v.src = fileUrl(path);
    setTimeout(() => finish(null), 8000);
  });
  thumbQueue = thumbQueue.then(task, task);
  return thumbQueue;
}

function generateImageThumb(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = 160, h = Math.max(40, Math.round(160 * (img.naturalHeight / img.naturalWidth)));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.78));
      } catch (_) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = fileUrl(path);
  });
}

// 画像の寸法取得
function imageMeta(path) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 1280, height: 720 });
    img.src = fileUrl(path);
  });
}

// HTML5 audio からの長さ取得（ffprobe フォールバック）
function probeViaAudio(path) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    a.addEventListener('loadedmetadata', () => finish({ duration: a.duration || 0 }));
    a.addEventListener('error', () => finish({}));
    setTimeout(() => finish({}), 6000);
    a.src = fileUrl(path);
  });
}

// HTML5 video からのメタ取得（ffprobe フォールバック）
function probeViaVideo(path) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    v.addEventListener('loadedmetadata', () => finish({ duration: v.duration || 0, width: v.videoWidth || 1280, height: v.videoHeight || 720 }));
    v.addEventListener('error', () => finish({}));
    setTimeout(() => finish({}), 6000);
    v.src = fileUrl(path);
  });
}

// ---- 読み込み ----
export async function importMedia(paths, { addToTimeline = true } = {}) {
  if (!paths || paths.length === 0) return;
  const project = getProject();
  const added = [];
  let skipped = 0;

  for (const p of paths) {
    const kind = mediaKind(p);
    if (!kind) { skipped++; continue; }

    const existing = project.media.find((m) => m.path === p);
    if (existing) {
      if (addToTimeline) addClipFromMedia(existing.id, { silent: true });
      continue;
    }

    let media;
    if (kind === 'image') {
      const meta = await imageMeta(p);
      media = { id: uid('media'), name: basename(p), path: p, type: 'image', duration: 0, width: meta.width, height: meta.height, fps: 0, hasAudio: false };
      generateImageThumb(p).then((url) => { if (url) { thumbs.set(media.id, url); renderMediaBin(); } });
    } else if (kind === 'audio') {
      let meta = { ok: false };
      try { meta = await window.api.probe(p); } catch (_) { meta = { ok: false }; }
      let duration = meta.ok ? meta.duration : 0;
      if (!duration) { const fb = await probeViaAudio(p); duration = fb.duration || 0; }
      media = { id: uid('media'), name: basename(p), path: p, type: 'audio', duration: duration || 0, width: 0, height: 0, fps: 0, hasAudio: true };
    } else {
      let meta = { ok: false };
      try { meta = await window.api.probe(p); } catch (_) { meta = { ok: false }; }
      if (!meta.ok || !meta.duration) {
        const fb = await probeViaVideo(p);
        meta = Object.assign({ ok: true, hasAudio: true, fps: 30 }, fb, meta.ok ? meta : {});
      }
      media = { id: uid('media'), name: basename(p), path: p, type: 'video', duration: meta.duration || 0, width: meta.width || 1280, height: meta.height || 720, fps: meta.fps || 30, hasAudio: meta.hasAudio !== false };
      generateVideoThumb(p).then((url) => { if (url) { thumbs.set(media.id, url); renderMediaBin(); } });
    }

    project.media.push(media);
    if (media.type === 'audio') ensureWaveform(media); // 波形は音声クリップのみ（動画は全読み込みで重く危険なため除外）
    added.push(media);
    if (addToTimeline) addClipFromMedia(media.id, { silent: true });
  }

  renderMediaBin();
  if (added.length) toast(`${added.length} 件の素材を読み込みました`, 'ok');
  if (skipped) toast(`${skipped} 件は対応していない形式のためスキップしました`, 'err');
  return added;
}

// [start, start+dur) がトラック上で空いているか
function slotFree(track, start, dur, ignoreId) {
  const e = start + dur;
  for (const c of track.clips) {
    if (c.id === ignoreId) continue;
    if (start < clipEnd(c) - 1e-6 && e > c.start + 1e-6) return false;
  }
  return true;
}

// メディアをクリップとしてトラックへ追加。
// drop（trackId＋start 指定）で対象が埋まっていれば上位 visual トラックへ自動レイヤー化。
export function addClipFromMedia(mediaId, { silent = false, trackId = null, start = null } = {}) {
  const m = mediaById(mediaId);
  if (!m) return;
  const isAudio = m.type === 'audio';
  let newClipId = null, finalTrackId = null;

  mutate((p) => {
    const tracks = () => p.tracks;
    const clip = makeClipFromMedia(m, 0);
    const dur = clipDur(clip);

    if (isAudio) {
      let track = trackId ? tracks().find((t) => t.id === trackId && t.kind === 'audio') : null;
      if (!track) track = tracks().find((t) => t.kind === 'audio');
      if (!track) { track = { id: uid('trk'), kind: 'audio', name: 'A' + (tracks().filter((t) => t.kind === 'audio').length + 1), clips: [] }; p.tracks.push(track); }
      const desired = start != null ? Math.max(0, start) : getPlayhead();
      clip.start = slotFree(track, desired, dur) ? desired : findFreeSlot(track, desired, dur, null);
      track.clips.push(clip); track.clips.sort((a, b) => a.start - b.start);
      newClipId = clip.id; finalTrackId = track.id;
      return;
    }

    // 視覚素材（動画・画像）
    const visuals = () => p.tracks.filter((t) => t.kind === 'visual');
    if (start == null) {
      // ビンからの追加：ベース（最下段）visual トラックへ順次追加
      let track = visuals()[visuals().length - 1];
      if (!track) { track = { id: uid('trk'), kind: 'visual', name: 'V1', clips: [], base: true }; p.tracks.unshift(track); }
      clip.start = mainTrackEnd();
      clip.start = findFreeSlot(track, clip.start, dur, null);
      track.clips.push(clip); track.clips.sort((a, b) => a.start - b.start);
      if (clip.kind === 'video' && m.hasAudio !== false) attachLinkedAudio(p, clip, m);
      newClipId = clip.id; finalTrackId = track.id;
      return;
    }
    // ドロップ：指定 start に置く。対象トラックが埋まっていれば上位の空きトラック→無ければ新規上位トラック
    const s = Math.max(0, start);
    const list = visuals();
    let target = trackId ? p.tracks.find((t) => t.id === trackId && t.kind === 'visual') : null;
    let track = null;
    if (target && slotFree(target, s, dur)) track = target;
    if (!track) {
      // 対象トラックより上（index 小）で空きを探す
      const startIdx = target ? p.tracks.indexOf(target) : p.tracks.length;
      for (let i = startIdx - 1; i >= 0; i--) { const t = p.tracks[i]; if (t.kind === 'visual' && slotFree(t, s, dur)) { track = t; break; } }
    }
    if (!track) {
      // 新規 visual トラックを最上段に自動追加
      track = { id: uid('trk'), kind: 'visual', name: 'V' + (list.length + 1), clips: [] };
      p.tracks.unshift(track);
    }
    clip.start = s;
    track.clips.push(clip); track.clips.sort((a, b) => a.start - b.start);
    if (clip.kind === 'video' && m.hasAudio !== false) attachLinkedAudio(p, clip, m);
    newClipId = clip.id; finalTrackId = track.id;
  });

  if (finalTrackId && newClipId) setSelection({ trackId: finalTrackId, clipId: newClipId });
  if (!silent) toast(`「${m.name}」を追加しました`);
}

// 動画クリップの音声を、波形付きの音声クリップとして音声トラックへ自動追加し、
// 動画側の音声は分離（detachedAudio）して二重再生を防ぐ。映像と音声は linkedAudioId/linkedVideoId で対応づけ。
function attachLinkedAudio(p, videoClip, m) {
  const dur = clipDur(videoClip);
  if (dur <= 0) return;
  const aud = {
    id: uid('clip'), kind: 'audio', mediaId: m.id,
    in: videoClip.in, out: videoClip.out, start: videoClip.start,
    volume: 1, linkedVideoId: videoClip.id,
  };
  const audios = p.tracks.filter((t) => t.kind === 'audio');
  let at = audios.find((t) => slotFree(t, aud.start, dur));
  if (!at) { at = { id: uid('trk'), kind: 'audio', name: 'A' + (audios.length + 1), clips: [] }; p.tracks.push(at); }
  at.clips.push(aud); at.clips.sort((a, b) => a.start - b.start);
  videoClip.detachedAudio = true;
  videoClip.linkedAudioId = aud.id;
  ensureWaveform(m); // 波形を用意
}

// トラック上で start から dur ぶん、既存クリップと重ならない開始位置を探す
export function findFreeSlot(track, start, dur, ignoreId) {
  let s = Math.max(0, start);
  const others = track.clips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const c of others) {
      const cs = c.start, ce = clipEnd(c);
      if (s < ce && (s + dur) > cs) { s = ce; changed = true; }
    }
  }
  return s;
}

// ---- メディアビン描画 ----
export function renderMediaBin() {
  const list = document.getElementById('mediaList');
  if (!list) return;
  const project = getProject();
  list.innerHTML = '';

  const countEl = document.getElementById('mediaCount');
  if (countEl) { countEl.textContent = String(project.media.length); countEl.hidden = project.media.length === 0; }

  if (project.media.length === 0) {
    const ill = el('img', { class: 'empty-illust', src: 'assets/empty-media.svg', alt: '' });
    list.appendChild(el('div', { class: 'empty-hint', id: 'libEmpty' }, [
      ill,
      el('p', { text: 'まだ素材がありません' }),
      el('button', { class: 'btn btn-primary', onClick: pickAndImport }, ['＋ 素材を読み込む']),
      el('p', { class: 'dim', text: '動画・画像・音声をここにドラッグ＆ドロップ' }),
    ]));
    return;
  }

  for (const m of project.media) {
    const thumb = thumbs.get(m.id);
    const badge = m.type === 'image' ? '画像' : m.type === 'audio' ? '音声' : '動画';
    const sub = m.type === 'image' ? `${m.width}×${m.height}`
      : m.type === 'audio' ? fmtTime(m.duration)
        : `${fmtTime(m.duration)} ・ ${m.width}×${m.height}`;
    const item = el('div', { class: 'media-item', title: m.path, draggable: 'true' }, [
      el('div', { class: 'media-thumb' + (m.type === 'image' ? ' is-image' : '') + (m.type === 'audio' ? ' is-audio' : ''), style: thumb ? `background-image:url(${thumb})` : '' }, [
        m.type === 'audio' ? el('span', { class: 'audio-ico', text: '🎵' }) : null,
        el('span', { class: 'media-badge ' + m.type, text: badge }),
      ]),
      el('div', { class: 'media-meta' }, [
        el('div', { class: 'media-name', text: m.name }),
        el('div', { class: 'media-dur', text: sub }),
      ]),
      el('button', { class: 'media-add', title: 'タイムラインに追加', onClick: (e) => { e.stopPropagation(); addClipFromMedia(m.id); } }, ['＋']),
    ]);
    item.addEventListener('dblclick', () => addClipFromMedia(m.id));
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/media-id', m.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    list.appendChild(item);
  }
}

// プロジェクト読込後などのサムネイル一括生成
export async function ensureThumbnails() {
  const project = getProject();
  for (const m of project.media) {
    if (thumbs.has(m.id)) continue;
    // eslint-disable-next-line no-await-in-loop
    const url = m.type === 'image' ? await generateImageThumb(m.path) : await generateVideoThumb(m.path);
    if (url) { thumbs.set(m.id, url); renderMediaBin(); }
  }
}

export async function pickAndImport() {
  const res = await window.api.openVideos();
  if (res.canceled) return;
  await importMedia(res.files);
}
