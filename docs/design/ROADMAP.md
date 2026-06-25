# Telora 3モデル化 — 実装ロードマップ & 進捗チェックリスト

> **このファイルが進捗の唯一の正本（single source of truth）です。**
> 作業が終わるたびに `- [ ]` を `- [x]` に更新していきます。
> ターミナルを閉じても、このファイルと `docs/design/00〜03` を読めば**続きから再開**できます。

- **最終更新**: 2026-06-23
- **現在のフェーズ**: フェーズ3 完了 ✅ → **3モデル（①②③）すべて起動可能**
- **残り**: ③の実LLM E2E（ユーザーのAPIキー設定が必要）。②③の堅牢化（MCP実クライアント接続確認・本格ジョブ化・トークン認証等）は任意の将来課題。
- **起動**: `npm run start:base`（①）／`npm run start:mcp`（②・MCP `http://127.0.0.1:19790/mcp`）／`npm run start:chat`（③・右下「🤖 AIチャット」）
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

- [x] ルート `package.json` に npm workspaces を定義（`packages/*`, `apps/*`）
- [x] `src/main/*` → `packages/core/main/` へ移設（git mv で履歴保持）
- [x] `src/renderer/*` → `packages/core/renderer/` へ移設（git mv で履歴保持）
- [x] import パス・相対参照の修正 → **不要だった**（main.js が `__dirname` 相対で preload/renderer を参照しており、main と renderer をセットで移動したため無傷）
- [x] `apps/base/`（main.js が core を require / package.json main=main.js）から起動
- [x] `npm run start:base`（`electron apps/base`）と `start`（`electron .`→root main=apps/base/main.js）追加
- [x] **回帰確認**: モデル①が従来どおり動く（eval ハーネスで検証：renderer import / クリップ描画 / フィルムストリップ / ミュート×4 / 録音ボタン / カット支援 / IPC audioPeaks・probe すべてOK・windowErrors 0・キャプチャ一致）
- [x] electron-builder の `files` を `packages/core/**` `apps/**` に更新
- [ ] develop へコミット

---

## フェーズ1 — 編集コマンド層 EditCommands（②③の共有心臓部）

ゴール: `packages/core/renderer/commands/edit-commands.js` を新設。JSON入出力・undo整合・`{ok,result,error}` 返却。

- [x] `edit-commands.js` 雛形（`run(name, args)` ディスパッチ＋構造化エラー / `listCommands`）。配置: `packages/core/renderer/js/commands/edit-commands.js`
- [x] 読み取り: `getTimeline`（settings/playhead/duration/tracks→clips 要約）
- [x] 読み取り: `getTranscript`（getTextClips → cues）
- [x] `selectClip`（setSelection・存在検証）
- [x] `splitAt` / `cutBefore` / `cutAfter`（setPlayhead + 既存関数）
- [x] `deleteClip`（選択 + deleteSelection・存在検証）
- [x] `moveClip`（新規 mutate 薄ラッパ：指定 start/trackId へ移動、text は尺保持）
- [x] `addTelop`（任意時刻にテロップ追加：defaultTextClip + style 上書き）
- [x] `setTelop`（text/style 更新）
- [x] `cutSilence`（silenceCut）/ `cutFillers`（fillerCut）
- [x] `setTrackMute`（値指定：現 toggleTrackMute を読み取り比較で補完）
- [x] `addCrossfade`（applyCrossfade）/ `importMedia` / `export` / `undo` / `redo`
- [x] export 用に `buildExportPayload(opts)` を export-ui.js から抽出（DOM非依存・runExport と共有）
- [x] 各コマンドの単体検証（eval ハーネスで18コマンド全assert合格。無音カット・書き出しは実FFmpegで検証、undo/redo・エラー/未知コマンドも確認、windowErrors 0）
- [ ] develop へコミット

---

## フェーズ2 — モデル② ローカルMCP（[設計 02](./02-local-mcp.md)）

ゴール: main にHTTP MCPサーバ、外部エージェントがタイムライン操作。本体は無料/オフライン維持。

