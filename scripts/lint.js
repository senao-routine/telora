// 依存ゼロの構文チェッカ。main=CommonJS / renderer=ES modules の混在に無設定で対応する。
// 使い方:
//   node scripts/lint.js            … packages/ apps/ tests/ scripts/ の .js / .json を全チェック
//   node scripts/lint.js --file <p> … 1ファイルのみ（編集フック用・高速）
// 実行はせず構文解析のみ（vm.Script→CJS、vm.SourceTextModule→ESM の順に試す）。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// vm.SourceTextModule には --experimental-vm-modules が必要。無ければフラグ付きで自分を再実行。
if (typeof vm.SourceTextModule !== 'function') {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--no-warnings', __filename, ...process.argv.slice(2)],
    { stdio: 'inherit' }
  );
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['packages', 'apps', 'tests', 'scripts'];
const EXCLUDE = new Set(['node_modules', 'vendor', 'dist', '.out', '.git']);

function firstLine(e) {
  const m = String((e && e.stack) || e).split('\n');
  // SyntaxError の stack は「file:line」→ソース行→^→メッセージ の順。要点の2行に絞る。
  const msg = m.find((l) => l.includes('SyntaxError')) || m[0];
  return `${m[0].trim()} … ${msg.trim()}`;
}

function checkJs(file) {
  const src = fs.readFileSync(file, 'utf8');
  let cjsErr = null;
  try { new vm.Script(src, { filename: file }); return null; } catch (e) { cjsErr = e; }
  try { new vm.SourceTextModule(src, { identifier: file }); return null; } catch (e) {
    // 両方失敗＝本物の構文エラー。ESM 側のメッセージを優先（renderer が ESM のため）。
    return firstLine(e.message === cjsErr.message ? e : e);
  }
}

function checkJson(file) {
  try { JSON.parse(fs.readFileSync(file, 'utf8')); return null; } catch (e) {
    return String(e.message || e);
  }
}

function checkFile(file) {
  const ext = path.extname(file);
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return checkJs(file);
  if (ext === '.json') return checkJson(file);
  return null; // 対象外
}

function* walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of entries) {
    if (EXCLUDE.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile()) yield p;
  }
}

function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');

  const targets = [];
  if (fileIdx >= 0) {
    const f = args[fileIdx + 1];
    if (!f) { console.error('lint: --file にはパスが必要です'); process.exit(1); }
    targets.push(path.resolve(f));
  } else {
    for (const d of TARGET_DIRS) {
      for (const f of walk(path.join(ROOT, d))) {
        if (/\.(js|mjs|cjs|json)$/.test(f)) targets.push(f);
      }
    }
    // ルート直下の package.json も対象
    targets.push(path.join(ROOT, 'package.json'));
  }

  const errors = [];
  let checked = 0;
  for (const f of targets) {
    if (!fs.existsSync(f)) continue;
    const err = checkFile(f);
    if (err !== null) errors.push({ file: path.relative(ROOT, f), err });
    checked++;
  }

  if (errors.length) {
    for (const { file, err } of errors) console.error(`lint NG: ${file}\n  ${err}`);
    console.error(`lint: ${checked} ファイル中 ${errors.length} 件の構文エラー`);
    process.exit(1);
  }
  console.log(`lint OK (${checked} ファイル)`);
}

main();
