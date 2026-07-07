// スモークテスト: base（と ai）を TCE_SMOKE=1 で起動し、window.__errors が空であることを確認する。
// 使い方: node tests/run-smoke.js [--base-only]
'use strict';
const path = require('node:path');
const { launchElectron, findMarker, ROOT } = require('./lib/launch');

const SMOKE_PREFIX = '[smoke] window.__errors = ';

async function smokeApp(name, extraEnv, forbidMarkers = []) {
  const appDir = path.join(ROOT, 'apps', name);
  const res = await launchElectron({
    appDir,
    env: { TCE_SMOKE: '1', ...extraEnv },
    timeoutMs: 45000,
  });

  if (res.fatal) return { name, ok: false, why: 'fatal: ' + res.fatal };
  if (res.timedOut) return { name, ok: false, why: 'タイムアウト（[smoke] マーカー未出現＝白画面/ロード前クラッシュの疑い）' };

  const raw = findMarker(res.lines, SMOKE_PREFIX);
  if (raw == null) return { name, ok: false, why: '[smoke] マーカーが出力されなかった (exit=' + res.exitCode + ')' };

  let errors;
  try { errors = JSON.parse(raw); } catch (e) { return { name, ok: false, why: '__errors の JSON パース失敗: ' + raw }; }
  if (!Array.isArray(errors) || errors.length > 0) {
    return { name, ok: false, why: 'renderer エラー ' + JSON.stringify(errors) };
  }
  for (const m of forbidMarkers) {
    const hit = res.lines.find((l) => l.includes(m));
    if (hit) return { name, ok: false, why: `禁止マーカー "${m}" が出力された: ${hit}` };
  }
  return { name, ok: true, why: 'errors=0' };
}

async function main() {
  const baseOnly = process.argv.includes('--base-only');
  // ai: MCP サーバは既定 OFF（T001）— 自動起動していないことを '[mcp]' マーカー不在で恒久検証。
  //     万一の regression で起動しても開発中インスタンス(19790)と衝突しないよう別ポートを指定。
  const apps = baseOnly
    ? [['base', {}]]
    : [['base', {}], ['ai', { CLIPAI_MCP_PORT: '19791' }, ['[mcp]']]];

  let failed = 0;
  for (const [name, env, forbid] of apps) {
    const r = await smokeApp(name, env, forbid);
    console.log(`smoke ${r.name}: ${r.ok ? 'OK' : 'NG'} (${r.why})`);
    if (!r.ok) failed++;
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('smoke: 予期しないエラー', e); process.exit(1); });
