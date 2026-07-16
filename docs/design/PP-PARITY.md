# PP-PARITY — Premiere Pro 操作感パリティ バックログ

作成: 2026-07-16（6領域並列コード監査に基づく。監査詳細はセッションログ参照）
目的: ClipAI の機能・操作感を Premiere Pro と遜色ないレベルへ近づける。

## 運用（フォーマット契約）

- このファイルは **PPパリティ改善ループ専用のキュー**。docs/TODO.md（リリース準備）とは独立。
- ループは **P0 → P1 → P2 の先頭未着手 `- [ ]`** から1件ずつ消化する。
- 1タスク = 実装 → 検証（最低 `npm run test:fast`。main プロセス・FFmpeg・export を触ったら `npm test`）→ 日本語1コミットで確定。
- 完了したら `- [x]` に変え、末尾の進捗ログへ「日付 / ID / 要約 / 検証結果」を追記する。
- 規約: 依存追加禁止・preload API は追加のみ・renderer は日本語文字列・vendor/ 不可侵。

## キーマップ方針

総括: 既存キーは全て維持し、PP標準キーは「空いていればそのまま追加」する二重割当方式。J/K/L・I/O・Q/W・X・N・=/-/\\・Cmd+K・Cmd+Shift+K・Shift+Delete・Cmd+A はすべて未割当と実コードで確認済みで無競合追加できる。例外は2つだけ: (1) スナップトグルはPP標準のSが分割(app.js:316)に使用中のためNへ（Sは動かさない）、(2) Shift+矢印は同一キーに1秒と5フレームを同居できないためPP標準の5フレームへ変更し、既存の1秒はCmd+矢印へ移設（機能は失わない・唯一の意味変更としてリリースノート明記）。実装上の鉄則は3つ: ①新キーはapp.js wireKeyboardのtypingガード(309行)より後の単独キー領域に置き、メニュー(main.js buildMenu)には単独キーのacceleratorを登録しない（Space/Deleteの入力妨害バグPP010の再発防止。メニューはlabel表記のみ）。②メニュー新チャンネルはonMenuが汎用パススルー(preload.js:67-70)のためpreload変更不要＝FROZEN制約に抵触しない。③キー追加が一段落したらPP024でKEYMAPテーブルに一元化し、将来の「ClipAI標準/PP互換」プリセット切替の足場とする。なお監査に1件誤りあり: Alt+ドラッグ複製は実装済み(timeline.js:448-461)で新規実装不要。

## P0

- [x] PP001 [M] 可変レート再生基盤とK/Lシャトル（L連打で1→2→4→8倍・K停止）
  - PP挙動: L=順方向再生（連打のたび2倍速へ、最大8倍）、K=停止。Space再生と独立してレートを持ち、レート表示がモニタに出る。
  - 方針: preview.js にモジュール変数 playRate=1 と setPlayRate()/getPlayRate() を export 追加。tick()（preview.js:538）の t 計算を `wallStartT + elapsed * playRate` に変更し、レート変更時は play()/seek() と同じ2行（wallStartPerf/wallStartT の再基準化 preview.js:562-563）を必ず実行。syncBaseVideo/syncVideoTracks/syncAudioClips の playbackRate 設定（監査 L129/L200/L161）を clipSpeed×playRate に。|playRate|>4 は media を pause して render(t) の静止画合成パス＋音声ミュートに切替。app.js wireKeyboard の単独キー領域（app.js:312 以降・typing ガード後）に k/l を配線し、トランスポート横に「×2」等の小ラベルを追加。
  - 対象: packages/core/renderer/js/preview.js, packages/core/renderer/js/app.js, packages/core/renderer/index.html
  - 検証: TCE_EVAL で setPlayRate(2) 後に一定時間の getPlayhead() 増分が約2倍であることを確認。手動で L 連打→K の遷移とA/V追従を確認。npm run test:fast。
  - 競合: J/K/L は未割当で競合なし。唯一の注意は tick が「レート固定1.0」前提で書かれている点（wallStartT 再基準化を漏らすと再生位置が飛ぶ）。
- [x] PP002 [M] J逆再生シャトル（シーク描画方式・J連打で-1→-2→-4倍）
  - PP挙動: J=逆方向再生。順再生中に J で減速→逆転、連打で逆方向倍速。JKL の指の記憶が完結する。
  - 方針: PP001 の playRate 基盤に負値を許容。playRate<0 のとき tick 内で3つの sync 関数を shouldPlay=false 相当で呼び（media は pause 保証）、render(t) の毎フレーム静止画合成のみで描画する（コーデックフォールバック getFfFrame の80枚キャッシュがそのまま効く）。音声は stopAllAudio でミュート。t<=0 到達で playRate=1 に戻して停止。app.js に j キーを配線（L と対称のレートステップ）。カクつきは仕様として許容（PP でも逆再生はプロキシ前提）。
  - 対象: packages/core/renderer/js/preview.js, packages/core/renderer/js/app.js
  - 検証: 手動: J で再生ヘッドが逆走し映像が更新される・0秒で停止する。TCE_EVAL で playRate=-1 時に getPlayhead() が減少することを確認。npm run test:fast。
  - 競合: なし（J は未割当）。PP001 とは同ファイル同関数を触るため直列で実装する。
