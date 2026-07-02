# ClipAI マーケティング戦略

最終更新: 2026-07-02（product-strategist / business-analyst の批判的レビューを反映）／ 対象: ClipAI（旧Telora）v0.x ／ 正本: 本ファイル（製品ロードマップは docs/design/ROADMAP.md）

---

## 1. エグゼクティブサマリー

ClipAI は「完全無料・完全オフライン・無制限」の日本語テロップ＆カット編集を核に、
主要競合（CapCut/Vrew/Filmora/Descript）が全てクラウド課金制で提供する AI 字幕機能の空白地帯を突く。
配布は「④AI版」一本に集約し、GitHub Releases を起点に Mac 署名・公証 → デモ動画 → 窓の杜/Homebrew の順で展開。
最大の敵は機能不足ではなく配布摩擦（未署名 Gatekeeper 警告・1.5GB・Windows 未検証）であり、これらの解消を最優先とする。
マネタイズは本体永久無料を維持し、寄付＋将来の買い切りアドオンで固定費（署名費 年2〜7万円）を回収する。

---

## 2. ターゲットペルソナ（二正面）

### ペルソナA: 日本語トーク系動画クリエイター

- **具体像**: 実況・解説・切り抜き・Vlog を YouTube に投稿する個人〜小規模クリエイター。
  Vrew か CapCut で字幕を付けているが、無料枠の上限や透かしに不満を持つ。プログラミング経験なし。
  AviUtl/ゆっくりMovieMaker4 の文化圏（国産・無料・個人開発ソフトへの信頼が厚い）と重なる [^aviutl] [^ymm4]。
- **課題**:
  - Vrew: 無料は文字起こし月120分まで＋出力冒頭にロゴ透かし。継続利用は月900円〜の課金 [^vrew-limit]。
    クラウド処理が既定で、動画音声が外部サーバーに送られる情報漏えい懸念も指摘される [^vrew-risk]。
  - CapCut: AI字幕群は Pro 限定＆ネット接続必須 [^capcut-price] [^capcut-offline]。2025年 ToS 改定で
    アップロードコンテンツへの永久ライセンス条項が加わり商用層に不安が広がる [^capcut-tos]。
  - Filmora: 買い切り8,980円を払っても自動字幕は別途クレジット課金（1分約4.2円相当）[^filmora-credit]。
  - 日本のフルテロップ文化（同音異義語＋ミュート視聴対応）により字幕作業量が世界一多い [^telop]。
- **訴求メッセージ**:
  「文字起こしは無制限・月◯分制限なし・1分◯円の従量課金なし。動画は1バイトも外に出ない。
  テロップと無音・フィラー（えー/あの）カットまで、全部無料・全部オフライン。」

### ペルソナB: AIエージェント使いの開発者

- **具体像**: Claude Code / Cursor / Codex を日常使いするエンジニア。副業や趣味で動画も作る。
  Qiita/Zenn で「Claude Code × 動画編集」記事を読み、DaVinci MCP 等の外付け連携を試したが環境構築の重さに挫折 [^qiita] [^vidocu]。
- **課題**:
  - MCP ネイティブの動画エディタは Palmier Pro が代表格だが、macOS 26 (Tahoe) Apple Silicon 限定で
    Windows・Intel Mac・旧 macOS ユーザーは使えない [^palmier-gh] [^weel]。
  - 既存プロエディタの MCP 外付け（DaVinci/Premiere）はセットアップが重く操作範囲も限定的 [^vidocu]。
- **訴求メッセージ**:
  「あなたの Claude Code がそのままタイムラインを操作する。『全部のクリップの無音を消して』→ 12箇所削除。
  AI コストはあなたのエージェント側。だから本体は永久無料。Win/Mac 両対応（Windows は検証中）。」

---

## 3. 競合ポジショニング表

