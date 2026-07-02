# ClipAI リリース準備 TODO（正本）

## フォーマット契約（/daily はこの規約で本ファイルを消化する）

- 1回の /daily で消化するのは **1タスクのみ**。P0 → P1 → P2 の順に、最初の未着手 `- [ ]` を選ぶ。並び順がそのまま優先順位（人間が編集して並べ替えてよい）。
- マーク: `- [ ]` 未着手 ／ `- [~]` 着手中（最優先で再開） ／ `- [x]` 完了 ／ 行内に `⛔` があるタスクはブロック中（人間の作業・判断待ち）＝スキップする。
- 各タスクは **ID（TXXX）・種別（code/marketing/docs/人間）・完了条件・検証:** を必ず持つ。「検証:」の無いタスクには着手しない。
- 大きすぎる場合（変更ファイル5超・独立成果物が複数・検証がその場で完結しない）は `TXXXa/b/…` に分割して先頭のみ実施。
- 完了したら `- [x]` にし、末尾の進捗ログへ `- YYYY-MM-DD: TXXX 完了。<要約>（<検証結果>）` を追記。実装と本ファイル更新を1コミット（日本語・push しない）。
- 出典表記: `[分析 XX-n]` = docs/エンジニア分析-20260702.md の指摘ID ／ `[戦略 §n]` = docs/marketing/STRATEGY.md のセクション。
- コード規約は CLAUDE.md に従う（vendor/ 不可・依存追加禁止・preload は追加のみ・コード変更後は最低 `npm run test:fast`）。

---

## P0 — リリースブロッカー（戦略ゲート G1 の前提）

- [ ] T001 [code] 配布ビルドを AI 版に切替え、AI 機能は既定 OFF にする [分析 DIST-1][戦略 §5]
  - 完了条件: package.json の main が apps/ai を指し（①〜④の分売はしない）、model=ai でも MCP サーバは自動起動せず「AI接続」メニューから ON にする（初回起動で API キー・ポート待受に遭遇しない）。
  - 検証: `npm test`（smoke base/ai）green ／ `node -e` で main が apps/ai/main.js であることと、ai 起動直後に 127.0.0.1:19790 が閉じていることを確認（tests/lib/launch.js + curl）。

- [ ] T002 [code] 未保存データの消失ガード（close・Cmd+Q・開く・ホームの3択ダイアログ） [分析 UX-1/FG-1/QUA-1]
  - 完了条件: dirty 状態で ウィンドウclose／Cmd+Q／プロジェクトを開く／ホームへ戻る のすべてで「保存して終了／保存せず終了／キャンセル」の3択が出る。preload は新チャネル追加のみ（FROZEN 契約遵守）。
  - 検証: TCE_EVAL で dirty 状態を作り IPC 経路の応答を assert する回帰を tests/ に追加 ＋ `npm test` green（main プロセス変更のため）。

- [ ] T003 [code] 自動バックアップと起動時復元（.tceproj.autosave） [分析 FG-1]
  - 完了条件: dirty 中 60〜120 秒間隔で userData 配下へ自動バックアップし、起動時に検出したら「前回のセッションを復元しますか」を提案する。
  - 検証: TCE_EVAL でバックアップ生成→復元提案→復元内容一致を assert ＋ `npm test` green。

- [ ] T004 [人間] ⛔ Apple Developer Program 登録（年約 $99≒1.5万円） [分析 DIST-2][戦略 §6]
  - 完了条件: Developer ID Application 証明書が Keychain に存在する。
  - 検証: `security find-identity -v -p codesigning` に Developer ID Application が表示される（完了したら ⛔ を外す→T005 が解禁）。

- [ ] T005 [code] ⛔（T004 完了待ち）electron-builder の署名・公証設定 [分析 DIST-2][戦略 §6]
  - 完了条件: mac.notarize・hardenedRuntime・entitlements（ffmpeg/whisper-cli の spawn に必要な項目を検証の上）を設定し、署名・公証済み DMG がビルドできる。
  - 検証: `npm run dist:mac:arm64` 後に `spctl -a -vv dist/mac-arm64/ClipAI.app` が accepted。

