// MCP ブリッジ（モデル②・renderer 側）。main の MCPサーバから来たツール呼び出しを
// 共有コアの EditCommands で実行し、結果を返す。モデル②のときだけ読み込まれる。
import { run } from './commands/edit-commands.js';
import { toast } from './ui.js';

export function initMcpBridge() {
  if (!window.api || typeof window.api.onMcpInvoke !== 'function') return;
  window.api.onMcpInvoke(async ({ id, name, args }) => {
    let res;
    try { res = await run(name, args); }
    catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
    window.api.sendMcpResult({ id, ok: res.ok, result: res.result, error: res.error });
  });
  console.log('[mcp-bridge] ready (AIエージェントからの操作を受け付けます)');
  try { toast('MCP接続を待機中（AIエージェントからタイムラインを操作できます）'); } catch (_) {}
}