| 軸 | **ClipAI** | CapCut | Vrew | Filmora | Premiere Pro | Descript | Palmier Pro |
|---|---|---|---|---|---|---|---|
| 価格 | **完全無料（MIT）** | 無料＋Pro $9.99〜19.99/月 [^capcut-price2] | 無料枠＋月900円〜 [^vrew-limit] | 買い切り8,980円＋字幕クレジット課金 [^filmora-price] [^filmora-credit] | 月3,280円〜（年契約） [^premiere-price] | 無料枠＋$16〜50/月 [^descript-price] | 本体無料＋生成AI $29〜69/月 [^palmier-price] |
| AI字幕（文字起こし） | **無制限・同梱 whisper.cpp large-v3-turbo・日本語検証済み** | クラウド・Pro限定機能あり [^capcut-price] | クラウド・無料は月120分 [^vrew-limit] | クラウドAI・分単位クレジット消費 [^filmora-credit] | オンデバイス対応済み [^premiere-offline] | クラウド・無料は月60分＋透かし [^descript-price] | あり（詳細は生成AI課金圏） [^palmier-price] |
| 無音・フィラーカット | **両方実装済み・無料** | フィラー除去強化中 [^capcut-filler] | 無音カットあり [^vrew-users] | — | 語間・フィラーカット標準対応 [^premiere-price] | フィラー削除（無料は制限付き） [^descript-price] | AI指示で可 [^weel] |
| 完全オフライン | **可（モデル同梱）** | AI機能はネット必須 [^capcut-offline] | 不可（クラウド既定） [^vrew-risk] | 字幕はクラウド [^filmora-credit] | 文字起こしのみ可 [^premiere-offline] | 不可 [^descript-jp] | 生成AIはクラウド [^palmier-price] |
| AIエージェント（MCP）操作 | **ネイティブ内蔵・エージェント自由** | なし [^capcut-filler] | なし [^capcut-filler] | なし | 外付けMCPのみ [^vidocu] | なし（Underlord は自社AI） [^a16z] | ネイティブ内蔵 [^palmier-gh] |
| 日本語UI／日本語精度 | **日本語UI・日本語検証済み** | 日本語UIあり | 日本語UIあり・専門用語の誤字指摘 [^vrew-accuracy] | 日本語UIあり | 日本語UIあり | 英語UIのみ・日本語精度低評価 [^descript-jp] | 日本語READMEのみ [^palmier-gh] |
| 対応OS | **Mac (arm64/x64) ＋ Win x64（実機未検証）** | Win/Mac | Win/Mac | Win/Mac | Win/Mac | Win/Mac | **macOS 26 Apple Silicon のみ** [^palmier-gh] |

要点: 「AI字幕が無制限×オフライン×無料」を満たす競合はゼロ。「日本語UI×無料×フィラーカット」も空白地帯。
日本市場での現実的な比較対象は Vrew（トーク系の第一想起）と CapCut（無料の第一想起）に絞って発信する。

---

## 4. 差別化の核と一行ポジショニング

**差別化の核（3点、競合の不満パターンに1対1で対応）**

1. **隠れ課金ゼロ** — 月◯分制限・分単位クレジット・Pro素材透かしが存在しない（↔ Filmora の二重課金、CapCut の透かし）
2. **動画は1バイトも外に出ない** — whisper.cpp 完全同梱のオフライン処理（↔ Vrew のクラウド送信懸念）
3. **あなたの AI エージェントが編集する** — MCP ネイティブで AI コストはユーザー側。だから本体無料が持続する（↔ Palmier の生成AIクレジット課金、かつ Win/Intel Mac 対応で Palmier の対応範囲外をカバー）

**一行ポジショニング文**

> 「ClipAI — 日本語トーク動画のテロップとカットを、完全無料・完全オフラインで。あなたの AI エージェントに『無音を全部消して』と言うだけ。」

---

## 5. 製品ラインナップ推奨: 「④AI版」一本で出す

**推奨: ①〜③の分売はせず、④（ベース＋MCP＋AIチャット合体）を単一配布物として出す。**

理由:

1. **選択肢が離脱を生む**: ペルソナAは「①と④どっちを落とせばいい？」で迷った瞬間に離脱する。
   ④は AI 機能を使わなければ①として動作するため、分売のメリットがユーザー側にない。
2. **リリース運用コストが1/4**: 4形態×3プラットフォーム（mac arm64/x64・win x64）＝12バイナリの
   署名・公証・検証は個人開発では回らない。1形態×3に絞る。
3. **差別化の核が④にしかない**: MCP と BYOK チャットこそ競合との違いであり、それを外した①を
   看板にする理由がない。既に開発上の推奨起動も④である。
4. **命名で機能を伝える**: 「AI版/ベース版」の区分は捨て、単に「ClipAI」とし、
   AI 機能は設定画面のトグル（MCP サーバ ON/OFF、API キー設定）として表現する。