- [ ] T006 [code] パフォーマンス計測ハーネス tests/run-perf.js の新設 [分析 PERF-6]
  - 完了条件: TCE_EVAL で合成プロジェクト（150クリップ＋テロップ50）を投入し、emit('project')×50 の合計時間・pushHistory 1回の時間と snapshot サイズ・render(t) 1回の時間を JSON 出力、閾値超過で fail する。
  - 検証: `node tests/run-perf.js` が現状値を出力して green（閾値は現状値+余裕で初期設定）。T007/T030〜/T077 の効果測定の受け口になる。

- [ ] T007 [code] ドラッグ中の全 DOM 再構築＋全再合成を差分更新化 [分析 PERF-1]
  - 完了条件: ドラッグ中は対象クリップの style 更新のみ（軽量イベント新設）とし、'project' の全再構築は pointerup 時に1回。render() は rAF 合流。
  - 検証: `node tests/run-perf.js` の emit×50 が改善（数値を進捗ログに記録）＋ `npm run test:fast` green ＋ スナップ吸着の無回帰（既存テスト）。

- [ ] T008 [code] MCP サーバ HTTP 層の回帰テスト tests/run-mcp.js 新設 [分析 TEST-1]
  - 完了条件: apps/ai を空きポートで起動し、initialize（protocolVersion・Mcp-Session-Id）→ tools/list（20ツール）→ tools/call（read系＋mutate系）→ ジョブ化経路（get_job_status ポーリング）→ 認証（CLIPAI_MCP_TOKEN 設定時の 401）を Node 標準 fetch で assert。
  - 検証: `npm test` に組み込んで green。

## P1 — 品質・洗練＋リリース準備

### 信頼を壊す不具合の修正（クイックウィン）

- [ ] T010 [code] Windows の HW エンコード失敗を修正（エンコーダマップ＋自動リトライ） [分析 WIN-1]
  - 完了条件: platform 別エンコーダ選択（darwin: videotoolbox／win32: nvenc/qsv/amf を検出）＋ HW 失敗時に libx264 で自動リトライしトースト告知。
  - 検証: `npm test`（実FFmpeg書き出し含む）green ＋ エンコーダ選択ロジックの単体 assert（platform 引数化）。

- [ ] T011 [code] 文字起こしキャンセルの実効化 [分析 UX-5]
  - 完了条件: キャンセルで音声抽出・whisper の両プロセスが止まり、以後の結果（テロップ挿入）が破棄される。
  - 検証: `node tests/run-commands.js --fast` green ＋ TCE_EVAL でキャンセルフラグ経路を assert。

- [ ] T012 [code] 書き出しの再入ガードとモーダル中ショートカット無効化 [分析 UX-4]
  - 完了条件: 書き出し中の Cmd+E 再入・Space 再生・編集系ショートカットが全て無効（Escape のみ許可）。main 側も二重 invoke を拒否。
  - 検証: TCE_EVAL で書き出し中フラグ時のキー入力が no-op であることを assert ＋ `npm test` green。

- [ ] T013 [code] トーストがホーム画面の背面に隠れる問題の修正 [分析 UX-2]
  - 完了条件: toast の z-index をホームより上に。「最近のプロジェクト」読込失敗はホーム内にインライン表示（削除確認付き）。
  - 検証: `npm run test:fast` green ＋ TCE_CAPTURE でホーム表示中トーストの視認を確認。

- [ ] T014 [code] AIチャットの永久ハング対策（LLM タイムアウト＋停止ボタン） [分析 QUA-6]
  - 完了条件: postJson に 120 秒タイムアウト、チャット UI に停止ボタン、エラーは日本語メッセージ化。
  - 検証: `npm run test:fast` green ＋ タイムアウト経路の単体 assert（モックサーバ）。

- [ ] T015 [code] MCP ポート競合時の誤った成功表示を修正 [分析 QUA-7]
  - 完了条件: EADDRINUSE でポート+1 を最大5回リトライ、失敗時は CLIPAI_MCP_PORT 案内ダイアログ。start() は listening 確定を返す。
  - 検証: テストでポートを占有した状態の起動で挙動を assert ＋ `npm test` green。

