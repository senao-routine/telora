# モデル① ベース動画編集ソフト — 設計

**位置づけ**: 現行 Telora そのもの。基本的な動画編集ソフトの方式。モデル②③はこれを母体に拡張する。
ここでは「現行アーキテクチャの整理」と「②③が差し込む拡張ポイント」を明文化する。

---

## 1. レイヤ構成

```
┌─────────────────────────────────────────────────────────┐
│ Renderer（vanilla JS / ESモジュール・contextIsolation有効）   │
│                                                          │
│  app.js  ── 全結線（topbar/toolbar/keyboard/menu/home）      │
│    │                                                     │
│    ├─ state.js   中央状態 + イベントバス on/emit + mutate +    │
│    │             undo/redo（getProject/getTracks/…）         │
│    ├─ edit.js    分割/前後カット/上書き/コピペ/複製/クロスフェード     │
│    ├─ cut-tools.js 無音カット/フィラーカット（純粋関数 + 適用）      │
│    ├─ timeline.js タイムライン描画・ドラッグ・マーキー選択           │
│    ├─ preview.js  Canvas合成プレビュー・音声同期・ベース動画         │
│    ├─ inspector.js プロパティ編集（クリップ/テロップ/カット支援）      │
│    ├─ media.js    素材取込・サムネ・メディアビン                  │
│    ├─ waveform.js / filmstrip.js  波形・フレーム表示             │
│    ├─ recorder.js マイク録音→挿入                            │
│    └─ import-srt.js / import-xml.js  字幕・編集データ取込         │
│                          │ window.api（preload・FROZEN）       │
└──────────────────────────┼──────────────────────────────┘
                           │ contextBridge / ipcRenderer
┌──────────────────────────┼──────────────────────────────┐
│ Main（CommonJS）           ▼                               │
│  main.js  ── ipcMain.handle 群（26チャネル）                 │
│    ├─ export.js   FFmpeg実行：exportTimeline/probe/           │
│    │              extractFrame/makeProxy/extractAudio/        │
│    │              audioPeaks/detectSilence/saveRecording      │
│    └─ transcribe.js ローカルWhisper：transcribe/transcribeWords │
└─────────────────────────────────────────────────────────┘
                           │
                    システム FFmpeg / Whisper（外部バイナリ）
```

---

## 2. 状態・イベント・IPC の流れ

### 状態とイベント（renderer 内・単方向）
- 単一の `state.project`（tracks→clips、media、settings、markers 等）。
- 変更は必ず `mutate(fn)` 経由（履歴を積み、`emit('project')`）。直接代入は避ける。
- 購読は `on('project'|'selection'|'playhead'|'zoom'|'waveform'|'filmstrip'|'settings'|'tool'|'range'|'telop-live'|'edit-focus'|'playing'|'dirty', fn)`。
- undo/redo: `pushHistory()` で現状をスナップ、`undo()/redo()`、`canUndo()/canRedo()`。

```
ユーザー操作 → edit.js/inspector等 → mutate(fn) → state変更 + pushHistory
                                          └→ emit('project') → timeline/preview/inspector が再描画
```

### ネイティブ処理（renderer ↔ main）
```
renderer: window.api.<method>(args)   （preload で contextBridge 公開、FROZEN）
   → ipcRenderer.invoke('<channel>', args)
main: ipcMain.handle('<channel>', handler)  → export.js / transcribe.js
   → システム FFmpeg / Whisper を spawn
   → 結果（{ok,...}）を Promise で返す
進捗: main → event.sender.send('export-progress'|'transcribe-progress') → preload onXxxProgress
```

代表的チャネル: `export` / `probe` / `extract-frame` / `make-proxy` / `extract-audio` / `audio-peaks` / `detect-silence` / `save-recording` / `transcribe` / `transcribe-words` / `read-file(-buffer)` / `write-file` / `write-dataurl` / 各種ダイアログ。

---

## 3. 主要モジュールの責務

| モジュール | 責務 | 主な公開関数 |
|---|---|---|
| state.js | 真実の状態・イベント・履歴・各種ヘルパ | `getProject/mutate/on/emit/undo/redo/getTracks/getSelection/setSelection/getPlayhead/setPlayhead/totalDuration/clipDur/clipEnd/clipSpeed/toggleTrackMute/…` |
| edit.js | クリップ編集操作 | `splitAtPlayhead/cutBefore/cutAfter/deleteSelection/copySelection/pasteClipboard/duplicateSelection/applyCrossfade/resolveOverwrite/deleteSelectedRange` |
| cut-tools.js | カット支援 | `silenceCut/fillerCut/fillerCutWithWords/keptSegmentsByRemoving/isFiller` |
| export.js(main) | FFmpeg 全般 | `exportTimeline/probe/extractFrame/makeProxy/extractAudio/audioPeaks/detectSilence/saveRecording` |
| transcribe.js(main) | ローカルWhisper | `transcribe/transcribeWords/detectEngine` |

---

## 4. ②③のための拡張ポイント（重要）

モデル①の中で、②③が無改造で差し込めるよう意識しておくべき「フック」：

1. **mutate + emit の単方向フロー**: 外部（MCP/LLM）からの編集も、必ず `mutate()` を通せば履歴・再描画が自動で効く。→ EditCommands は mutate を使うだけでよい。
2. **イベントバス on/emit**: 編集コマンド実行後の「現在状態の読み取り」は `getProject()`、UI更新は `emit('project')`/`emit('selection')` で完結。
3. **preload の window.api は FROZEN**: ②③が main と話す追加チャネル（MCP往復・LLM呼び出し）は、**preload に新メソッドを追加**して公開する（既存を書き換えるのではなく追加）。
4. **検証ハーネス**: `TCE_DEBUG/TCE_EVAL/TCE_CAPTURE` で renderer 状態をプログラム検証できる。②③の自動テストにも流用可能。

### モデル①側で先に整えておくと良い小改修（任意・低リスク）
- `toggleTrackMute(id)` に加え、値指定の `setTrackMute(id, muted)` を追加（②③のコマンド化で便利）。
- 「任意時刻にテロップ追加」「指定 start にクリップ移動」を `mutate()` ベースの小関数として切り出す（現在は UI 操作に内包）。
- これらは EditCommands から呼ぶ土台になる（00章のカタログ参照）。

---

## 5. リスクと対策

| リスク | 対策 |
|---|---|
| モノレポ移行で import パスが壊れる | フェーズ0で①が従来どおり動くことを Electron eval ハーネスで回帰確認してから②③へ |
| 外部編集（②③）が履歴を汚す/壊す | EditCommands を必ず mutate 経由にし、破壊的操作前に pushHistory |
| preload FROZEN による制約 | 新機能は window.api への**追加**で対応（既存メソッド差し替え不可） |

モデル①は「動く母体」。まずこの土台を `packages/core` 化して維持することが、②③の前提になる。