### バージョン呼称と初回起動体験

- **呼称**: GitHub Releases 起点の配布は「パブリックβ（v0.x）」と明示する。
  「v1.0」の宣言は窓の杜へのリリース送付（施策3）と同時に行う。
  メディア記事は一度きりの資産であり、βの粗さで消費しない。
  ペルソナBはβ耐性が高く、ペルソナAには安定版として届ける二段構え。
- **初回起動体験**: AI 機能（MCP サーバ・API キー設定）は既定 OFF。
  初回起動でペルソナAが API キー入力に遭遇しない導線を必須とする
  （「無料と言いつつ課金が要る」誤解による離脱を防ぐ）。
  MCP サーバは 127.0.0.1 バインドのみで「1バイトも外に出ない」訴求と整合させる。
- **名称リスク（要対応）**: 「ClipAI」は App Store・Web に同名の AI 動画系
  既存製品が複数ある（clipai.app、ClipAI - AI Video Editor 等）。
  単独名での検索流入は見込めない前提で、「ClipAI 動画編集 オフライン 無料」等の
  複合キーワードで導線を設計する。商標調査を要検証事項に追加。

---

## 6. リリース戦略

### チャネルと順序

| 順 | チャネル | 対象ペルソナ | 前提条件 |
|---|---|---|---|
| 1 | **GitHub Releases**（現行・主配布） | B | 1ファイル2GiB上限。現状1.5GBで残余25%のみ [^gh-releases] |
| 1 | **独自 Homebrew tap**（`brew install <owner>/tap/clipai`） | B | star 要件なし・即日可。公式 cask 昇格までの主経路 |
| 2 | **公式サイト（LP 1枚）** | A | YMM4 型の直接配布モデル [^ymm4]。GitHub Releases へのリンクで可 |
| 3 | **MCP レジストリ／ディレクトリ登録**（mcp.so・PulseMCP・awesome-mcp-servers 系） | B | MCP サーバ仕様の README 英語版1枚。ほぼゼロコスト |
| 4 | **窓の杜ニュース記事化** | A (Win) | **Windows 実機検証＋SmartScreen 起動手順ページが必須**（窓の杜は Windows 専門媒体。読者が落とすのは exe。Mac 公証は前提にならない）。申請制ではなく編集部選定。mado-no-mori-info@impress.co.jp へ送付 [^mado] |
| 5 | **Homebrew 公式 cask** | B | 第三者投稿 75 star／自薦 225 star [^brew]。未署名は不可 [^brew-unsigned] → 署名＋star 到達後に独自 tap から昇格 |
| 6 | **Microsoft Store** | A (Win) | 個人登録が完全無料化・自動デジタル署名付与 [^msstore]。Windows 実機検証が先 |
| — | Scoop / winget | B (Win) | Win 開発者向け補完。署名不要系。MS Store と前後してよい |
| — | Vector | — | 10MB超でFTP推奨という古いインフラで1.5GB級は対象外。見送り [^vector] |
| — | Mac App Store | — | App Sandbox 必須が ffmpeg/whisper 子プロセスと相性が悪く工数大。当面見送り（相性の詳細は要検証） [^mas] |

### 署名・公証（要否とコスト）

- **macOS: 必須・最優先投資。** Sequoia 以降、未署名アプリの回避手順は「設定深層＋1時間制限＋管理者パスワード」
  まで悪化し [^sequoia]、Tahoe では「壊れているため開けません」→ `xattr` コマンドが必要なケースも報告 [^tahoe]。
  非開発者のペルソナAには致命的な障壁。Apple Developer Program 年 $99（約1.5万円）[^adp] ＋
  electron-builder で署名〜公証は自動化可能（約5分/ビルド、GitHub Actions 手順も確立）[^zenn-notarize]。
- **Windows: 当面は README 注意書きで可、中期的に署名。** 未署名でも SmartScreen は「詳細情報→実行」の
  2クリックで回避可能 [^smartscreen]。最安の Azure Artifact Signing は日本の個人・法人が Public Trust 対象外で使えない [^azure-sign]。
  現実的候補は MIT ライセンスを活かした Certum Open Source 向け（$116〜/年程度、資格は要確認）[^certum]、
  次点で GlobalSign OV 約6万円/年 [^globalsign]。2026年3月以降は証明書有効期間460日のため更新運用が発生 [^csc31]。
  署名しても EV 含めレピュテーション構築期間は警告が出る前提で、スクリーンショット付き起動手順を用意する [^ev]。