- [x] PP003 [M] I/Oイン・アウト点（再生ヘッドでマーク・ルーラー表示・Alt+Xクリア）
  - PP挙動: I=イン点、O=アウト点を再生ヘッド位置に設定。シーケンス上部に範囲がハイライト表示され、Opt+X（PP）でクリア。設定した範囲は各種範囲操作の対象になる。
  - 方針: 既存の state.ui.range（setRange state.js:192）と rangeBandEl 表示（timeline.js:372-379）を流用し、state.js に markIn()/markOut() を追加（片側のみ設定時は反対端を 0/totalDuration に補完）。range に source:'io'|'tool' を持たせ、setTool（state.js:189）の「range 以外へ切替で range=null」副作用を source==='tool' のときだけに限定（I/O で打った範囲がツール切替で消えないように）。app.js に i / o / Alt+X を配線。ルーラーにイン/アウトのブラケット記号を描画。既存の btnDeleteRange（範囲リップル削除）がそのまま I/O 範囲にも効くようになる。
  - 対象: packages/core/renderer/js/state.js, packages/core/renderer/js/app.js, packages/core/renderer/js/timeline.js
  - 検証: TCE_EVAL: I/O 押下相当の markIn/markOut 後に getRange() が期待値・ツールを select に戻しても range が残る。手動でバンド表示と Alt+X クリアを確認。npm run test:fast。
  - 競合: Cmd+I=素材読み込み（app.js:305）は修飾キー付きなので単独 I と非競合・両方維持。R の範囲ツールとは同じ range モデルを共有（後から操作した方が勝つ）。
- [x] PP004 [S] スナップのON/OFFトグル（Nキー＋磁石ボタン・永続化）
  - PP挙動: PP は S キーとタイムラインヘッダの磁石アイコンでスナップを随時切替。フレーム微調整の直前に切るのが常套操作。
  - 方針: state.ui.snap（既定 true）を追加し、localStorage 'clipai.snap' で永続化（proxy.js:5,25 の telora.proxy パターン踏襲）。snapTime（timeline.js:280）と snapMoveStart（timeline.js:300）の冒頭で無効時は素通し（snapGuideTime=null で吸着ガイドも消す）。ツールバーに磁石トグルボタン（btnGuides の active クラスパターン app.js:258-259 踏襲）、キーは N を割当。
  - 対象: packages/core/renderer/js/timeline.js, packages/core/renderer/js/state.js, packages/core/renderer/js/app.js, packages/core/renderer/index.html
  - 検証: 手動: N でドラッグ吸着とシアンのガイド線が消える/戻る・アプリ再起動後も状態保持。npm run test:fast。
  - 競合: PP標準の S はスナップだが、本アプリでは S=分割（app.js:316）で使用中。既存キー維持の原則により S は動かさず、N（Final Cut 流・未割当）に割当。ボタンのツールチップに「スナップ (N)」と明記して発見可能性を担保。
- [x] PP005 [S] タイムラインズームのキーボード操作（=/-/\）
  - PP挙動: PP は =/- でタイムラインズームイン/アウト、\ でシーケンス全体表示。ズームは毎分使う基本動作。
  - 方針: wireKeyboard の単独キー領域（app.js:319 のM の後・typing ガード済み位置）に '='/'+'→zoomIn、'-'→zoomOut、'\\'→zoomFit を追加。3関数は timeline.js:602-609 に実装済みで app.js:260-262 が import 済みのため配線のみ。ズーム後は ensurePlayheadVisible で再生ヘッドを見失わないようにする。
  - 対象: packages/core/renderer/js/app.js
  - 検証: 手動: =/-/\ で拡縮・全体フィット。テロップ本文入力中に '-' が文字として入ること（typing ガード）を確認。npm run test:fast。
  - 競合: 表示メニューの Cmd+Plus/Minus（Electron role のページズーム）とは修飾キー有無で区別され競合なし。ページズーム role は差し替えず併存（アクセシビリティ用途を維持）。
- [x] PP006 [S] Cmd+K 分割の追加（既存 Cmd+B / S は維持）
  - PP挙動: PP の「編集点を追加」は Cmd+K。PP 併用ユーザーの指が最初に空振りするキー。
  - 方針: app.js:307 の Cmd+B 分岐直後に `mod && 'k'` → splitAtPlayhead を追加。typing 中の発火は既存 Cmd+B と同挙動に揃える（必要なら app.js:294 の typing 除外リスト検討は別途）。メニュー（main.js:122）は CmdOrCtrl+B のまま変更せず二重アクセラレータ登録を避け、ラベル末尾に「（Cmd+B / Cmd+K / S）」と付記して発見可能性を上げる。
  - 対象: packages/core/renderer/js/app.js, packages/core/main/main.js
  - 検証: 手動: Cmd+K で再生ヘッド位置分割・Cmd+B と S も従来通り。npm test（main プロセスのメニュー文言を触るため）。
  - 競合: Cmd+K は未割当で競合なし。既存3系統（Cmd+B・S・メニュー）は全て維持。
- [x] PP007 [S] Shift+矢印を5フレームへ（PP標準）・既存1秒ジャンプは Cmd+矢印へ移設
  - PP挙動: PP は ←/→=1フレーム、Shift+←/→=5フレーム。細かいカット位置合わせの基本粒度。
  - 方針: app.js:322-323 を `e.shiftKey ? 5/fps : 1/fps` に変更。既存の1秒ジャンプ機能は廃止せず、mod ガード（app.js:310）より前に Cmd+←/→ 分岐を追加して移設（typing 中は除外）。トランスポートの ±1秒ボタン（app.js:229-230）はそのまま残るため導線も維持される。
  - 対象: packages/core/renderer/js/app.js
  - 検証: TCE_EVAL: fps=30 で Shift+→ 相当の seek 後 getPlayhead() 増分が 5/30 秒。手動で Cmd+→=1秒を確認。npm run test:fast。
  - 競合: 唯一の「既存キーの意味変更」項目（同一キーに2つの意味は載せられないため原則の例外）。既存の Shift+矢印=1秒に慣れたユーザー向けに、1秒ジャンプを Cmd+矢印として存続させることで機能は失わない。リリースノートに明記。
