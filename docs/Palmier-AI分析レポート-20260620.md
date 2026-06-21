# Palmier AI 動画編集ソフト 分析レポート

**作成日**: 2026-06-20
**目的**: Palmier（Palmier Pro）の機能調査と、Telora（本動画編集ソフト）への取り込み候補の分析
**調査方法**: ディープリサーチ（19ソース取得 → 92主張抽出 → 上位25主張を3票の敵対的検証）
**検証結果**: 25主張すべて確証・棄却0

---

## 1. Palmier Proとは（一次情報で確証）

- **提供元**: Palmier, Inc.（Y Combinator S24）
- **対象OS**: **macOS専用**（macOS 26 Tahoe・Apple Silicon限定）。Windows/Linux非対応 ＝ TeloraのMac/Win両対応とは対照的
- **実装/ライセンス**: Swiftフルスクラッチ・**GPLv3のオープンソース**。ただし**生成AIバックエンドのみクローズド・専有**
- **料金**: エディタ本体とMCPは**完全無料・ログイン不要**。課金は生成AIクレジットのみ
  - Free $0 ／ Pro $29/月（通常$49・5,000クレジット）／ Max $69/月（通常$99・12,000クレジット）／ Custom
  - ※$29/$69は期間限定ローンチ価格

出典: [palmier.io](https://www.palmier.io/) / [GitHub README](https://github.com/palmier-io/palmier-pro/blob/main/README.md) / [YC](https://www.ycombinator.com/companies/palmier) / [pricing](https://www.palmier.io/pricing)

---

## 2. 最大の特徴 ＝「AIエージェントが操作できる動画エディタ」（MCP）

- ローカルに **MCPサーバ（`http://127.0.0.1:19789/mcp`・HTTP）** を公開
- **Claude Code/Desktop・Codex・Cursor** がタイムラインを直接操作（トリミング・split・並べ替え・クリップ調整・生成メディア配置）
- 内蔵エージェントと外部エージェント（BYO）の両対応、共有ToolExecutor経由
- Help → MCP Instructions からワンクリック設定可能
- 実コードに `add_clips` / `move_clips` / `split_clip` / `set_clip_properties` / `get_timeline` / `generate_video` / `generate_audio` / `upscale_media` 等のツールが存在（DeepWikiコード解析で確認）

出典: [README](https://github.com/palmier-io/palmier-pro/blob/main/README.md) / [docs](https://www.palmier.io/docs) / [DeepWiki](https://deepwiki.com/palmier-io/palmier-pro/7-ai-agent-and-mcp-integration) / [YC Launch](https://www.ycombinator.com/launches/QtT-palmier-pro-an-open-source-video-editor-your-agents-can-operate)

---

## 3. 生成AI ＆ 書き出し

- **タイムライン上で動画/画像/音声を生成**。外部SOTAモデル（**Seedance 2.0・Kling V3・Veo 3.1・Grok Imagine・Nano Banana Pro**）を利用し、b-roll・効果音・ナレーション・BGMを直接挿入。動画は最初/最後フレーム固定可
- **書き出し**: MP4（H.264/H.265/ProRes）＋ **Premiere/DaVinci向け NLE XML**（仕上げ工程への橋渡し）

出典: [palmier.io](https://www.palmier.io/) / [README](https://github.com/palmier-io/palmier-pro/blob/main/README.md) / [eesel.ai](https://www.eesel.ai/blog/what-is-palmier-ai-video-editor)

---

## 4. 競合のテキストベース編集（Teloraの既存資産と直結）

- **Vrew**: 自動文字起こし→単語ブロック化、文書を読む感覚で単語選択編集 → [出典](https://vrew.ai/en/feature/text-based-video-editing/)
- **Descript**: 文字起こしを編集＝実メディアを編集。**文を消すと該当区間の映像/音声が削除** → [出典](https://www.descript.com/blog/article/descript-tutorial-for-beginners-6-steps-to-get-started)
- → どちらもTeloraの**既存Whisper文字起こし＋単語タイムスタンプ（フィラーカット実装済み）**と機構が共通

---

## 5. Teloraへの取り込み候補（優先順位）

| 順位 | 機能 | 実現方法 | 外部AI | 難易度 |
|:---:|---|---|:---:|:---:|
| **1** | **NLE XML書き出し**（Premiere/DaVinci） | 内部タイムライン→FCPXML/Premiere XMLの構造変換のみ。FFmpeg不要・既存XML基盤（import-xml.js）あり | 不要 | **低** |
| **2** | **テキストベース編集**（Vrew/Descript型） | 文字起こしパネルで文/単語を選択→削除で既存カット処理へ橋渡し。フィラーカット機構を一般化 | 不要 | 中 |
| **3** | **ローカルMCPサーバ**（エージェント操作） | Electron mainにHTTP MCPサーバ、カット/テロップ/分割をMCPツール公開。Palmierと同設計で差別化大 | 不要※ | 中 |
| **4** | **文字起こし整形強化** | 句読点正規化・改行最適化・無音/フィラー一括クリーン。既存Whisper出力の自然な拡張 | 不要 | 低〜中 |
| **5** | 生成AI（動画/画像/音声） | 外部SOTAモデル＋有料API前提 ＝ **無料/オフライン方針と相反**。入れるならオプトイン外部API or ローカルTTS/軽量画像に限定 | **必須** | 高 |

※ MCPはAIモデル自体をユーザー側エージェントに委ねるため、**Telora本体は無料/オフラインを維持できる**点が重要。

### 戦略的所見

- Palmierの「**ローカル/オフライン・無料・エージェント操作**」という思想は、実はTeloraと最も近い。
- **①NLE XML書き出し → ②テキストベース編集 → ③ローカルMCP** の順で、すべて**外部AI不要・既存資産流用**で実装でき、Palmierの中核価値を無料で再現できる。
- 生成AIは性格に合わないため最後。やるならオプトインに留めるべき。

---

## 6. 留意点（caveats）

- **時間依存性**: Palmierは2026年6月中旬ローンチの新製品。価格（$29/$69）は期間限定ローンチ価格（通常$49/$99）。モデルロスタは急速更新中（「and more」と明記、homepageとREADMEで列挙が一部食い違うが矛盾ではなく進化途上）。
- **ソース品質**: 機能事実はpalmier.io・GitHub（GPLv3公開リポジトリ、コード/設定が検証可能）・YC公式という一次/検証可能ソースで非常に強い。競合（Vrew/Descript）も一次＋独立ソースで裏付け。
- **未検証範囲**: CapCut/剪映・Premiere Firefly・Filmoraの個別AI機能は今回の25主張に含まれず深掘りできていない（競合比較はVrew/Descriptのテキスト編集軸に限定）。
- **実装提案の位置づけ**: Telora向け実装提案（優先度1〜5）は研究クレームではなく、**検証済みのPalmier/競合機能＋Teloraコードベース**（import-xml.jsの存在、Electron+state.js+Whisper構成）を踏まえた**分析的推論**（confidence: medium）。内部データ→NLE XMLマッピングやMCPツール配線の具体実装可否は未検証。
- **オープンソースは部分的**: 生成AIバックエンドは専有・クローズド。「Mac対応」はmacOS 26 Tahoe・Apple Silicon限定と実際は狭い（TeloraのMac/Windowsクロスプラットフォームとは対照的）。

---

## 7. 未解決の論点（open questions）

1. CapCut/剪映、Premiere Firefly、Filmoraの具体的AI動画編集機能（自動字幕・AI削除・生成塗りつぶし等）はTeloraに取り込み価値があるか — 追加リサーチが必要。
2. Telora内部タイムラインモデル（state.js）からPremiere XML/FCPXMLへの正確なマッピング（トラック/トランジション/キーフレーム/テロップスタイルの対応）は実際に往復可能か、どこまで再現できるか。
3. ローカルMCPサーバをTeloraに実装する場合、レンダラ（vanilla JS）のstate操作をmainプロセスのMCPツールから安全に駆動するIPC設計（preload/contextBridge経由）は現行アーキテクチャでどの程度の改修を要するか。
4. オフライン前提でナレーション生成を入れるなら、ローカルTTS（例: ローカル音声合成モデル）の品質・ライセンス・クロスプラットフォーム（Mac/Windows）動作はTeloraの無料方針と両立するか。

---

## 8. 主要ソース一覧

### 一次情報（primary）
- https://www.palmier.io/
- https://www.palmier.io/pricing
- https://www.palmier.io/docs
- https://github.com/palmier-io/palmier-pro
- https://github.com/palmier-io/palmier-pro/blob/main/README.md
- https://www.ycombinator.com/companies/palmier
- https://www.ycombinator.com/launches/QtT-palmier-pro-an-open-source-video-editor-your-agents-can-operate
- https://vrew.ai/en/feature/text-based-video-editing/
- https://www.descript.com/blog/article/descript-tutorial-for-beginners-6-steps-to-get-started
- https://www.capcut.com/tools/filler-words

### 二次情報・解析（secondary）
- https://deepwiki.com/palmier-io/palmier-pro/7-ai-agent-and-mcp-integration
- https://www.digitaltrends.com/cool-tech/this-new-video-editor-lets-claude-work-directly-on-your-timeline/

### ブログ・記事（blog）
- https://www.eesel.ai/blog/what-is-palmier-ai-video-editor
- https://outlierkit.com/resources/palmier-review/
- https://note.com/sumtenchou_5636/n/nf0976761922e?hl=en
- https://medium.com/@didierlacroix/the-power-of-single-word-subtitles-662f8c3891bd

### ローカル実装の参考
- https://github.com/Ekaanth/OpenCut-AI
- https://github.com/Breakthrough/PySceneDetect
- https://blog.gdeltproject.org/using-ffmpegs-scene-detection-to-generate-a-visual-shot-summary-of-television-news/

---

*このレポートはディープリサーチワークフロー（角度5 / 取得19ソース / 抽出92主張 / 検証25主張すべて確証・棄却0 / エージェント101体）の成果をまとめたものです。*
