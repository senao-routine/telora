# 3モデル構成 — 全体設計とフォルダ構成

**作成日**: 2026-06-20
**対象**: Telora（Electron + システムFFmpeg 製の無料・クロスプラットフォーム動画編集ソフト）
**目的**: 1つの母体から「①ベース ②ローカルMCP ③アプリ内AIチャット」の3モデルを、共有コアを軸にフォルダで分けて育てる。

---

## 0. 3モデルの全体像

| | モデル① ベース | モデル② ローカルMCP | モデル③ AIチャット |
|---|---|---|---|
| 位置づけ | 通常の動画編集ソフト（現行） | 外部AIエージェントがタイムラインを操作 | アプリ内で自然言語編集 |
| AIの所在 | なし | **ユーザーのClaude Code/Cursor等**（外部） | LLM（外部APIまたはローカル） |
| 外部依存 | なし | なし（本体は無料/オフライン維持） | **オプトイン**（APIキー or ローカルモデル） |
| 追加コア | — | MCPサーバ + IPCブリッジ + **編集コマンド層** | チャットUI + LLM抽象 + **編集コマンド層** |
| 無料/オフライン | ◎ | ◎ | △（外部API選択時のみ通信） |

**最重要の設計判断**: モデル②と③は、どちらも「プログラムからタイムラインを編集する」という同じ要求を持つ。両者が別々に state を叩くのではなく、**共有コアに「編集コマンド層（EditCommands）」を1枚噛ませ、②MCPと③チャットはともにこの層を叩く**。これで実装と振る舞いが一致し、テストも一元化できる。

```
                 ┌──────────────────────────────┐
   外部エージェント ─MCP→ │ ②MCPサーバ ─┐                │
   （Claude/Cursor）     │             ├→ EditCommands │→ state.js / edit.js / cut-tools.js
   アプリ内チャット ─NL→  │ ③LLMアダプタ ─┘  （共有コア）   │
                 └──────────────────────────────┘
```

---

## 1. フォルダ/リポジトリ構成（2案比較）

### 案A: モノレポ + 共有コア（**推奨**）

```
動画編集ソフト/
├─ packages/
│  └─ core/                     # 3モデル共有
│     ├─ main/                  # CommonJS：FFmpeg・Whisper・IPC基盤
│     │  ├─ export.js  transcribe.js  ipc-core.js
│     │  └─ ...（現 src/main/* を移設）
│     ├─ renderer/              # vanilla JS：状態・編集・UI部品
│     │  ├─ state.js  edit.js  cut-tools.js  timeline.js …（現 src/renderer/js/*）
│     │  └─ commands/edit-commands.js   # ★新規：編集コマンド層（②③共有）
│     └─ preload/preload-core.js
├─ apps/
│  ├─ base/                     # モデル①
│  │  ├─ main.js  preload.js    # core を読み込んで起動するだけ
│  │  ├─ index.html  app.js
│  │  └─ package.json
│  ├─ mcp/                      # モデル②（core + MCPサーバ）
│  │  ├─ main.js                # core起動 + mcp-server.js を有効化
│  │  ├─ mcp-server.js          # ★HTTP MCPサーバ
│  │  └─ package.json
│  └─ chat/                     # モデル③（core + チャットUI）
│     ├─ chat-panel.js  llm-adapter.js   # ★
│     └─ package.json
├─ docs/design/                 # 本設計書
└─ package.json                 # ワークスペース定義（npm workspaces）
```

- **共有するもの**: state / edit / cut-tools / timeline / preview / inspector / media（renderer UI部品）、export.js / transcribe.js（main の FFmpeg・Whisper）、preload 基盤、そして新設の `edit-commands.js`。
- **モデル固有**: `apps/mcp/mcp-server.js`（②）、`apps/chat/chat-panel.js`・`llm-adapter.js`（③）、各 `main.js`（どの機能を有効化するかの差分のみ）。
- **起動**: ルート package.json に `"start:base"`, `"start:mcp"`, `"start:chat"` を定義し、それぞれ `electron apps/<name>` を起動。
- **長所**: 1か所の修正が3モデルに反映。バグ修正・新編集機能が分岐しない。
- **短所**: 初回に現行 `src/` → `packages/core/` への移設リファクタが必要（import パス調整）。

### 案B: 3独立コピー

```
動画編集ソフト/
├─ telora-base/      # 現行をそのままコピー
├─ telora-mcp/       # コピー + MCPサーバ
└─ telora-chat/      # コピー + チャット
```

- **長所**: 移設不要・即分離・各モデルを自由に破壊実験できる。
- **短所**: コア修正を3回反映する必要があり**必ず乖離する**。中長期に破綻しやすい。

### 推奨