### 見た目と第一印象（README・ブランド・エラー文言）

- [ ] T016 [docs] README を ClipAI 名義で全面改稿 [分析 FG-10/DOC-1][戦略 §7]
  - 完了条件: ①「追加インストール不要・完全オフライン・無料」が冒頭 ②DL 手順と Gatekeeper/SmartScreen 回避手順 ③MCP クイックスタート（claude mcp add ...）④現行 packages/core+apps 構成 ⑤デモ GIF 枠。手動導入記述は開発者向けセクションへ隔離。
  - 検証: 完了条件①〜⑤のセルフチェック ＋ 旧記述（要 PATH／src/ 構成／Telora）の残存ゼロを grep で確認。

- [ ] T017 [code] 旧ブランド「Telop Cut Editor」「Telora」のユーザー可視残存を掃除 [分析 BRAND-1]
  - 完了条件: ダイアログのフィルタ名・ページタイトル等を ClipAI 化（.tceproj 拡張子は後方互換で維持）。
  - 検証: `grep -rn 'Telop Cut\|Telora' packages apps` でユーザー可視箇所ゼロ ＋ `npm run test:fast` green。

- [ ] T018 [code] 素材リンク切れの検出・再リンク導線 [分析 UX-3/QUA-4]
  - 完了条件: プロジェクト読込直後と書き出し前に素材パスを検査（fileExists IPC 追加）、欠落一覧＋「ファイルを選び直す／無視」ダイアログ、ビンに警告バッジ。preview の誤誘導文言（FFmpeg 欠落）も修正。
  - 検証: 欠落プロジェクトの fixture で TCE_EVAL assert ＋ `npm test` green。

- [ ] T019 [code] 無言失敗の可視化（probe 全滅素材・オーバーレイ書き出し欠落） [分析 QUA-5/UX-9]
  - 完了条件: duration<=0 素材は追加を中止しファイル名付き err トースト。書き出し前に合成不能ファイルを列挙して続行確認。
  - 検証: 破損 fixture で TCE_EVAL assert ＋ `npm run test:fast` green。

- [ ] T020 [code] 書き出し失敗時の FFmpeg 生ログを日本語対処文へマップ [分析 PF-2]
  - 完了条件: 代表 stderr パターン（Unknown encoder／No space left／Permission denied／No such file）を日本語の対処文に変換、詳細は折りたたみ＋ログファイル保存。
  - 検証: 各パターンの変換単体 assert ＋ `npm run test:fast` green。

- [ ] T021 [code] 同梱バイナリ解決失敗時のエラーを配布形態に合わせる [分析 PF-1]
  - 完了条件: packaged 時は「再インストール案内」、開発時のみ brew/pip 案内。checkTools が vendor 解決結果を返す。
  - 検証: 分岐の単体 assert ＋ `npm run test:fast` green。

### リリース資材（マーケ・G1〜G3 ゲート準備）

- [ ] T022 [marketing] デモ動画 1b（Claude Code 連携・90秒）の詳細台本と撮影手順書 [戦略 §7 施策1]
  - 完了条件: docs/marketing/demo-1b.md にカット割り・画面収録手順・使用プロジェクト・ナレーション/字幕全文（撮影・編集は人間が実施）。
  - 検証: 台本が戦略 §7 の骨子6項と整合し、登場機能が全て実装済みであることをコードで確認。

- [ ] T023 [marketing] MCP レジストリ登録用の英語 README 1枚 [戦略 §6 チャネル3]
  - 完了条件: docs/marketing/mcp-registry-readme.md（英語・ツール一覧・接続手順・登録先リスト mcp.so/PulseMCP/awesome-mcp-servers）。登録実行は⛔人間。
  - 検証: 記載ツール名が packages/core の実カタログと一致（20ツール）。