- [x] PP008 [M] 選択クリップのキーボードナッジ（Alt+←/→=1フレーム・Alt+Shift=5フレーム）
  - PP挙動: PP はクリップ選択中に修飾キー+矢印でフレーム単位ナッジ。マウスに持ち替えずミリ単位の位置合わせができる。
  - 方針: wireKeyboard に Alt+←/→ を追加：選択があれば mutate() 1回で選択クリップ群の start を ±1/fps（Shift 併用 ±5/fps）移動、選択がなければ何もしない。負方向はグループ内最左クリップが 0 で止まるクランプ（timeline.js:437 と同式）。text クリップは start/end 両方を動かす特例（timeline.js:440 踏襲）。移動後は onUp と同手順（timeline.js:527-536）で各トラック sort → resolveOverwrite（edit.js:21）を実行し、ドラッグ移動と意味論を揃える。mutate 1回に収めて undo 1段を保証。
  - 対象: packages/core/renderer/js/app.js, packages/core/renderer/js/edit.js
  - 検証: TCE_EVAL: クリップ選択→Alt+→ 相当の呼び出しで start が 1/fps 増・Cmd+Z で1回で戻る。重ね合わせ時に resolveOverwrite が効くことを確認。npm run test:fast。
  - 競合: Alt+←/→ は未割当（テキスト欄の単語移動は typing ガードで保護）。PP の Mac 標準は Cmd+←/→ だが本バックログでは1秒ジャンプ（PP007）に使用するため Alt 系（PP の Windows 標準）を採用。
- [x] PP009 [M] Shift+Delete リップル削除（選択クリップの区間を詰める・PPの抽出相当）
  - PP挙動: PP の Shift+Delete（リップル削除）/ 抽出。クリップを消すとギャップが自動で閉じ、後続が左に詰まる。カット編集の心臓。
  - 方針: deleteSelectedRange（edit.js:293）の左詰めロジックを範囲引数版の内部関数 deleteRange(a,b)（makeSub edit.js:285 流用）に抽出し、新設 rippleDeleteSelection() が選択クリップの [start,end] 区間群を統合して後ろから順に適用（mutate 1回で undo 1段）。wireKeyboard の Delete 分岐（app.js:315）に e.shiftKey 分岐を追加。クリップ右クリックメニュー（clipContextItems timeline.js:237-258）に「リップル削除（後続を詰める）」を追加。全トラック横断で詰まる仕様（PPの抽出相当）を toast 文言で明示。deleteRange は PP011/PP013 でも再利用する基盤。
  - 対象: packages/core/renderer/js/edit.js, packages/core/renderer/js/app.js, packages/core/renderer/js/timeline.js
  - 検証: tests/run-commands.js に「2クリップ並び→前をリップル削除→後続 start が前詰め」の回帰ケースを追加。npm run test:fast。
  - 競合: Shift+Delete は未割当。既存 Delete=リフト削除（ギャップ残し）は維持し、2つの削除を右クリックメニュー文言で並べて区別。
- [x] PP010 [S] メニューアクセラレータ Space/Delete の文字入力妨害を解消
  - PP挙動: PP ではテキスト編集中にショートカットが奪われることはない。テロップ入力中に Space で再生が走る/Delete でクリップが消えるのは毎分レベルの信頼性問題。
  - 方針: buildMenu の Space（main.js:121）と Delete（main.js:125）の accelerator を撤去し、label に「（Space）」「（Delete）」を付記して表示だけ残す。実発火は renderer の typing ガード付き keydown（app.js:309,312,315）に一本化（既に両キーとも実装済みなので main.js の2行変更のみ）。Cmd 系の二重定義（B/S/O/E/I/T）はメニュー側が先取りするだけで実害がないため今回は据え置き、app.js:296-307 に「メニュー側が正」のコメントを追記。
  - 対象: packages/core/main/main.js, packages/core/renderer/js/app.js
  - 検証: 手動: テロップ本文 textarea でスペース・Backspace/Delete が正常に文字入力として機能し、フォーカス外では従来通り再生/削除。メニュークリックからの再生/削除も動作。npm test（main プロセス変更のため）。
  - 競合: なし（キーの移動ではなく発火経路の一本化）。メニューにキー表記が残るため発見可能性は落ちない。

## P1

- [x] PP011 [M] Q/W リップルトリム（再生ヘッドまで前/後を詰めてカット）
  - PP挙動: PP の Q=前の編集点から再生ヘッドまでをリップルトリム、W=再生ヘッドから次の編集点まで。ジェットカット編集の最速手段。
  - 方針: PP009 で抽出した deleteRange(a,b) を流用。Q: targetClipAtPlayhead（edit.js:50）で対象クリップを特定し deleteRange(clip.start, playhead)、W: deleteRange(playhead, clipEnd(clip))。端 MIN_CLIP ガードは cutBefore/cutAfter（edit.js:99,115）と同基準。wireKeyboard の単独キー領域に q/w を追加。既存 A/D（非リップル）はそのまま維持し、toast 文言を「詰めてカット」（Q/W）と「トリムのみ」（A/D）で書き分ける。
  - 対象: packages/core/renderer/js/edit.js, packages/core/renderer/js/app.js
  - 検証: tests/run-commands.js に Q/W 相当の回帰（後続クリップの start が詰まる）を追加。TCE_EVAL で speed≠1 クリップでも in/out が破綻しないこと。npm run test:fast。
  - 競合: Q/W は未割当。A/D と機能が隣接するため UI 文言での区別が必須（キー自体の競合はなし）。
- [x] PP012 [M] イン-アウト補助操作（Shift+I/Oジャンプ・X=クリップをマーク・Shift+Space=イン-アウト再生）
  - PP挙動: PP は Shift+I/O でイン/アウトへジャンプ、X で再生ヘッド下のクリップをイン-アウトにマーク、イン-アウト間だけを再生して確認できる。
  - 方針: PP003 の I/O 基盤上に追加。Shift+I/Shift+O=getRange() の start/end へ seek。X=targetClipAtPlayhead（edit.js:50）のクリップ範囲を markIn/markOut に設定。Shift+Space=イン-アウト間再生: preview.js に playRange(a,b) を追加（seek(a,{play:true}) ＋ tick（preview.js:539）の停止判定に stopAt を追加し b で自動停止、通常再生時は stopAt=null）。
  - 対象: packages/core/renderer/js/app.js, packages/core/renderer/js/preview.js, packages/core/renderer/js/state.js
  - 検証: 手動: X→Shift+Space でクリップ区間だけ再生され末尾で停止。TCE_EVAL で stopAt 到達後 isPlaying()===false。npm run test:fast。
  - 競合: X 単独は未割当（Cmd+X 切り取りとは修飾キーで区別）。Shift+Space も未割当。tick の停止判定（totalDuration 到達 preview.js:539）に条件を足すため PP001/PP002 の後に実装する。
