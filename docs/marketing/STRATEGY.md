# ClipAI マーケティング戦略

最終更新: 2026-07-02 ／ 対象: ClipAI（旧Telora）v0.x ／ 正本: 本ファイル（製品ロードマップは docs/design/ROADMAP.md）

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

---

## 6. リリース戦略

### チャネルと順序

| 順 | チャネル | 対象ペルソナ | 前提条件 |
|---|---|---|---|
| 1 | **GitHub Releases**（現行・主配布） | B | 1ファイル2GiB上限。現状1.5GBで残余25%のみ [^gh-releases] |
| 2 | **公式サイト（LP 1枚）** | A | YMM4 型の直接配布モデル [^ymm4]。GitHub Releases へのリンクで可 |
| 3 | **窓の杜ニュース記事化** | A | 申請制ではなく編集部選定。mado-no-mori-info@impress.co.jp へリリース情報送付でニュース掲載を狙う [^mado] |
| 4 | **Homebrew cask** | B | 自薦は GitHub star 225 以上が必要 [^brew]。かつ未署名アプリは公式リポジトリ不可 [^brew-unsigned] → 署名が前提 |
| 5 | **Microsoft Store** | A (Win) | 個人登録が完全無料化・自動デジタル署名付与 [^msstore]。ただし **Windows 実機検証が先** |
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

---

## 7. プロモーション施策（優先度順）

### 施策1【最優先】デモ動画「Claude Code に『無音を全部消して』」

a16z が2026年を agentic video editing 元年と位置づけ [^a16z]、日本語圏でも Claude Code × 動画編集の
記事が非エンジニアまで広がっている今 [^qiita]、このデモは時流のど真ん中。60〜90秒、日本語、字幕付き。

**台本骨子:**
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

### 施策3: 窓の杜へのリリース情報送付

ペルソナA向け最大のリーチ手段。mado-no-mori-info@impress.co.jp へ「日本語UI・完全無料・オフライン
無制限文字起こし」を軸にしたプレスリリースを送付 [^mado]。署名・公証完了後に実施（記事化→未署名警告で炎上を避ける）。

### 施策4: 対 Vrew/CapCut 比較 LP・比較表

「Vrew の月120分制限と透かし、要りません」を軸に、本書 §3 の表を一般向けに簡略化して LP に掲載。
CapCut ToS 改定（永久ライセンス条項）で不安を持つ商用クリエイターの受け皿メッセージ
「MIT ライセンス・ローカル完結・コンテンツの権利を一切取得しない」を明記 [^capcut-tos]。

### 施策5: 切り抜き師向けユースケース発信

切り抜きは単価0.1〜0.7円/再生かつ収益化厳格化で量産効率への圧力が極めて強い [^kirinuki]。
「数十本を一括で無音・フィラーカット」のバッチ処理デモを施策1の派生として作り、
切り抜きコミュニティ（X・公式許諾スキーム界隈）に向けて発信する。

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