- [ ] T024 [code] フィードバック導線: GitHub Issues 日本語テンプレート [戦略 §6]
  - 完了条件: .github/ISSUE_TEMPLATE/（バグ報告・機能要望、環境情報の記入欄付き・日本語）。ペルソナA向け非 GitHub 窓口（フォーム）は⛔人間として別途。
  - 検証: `npm run lint`（YAML/JSON 構文）＋ テンプレの必須項目セルフチェック。

- [ ] T025 [marketing] Gatekeeper／SmartScreen 起動手順ページの下書き [戦略 §6]
  - 完了条件: docs/marketing/install-guide.md に mac（署名前の暫定手順含む）と Windows（SmartScreen 2クリック）の手順文面（スクショ枠指定付き。スクショ撮影は人間）。
  - 検証: 手順が現行 macOS/Windows の実挙動の記述（戦略 §6 の出典）と矛盾しないことのセルフチェック。

- [ ] T026 [docs] Homebrew 独自 tap の作成手順と cask 定義ドラフト [戦略 §6 チャネル1]
  - 完了条件: docs/marketing/homebrew-tap.md に tap リポジトリ構成・cask ルビー定義（sha256 手順込み）・公開手順。tap リポジトリ作成は⛔人間。
  - 検証: cask 定義が `brew style` 相当の構文規約を満たすセルフチェック（DMG の実 URL は placeholder 可）。

- [ ] T027 [人間] ⛔ 種火ユーザー 10〜20人のリクルート [戦略 §6 G1]
  - 完了条件: β配布に協力してくれる初期ユーザーの名簿と連絡手段が揃う。
  - 検証: 人数と回収予定日を進捗ログに記録。

- [ ] T028 [marketing] 窓の杜向けプレスリリース文面ドラフト [戦略 §6/§7 施策3]
  - 完了条件: docs/marketing/press-release.md（G2/G3 通過後に送付。送付は⛔人間）。「日本語UI・完全無料・オフライン無制限文字起こし」軸。
  - 検証: 戦略 §4 の差別化3点と一行ポジショニングを含むセルフチェック。

- [ ] T029 [marketing] 「ClipAI」名称衝突・商標の一次調査 [戦略 §5/§9]
  - 完了条件: docs/marketing/naming-risk.md に同名アプリ一覧・商標DB（J-PlatPat）検索結果・継続/改名の判断材料。最終判断は⛔人間。
  - 検証: 調査ソース URL 明記＋改名する場合のコスト見積もり（コード内の変更点数を grep で概算）を含む。

### 機能ギャップ（乗り換え障壁の解消）

- [ ] T030 [code] 動画クリップの音量調整（UI＋プレビュー＋書き出し） [分析 FG-2]
  - 完了条件: インスペクタの音量が video クリップにも表示され、プレビュー・書き出しの両方に反映される。
  - 検証: `npm test`（実FFmpeg）で音量指定書き出しの ffprobe 検証を追加して green。

- [ ] T031 [code] 文字起こしテロップの自動折り返し・長さ制御 [分析 FG-3]
  - 完了条件: whisper 引数に最大長制御（日本語 18〜24 文字目安）、render-telop に measureText ベースの自動折り返し（プレビュー＝書き出し共通）。
  - 検証: 長文 cue の fixture で折り返し assert ＋ `npm run test:fast` green。

- [ ] T032 [code] 字幕一覧の編集ビュー（テキスト直接編集） [分析 FG-4]
  - 完了条件: 左パネルに「字幕」タブ、時系列リスト、行クリックでシーク＋選択、行内でテキスト編集（プレビュー即時反映）。
  - 検証: TCE_EVAL で編集→getTranscript 反映を assert ＋ `npm run test:fast` green。

- [ ] T033 [code] システムフォント選択 [分析 FG-5]
  - 完了条件: queryLocalFonts でフォント列挙する検索可能セレクト（取得不可時は現行5種へフォールバック）。
  - 検証: TCE_EVAL でフォント設定→テロップ描画反映を assert ＋ `npm run test:fast` green。