- [x] `apps/mcp/`（main.js が `TELORA_MODEL=mcp` で core 起動 → core が MCPサーバ有効化）。`npm run start:mcp`
- [x] preload に `onMcpInvoke` / `sendMcpResult` / `model` を**追加**（FROZEN なので追加のみ）
- [x] renderer `mcp-bridge.js`（onMcpInvoke → EditCommands.run → sendMcpResult）。`model==='mcp'` の時だけ読み込み
- [x] main `mcp-server.js`：HTTPサーバ（`127.0.0.1` 限定・ポート 19790）。※専用アプリ＝起動＝利用意思とみなし ON（一般アプリ向けの「既定OFFトグル」は将来）
- [x] `tools/list` / `tools/call`（**全19ツール**: get_timeline/get_transcript/select_clip/split_clip/cut_before/cut_after/delete_clip/move_clip/add_telop/set_telop/cut_silence/cut_fillers/set_track_mute/add_crossfade/import_media/add_clip/export_video/undo/redo）
- [x] id 相関の IPC 往復 + タイムアウト（通常30s／書き出し・文字起こし系は600s）
- [x] **接続デモ**: curl で JSON-RPC 往復を実機検証（initialize→tools/list→add_telop→get_timeline反映→import_media→add_clip→cut_silence made=2）。※実 Claude Code クライアント接続は手元環境で要確認（SSE/セッション等のエッジケース）
- [x] 残りツール（move_clip/cut_fillers/set_track_mute/add_crossfade/import/add_clip/export/undo/redo …）
- [x] 接続情報メニュー（`AI接続 → MCP接続情報を表示…` で各クライアントの登録コマンドを案内）
- [x] **最小デモ達成**: 「無音を消す」が MCP 経由で通る（cut_silence made=2・実FFmpeg）
- [x] モデル①無回帰・モデル分離確認（base は MCPポート開かず／model=base）
- [ ] develop へコミット
- [ ] （将来）長時間処理の本格ジョブ化（export/transcribe + `get_job_status`）・任意トークン認証・サーバON/OFFトグルUI

---

## フェーズ3 — モデル③ アプリ内AIチャット（[設計 03](./03-ai-chat.md)）

ゴール: アプリ内LLMが function calling で EditCommands を呼ぶ。外部API（オプトイン）/ローカル選択。

- [x] `apps/chat/`（`TELORA_MODEL=chat`）。`npm run start:chat`
- [x] preload に `llmChat`/`llmConfigGet`/`llmConfigSet` 追加 / main `llm-proxy.js`（Anthropic・OpenAI互換・ローカルのHTTPS中継、キーは main の userData にのみ保存）
- [x] `chat-panel.js`（右ドロワー：会話履歴・入力・状態表示・API設定モーダル）。`model==='chat'` 時のみ読み込み
- [x] 共有ツールカタログ `commands/tool-catalog.js`（19ツール・破壊フラグ付き。②③共通の基準）
- [x] `chat-orchestrator.js`（getTimeline → LLM → tool_calls →（破壊的は onConfirm）→ EditCommands.run → 逐次 onEvent 表示・多ターンループ maxSteps）
- [x] 破壊的操作の確認ダイアログ（実行は EditCommands 経由＝全て undo 可能）
- [x] **オーケストレータ検証**（疑似LLM注入・実API不要）: ツール19/タイムライン受領、add_telop 反映、delete_clip は確認キャンセルで非実行・承認で削除。設定IPC往復（キー秘匿）、no-keyエラー、UI（fab/ドロワー）表示も確認・windowErrors 0
- [x] ローカルモデル経路（OpenAI互換 baseUrl 対応）
- [x] APIキー設定UI（⚙モーダル。キーは main userData に保存・renderer/プロジェクトに出さない・オプトイン）
- [x] 複合指示の多ターン化（ツール実行→結果を次ターンへ）
- [ ] develop へコミット
- [ ] （要・実機）ユーザーのAPIキーを設定し、実LLMで「無音を全部消して」等のE2E確認（HTTP中継コードは実装済・キー未設定のため本セッションでは未通電）

---

## 決め待ち（未確定の判断・必要なら相談）

- [ ] フォルダ構成: 案A モノレポ（推奨）で確定してよいか／案B 3独立コピー希望か
- [ ] モデル③の外部API: 許容するか（オプトイン前提）／ローカルモデルのみに限定するか
- [ ] MCPサーバ既定ポート 19790 でよいか
- [ ] フェーズ0の移設をいつ実行するか（破壊的リファクタなので承認タイミング）

---

## 進捗ログ（任意・追記式）