- **固定費の全体像**: Mac 年約1.5万円（必須）＋ Win 年約1.7万〜6万円。完全無料アプリでも年2〜7万円が発生する。

### 配布サイズ対策（1.4〜1.5GB問題）

- 1.5GB は動画編集ソフトとして異常ではない（DaVinci 約2.9GB [^davinci-size]、Filmora 要求10GB [^filmora-spec]）が、
  比較される軽量系（CapCut インストーラ約200MB [^capcut-size]）に対し初回体験の摩擦になる。
- **推奨（折衷案）**: 量子化版 large-v3-turbo-q5_0（574MB）を同梱して「インストール直後から完全オフライン」を守り、
  フル精度版 large-v3-turbo（1.62GB）は設定画面からオプション DL。配布物は約600〜700MB台に半減 [^hf-models]。
  Whisper 系アプリでは「モデル初回DL」が標準UX として受容済み（MacWhisper・Vibe）[^macwhisper] [^vibe]。
  **ただし q5_0 の日本語精度は要実測検証。** 精度劣化が大きければ同梱モデルを再選定する。
- 「同梱ゼロ＋初回DL必須」案は「完全オフライン」の核訴求が初回に崩れるため単独では不採用。
- 即効策: `electron-builder --analyze` で他アーキテクチャ向け ffmpeg/whisper バイナリの混入を監査
  （win-x64 クロスビルド導入直後で混入リスク高）[^electron-vite]。
- GitHub Releases 2GiB 上限に対する保険としてもモデル分離は必須 [^gh-releases]。

### リリースゲート（順序に速度の規律を与える）

| ゲート | 判定条件 | 次に解禁されるもの |
|---|---|---|
| G1: β公開 | Mac 署名・公証完了＋種火ユーザー10人確保 | チャネル1〜3、施策1b・2 |
| G2: Windows 解禁 | Win 実機検証完了＋SmartScreen 手順ページ公開 | チャネル4・6、施策3 |
| G3: v1.0 宣言 | 外部フィードバックループ1周以上＋クリティカル既知バグゼロ | 窓の杜送付＝v1.0 同時、施策4 本格化 |

競合機会（Vrew 無料枠縮小・CapCut ToS 不安）は減衰する。各ゲートに目標時期を設定し、
月次で競合ウォッチ（Vrew 価格ページ・Palmier 対応OS・Premiere オンデバイス機能）を行う。

### リリース成功条件（フェーズ別）

- **公開直後（〜2週間）= 配布摩擦の解消が第三者で実証される**: 開発者以外の Mac ユーザーが
  助けなしで「DL→起動→文字起こし→書き出し」を完走した報告が複数（Gatekeeper 起因の脱落ゼロ）／
  種火ユーザー10〜20人全員から定性フィードバック回収／不具合の報告→修正→更新が48時間以内に
  1周し実ユーザーに届く／施策2 の記事が発信者以外に共有される／「無制限オフライン字幕」と
  「MCP 操作」のどちらへの反応が強いか観測に基づき言える。
- **1ヶ月 = 「一度使った人が使い続ける」証拠が出る**: 「2本目以降の動画を編集した」報告・作例が
  存在／外部フィードバックループ（報告→修正→リリース→報告者の確認）が最低1サイクル完了／
  Homebrew 経路確立／Windows 実機検証完了（窓の杜送付の前提）／「Vrew/CapCut から乗り換えた」
  文脈の第三者言及が最低1件。
- **3ヶ月 = 施策を打たなくても伸びる状態**: 施策スパイク以外（検索・口コミ・レジストリ）の流入が
  継続発生／第三者発のレビュー記事・動画・作例が複数／両ペルソナで定着事例／v1.0 宣言と
  メディア掲載が完了し初回体験事故ゼロ／寄付導線設置と初寄付の発生／競合イベントに
  1週間以内の発信で反応できた。

### フィードバック・サポート・更新（オフライン訴求との両立）

- **構造的制約**: 「動画は1バイトも外に出ない」訴求によりテレメトリ・自動クラッシュ
  レポートは採用できない。フィードバックは能動導線のみで設計する。