- [ ] T034 [code] 文字起こしを EditCommands＋MCP ツール化 [分析 FG-6]
  - 完了条件: transcribe コマンドを EditCommands に追加し、tool-catalog・mcp-server 両カタログへ登録（エージェントから字幕自動生成が可能に）。
  - 検証: `node tests/run-commands.js --stt` でコマンド経路 green（whisper 実走はオプトイン）＋ tests/run-mcp.js にツール数更新。

- [ ] T035 [code] 書き出し WYSIWYG 違反の修正（拡大率>100%・画面端配置） [分析 QUA-2]
  - 完了条件: scale>1／画面外はみ出しも overlay 合成経路に振り分け、pipRect クランプを撤廃。
  - 検証: `npm test` green ＋ TCE_CAPTURE と書き出しフレームの目視比較を進捗ログに記録。

- [ ] T036 [code] テロップアニメの書き出し制限を UI で告知（短期対応） [分析 QUA-3]
  - 完了条件: アニメ選択 UI に「※書き出し時はフェードになります」を表示（本修正は T072）。
  - 検証: `npm run test:fast` green ＋ TCE_CAPTURE で表示確認。

- [ ] T037 [code] テロップ多数時の filter graph 肥大対策 [分析 QUA-8]
  - 完了条件: -filter_complex_script（一時ファイル）化＋重ならないテロップのスプライト統合。100 キュー超の書き出しを npm test に追加。
  - 検証: `npm test`（100キュー回帰含む）green。

### パフォーマンス（T006 の計測値をゲートに）

- [ ] T038 [code] タイムライン仮想化（可視範囲のみ描画） [分析 PERF-2]
  - 完了条件: 可視時間レンジ＋前後1画面のみクリップ・目盛りを生成、スクロールで再生成。
  - 検証: `node tests/run-perf.js` の改善を記録 ＋ `npm run test:fast` green。

- [ ] T039 [code] 停止中の常時 60fps 合成を dirty フラグ制に [分析 PERF-3]
  - 完了条件: 停止中は needsRender 時のみ render（アイドル CPU 削減）。
  - 検証: `node tests/run-perf.js` ＋ 停止中 CPU 使用率の before/after を進捗ログに記録。

- [ ] T040 [code] フィルムストリップのキャッシュ上限（LRU） [分析 PERF-4]
  - 完了条件: 上限付き LRU 化（目安600エントリ）。可能なら ImageBitmap 化。
  - 検証: 長尺 fixture で Map サイズ上限を assert ＋ `npm run test:fast` green。

- [ ] T041 [code] プロキシ生成の進捗・キャンセル・自動生成 [分析 PERF-5]
  - 完了条件: 進捗バー＋キャンセル対応、プロキシ ON 中の新規素材へ自動適用、-threads 制限。
  - 検証: TCE_EVAL で進捗イベント受信を assert ＋ `npm run test:fast` green。

### テスト整備（リリース前の事故防止）

- [ ] T042 [code] 書き出し成果物の内容検証（ffprobe） [分析 TEST-2]
  - 完了条件: 書き出しテストに video/audio ストリーム存在・尺±0.5s・解像度の assert を追加。
  - 検証: `npm test` green。

- [ ] T043 [code] プロジェクト保存/読込の回帰（v1→v2 移行・破損・往復） [分析 TEST-3]
  - 完了条件: v1/v2/破損 の .tceproj fixture 3種と eval セクション追加。
  - 検証: `npm run test:fast` green。

- [ ] T044 [code] tests/run-unit.js 新設（llm-format＋ツールカタログ整合＋モデル名一元化） [分析 TEST-5/TEST-6/QUA-10]
  - 完了条件: Node 単体（Electron 不要）で llm-format の交互制約・カタログ3箇所の一致・スキーマ必須項目を assert。デフォルトモデル名は定数に一元化し現行モデル名へ更新。
  - 検証: test:fast の先頭に組み込み green。

- [ ] T045 [code] chat-orchestrator のフェイク LLM 回帰 [分析 TEST-7]
  - 完了条件: スクリプト化フェイク LLM で tool 実行→反映、確認キャンセルで非実行、ステップ上限を assert。
  - 検証: `npm run test:fast` green。

