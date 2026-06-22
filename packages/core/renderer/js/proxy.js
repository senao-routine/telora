// プロキシ（低解像度の代理ファイル）でプレビューを高速化する。書き出しは常にオリジナルを使う。
import { getProject, emit } from './state.js';
import { toast } from './ui.js';

let enabled = (typeof localStorage !== 'undefined' && localStorage.getItem('telora.proxy') === '1');

export function proxyEnabled() { return enabled; }
// プレビューで使うパス（プロキシ有効かつ生成済みならプロキシ、なければオリジナル）
export function previewPath(media) {
  if (enabled && media && media.proxyPath) return media.proxyPath;
  return media ? media.path : '';
}

export async function generateProxies() {
  let n = 0;
  for (const m of getProject().media) {
    if (m.type !== 'video' || m.proxyPath) continue;
    try { const r = await window.api.makeProxy(m.path); if (r && r.ok) { m.proxyPath = r.proxyPath; n++; } } catch (_) { /* noop */ }
  }
  return n;
}

export async function toggleProxy() {
  enabled = !enabled;
  try { localStorage.setItem('telora.proxy', enabled ? '1' : '0'); } catch (_) {}
  if (enabled) {
    toast('プロキシを生成しています…（初回は時間がかかります）');
    await generateProxies();
    toast('プロキシ再生に切り替えました', 'ok');
  } else {
    toast('オリジナル再生に戻しました');
  }
  emit('proxy'); emit('project');
  return enabled;
}