- 導線: GitHub Issues（日本語テンプレ、ペルソナB向け）＋ Google フォーム等の
  非 GitHub 窓口（ペルソナA向け。A は GitHub アカウントを持たない前提）。
- サポート成果物: FAQ／既知の問題ページ、未署名 Windows のスクショ付き起動手順、
  個人開発としての応答方針（ベストエフォート明記）。
- **更新配布**: 自動更新（electron-updater）を v1.0 までに導入。更新導線がないと
  不具合修正が届かず初期の悪評が固定化する。1.5GB級のため差分更新を検討。
- 計測: 全施策リンクに UTM、GitHub Traffic とリリース資産別 DL 数を週次確認。
  施策ごとの効果を判定できない発信は行わない。

---

## 7. プロモーション施策（優先度順）

### 施策1【最優先】デモ動画 — 2本立て（1本で両ペルソナは狙えない）

a16z が2026年を agentic video editing 元年と位置づけ [^a16z]、日本語圏でも Claude Code × 動画編集の
記事が非エンジニアまで広がっている今 [^qiita]、このデモは時流のど真ん中。ただしターミナル起点の
デモはペルソナBにしか刺さらないため、2本立てとする:

- **1a（ペルソナA向け・GUI完結・60秒）**: 素材読込→文字起こし無制限→フルテロップ自動生成→
  無音・フィラーカット、すべてボタン操作。ターミナルは一切映さない。窓の杜掲載時・比較LPの主役。
- **1b（ペルソナB向け・90秒）**: 下記台本（Claude Code に「無音を全部消して」）。
  Zenn/Qiita 記事・MCPレジストリ・X 開発者界隈向け。
- **共通**: デモ動画自体を ClipAI で編集し「この動画は ClipAI で編集しました」を末尾に明記する
  （最も安価で強い証明）。公開順: 1b→施策2と同時（β初速・star獲得）、1a は G2/G3 までに完成。

**1b の台本骨子:**
1. （0-10秒）実況動画のタイムラインを見せる。「トーク動画の編集、いちばん面倒なのは無音とフィラー消し」
2. （10-25秒）Claude Code のターミナルに「全部のクリップの無音を消して」と入力
3. （25-45秒）ClipAI のタイムラインでカットが自動実行される様子 →「12箇所削除しました」の応答
4. （45-60秒）続けて「『えー』『あの』も消して」→ フィラーカット実行。ビフォーアフター再生比較
5. （60-75秒）「文字起こしも無制限・オフライン。動画は1バイトも外に出ない」→ 字幕生成を見せる
6. （75-90秒）「完全無料・MIT ライセンス。GitHub からどうぞ」→ URL 表示

配信先: X（x-post スキル活用）・YouTube・GitHub README 冒頭 GIF。

### 施策2: Zenn/Qiita 技術記事「MCP ネイティブ動画エディタを作った」

ペルソナB向け。Palmier Pro との比較（macOS 26 限定 vs Win/Mac 対応、生成AIクレジット vs 完全無料）を
正面から書く。Palmier の日本語レビュー記事が既に読まれている文脈に相乗りする [^weel]。

記事公開はβ公開当日に合わせ、Homebrew 公式 cask 要件（第三者投稿75／自薦225 star）到達の
star 獲得エンジンとして位置づける。同時に awesome-mcp-servers 系リストへ PR、
mcp.so・PulseMCP へ登録（英語 README 1枚で可）。

### 施策3: 窓の杜へのリリース情報送付

ペルソナA向け最大のリーチ手段。mado-no-mori-info@impress.co.jp へ「日本語UI・完全無料・オフライン
無制限文字起こし」を軸にしたプレスリリースを送付 [^mado]。署名・公証完了後に実施（記事化→未署名警告で炎上を避ける）。

### 施策4: 対 Vrew/CapCut 比較 LP・比較表

「Vrew の月120分制限と透かし、要りません」を軸に、本書 §3 の表を一般向けに簡略化して LP に掲載。
CapCut ToS 改定（永久ライセンス条項）で不安を持つ商用クリエイターの受け皿メッセージ
「MIT ライセンス・ローカル完結・コンテンツの権利を一切取得しない」を明記 [^capcut-tos]。

比較表には「最終確認日」と出典を常置し、競合の価格・制限変更を月次で反映する（景表法・
優良誤認の回避と信頼性維持）。断定は自社検証済みの項目に限る。

