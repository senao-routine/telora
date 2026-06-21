# モデル② ローカルMCP版 — 設計

**位置づけ**: Palmier 方式。Electron main に**ローカルHTTP MCPサーバ**を立て、ユーザー自身の AIエージェント（Claude Code / Claude Desktop / Cursor / Codex）が Telora のタイムラインを操作する。
**思想**: AIモデルはユーザー側エージェント任せ。よって **Telora本体は無料・オフライン**を維持できる（差別化の核）。

参考: Palmier Pro は `http://127.0.0.1:19789/mcp`（HTTP）でMCPサーバを公開し、共有ToolExecutor経由で `get_timeline/add_clips/split_clip/move_clips/set_clip_properties/generate_*` 等を提供（GitHub README・DeepWiki で確認済み）。

---

## 1. アーキテクチャ全体

```
┌── 外部AIエージェント（ユーザー所有）─────────────┐
│  Claude Code / Cursor / Codex / Claude Desktop  │
└───────────────┬─────────────────────────────┘
                │ MCP over HTTP (127.0.0.1:PORT/mcp)
┌───────────────▼─────────────────────────────────────────┐
│ Electron Main（CommonJS）                                  │
│  apps/mcp/mcp-server.js                                   │
│   ├─ HTTPサーバ（127.0.0.1 限定・ループバックのみ）              │
│   ├─ MCPプロトコル処理（tools/list, tools/call）              │
│   └─ ToolDispatcher：tool名→ renderer への IPC往復           │
│            │ webContents.send('mcp-invoke', {id,name,args}) │
└────────────┼─────────────────────────────────────────────┘
             │  ▲ ipcMain.once/on('mcp-result', {id,ok,result})
┌────────────▼──┼──────────────────────────────────────────┐
│ Renderer       │                                          │
│  mcp-bridge.js（preload 経由で onMcpInvoke を購読）           │
│   → EditCommands.run(name, args)  （00章の共有コマンド層）     │
│   → state.js / edit.js / cut-tools.js を mutate 経由で実行    │
│   → 結果を sendMcpResult(id, {ok,result})                  │
└──────────────────────────────────────────────────────────┘
```

**要点**: MCPサーバは main に居るが、編集の真実は renderer の state にある。両者を **id 相関の IPC 往復**で橋渡しする。

---

## 2. MCPサーバ（main 側）

- **配置**: `apps/mcp/main.js` が core の main を起動した後、`mcp-server.js` を `app.whenReady()` 後に起動。
- **トランスポート**: HTTP、**127.0.0.1 のみにバインド**（`server.listen(PORT, '127.0.0.1')`）。LAN/外部からは到達不可。ポートは既定 `19790`（Palmierの19789と衝突回避）、設定で変更可。
- **プロトコル**: MCP 標準の JSON-RPC。最低限 `initialize` / `tools/list` / `tools/call` を実装。公式 `@modelcontextprotocol/sdk`（Node）を使うのが堅い（依存追加。オフライン配布のため node_modules に同梱）。
- **ワンクリック設定**: メニュー「ヘルプ → MCP接続情報」で各クライアントのコマンドを表示（例）:
  - `claude mcp add --transport http telora http://127.0.0.1:19790/mcp`
  - `codex mcp add telora --url http://127.0.0.1:19790/mcp`
- **起動制御**: 設定で MCPサーバの ON/OFF。OFF時はポートを開かない（既定OFF＝明示的に有効化＝安全側）。

---

## 3. main ↔ renderer IPCブリッジ（往復）

MCPツール呼び出しは「非同期で renderer に投げて結果を待つ」必要がある。id 相関の pending-promise で実装。

### main 側（mcp-server.js）
```js
const pending = new Map(); // id -> {resolve, reject, timer}
let seq = 0;
function callRenderer(name, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = String(++seq);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('renderer timeout')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    mainWindow.webContents.send('mcp-invoke', { id, name, args });
  });
}
ipcMain.on('mcp-result', (_e, { id, ok, result, error }) => {
  const p = pending.get(id); if (!p) return;
  clearTimeout(p.timer); pending.delete(id);
  ok ? p.resolve(result) : p.reject(new Error(error || 'command failed'));
});
// tools/call ハンドラ → const result = await callRenderer(toolName, toolArgs);
```

### preload（**追加**で公開。既存 window.api は FROZEN なので新メソッド追加）
```js
onMcpInvoke: (cb) => { const h = (_e, msg) => cb(msg); ipcRenderer.on('mcp-invoke', h); return () => ipcRenderer.removeListener('mcp-invoke', h); },
sendMcpResult: (payload) => ipcRenderer.send('mcp-result', payload),
```

