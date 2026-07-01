// Claude Code の PostToolUse(Edit|Write) フック。
// 編集されたファイルが .js/.json なら構文チェックし、エラーなら exit 2 で即フィードバックする。
// stdin: フックイベントの JSON（tool_input.file_path を参照）
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readStdin() {
  try { return require('node:fs').readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

const raw = readStdin();
let filePath = null;
try {
  const evt = JSON.parse(raw);
  filePath = evt && evt.tool_input && evt.tool_input.file_path;
} catch (_) { process.exit(0); }

if (!filePath || !/\.(js|mjs|cjs|json)$/.test(filePath)) process.exit(0);
// 生成物・同梱物は対象外
if (/node_modules|vendor|dist|\.out/.test(filePath)) process.exit(0);

const lint = path.join(__dirname, '..', 'lint.js');
const r = spawnSync(process.execPath, [lint, '--file', filePath], { encoding: 'utf8' });
if (r.status !== 0) {
  // exit 2 = Claude にエラー内容がフィードバックされ、自己修正ループに入る
  console.error((r.stderr || r.stdout || '構文チェック失敗').trim());
  process.exit(2);
}
process.exit(0);