- [x] PP013 [M] ギャップの右クリック「ギャップを詰める（リップル削除）」
  - PP挙動: PP はクリップ間のギャップを右クリック→リップル削除で一発で詰められる。
  - 方針: トラック行の空白部に contextmenu リスナを追加（現状は クリップ timeline.js:227 と素材 media.js:297 のみ）。クリック時刻 t のトラックで clipAtTimeOnTrack が null なら前後クリップから gap=[prevEnd, nextStart]（先頭ギャップは [0, firstStart]）を算出し、PP009 の deleteRange(gap) を実行。他トラックのクリップがその区間に重なる場合は詰め幅を安全側にクランプ（全トラックの重なりチェック）。context-menu.js に disabled 対応を最小追加し、ギャップ以外では項目を減色表示。
  - 対象: packages/core/renderer/js/timeline.js, packages/core/renderer/js/edit.js, packages/core/renderer/js/context-menu.js
  - 検証: 手動: 2クリップ間の空白を右クリック→詰める→後続が前詰め・Cmd+Z で復元。npm run test:fast。
  - 競合: なし。マーキー選択（startBodyDrag timeline.js:345）とはボタン種別（右クリック）で分離。
- [x] PP014 [S] マーカーをスナップ候補に追加＋リップル時のマーカー追従
  - PP挙動: PP はマーカーにもクリップが吸着し、リップル編集でマーカー位置も追従する。
  - 方針: snapTime（timeline.js:282）と snapMoveStart（timeline.js:302）の候補配列に getProject().markers の各 t を追加（2行×2箇所）。あわせて PP009 の deleteRange(a,b) 内で markers を処理: t>=b は len 分左シフト、a<=t<b は削除（現状 deleteSelectedRange は p.tracks しか触らずマーカーがズレたまま残る既知バグの修正を兼ねる）。
  - 対象: packages/core/renderer/js/timeline.js, packages/core/renderer/js/edit.js
  - 検証: 手動: マーカー近傍へドラッグで吸着ガイドが出る。TCE_EVAL: マーカーより前を範囲リップル削除→マーカー t が len 分減る。npm run test:fast。
  - 競合: なし。
- [x] PP015 [S] Shift+マーキーで追加選択＋Cmd+A 全選択
  - PP挙動: PP は Shift+ドラッグで既存選択に追加、Cmd+A でシーケンス内全クリップ選択。
  - 方針: startBodyDrag（timeline.js:345-349）で e.shiftKey を drag.additive に保持し、selectClipsInBox（timeline.js:362-370）で置換でなく getSelectedIds() と統合して setMultiSelection。Cmd+A は wireKeyboard の mod 領域に追加し、typing 中は OS の全選択に委譲（app.js:294 の除外リストに 'a' を追加）。全トラックの全クリップ id を setMultiSelection（state.js:140-145）へ。
  - 対象: packages/core/renderer/js/timeline.js, packages/core/renderer/js/app.js
  - 検証: 手動: マーキー→Shift+マーキーで選択が増える・Cmd+A で全選択・テキスト欄内 Cmd+A は文字全選択のまま。npm run test:fast。
  - 競合: Cmd+A は未割当。typing 除外リスト（app.js:294）への追加を忘れるとテキスト全選択を奪うため必須。
- [x] PP016 [M] トラックロック（🔒トグル・編集操作からの保護）
  - PP挙動: PP はトラックヘッダの鍵アイコンでロックし、ロック中のトラックはドラッグ・トリム・削除・上書きの対象外（斜線表示）。
  - 方針: track.locked を追加（undefined=false なので既存プロジェクト JSON と互換・undo スナップショットもそのまま通る）。トラックヘッダのミュートボタン並び（timeline.js:132-137）に 🔒 トグルを追加し、ロック行は CSS 斜線背景。ガード挿入点: startClipDrag（timeline.js:385・選択のみ許可）、HTML5 ドロップ（timeline.js:154-163）、moveClipVertically の行判定（trackRowAtY 先で locked 行スキップ）、deleteSelection/deleteRange/resolveOverwrite（edit.js・ロック行は変更対象から除外→リップル時は詰めずに据え置き）、findFreeSlot（media.js:242）と placeBumped（edit.js:213）の探索からロック行を除外。edit.js 共有関数で守るため MCP/AI 経路にも同時に効く。
  - 対象: packages/core/renderer/js/state.js, packages/core/renderer/js/timeline.js, packages/core/renderer/js/edit.js, packages/core/renderer/js/media.js
  - 検証: tests/run-commands.js にロック行への deleteClip/moveClip が拒否されるケースを追加。手動でドラッグ・トリム・ドロップ不可を確認。npm run test:fast。
  - 競合: リップル削除（PP009/PP011）との整合が論点: ロック行は詰めない仕様（PPのシンクロックOFF相当）とし、toast で「ロック中のトラックは詰めません」と明示。
- [x] PP017 [M] 映像トラックの表示ON/OFF（目アイコン）
  - PP挙動: PP はトラックの目アイコンで映像出力をトグルし、下のレイヤーだけを確認しながら編集できる。
  - 方針: track.hidden を追加し、トラックヘッダ（timeline.js:132-137 のボタン並び）に 👁 トグル（visual トラックのみ表示）。preview.js render()（監査 L384-450）の下→上トラック合成ループで hidden をスキップ（hitBoxes にも積まないので誤クリックも防げる）。書き出し反映は export のフィルタ構築に1箇所スキップを足すが、2時間を超える場合はプレビューのみ先行しツールチップに「プレビューのみ」と明示して分割。
  - 対象: packages/core/renderer/js/state.js, packages/core/renderer/js/timeline.js, packages/core/renderer/js/preview.js
  - 検証: 手動: 上位トラックの目を OFF→プレビューから消え、クリック当たり判定も下のクリップに抜ける。TCE_CAPTURE で表示OFF前後のキャプチャ比較。npm run test:fast。
  - 競合: 音声ミュート（toggleTrackMute state.js:451-459）とはボタン・フィールドとも独立させ、既存のミュート挙動は変更しない。