- [ ] T046 [code] SRT/XML パーサ回帰 [分析 TEST-8]
  - 完了条件: SRT 往復・CRLF/BOM/タグ正規化・不正ブロックスキップ、最小 xmeml 取込の assert。
  - 検証: `npm run test:fast` green。

- [ ] T047 [code] パッケージ済みアプリのスモーク（リリース前チェック用） [分析 TEST-4]
  - 完了条件: tests/run-packaged-smoke.js（npm test には入れず `npm run test:packaged` として dist 成果物を TCE_SMOKE 起動・__errors 空を assert）。
  - 検証: 手元の既存 dist ビルドで green（無ければ dist:mac:arm64 を1回実行）。

### Windows 解禁（戦略ゲート G2）

- [ ] T048 [code] transcribe.js の PATH 連結を platform 対応に [分析 WIN-2]
  - 完了条件: path.delimiter 使用＋EXTRA_PATHS の platform 分岐。
  - 検証: 単体 assert（delimiter 引数化）＋ `npm run test:fast` green。

- [ ] T049 [docs] Windows 実機検証の手順書 [分析 WIN-3]
  - 完了条件: docs/windows-verification.md（インストール→起動→素材読込→文字起こし→通常/HW 書き出し→MCP 接続の確認項目、NSIS 2GB 上限の余裕確認込み）。
  - 検証: 手順の各項目に期待結果が明記されているセルフチェック。

- [ ] T050 [人間] ⛔ Windows 実機での検証実施（T049 の手順書に従う） [分析 WIN-3][戦略 §6 G2]
  - 完了条件: 手順書全項目 PASS（不具合は TODO へ新タスク起票）。
  - 検証: 結果を docs/windows-verification.md に記録。

## P2 — 将来・磨き込み

- [ ] T060 [code] 予期しないエラーのトースト通知（スロットル付き） [分析 UX-6]
  - 完了条件: window error/unhandledrejection で err トースト。mcp-bridge/chat-panel 読込失敗は機能名入りで昇格。
  - 検証: TCE_EVAL で例外→トースト発火を assert ＋ `npm run test:fast` green。
- [ ] T061 [code] トーストの複合メッセージ／スタック表示 [分析 UX-7]
  - 完了条件: importMedia の成功＋スキップを1メッセージに統合、またはスタック表示化。
  - 検証: `npm run test:fast` green。
- [ ] T062 [code] 範囲書き出し確認を3択モーダルに [分析 UX-8]
  - 完了条件: 「選択範囲のみ／全体／中止」の3択＋設定ポップオーバーに状態表示。
  - 検証: TCE_EVAL で3分岐を assert ＋ `npm run test:fast` green。
- [ ] T063 [code] MCP に set_clip ツール追加（音量・速度・フェード・変形） [分析 FG-7]
  - 完了条件: EditCommands＋両カタログ＋undo 対応（T030 が前提）。
  - 検証: tests/run-mcp.js・run-commands.js にケース追加 green。
- [ ] T064 [code] 出力フレームレート選択（30/60fps） [分析 FG-8]
  - 完了条件: 書き出し設定に fps セレクト（既定は素材追従）。
  - 検証: `npm test` の ffprobe 検証に fps assert 追加 green。
- [ ] T065 [code] BGM ループ配置 [分析 FG-9]
  - 完了条件: audio クリップに loop プロパティ（プレビュー剰余再生・書き出し aloop）。
  - 検証: `npm test`（実FFmpeg）にループ書き出しケース追加 green。
- [ ] T066 [code] export.js の死にコード掃除（分割の前段） [分析 QUA-9]
  - 完了条件: 到達不能キャンセル機構・未使用関数を削除しコメントを実態に一致させる。
  - 検証: `npm test` green（分割本体は効果が出る時期に別タスク起票）。
- [ ] T067 [code] undo 履歴のコピーオンライト化（T006 実測が閾値超過の場合のみ） [分析 PERF-7]
  - 完了条件: 変更トラックのみ複製する snapshot に移行、または HISTORY_LIMIT 動的化。
  - 検証: `node tests/run-perf.js` の pushHistory 時間・メモリ改善を記録。