### 施策5: 切り抜き師向けユースケース発信

切り抜きは単価0.1〜0.7円/再生かつ収益化厳格化で量産効率への圧力が極めて強い [^kirinuki]。
「数十本を一括で無音・フィラーカット」のバッチ処理デモを施策1の派生として作り、
切り抜きコミュニティ（X・公式許諾スキーム界隈）に向けて発信する。

**実装ゲート**: 「数十本を一括処理」の UX が現行機能に存在するか要検証。未実装なら本施策は
機能実装後まで凍結する（誇大訴求の回避）。

### 施策6: YouTube チュートリアル＋note 発信（ペルソナA向け）

ペルソナAの探索行動は YouTube 検索（「Vrew 無料 制限」「テロップ 自動 無料」）と note。
施策1a の派生として「Vrew からの乗り換え手順」「フルテロップを10分で」等の実用チュートリアルを
継続発信する。Zenn/Qiita（施策2）はペルソナAに届かない点に注意。

---

## 8. マネタイズの選択肢

**無料維持の持続性**: ②MCP 版の構造上、AI 推論コストはユーザーのエージェント／API キー側に転嫁されるため、
運営側の変動費はほぼゼロ。固定費は署名証明書の年2〜7万円（§6）＋ドメイン程度で、個人で維持可能な水準。
日本市場は「本体永久無料＋周辺で回収」モデルが実証済み（DaVinci/Blender/YMM4）[^monetize] [^ymm4]。

将来の選択肢（3つまで、優先順）:

1. **寄付・スポンサー（Blender 型）**: GitHub Sponsors。Blender は寄付・開発基金で年約5.4億円を集め
   無料維持を宣言している実例 [^monetize]。OSS × 開発者コミュニティと最も整合的。まず着手。
2. **買い切りアドオン（YMM4/DaVinci 型）**: 商用テロップテンプレート集（テレビ的装飾・話者別スタイル）や
   高度機能パックの買い切り販売。日本のフルテロップ文化では字幕のデザイン性が採用を左右するため [^telop]、
   テンプレートは製品価値とマネタイズを兼ねる。買い切りは日本市場の支持が強い [^davinci-jp]。
3. **法人向けサポート/ライセンス**: Vrew のクラウド送信を懸念する企業層 [^vrew-risk] に対し、
   オフライン完結を武器にした法人向けサポート契約。需要規模は現時点で不明（要検証）。

### 8.1 固定費と回収ラインの数値裏付け

固定費は署名証明書＋ドメインに集約され（変動費ほぼゼロ）、署名グレードで3段階に整理できる。
モデル配布・LP は無料枠（GitHub Releases/HuggingFace/GitHub Pages）で運用しホスティング費は計上しない。

| シナリオ | 内訳 | 年額 | 月按分 |
|---|---|---|---|
| Lean | Apple Developer ¥15,000＋ドメイン¥2,000（Win は README 注意書き運用） | **¥17,000** | ¥1,417 |
| Standard | 上記＋Certum Open Source Win署名 ¥17,000（資格要確認） | **¥34,000** | ¥2,833 |
| Full | 上記の Win を GlobalSign OV ¥60,000/年 に置換 | **¥77,000** | ¥6,417 |

各マネタイズ手段での回収ライン:

| 固定費 | ¥500/月スポンサー | ¥300/月スポンサー | 単発¥500寄付 | ¥2,000テンプレ集 | 法人¥50,000/年 |
|---|---|---|---|---|---|
| Lean ¥17,000 | 3人 | 5人 | 34件/年 | 10本/年 | 0.34件 |
| Standard ¥34,000 | 6人 | 10人 | 68件/年 | 19本/年 | 0.68件 |
| Full ¥77,000 | 13人 | 22人 | 154件/年 | 43本/年 | 1.54件 |

要点: Lean ラインは「¥500/月スポンサー3人」または「テンプレ年10本」で回収できる。
法人サポートは1契約で全ラインを超過するため、需要確認できれば最効率（規模は要検証）。

### 8.2 期待値（3シナリオ・DL基点／仮定は要検証）

以下の変換率は OSS・フリーソフト一般水準からの推定であり **すべて要検証**。
リリース後は GitHub API の実DL数・実 star 数で継続更新する。

- DL→継続スポンサー 0.05〜0.4%【要検証】／DL→テンプレ購入 0.2〜1.2%【要検証】／
  DL→単発寄付 0.1〜0.7%【要検証】