- [x] PP018 [S] タイムコード直接入力（再生ヘッド位置の数値ジャンプ）
  - PP挙動: PP はプログラムモニタのタイムコードをクリックして数値入力→その位置へジャンプ。+/-入力で相対移動もできる。
  - 方針: playheadTimeEl（timeline.js:271）をクリックで input 要素に差し替え、Enter で parse して seek、Esc/blur で表示に復帰。受理形式: '90'（秒）・'1:23'・'1:23.15'（分:秒.小数）・'+2'/'-0.5'（相対）。フォーカス中は input 要素なので isTyping ガード（app.js:282-287）が自動で効き、単独キーショートカットと干渉しない。パースは 10行程度の純関数にして単体テスト可能に。
  - 対象: packages/core/renderer/js/timeline.js
  - 検証: 手動: 表示クリック→'1:30' Enter で 90 秒へ・'+5' で相対移動・Esc で取消。パース純関数は tests/ の Node 標準 assert で回帰。npm run test:fast。
  - 競合: なし。
- [x] PP019 [S] Cmd+Shift+K 全トラック一括分割
  - PP挙動: PP の Cmd+Shift+K は再生ヘッド位置で全トラックに編集点を追加（複数レイヤーの一括ジェットカット準備）。
  - 方針: splitAtPlayhead（edit.js:63-90）の分割本体を clip 引数版 splitClipAt(track, clip, t) に抽出し、既存関数と新設 splitAllAtPlayhead() の両方から呼ぶ。新設側は mutate 1回で全トラックの clipAtTimeOnTrack(t)（state.js:236）に該当する全クリップを分割（端 MIN ガードで自然にスキップ、ロック行は PP016 導入後スキップ）。wireKeyboard の mod 領域に Cmd+Shift+K を追加し、メニュー「編集」にも項目追加。
  - 対象: packages/core/renderer/js/edit.js, packages/core/renderer/js/app.js, packages/core/main/main.js
  - 検証: tests/run-commands.js に3トラック重なり状態での一括分割回帰を追加（クリップ数が期待通り増える・undo 1段）。npm run test:fast。
  - 競合: Cmd+Shift+K は未割当。splitAt コマンド（edit-commands.js）の既存挙動（単一クリップ分割）は変更しない。
- [x] PP020 [S] 編集メニューの整備（undo/redo・コピー系・リップル削除・ズームをメニューに露出）
  - PP挙動: PP は全操作がメニューバーに並び、ショートカット未習得ユーザーでもマウスで到達できる（発見可能性）。
  - 方針: buildMenu の「編集」に 取り消し/やり直し・コピー/貼り付け/切り取り/複製・リップル削除、「表示」にタイムラインの拡大/縮小/全体表示（menu-zoom-in/out/fit チャンネル新設）を追加。onMenu は汎用パススルー（preload.js:67-70）のため preload 変更不要＝FROZEN 制約に抵触しない。wireMenu（app.js:265-280）に対応ハンドラを追加。undo/redo は accelerator を付けず label 表記のみ（メニューに載せるとテキスト欄の OS ネイティブ undo を奪うため・PP010 と同方針）。
  - 対象: packages/core/main/main.js, packages/core/renderer/js/app.js
  - 検証: 手動: メニューから各操作が実行できる・テキスト欄で Cmd+Z が文字 undo のまま。npm test（main プロセス変更のため）。
  - 競合: undo/redo にアクセラレータを付けると renderer の typing 委譲（app.js:294）が無効化されるため「表記のみ」とする点が唯一の設計制約。
- [x] PP021 [M] 複数選択クリップのグループ縦移動（まとめて別トラックへ）
  - PP挙動: PP は複数クリップを掴んで上下のトラックへまとめて移動できる（相対レイヤー関係を維持）。
  - 方針: onMove の group 分岐（timeline.js:433-446）に縦移動を追加: primary の行 delta（trackRowAtY timeline.js:551-560 の現在行−開始行）を求め、全選択クリップの移動先行が存在し kind 互換（trackCompatible timeline.js:563-565）の場合のみ全員を delta 行ぶん移す（1つでも不可なら縦は据え置き＝PPと同じ全員一致ルール）。groupOrig に元トラック id も保持。新規トラック自動生成（spawnedTopId timeline.js:577-588）は primary のみに制限。onUp のグループ resolveOverwrite（timeline.js:527-532）は既に全トラック走査なので変更不要。
  - 対象: packages/core/renderer/js/timeline.js
  - 検証: 手動: 2クリップ選択→上ドラッグで両方が1段上のトラックへ・音声混在選択では縦移動しない。Cmd+Z で1段復元。npm run test:fast。
  - 競合: drag 状態機械（timeline.js:33 の単一オブジェクト）への追加のため、Alt+複製（drag.clipId 差し替え timeline.js:449-461）との併用時は group が優先（既存仕様どおり group 分岐が先に return）であることをコメントで固定。

## P2

- [x] PP022 [M] 動画クリップの音量調整（インスペクタ＋プレビュー反映）
  - PP挙動: PP はクリップ単位のオーディオゲインを動画クリップにも適用できる。BGM と被る本編音声を下げる毎日の操作。
  - 方針: inspector.js:110 の音量スライダー表示条件を kind==='audio' から ['audio','video'] に緩和（clip.volume フィールドは splitAtPlayhead edit.js:81 が既に引き継いでおりモデル互換）。プレビュー: syncBaseVideo のフェード追従音量（監査 L134-137）と syncVideoTracks の音量計算に (clip.volume ?? 1) を乗算。書き出しの FFmpeg 音声フィルタへの反映は別タスクに切り出し可能とし、未反映の間はスライダー横に「書き出しには未反映」と明示。
  - 対象: packages/core/renderer/js/inspector.js, packages/core/renderer/js/preview.js
  - 検証: 手動: 動画クリップ選択→音量 50%→プレビュー音量が下がる・undo で戻る。syncFields（inspector.js:383-410）への refKey 追記漏れがないかスクラブ追従を確認。npm run test:fast。
  - 競合: なし。トラックミュート（toggleTrackMute）とは乗算関係で共存。
