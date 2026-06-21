# Telora 3モデル化 — 実装ロードマップ & 進捗チェックリスト

> **このファイルが進捗の唯一の正本（single source of truth）です。**
> 作業が終わるたびに `- [ ]` を `- [x]` に更新していきます。
> ターミナルを閉じても、このファイルと `docs/design/00〜03` を読めば**続きから再開**できます。

- **最終更新**: 2026-06-21
- **現在のフェーズ**: フェーズ0 着手前（設計完了）
- **次の一歩**: フェーズ0「モノレポ足場（現行を packages/core 化 → apps/base から起動）」
- **設計書**: [00 全体/構成](./00-overview-and-structure.md) ・ [01 ベース](./01-base-editor.md) ・ [02 MCP](./02-local-mcp.md) ・ [03 AIチャット](./03-ai-chat.md)

凡例: `- [ ]` 未着手 / `- [~]` 着手中（手動で `~` に） / `- [x]` 完了

---

## 🔁 再開のしかた（ターミナルを閉じた後）

1. このファイル `docs/design/ROADMAP.md` を開く。
2. 「現在のフェーズ」と、最初に出てくる `- [ ]`（未完）を見る＝そこが続き。
3. 該当フェーズの設計書（00〜03）の対応セクションを読む。
4. 作業したら、終えた項目を `- [x]` に更新し、「最終更新」「現在のフェーズ」「次の一歩」も書き換える。

> 採用構成: **案A モノレポ + 共有コア**（`packages/core` + `apps/{base,mcp,chat}`）。詳細は 00 章。

---

## フェーズ0 — モノレポ足場（current を壊さず core 化）

ゴール: 現行 Telora を `packages/core` へ移し、`apps/base`（モデル①）として従来どおり起動・動作。

- [ ] ルート `package.json` に npm workspaces を定義（`packages/*`, `apps/*`）
- [ ] `src/main/*` → `packages/core/main/` へ移設（export.js / transcribe.js / main.js / preload.js）
- [ ] `src/renderer/*` → `packages/core/renderer/` へ移設（js / styles / index.html）
- [ ] import パス・相対参照の修正
- [ ] `apps/base/`（main.js / preload.js / 起動エントリ）から core を読み込み起動
- [ ] `npm run start:base` スクリプト追加
- [ ] **回帰確認**: モデル①が従来どおり動く（Electron eval ハーネス `TCE_DEBUG/TCE_EVAL/TCE_CAPTURE` で主要機能をスモーク）
- [ ] develop へコミット（ユーザー承認後）

---

## フェーズ1 — 編集コマンド層 EditCommands（②③の共有心臓部）

ゴール: `packages/core/renderer/commands/edit-commands.js` を新設。JSON入出力・undo整合・`{ok,result,error}` 返却。

- [ ] `edit-commands.js` 雛形（`run(name, args)` ディスパッチ＋構造化エラー）
- [ ] 読み取り: `getTimeline`（getProject/totalDuration/getPlayhead 要約）
- [ ] 読み取り: `getTranscript`（getTextClips）
- [ ] `selectClip`（setSelection）
- [ ] `splitAt` / `cutBefore` / `cutAfter`（setPlayhead + 既存関数）
- [ ] `deleteClip`（選択 + deleteSelection）
- [ ] `moveClip`（★新規 mutate 薄ラッパ：指定 start/trackId へ移動）
- [ ] `addTelop`（★任意時刻にテロップ追加：defaultTextClip + mutate）
- [ ] `setTelop`（mutate）
- [ ] `cutSilence`（silenceCut）/ `cutFillers`（fillerCut）
- [ ] `setTrackMute`（★値指定版：現 toggleTrackMute を補完）
- [ ] `addCrossfade`（applyCrossfade）/ `importMedia` / `export` / `undo` / `redo`
- [ ] 各コマンドの単体検証（TCE_EVAL でコマンド→state変化を assert）
- [ ] develop へコミット（承認後）

---

## フェーズ2 — モデル② ローカルMCP（[設計 02](./02-local-mcp.md)）

ゴール: main にHTTP MCPサーバ、外部エージェントがタイムライン操作。本体は無料/オフライン維持。

- [ ] `apps/mcp/`（main.js が core 起動 + mcp-server 有効化）
- [ ] preload に `onMcpInvoke` / `sendMcpResult` を**追加**（FROZEN なので追加のみ）
- [ ] renderer `mcp-bridge.js`（onMcpInvoke → EditCommands.run → sendMcpResult）
- [ ] main `mcp-server.js`：HTTPサーバ（`127.0.0.1` 限定・既定 OFF・ポート 19790）
- [ ] `tools/list` / `tools/call`（まず4つ: `get_timeline` `split_clip` `add_telop` `cut_silence`）
- [ ] id 相関の IPC 往復 + タイムアウト（既定15s）
- [ ] **接続デモ**: Claude Code から接続し4ツール実行 → state 変化を確認
- [ ] 残りツール（move_clip/cut_fillers/set_track_mute/add_crossfade/import/export/undo/redo…）
- [ ] 長時間処理のジョブ化（export / transcribe）+ `get_job_status`
- [ ] 設定UI（ON/OFF・ポート・接続情報表示）+ 任意トークン認証
- [ ] **最小デモ達成**: 「全クリップの無音を消して」が外部エージェント経由で通る
- [ ] develop へコミット（承認後）

---

## フェーズ3 — モデル③ アプリ内AIチャット（[設計 03](./03-ai-chat.md)）

ゴール: アプリ内LLMが function calling で EditCommands を呼ぶ。外部API（オプトイン）/ローカル選択。

- [ ] `apps/chat/`
- [ ] preload に `llmChat` 追加 / main `llm-proxy.js`（外部API HTTPS 中継・キーは main 保持）
- [ ] `chat-panel.js`（履歴・入力・「実行前に確認」トグル）
- [ ] オーケストレータ（getTimeline → LLM → tool_calls →（破壊的は確認）→ EditCommands.run → 結果表示）
- [ ] 破壊的操作の確認ダイアログ + 履歴グルーピング（↩ 取り消し）
- [ ] **最小デモ達成**: 「この動画の無音を全部消して」→ 実行 →「12箇所・8.3秒削除（↩）」
- [ ] ローカルモデル経路（llama.cpp/Ollama 等）
- [ ] APIキー設定UI（main の userData / キーチェーン・gitignore・オプトイン）
- [ ] 複合指示の多ターン化
- [ ] develop へコミット（承認後）

---

## 決め待ち（未確定の判断・必要なら相談）

- [ ] フォルダ構成: 案A モノレポ（推奨）で確定してよいか／案B 3独立コピー希望か
- [ ] モデル③の外部API: 許容するか（オプトイン前提）／ローカルモデルのみに限定するか
- [ ] MCPサーバ既定ポート 19790 でよいか
- [ ] フェーズ0の移設をいつ実行するか（破壊的リファクタなので承認タイミング）

---

## 進捗ログ（任意・追記式）

- 2026-06-21: 設計書 00〜03 作成、本ロードマップ作成。実装は未着手。