- 実効単価: 継続スポンサー ¥4,000/年、テンプレ net ¥1,800、単発 ¥800【要検証】

| シナリオ | DL累計 | 推定star | 年間収益 | Lean/Std/Full カバー率 |
|---|---|---|---|---|
| 悲観 | 700 | 21 | ¥4,480 | 26% / 13% / 6% |
| 中位 | 3,000 | 150 | ¥52,200 | 307% / 154% / 68% |
| 楽観 | 12,000 | 960 | ¥518,400 | 3,049% / 1,525% / 673% |

損益分岐DL（中位転換率・3チャネル合算）: Lean 約1,000／Standard 約1,955／Full 約4,426。

### 8.3 KPI ツリー（テレメトリなしで測定可能）

本体はテレメトリ非搭載を維持し、外部で取得できる指標のみで運用する。

| 階層 | KPI | 取得手段 | 悲観 | 中位 | 楽観 |
|---|---|---|---|---|---|
| 獲得★ | GitHub Releases DL累計 | GitHub API（download_count） | 700 | 3,000 | 12,000 |
| 獲得 | LP訪問→DL率 | Cloudflare Web Analytics（LPのみ・Cookieなし・無料） | — | — | — |
| エンゲージ | GitHub star | GitHub API（Homebrew 225 閾値管理も兼ねる） | 30 | 150 | 960 |
| エンゲージ | 継続率プロキシ＝更新版DL率 | 新版DL/直近版累計DL（GitHub API） | — | — | — |
| エンゲージ | 利用深度プロキシ＝フルモデル追加DL | HuggingFace/自ホストDL数 | — | — | — |
| リーチ | X フォロワー | X Analytics | 200 | 1,000 | 5,000 |
| 収益化 | 継続スポンサー数 | Sponsors ダッシュボード | 1 | 5 | 48 |
| 収益化 | テンプレ販売数 | BOOTH/Gumroad | 2 | 15 | 144 |
| 収益化 | 年間支援額（North Star） | 各集計 | ¥4,500 | ¥52,000 | ¥518,000 |

起動継続率は直接取得不能なため、「更新版DL率」と「フルモデル追加DL数」をプロキシとする。
DL数・star は GitHub API で日次自動取得（cron化）、その他は週次手動集計。四半期ごとに
カバー率をレビューし、署名グレード（Lean/Standard/Full）の投資判断を更新する。

### 8.4 感度分析

回収ライン到達への効き（中位基準・半減↔倍増の収益スイング幅）:
DL数 ¥78,300 ＞ テンプレ転換率/単価 ¥40,500 ＞ スポンサー転換率/単価 ¥27,000 ＞ 単発 ¥10,800。
乗算構造のため理論弾力性は全変数=1だが、実現可能レンジは DL（約17倍）＞転換率（3〜8倍）＞
単価（2〜3倍・値上げは転換率と負相関）。よって **最大レバーは DL数**。全チャネルの母数を
同時に押し上げるため、§7 施策1（デモ動画）・施策3（窓の杜）への投資が回収ラインに最も効く。

**採らない選択肢**: Palmier 型の生成AIクレジット課金。「AI コストをユーザー側に転嫁して本体無料」という
差別化の核と正面から矛盾するため。

---

## 9. 出典一覧