- [x] PP023 [M] コンテキストメニュー強化（ショートカット表記・disabled・矢印キー操作）
  - PP挙動: PP の右クリックメニューは各項目にショートカットが併記され、実行不能な項目はグレーアウト、キーボードでも選べる。
  - 方針: context-menu.js の item 形式に {shortcut, disabled} を追加（右端に薄色でキー表記・disabled は click 無効＋減色）、onKey（context-menu.js:14）を拡張して ArrowUp/Down で項目ハイライト・Enter で実行。呼び出し元 clipContextItems（timeline.js:237-258）と media.js:297-305 に shortcut 文字列（'S'・'Shift+Del' 等）を付記。部品と全呼び出し元の同時改修になるため、item 形式は後方互換（新キーは省略可）に保つ。
  - 対象: packages/core/renderer/js/context-menu.js, packages/core/renderer/js/timeline.js, packages/core/renderer/js/media.js
  - 検証: 手動: 右クリック→矢印キーで選択→Enter 実行・Escape で閉じる・shortcut 表記の描画確認。npm run test:fast。
  - 競合: なし（部品の後方互換を維持するため既存呼び出しはそのまま動く）。
- [x] PP024 [M] ショートカット一覧オーバーレイ（?キー）とキーマップの一元テーブル化
  - PP挙動: PP はキーボードショートカットの一覧・検索画面を持つ。習得コストを下げ、PP互換キーの発見可能性を担保する。
  - 方針: app.js の wireKeyboard に散在する割当を KEYMAP テーブル（key/modifier/説明/ハンドラ）に一元化し、if 連鎖をテーブル駆動に置換（評価順序は配列順で従来を保存）。'?'（Shift+/）で半透明オーバーレイに一覧をカテゴリ表示（Esc/再押下で閉じる）。このテーブルが将来の「ClipAI標準/PP互換」プリセット切替の足場になる。
  - 対象: packages/core/renderer/js/app.js, packages/core/renderer/index.html
  - 検証: 全キーの回帰が対象: TCE_EVAL で主要キー（Space/S/Q/W/I/O/JKL）のハンドラ発火を確認＋手動一巡。npm run test:fast。
  - 競合: '?' は未割当。テーブル化は挙動不変のリファクタを含むため、P0/P1 のキー追加が一段落した後に実施する（先にやると全項目とコンフリクトする）。
- [x] PP025 [M] スクラブオーディオ（ルーラードラッグ中の音出し・設定でON/OFF）
  - PP挙動: PP はタイムラインスクラブ中に音声が追従再生され、耳でカット点を探せる。
  - 方針: drag.kind==='scrub' の連続 seek（timeline.js:412）中に、ベース動画 <video> を currentTime 設定後 60〜90ms だけ play→pause するマイクロ再生をデバウンス実行（preview.js に scrubAudioTick(t) を追加し seek から呼ぶ）。音声トラックは対象外（ベース音声のみ）で実装を1〜2時間に収める。localStorage 'clipai.scrubAudio'（既定 OFF）でトグルし、設定は書き出し設定ポップオーバー付近に置く。
  - 対象: packages/core/renderer/js/preview.js, packages/core/renderer/js/timeline.js, packages/core/renderer/js/app.js
  - 検証: 手動: 設定ON→ルーラードラッグで断続的に音が鳴る・OFF で無音・ドラッグ終了後に再生状態が汚れない（isPlaying false のまま）。npm run test:fast。
  - 競合: syncBaseVideo のドリフト補正（許容 0.04/0.12s）と play/pause が競合し得るため、マイクロ再生中は同期チェックをスキップするフラグを立てる。
- [x] PP026 [M] トラック高さの3段階切替（S/M/L・波形とサムネの視認性向上）
  - PP挙動: PP はトラック高さを自由に変えられ、波形を拡大して無音や息継ぎを目視できる。
  - 方針: TRACK_H 固定値（timeline.js:20 visual:64/audio:54）を state.ui.trackScale（'s'|'m'|'l'、localStorage 'clipai.trackScale'）から算出する trackH(kind) 関数に置換。参照箇所（行描画・trackRowAtY timeline.js:551-560・マーキー判定）を関数経由に統一。ツールバーに高さ切替ボタン。CSS の行高も CSS 変数化して同期。
  - 対象: packages/core/renderer/js/timeline.js, packages/core/renderer/js/state.js, packages/core/renderer/index.html, packages/core/renderer/styles
  - 検証: 手動: 3段階切替で行高・縦ドラッグのトラック判定・マーキー選択が全て追従する。再起動後も保持。npm run test:fast。
  - 競合: trackRowAtY が高さ定数に依存しているため、置換漏れがあると縦ドラッグの行判定だけズレる（参照箇所の grep 網羅を verify に含める）。
- [x] PP027 [M] イン-アウト範囲のみ書き出し（ワークエリア書き出し）
  - PP挙動: PP はイン-アウトを打った範囲だけを書き出せる（長尺から一部だけ納品する定番フロー）。
  - 方針: 書き出し設定ポップオーバー（wireTopbar app.js:116-163）に「イン-アウト間のみ書き出す」チェックを追加（getRange() が有効な時だけ活性）。第一段は低リスクの後段トリム方式: 通常書き出し完了後に FFmpeg の -ss/-t でコピートリム（再エンコードなし・数秒）して範囲外を落とす。合成時間軸自体を [a,b] に平行移動する本格版は効果測定後に別タスク化。
  - 対象: packages/core/renderer/js/app.js, packages/core/renderer/js/state.js
  - 検証: npm test（実FFmpeg書き出しを含むフル）＋手動: I/O を打って書き出し→出力尺が範囲長と一致（±1フレーム）。
  - 競合: FFmpeg系の重い改修を避ける制約に配慮し「後段コピートリム」方式を採用（書き出しパイプライン本体は不変更）。