- 2026-06-21: 設計書 00〜03 作成、本ロードマップ作成。実装は未着手。
- 2026-06-23: **フェーズ0完了**。`src/` を `packages/core/` へ git mv、`apps/base` launcher 追加、ルート package.json に workspaces/scripts/builder files 設定。モデル①の無回帰を eval ハーネスで確認。次はフェーズ1（EditCommands）。
- 2026-06-23: **フェーズ1完了**。`commands/edit-commands.js`（18コマンド・`run`/`listCommands`）新設。export-ui.js から `buildExportPayload` を抽出（runExport と共有）。eval ハーネスで全コマンド検証（無音カット・書き出しは実FFmpeg）・windowErrors 0。次はフェーズ2（MCP）。
- 2026-06-25: **方針変更：動画は映像＋音声を1本の帯で表示（自動分離をやめる）**。ユーザー要望で、動画追加時に音声を別トラックへ自動分離する挙動を撤回。動画クリップは波形バンド付きの1クリップとして表示し、自分の音声をそのまま再生（二重なし）。音声単体素材は従来どおり音声トラックへ。連動コード（split/trim/cut/move/delete link・unlink）は linkedAudioId/detachedAudio を持つクリップ限定のため、新規クリップでは発火せず no-op（dormant）。検証: 動画追加=1クリップ・波形バンドあり・分割で音声増えない・音声単体は音声トラック・windowErrors 0。
- 2026-06-25: **リンク音声の仕上げ（D）**。映像↔音声を「移動」に加え「トリム・前後カット・分割」でも連動。特に分割は相手も同位置で分割し左右を対応づけ、右半分も detachedAudio を維持（二重音声の再発を防止）。インスペクタに「🔓 リンクを解除」を追加（個別編集可能に・解除後も detach 維持）。分割2/2・区間一致・カット連動・解除を検証、windowErrors 0。
- 2026-06-24: **③実LLM通電の事前修正**。Anthropic API の交互制約に対応：(1) 1ターン複数ツールの tool_result を1つの user にまとめる、(2) オーケストレータが最終 assistant 応答を履歴に残し、次ターンの user 連続を防止。整形を純粋関数 `main/llm-format.js` に抽出し node で単体検証（2ターン/複数ツールとも role 交互・tool_result 統合を確認）。実APIキー設定後の通電待ち。
- 2026-06-23: **二重音声バグ修正＋映像/音声の完全分離表示**。原因＝非ベース動画(trackVideoEls)が `muted=false` でリンク音声と二重再生していた→ detachedAudio/トラックミュート時に動画側 `<video>` を muted（ベース・非ベース両方）。動画クリップは分離時に波形バンドを出さず映像のみ（波形は音声トラック側）。音声クリップの波形を明るく・高く（高さ48・明色・装飾ストライプを抑制）して「しっかり表示」。base/非ベース両ケースで muted・windowErrors 0 を検証。
- 2026-06-23: **動画＝音声リンク（自動追加）**。動画を配置すると、その音声を波形付きの音声クリップとして音声トラックへ自動追加（`attachLinkedAudio`）。動画側の音声は分離（`detachedAudio`）してプレビュー/書き出しの二重再生を防止（preview ミュート・export base concat 無音・非ベース audioClips 除外）。映像/音声は `linkedAudioId/linkedVideoId` で対応づけ、削除・移動はセットで連動（timeline ドラッグ＋EditCommands.moveClip）。共有コアのため①②③に反映。実書き出し・状態で検証、windowErrors 0。
- 2026-06-23: **デザイン改善（タイムライン）**。動画クリップの素材フレームを主役に：スクリム除去で明るく、フィルムストリップを高密度化（FRAME_W 78→56・抽出幅200）、クリップ名は左下の小さなピル型に、波形帯を細く。共有コアのため①②③全バージョンに反映。混在（動画/画像/テロップ/音声）で無回帰確認。
- 2026-06-23: **フェーズ3完了**。モデル③（アプリ内AIチャット）が起動。`apps/chat` + 共有ツールカタログ + `chat-orchestrator`（function calling→EditCommands）+ `llm-proxy`（Anthropic/OpenAI/ローカル中継・キーはmain保持）+ 右ドロワーUI + ⚙API設定。疑似LLMでオーケストレータ/確認フロー/設定IPC/UIを検証（実APIはキー設定後に通電）。**3モデル①②③すべて起動可能に**。
- 2026-06-23: **フェーズ2完了**。モデル②（ローカルMCP）が起動。`apps/mcp` + core に `mcp-server.js`（HTTP 127.0.0.1:19790）・`mcp-bridge.js`・preload追加・`addClip` コマンド。全19ツールを公開。curl で JSON-RPC 往復を実機検証（add_telop→反映、cut_silence made=2 実FFmpeg）、モデル①無回帰＆分離確認。接続情報メニュー追加。次はフェーズ3（AIチャット）。