**案A（モノレポ + 共有コア）を推奨**。ただし初手のリスクを抑えるため、移行は段階的に：

1. **フェーズ0（足場）**: 現行 `src/` を `packages/core/` 配下へ移設し、`apps/base/` から起動できるようにする（モデル①が動く状態を維持）。
2. **フェーズ1（コマンド層）**: `packages/core/renderer/commands/edit-commands.js` を新設（②③の土台）。
3. **フェーズ2（②）**: `apps/mcp/` を追加。
4. **フェーズ3（③）**: `apps/chat/` を追加。

「まず3フォルダで眺めたい」という要望には、**案Aの `apps/{base,mcp,chat}` がそのままフォルダ分割**として機能する（実体のコードはcore共有）。完全独立で触りたい用途が出たら、その時だけ案Bの一時コピーを切る。

---

## 2. 編集コマンド層（EditCommands）— ②③の共有心臓部

`packages/core/renderer/commands/edit-commands.js`。renderer 側に置き、既存の state.js / edit.js / cut-tools.js を**安定した・シリアライズ可能なコマンドAPI**として薄くラップする。MCPサーバ（②）とLLMアダプタ（③）は、この層だけを呼ぶ。

### 設計原則
- 入出力は**JSONシリアライズ可能**（IDや秒数などのプリミティブ）。DOM/関数オブジェクトを跨がせない。
- 破壊的コマンドは内部で `pushHistory()` を呼び、**undo/redo と完全整合**。
- すべて `{ ok, result?, error? }` を返す。例外はここで握って構造化エラーに変換。
- 既存関数へのマッピングを持つ（下表）。新規ロジックは原則作らず「合成」する。

### コマンドカタログ（初版）

| コマンド | 引数 | 返り値 | 既存実装へのマッピング |
|---|---|---|---|
| `getTimeline` | — | tracks/clips/再生位置/総尺の要約 | `getProject()` / `totalDuration()` / `getPlayhead()` |
| `getTranscript` | `{clipId?}` | テロップ/字幕の {text,start,end} 配列 | `getTextClips()` |
| `selectClip` | `{trackId, clipId}` | ok | `setSelection()` |
| `splitAt` | `{time}` | 新clip群 | `setPlayhead()`→`splitAtPlayhead()` |
| `cutBefore` / `cutAfter` | `{time}` | ok | `setPlayhead()`→`cutBefore()/cutAfter()` |
| `deleteClip` | `{clipId}` | ok | 選択→`deleteSelection()` |
| `moveClip` | `{clipId, start, trackId?}` | ok | `mutate()` でクリップ移動（既存ドラッグ相当） |
| `addTelop` | `{text, start, end, style?}` | clipId | `defaultTextClip()`+`mutate()`（`addTelopAtPlayhead` を一般化） |
| `setTelop` | `{clipId, text?, style?}` | ok | `mutate()` |
| `cutSilence` | `{clipId, noiseDb?, minDur?}` | {made, removed} | `silenceCut()` |
| `cutFillers` | `{clipId}` | {made, count} | `fillerCut()` |
| `setTrackMute` | `{trackId, muted}` | ok | `toggleTrackMute()`（値指定版を追加） |
| `addCrossfade` | `{duration?}` | ok | `applyCrossfade()` |
| `importMedia` | `{paths[]}` | media[] | `importMedia()` |
| `export` | `{options}` | 出力パス | export-ui の gather + `window.api.exportVideo` |
| `undo` / `redo` | — | ok | `undo()` / `redo()` |

> 注: `moveClip` の「指定 start にクリップ移動」、`addTelop` の「任意時刻にテロップ追加」、`setTrackMute` の「値指定ミュート」は**現行に厳密な単体関数が無い**ため、`mutate()` での新規薄ラッパが必要（既存ロジックの再利用で実装可能）。

この層があることで、②は「MCPツール→EditCommands」、③は「LLMのfunction call→EditCommands」と**同じ的**を射る。

---

## 3. ビルド/起動・移行手順の概略

- **ワークスペース**: ルート `package.json` に npm workspaces（`packages/*`, `apps/*`）。各 app の `main` は core を `require`/`import`。
- **スクリプト例**:
  - `npm run start:base` → `electron apps/base`
  - `npm run start:mcp` → `electron apps/mcp`
  - `npm run start:chat` → `electron apps/chat`
- **検証ハーネス継承**: 既存の `TCE_DEBUG=1 / TCE_EVAL / TCE_CAPTURE` 方式は core 側 main の did-finish-load に置けば3モデル共通で使える。
- **移行の安全策**: フェーズ0完了時点で「モデル①が従来どおり動く」ことを既存の検証手順（Electron eval ハーネス）で確認してから②③へ進む。

詳細は各モデルの設計書（01〜03）参照。