- [x] PP028 [S] moveClip コマンドの上書き解決を GUI と統一（MCP/AI経路の重複クリップ防止）
  - PP挙動: PP では移動手段によらず上書き編集の意味論は一貫している。ClipAI では AI/MCP 経由の moveClip だけ重なりが残る非一貫がある。
  - 方針: edit-commands.js の moveClip（edit-commands.js:81-106）末尾に、GUI ドラッグの onUp（timeline.js:535）と同じ track.clips.sort → resolveOverwrite(track,[id]) を追加。3経路（GUI/MCP/AIチャット）の意味論が揃う。HANDLERS のシグネチャ・戻り値形式（{ok,result}）は不変更なので API 互換は保たれる。
  - 対象: packages/core/renderer/js/commands/edit-commands.js, tests/run-commands.js
  - 検証: tests/run-commands.js に「moveClip で既存クリップに重ねる→重複区間が上書き解決される」回帰を追加。npm run test:fast（コマンド回帰込み）。
  - 競合: preload API は不変更（renderer 内のコマンド実装のみ）。MCP クライアントから見ると挙動が「重なったまま」→「上書き」に変わるため、docs の MCP コマンド仕様に1行追記。
- [x] PP029 [S] オーディオソロ（Sボタン・プレビュー専用）
  - PP挙動: PP はトラックのソロボタンで特定トラックだけを聴ける（BGM を消して声だけ確認する等）。
  - 方針: track.solo を追加し、トラックヘッダのミュートボタン隣に「S」トグル（audio トラックとベース visual トラックに表示）。syncAudioClips（監査 L149-169）と syncBaseVideo の可聴判定を「solo が1つでも立っていれば solo トラックのみ可聴」に変更（ミュートより優先）。書き出しには影響しないプレビュー専用と明記。
  - 対象: packages/core/renderer/js/state.js, packages/core/renderer/js/timeline.js, packages/core/renderer/js/preview.js
  - 検証: 手動: BGM トラックと本編音声でソロ切替→対象のみ可聴・解除で全復帰・書き出し結果は不変。npm run test:fast。
  - 競合: トラックミュート（toggleTrackMute state.js:451-459）との優先順位（ソロ > ミュート）を preview 側の1関数に集約して二重条件の分散を防ぐ。

- [ ] PP030 [M] wireKeyboard の KEYMAP テーブル駆動化（プリセット切替の足場）
  - PP挙動: PP はキーボードレイアウトのプリセット切替を持つ。将来の「ClipAI標準 / PP互換」切替の基盤。
  - 方針: PP024 で作った表示用カタログ SHORTCUTS とは別に、wireKeyboard の if 連鎖を match/run のテーブル駆動に置換（評価順序は配列順で完全保存）。挙動不変のリファクタのため、既存の TCE_EVAL 一式（jkl/io/batch2〜7/overlay）を全部通すことを完了条件とする。
  - 対象: packages/core/renderer/js/app.js
  - 検証: 過去の全 eval スクリプト再実行＋npm run test:fast。
  - 競合: なし（純リファクタ）。

## 進捗ログ（追記式）