[^capcut-price]: https://www.eesel.ai/blog/capcut-pricing
[^capcut-price2]: https://bigvu.tv/blog/capcut-free-vs-pro-what-2026s-restructure-actually-gives-you/
[^capcut-offline]: https://www.capcut.com/ja-jp/help/what-to-do-if-no-internet-connection-on-capcut
[^capcut-tos]: https://0120.co.jp/blog/video-92/
[^capcut-filler]: https://hiroboonext.net/capcut-pc-ai-guide/
[^capcut-size]: https://www.capcut.com/resource/capcut-for-windows
[^vrew-limit]: https://hibinodouguten.com/vrew-limitation/
[^vrew-risk]: https://www.somethingfun.co.jp/video_tips/vrew_kiken
[^vrew-accuracy]: https://freeblog-video.com/transcription/
[^vrew-users]: https://ai-gallery.jp/tools/vrew/
[^filmora-price]: https://ks-llc.co.jp/media/filmora-price/
[^filmora-credit]: https://emomarke.com/filmora-auto-subtitle-review-cost/
[^filmora-spec]: https://filmora.wondershare.jp/tech-spec.html
[^premiere-price]: https://www.adobe.com/jp/products/premiere/pricing-info.html
[^premiere-offline]: https://pc.watch.impress.co.jp/docs/news/1386628.html
[^descript-price]: https://www.descript.com/pricing
[^descript-jp]: https://trends.codecamp.jp/blogs/media/descript
[^palmier-gh]: https://github.com/palmier-io/palmier-pro
[^palmier-price]: https://www.palmier.io/pricing
[^weel]: https://weel.co.jp/media/tech/palmier-pro/
[^a16z]: https://a16z.com/its-time-for-agentic-video-editing/
[^vidocu]: https://vidocu.ai/blog/video-mcp-servers-how-ai-agents-can-process-videos-in-2026
[^qiita]: https://qiita.com/taketsuyo/items/c72b429b49abb3de57c3
[^mado]: https://forest.watch.impress.co.jp/info/sakusya/sakusya3.html
[^vector]: https://www.vector.co.jp/for_authors/upload/faq.html
[^gh-releases]: https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
[^brew]: https://docs.brew.sh/Acceptable-Casks
[^brew-unsigned]: https://tech.layerx.co.jp/entry/2025/09/08/142149
[^mas]: https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide
[^msstore]: https://forest.watch.impress.co.jp/docs/news/2046485.html
[^adp]: https://www.tekural.com/blog/apple-developer-program-cost
[^zenn-notarize]: https://zenn.dev/minamiso/articles/568c8110a46901
[^sequoia]: https://softantenna.com/blog/how-to-bypass-gatekeeper-on-macos-sequoia/
[^tahoe]: https://swissmacuser.ch/fix-macos-tahoe-app-is-damaged-and-cant-be-opened-move-trash/
[^azure-sign]: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
[^globalsign]: https://jp.globalsign.com/codesigning/price_functions.html
[^certum]: https://certum.store/open-source-code-signing-on-simplysign.html
[^csc31]: https://www.digicert.com/blog/understanding-the-new-code-signing-certificate-validity-change
[^smartscreen]: https://jp.emeditor.com/emeditor-core/faq-windows-によって-pc-が保護されました-microsoft-defender-smartscreen/
[^ev]: https://ivansingleton.dev/the-cheapest-code-signing-certificate-for-business-central-appsource-in-2026-a-complete-comparison-guide/
[^davinci-size]: https://davinci-resolve.en.lo4d.com/download
[^hf-models]: https://huggingface.co/ggerganov/whisper.cpp/tree/main
[^macwhisper]: https://rentamac.io/whisper-on-mac/
[^vibe]: https://github.com/thewh1teagle/vibe/blob/main/docs/models.md
[^electron-vite]: https://electron-vite.org/guide/distribution
[^aviutl]: https://ascii.jp/elem/000/004/297/4297805/
[^ymm4]: https://manjubox.net/ymm4/
[^kirinuki]: https://tegy.co.jp/youtube-clip-unprofitable/
[^telop]: https://toyokeizai.net/articles/-/852542?display=b
[^monetize]: https://automaton-media.com/articles/newsjp/blender-20250918-358315/
[^davinci-jp]: https://creatorways.jp/davinci-resolve-free-vs-paid/

**要検証事項（リサーチで裏が取れていないもの）**:
- Windows 実機での動作（配布 exe は未検証）
- whisper large-v3-turbo-q5_0 量子化版の日本語精度
- Mac App Store の App Sandbox と ffmpeg/whisper 子プロセスの互換性
- Certum Open Source 証明書の個人開発者としての取得資格
- 「切り抜き市場単体の規模」を示す公的統計（未発見）
- Vrew のクレジット制移行の詳細（価格ページが動的表示のため。無料枠縮小は追い風になるためウォッチ対象）
- 「ClipAI」の名称衝突（App Store の同名 AI 動画アプリ複数・clipai.app・clipaipro.com）と商標調査
- 複数ファイル一括の無音・フィラーカット（施策5 の前提機能）の実装有無
- electron-updater と 1.5GB 配布物の差分更新可否
- マネタイズ期待値の各変換率（スポンサー/テンプレ/単発の DL 基点転換率）と実効単価（§8.2 の推定値）
