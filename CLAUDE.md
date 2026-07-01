# ClipAI 開発メモ

## 概要

Electron + FFmpeg 製・日本語UI・完全無料/オフラインの動画エディタ（テロップ＆カット＋AI特化）。
npm workspaces: `packages/core`（共有コア）+ `apps/{base,ai,mcp,chat}`（薄いランチャー、`CLIPAI_MODEL` で切替）。
main プロセス = CommonJS、renderer = ES modules。preload API は **FROZEN（追加のみ・変更禁止）**。
`packages/core/renderer/js/commands/edit-commands.js`（EditCommands・19コマンド）が ②MCP・③AIチャット共有の心臓部。
MCP サーバは ai/mcp 起動時に `127.0.0.1:19790`（JSON-RPC、curl で検証可。ポートは `CLIPAI_MCP_PORT` で変更可）。

## 検証コマンド

| コマンド | 内容 | 所要 |
|---|---|---|
| `npm run lint` | 全 .js/.json の構文チェック（依存ゼロ・実行なし） | 数秒 |
| `npm run test:fast` | lint + smoke(base) + コマンド回帰（FFmpeg系スキップ） | ~30秒 |
| `npm test` | lint + smoke(base/ai) + コマンド回帰フル（実FFmpeg: 無音カット・書き出し込み） | 1〜3分 |
| `node tests/run-commands.js --stt` | whisper 実走まで含む（重い・オプトイン） | 数分 |

- **コード変更後は最低 `npm run test:fast`。FFmpeg・export・main プロセスを触ったら `npm test`。**
- 検証の受け口（`packages/core/main/main.js`）: `TCE_DEBUG=1`（renderer ログを stdout 転送）/
  `TCE_SMOKE=1`（起動→`window.__errors` 出力→自動quit）/ `TCE_EVAL=<js>`（renderer で async 実行→`[eval-result]`）/
  `TCE_CAPTURE=<png>`（実画面キャプチャ）
- GUI 起動（`npm run start:*`）は自主終了しないため、自動検証には使わない（tests/ 経由で行う）

## 規約

- コミットメッセージは日本語。develop に直コミット。**push は人間の指示があった時のみ**
- `docs/design/ROADMAP.md` = 3モデル化実装の進捗ログ正本（追記式）／
  `docs/TODO.md` = リリース準備バックログ（/daily が消化。フォーマット契約は TODO.md 冒頭）
- `vendor/`（1.5GB の同梱バイナリ・モデル）は**読むのも編集も禁止**。`dist/`・`node_modules/` も編集禁止
- 依存パッケージは原則追加しない（無料・オフライン方針。テストも Node 標準のみで書く）
- renderer の文字列は日本語ハードコードで統一（i18n 機構は未導入・意図的）