### renderer 側（mcp-bridge.js）
```js
import { run as runCommand } from './commands/edit-commands.js';
window.api.onMcpInvoke(async ({ id, name, args }) => {
  try { const result = await runCommand(name, args); window.api.sendMcpResult({ id, ok: true, result }); }
  catch (e) { window.api.sendMcpResult({ id, ok: false, error: String(e && e.message || e) }); }
});
```

これで「main の MCPツール → renderer の EditCommands → state 編集 → 結果返却」が1往復で完結。

---

## 4. MCPツールカタログ（公開ツール → EditCommands → 既存実装）

| MCPツール | 引数 | EditCommands | 既存実装 |
|---|---|---|---|
| `get_timeline` | — | `getTimeline` | `getProject/totalDuration/getPlayhead` |
| `get_transcript` | `{clipId?}` | `getTranscript` | `getTextClips` |
| `select_clip` | `{trackId,clipId}` | `selectClip` | `setSelection` |
| `split_clip` | `{time}` | `splitAt` | `setPlayhead`+`splitAtPlayhead` |
| `cut_before` / `cut_after` | `{time}` | `cutBefore/cutAfter` | 同名 |
| `delete_clip` | `{clipId}` | `deleteClip` | `deleteSelection` |
| `move_clip` | `{clipId,start,trackId?}` | `moveClip` | 新規（mutate薄ラッパ） |
| `add_telop` | `{text,start,end,style?}` | `addTelop` | `defaultTextClip`+mutate |
| `set_telop` | `{clipId,text?,style?}` | `setTelop` | mutate |
| `cut_silence` | `{clipId,noiseDb?,minDur?}` | `cutSilence` | `silenceCut` |
| `cut_fillers` | `{clipId}` | `cutFillers` | `fillerCut` |
| `set_track_mute` | `{trackId,muted}` | `setTrackMute` | `toggleTrackMute`(値版追加) |
| `add_crossfade` | `{duration?}` | `addCrossfade` | `applyCrossfade` |
| `import_media` | `{paths[]}` | `importMedia` | `importMedia` |
| `export_video` | `{options}` | `export` | export-ui gather + `exportVideo` |
| `undo` / `redo` | — | `undo/redo` | 同名 |

各ツールの `description` と JSON Schema を `tools/list` で返す。エージェントは `get_timeline` で現状把握→編集ツール実行、のループで作業する。

---

## 5. undo/履歴・競合・エラー処理

- **undo整合**: すべて EditCommands→mutate 経由なので、各破壊的ツールが履歴を1段積む。エージェントの誤操作も人間が Cmd+Z で戻せる。粒度が細かすぎる場合は「セッション境界」でまとめる拡張も可能（将来）。
- **競合（人間とAIの同時編集）**: renderer はシングルスレッドで mutate が直列化されるため**データ競合は起きない**。ただし UX 配慮として、MCP編集中は軽いインジケータ（「AI編集中」）を出す。
- **エラー**: EditCommands は `{ok,error}` を返し、bridge が MCP エラーへ変換。タイムアウト（既定15s）は main 側 pending で検出。長時間処理（書き出し・文字起こし）は**ジョブ化**して即時に `{started:true, jobId}` を返し、進捗は別ツール `get_job_status` でポーリング（書き出しは数十秒かかるため同期返却にしない）。
- **検証**: ツール1つ1つを TCE_EVAL ハーネスで「コマンド→state変化」を assert（②は UI を介さないのでヘッドレス検証と相性が良い）。

---

## 6. セキュリティ

- **ループバック限定**（127.0.0.1）。外部ネットワークへ露出しない。
- **既定OFF**: MCPサーバは設定で明示的に有効化。
- **トークン任意**: 既定はローカル信頼。気にする場合は起動時生成のトークンを `Authorization` ヘッダで要求するオプション（クライアント設定にURLと共に埋め込む）。
- **破壊的操作の保護**: `delete_*` 等は履歴に必ず残る＝復元可能。プロジェクト保存前提で運用。
- **生成AIは持たない**: モデル②は編集操作のみ公開。生成（動画/画像）は範囲外＝外部依存を持ち込まない。

---

## 7. 段階的実装ステップ

1. `packages/core/renderer/commands/edit-commands.js` を実装（②③共有。00章カタログ）。単体検証。
2. preload に `onMcpInvoke/sendMcpResult` を追加。`mcp-bridge.js` で EditCommands に接続。
3. `apps/mcp/mcp-server.js`：HTTPサーバ + `tools/list`/`tools/call`（まず `get_timeline`/`split_clip`/`add_telop`/`cut_silence` の4つ）。
4. Claude Code から接続して4ツールを実行、state変化を確認。
5. 残りツール・ジョブ化（export/transcribe）・トークン認証・設定UI（ON/OFF・ポート・接続情報表示）を追加。

**最小デモ**: 「Claude Code に "全部のクリップの無音を消して" と頼む → `get_timeline`→各clipに `cut_silence`」が通ればコンセプト成立。
