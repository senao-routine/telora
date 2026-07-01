// EditCommands 回帰テストランナー。
// テンプレート（tests/eval/commands.eval.template.js）に設定を注入して tests/.out/ に生成し、
// TCE_EVAL で base アプリの renderer 上で実行 → [eval-result] を判定する。
// 使い方: node tests/run-commands.js [--fast] [--stt]
//   --fast … 実FFmpeg 系（cutSilence/export）をスキップ（日常の高速検証用）
//   --stt  … whisper 実走まで含める（重い・オプトイン）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { launchElectron, findMarker, ROOT } = require('./lib/launch');
const { ensureFixture } = require('./fixtures/make-fixture');

const EVAL_PREFIX = '[eval-result] ';
const TEMPLATE = path.join(__dirname, 'eval', 'commands.eval.template.js');
const OUT_DIR = path.join(__dirname, '.out');

async function main() {
  const fast = process.argv.includes('--fast');
  const stt = process.argv.includes('--stt');

  // フィクスチャ（importMedia に必要なので fast でも生成する。生成は 1〜2 秒）
  const fixture = ensureFixture();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'export-test.mp4');
  try { fs.unlinkSync(outPath); } catch (_) { /* noop */ }

  // テンプレート → 実行スクリプト生成
  const config = { fixture, outPath, fast, stt };
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const marker = '/*__CONFIG__*/ {}';
  if (!template.includes(marker)) {
    console.error('commands: テンプレートに ' + marker + ' が見つかりません');
    process.exit(1);
  }
  const genPath = path.join(OUT_DIR, 'commands.eval.gen.js');
  fs.writeFileSync(genPath, template.split(marker).join(JSON.stringify(config)));

  // 実行（fast: 90s / full: 240s。export の実エンコードを含むため full は余裕を持つ）
  const res = await launchElectron({
    appDir: path.join(ROOT, 'apps', 'base'),
    env: { TCE_EVAL: genPath },
    timeoutMs: fast ? 90000 : 240000,
  });

  const dumpLog = () => {
    console.error('---- renderer/main ログ（末尾40行）----');
    for (const l of res.lines.slice(-40)) console.error('  ' + l);
  };

  if (res.fatal) { console.error('commands NG: fatal: ' + res.fatal); dumpLog(); process.exit(1); }
  if (res.timedOut) { console.error('commands NG: タイムアウト（[eval-result] 未出現）'); dumpLog(); process.exit(1); }

  const raw = findMarker(res.lines, EVAL_PREFIX);
  if (raw == null) { console.error('commands NG: [eval-result] が出力されなかった (exit=' + res.exitCode + ')'); dumpLog(); process.exit(1); }

  let r;
  try { r = JSON.parse(raw); } catch (e) { console.error('commands NG: eval-result の JSON パース失敗: ' + raw.slice(0, 500)); process.exit(1); }
  if (r && r.evalError) { console.error('commands NG: eval 内例外:\n' + r.evalError); dumpLog(); process.exit(1); }

  let failed = 0;
  for (const a of r.asserts || []) {
    if (!a.ok) { failed++; console.error(`  NG: ${a.name}  ${a.detail || ''}`); }
  }
  if ((r.windowErrors || []).length) {
    failed++;
    console.error('  NG: window.__errors 非空: ' + JSON.stringify(r.windowErrors).slice(0, 500));
  }

  // export 実行時は成果物ファイルを runner 側で検証（renderer から fs は触れない）
  if (!fast) {
    const okFile = fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
    if (!okFile) { failed++; console.error('  NG: 書き出しファイルが生成されていない: ' + outPath); }
  }

  const skipped = (r.skipped || []).length ? `, skipped: ${(r.skipped || []).join(' / ')}` : '';
  console.log(`commands: ${r.total} asserts, ${failed} failed${skipped}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('commands: 予期しないエラー', e); process.exit(1); });