- [ ] T068 [code] 波形ピーク抽出のストリーム畳み込み化 [分析 PERF-8]
  - 完了条件: data イベント内で逐次バケット集約（メモリ O(buckets)）＋同時実行キュー。
  - 検証: 長尺音声 fixture でメモリ上限 assert ＋ `npm run test:fast` green。
- [ ] T069 [code] クロマキー・プレビューの最適化 [分析 PERF-9]
  - 完了条件: sqrt 除去＋停止中キャッシュ（T039 前提）。縮小解像度処理は効果測定の上で判断。
  - 検証: `node tests/run-perf.js` で改善を記録。
- [ ] T070 [code] スナップ関数の export＋ショートカット回帰 [分析 TEST-9]
  - 完了条件: snapTime/snapMoveStart を eval から直接検証、主要ショートカット（分割・削除・undo）の dispatchEvent 回帰。
  - 検証: `npm run test:fast` green。
- [ ] T071 [code] 配布サイズ半減: 同梱モデルの差し替え可能化＋量子化版の精度実測 [分析 DIST-3][戦略 §6]
  - 完了条件: bundledWhisper を「vendor/models 内の最良モデル選択」に一般化し、q5_0（574MB）と large-v3-turbo の日本語精度を同一音声で比較・記録。採否判断の材料を docs/ に残す。
  - 検証: `node tests/run-commands.js --stt` green ＋ 比較結果を docs/model-size-comparison.md に記録。
- [ ] T072 [code] テロップアニメの書き出し本対応（時間サンプリング PNG） [分析 QUA-3]
  - 完了条件: アニメ中 0.1 秒刻みのサブセグメント展開で位置・スケール・reveal を焼き込み（キーフレーム書き出しと同方式）。
  - 検証: `npm test` green ＋ プレビューと書き出しの目視比較を進捗ログに記録。
- [ ] T073 [code] electron-updater と差分更新の調査スパイク [戦略 §6/§9]
  - 完了条件: 1.5GB 級配布での自動更新可否・差分更新の現実性を docs/ に調査メモ化（導入判断は人間）。
  - 検証: 調査メモに結論・根拠 URL・推奨構成が揃っている。
- [ ] T074 [docs] ROADMAP の棚卸し（stale チェックボックス・決め待ち解消） [ROADMAP]
  - 完了条件: 済んでいる「develop へコミット」等を [x] 化、「決め待ち」4項目に現状の事実上の結論を追記。
  - 検証: `npm run lint` green ＋ ROADMAP と実装の矛盾ゼロのセルフチェック。
- [ ] T075 [marketing] デモ動画 1a（GUI 完結・60秒）の台本 [戦略 §7 施策1]
  - 完了条件: docs/marketing/demo-1a.md（ターミナル非登場・ボタン操作のみのカット割り。G2/G3 までに）。
  - 検証: 登場機能が全て実装済み・T031（折り返し）等の依存タスク完了を確認。
- [ ] T076 [marketing] 施策5（バッチ処理）の実装有無検証と凍結判断 [戦略 §7 施策5]
  - 完了条件: 複数ファイル一括の無音・フィラーカットが現行 UX で可能か検証し、不可なら施策凍結を STRATEGY に反映（機能化する場合は新タスク起票）。
  - 検証: 検証手順と結論を docs/marketing/ に記録。
- [ ] T077 [marketing] LP（1枚）の構成案とコピー [戦略 §6 チャネル2/§7 施策4]
  - 完了条件: docs/marketing/lp-draft.md（一行ポジショニング・比較表の一般向け簡略版・最終確認日付き・DL 導線）。
  - 検証: 戦略 §4 の差別化3点と整合するセルフチェック。

---

## 進捗ログ（追記式）

- 2026-07-02: 初版作成。エンジニア分析57件（docs/エンジニア分析-20260702.md）とマーケ戦略（docs/marketing/STRATEGY.md・外部レビュー反映済み）を統合し、P0:8／P1:41／P2:18 タスクに分解。