- 2026-07-16 / PP001+PP002 / J·K·Lシャトル実装（L:1→2→4→8倍、J:-1→-2→-4倍、K:停止。4倍以下順方向はネイティブ再生・それ以外はシーク描画、レート表示ラベル追加、Space/シークでシャトル解除）/ TCE_EVAL実測: 2倍速=1.96秒/秒・K後増分0・逆再生-0.59秒/秒・レンダラエラー0、test:fast 30アサート全緑
- 2026-07-16 / (ハーネス) / TCE_SMOKE・TCE_EVAL・TCE_CAPTURE を TCE_DEBUG なしの単独指定でも有効化（従来はTCE_DEBUG必須で、忘れると自動終了せずハングしていた）/ npm test 全緑
- 2026-07-16 / PP003 / I/Oイン・アウト点（I=イン・O=アウト・Alt+X=クリア。片側のみ打つと反対端は0/全体尺で補完。既存rangeモデル共有でsource:'io'の範囲はツール切替でも消えず、範囲削除ボタンがそのまま効く。帯はルーラーまで伸びブラケット表示）/ TCE_EVAL実測: I@1s→[1,9]・O@7s→[1,7]・Escape後も保持・Alt+Xでクリア・エラー0、test:fast 30アサート全緑
- 2026-07-16 / PP004+PP005+PP006+PP007 / スナップトグルN（磁石ボタン・localStorage永続化・OFF時はガイド線も抑制）／ズームキー =/-/\（\=全体フィット・ズーム後は再生ヘッド追従）／Cmd+K分割追加（Cmd+B・S維持、メニューに併記）／矢印粒度をPP標準化（Shift+←→=5コマ、旧1秒はCmd+←→へ移設） / TCE_EVAL実測: 1コマ0.03s・5コマ0.20s・Cmd1.00s・分割1→2・スナップON/OFF/永続化・ズーム80→64→80px+フィット、npm testフル全緑（同一ファイル交差のため4件を1コミットに統合）
- 2026-07-16 / PP008+PP009+PP010 / Alt+←→ナッジ（1コマ・Shiftで5コマ・mutate1回=undo1段・ドラッグと同じ上書き解決）／Shift+Deleteリップル削除（選択クリップ区間を統合し全トラック左詰め・右クリックメニューにも追加・共通コアextractRangeInPlaceを抽出）／メニューのSpace/Deleteアクセラレータ撤去（テキスト入力からのキー奪取を解消・ラベルにキー表記残し）。既存バグ修正: 範囲リップル削除でテキストクリップのendが未シフトで尺が伸びる問題 / TCE_EVAL実測: リップル後240px→0・ナッジ2.67px/16px・undo2段復帰・エラー0、npm testフル全緑
- 2026-07-16 / PP011+PP012+PP013 / Q/Wリップルトリム（クリップ先頭〜ヘッド／ヘッド〜末尾を詰めてカット・Q後はヘッドを編集点へ）／I-O補助（Shift+I/O=イン/アウトへジャンプ・X=ヘッド下クリップをマーク・Shift+Space=イン-アウト間再生で自動停止 playStopAt）／ギャップ右クリック「詰める」（他トラック食い込みは安全側クランプ・内容削除ゼロの純粋左詰めのみ許可・コンテキストメニューにdisabled対応追加）。改善: targetClipAtPlayhead が選択なし時に上位トラックへフォールバック（テロップのみのプロジェクトでQ/W/X/分割が効くように） / TCE_EVAL実測: X=[0,240]マーク・Q後[0,160][160,240]+ヘッド0・W後[0,80]・範囲再生1.5→2.00自動停止・ギャップ1.0秒詰め、test:fast全緑
- 2026-07-16 / PP014+PP015+PP016+PP017 / マーカーをスナップ候補に追加＋リップル時に追従（範囲内は削除・後方はシフト）／Shift+マーキー追加選択＋Cmd+A全クリップ選択（テキスト編集中はOSに委譲）／トラックロック🔒（ドラッグ・トリム・選択・マーキー・Cmd+A・配置・リップル・ドロップの対象外／PPと同じくロック層はリップルで動かない）／映像トラック表示OFF👁（プレビュー合成と書き出しの両方から除外・ベースは不可） / TCE_EVAL実測: マーカー320→80px追従・Cmd+A=2・ロック中選択0＋Q無効・👁クラストグル、test:fast全緑
- 2026-07-16 / PP018+PP019+PP020 / タイムコード直接入力（時間表示をダブルクリック→ 90 / 1:30 / 0:15.5 形式でジャンプ・不正入力は拒否・Enter/Escape/blurで閉じる）／Cmd+Shift+K 全トラック一括分割（ロック中トラック除外・mutate1回=undo1段・メニューにも追加）／編集メニュー整備（undo/redo・コピー/貼り付け/複製・リップル削除・全トラック分割をラベルのキー表記付きで追加、表示メニューにタイムラインズーム3項目。accelerator は付けず renderer の typing ガードに一本化＝PP010方針の踏襲） / TCE_EVAL実測: 一括分割2→4・undo1回で2・タイムコード2.5sジャンプ・不正入力無視、blur二重removeバグを検証で捕捉し修正、npm testフル全緑
- 2026-07-16 / PP021 / 複数選択クリップのグループ縦移動（primaryの行差分を原点行基準で全員に適用・1つでも移動先が無い/非互換なら全員据え置き=PPの全員一致ルール・グループでは新規トラック自動生成なし・ロック行はtrackCompatibleで自動除外） / TCE_EVAL実測: 2クリップが[2,0,0,0]→[0,2,0,0]へ一括移動・Cmd+Z一発で復元・エラー0、test:fast全緑 ※これでP1完了（21/29）
- 2026-07-17 / PP022+PP028+PP029 / 動画クリップの音量調整（インスペクタのスライダーを video にも表示・プレビューはベース動画含め volume×フェード反映・書き出しも expandClipForExport に volume を追加してベース動画音声まで反映）／moveClip コマンドに GUI と同じ resolveOverwrite を追加（GUI/MCP/AIチャット3経路の上書き意味論を統一・tests に重複なし回帰を追加・02-local-mcp.md に仕様追記）／オーディオソロ S ボタン（全トラック・ソロ＞ミュートの可聴判定 trackAudible をpreviewに集約・プレビュー専用） / 検証: ソロボタン4つ・トグルon/off・エラー0、npm test フル36アサート全緑（実FFmpeg書き出し互換確認込み）
- 2026-07-17 / PP024+PP027 / ショートカット一覧オーバーレイ（?キーで開閉・Escでも閉じる・6カテゴリ34行のカタログ表示・背景クリックで閉じる・トランスポートのヒント行にも案内追加）。if連鎖のテーブル駆動化は回帰リスク対効果からPP030として分離／イン-アウト範囲書き出しは既実装（renderer getRange()→FFmpeg trim/atrim）を確認し、I/O打点がそのまま効くことと確認ダイアログの文言をイン-アウト用語に改善 / TCE_EVAL実測: overlay 6グループ34行・?/Esc/再押下で開閉・エラー0、test:fast全緑
- 2026-07-17 / PP023+PP026 / コンテキストメニュー強化（ショートカット右端表記・↑↓で項目ハイライト・Enter実行・Escで閉じる・メニュー表示中の矢印キーはタイムラインへ漏れない・disabled対応は実装済みを流用）／トラック高さ3段階切替（ツールバー「高さ:小/中/大」ボタン・44/64/96px・localStorage永続化・クリップはtop/bottom固定で自動追従・trackRowAtYはrect実測のため縦ドラッグ判定も自動追従） / TCE_EVAL実測: ctx-key6件・フォーカス移動・arrowLeak=false・Enter実行・高さ64→96→44→64、test:fast全緑
- 2026-07-17 / PP025 / スクラブオーディオ（ルーラードラッグ中にベース動画の音を短く発声・scrubAudioUntilで停止ループと共存・ソロ/ミュートの可聴判定に追従・ツールバー🔉トグルで永続化・プレビュー専用） / 検証: トグル永続化・エラー0、累積回帰（jkl/overlay/batch4）全緑、npm testフル36アサート全緑
- 2026-07-17 / (完了宣言) / PP001〜PP029 の29項目完了。PP030（キーマップのテーブル駆動化）のみ「UX変化ゼロの純リファクタ・回帰リスク対効果」から意図的に保留（プリセット切替機能を実装する際に着手する）。ループはここで一区切り。再開は /loop で。
