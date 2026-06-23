// 編集ツールのカタログ（renderer・canonical）。モデル③チャットのLLM function calling と、
// MCP（モデル②）のツール定義の基準。name(LLM/MCP公開名) → cmd(EditCommands名) + JSON Schema。
// ※モデル②の mcp-server.js にも同等の定義がある（main/renderer のモジュール体系が異なるため）。

export const TOOLS = [
  { name: 'get_timeline', cmd: 'getTimeline', destructive: false, description: 'タイムライン全体（トラック・クリップ・再生位置・総尺）を取得する。編集前にまず呼ぶ。', schema: { type: 'object', properties: {} } },
  { name: 'get_transcript', cmd: 'getTranscript', destructive: false, description: 'テロップ（字幕）一覧（id/開始/終了/本文）を取得する。', schema: { type: 'object', properties: { clipId: { type: 'string' } } } },
  { name: 'select_clip', cmd: 'selectClip', destructive: false, description: 'クリップを選択する。', schema: { type: 'object', properties: { trackId: { type: 'string' }, clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'split_clip', cmd: 'splitAt', destructive: false, description: '指定時刻（秒）でクリップを分割する。', schema: { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] } },
  { name: 'cut_before', cmd: 'cutBefore', destructive: true, description: '指定時刻より前を切り取る。', schema: { type: 'object', properties: { time: { type: 'number' } } } },
  { name: 'cut_after', cmd: 'cutAfter', destructive: true, description: '指定時刻より後ろを切り取る。', schema: { type: 'object', properties: { time: { type: 'number' } } } },
  { name: 'delete_clip', cmd: 'deleteClip', destructive: true, description: 'クリップを削除する。', schema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'move_clip', cmd: 'moveClip', destructive: true, description: 'クリップを指定開始時刻（秒・任意で別トラック）へ移動する。', schema: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: 'number' }, trackId: { type: 'string' } }, required: ['clipId', 'start'] } },
  { name: 'add_telop', cmd: 'addTelop', destructive: false, description: 'テロップ（字幕）を指定時間に追加する。style で位置/サイズ等を上書き可。', schema: { type: 'object', properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, style: { type: 'object' } }, required: ['text'] } },
  { name: 'set_telop', cmd: 'setTelop', destructive: false, description: 'テロップの本文/スタイルを変更する。', schema: { type: 'object', properties: { clipId: { type: 'string' }, text: { type: 'string' }, style: { type: 'object' } }, required: ['clipId'] } },
  { name: 'cut_silence', cmd: 'cutSilence', destructive: true, description: '動画/音声クリップの無音区間を検出して自動カットする。', schema: { type: 'object', properties: { clipId: { type: 'string' }, noiseDb: { type: 'number' }, minDur: { type: 'number' } }, required: ['clipId'] } },
  { name: 'cut_fillers', cmd: 'cutFillers', destructive: true, description: 'フィラー語（えー/あの 等）を検出してカットする（Whisper必要）。', schema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'set_track_mute', cmd: 'setTrackMute', destructive: false, description: 'トラックの音声ミュートを設定する（映像だけ流す）。', schema: { type: 'object', properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } }, required: ['trackId', 'muted'] } },
  { name: 'add_crossfade', cmd: 'addCrossfade', destructive: true, description: '選択中クリップを直前のクリップに重ねてクロスフェードする。', schema: { type: 'object', properties: { duration: { type: 'number' } } } },
  { name: 'import_media', cmd: 'importMedia', destructive: false, description: '素材ファイル（絶対パスの配列）を読み込む。', schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } },
  { name: 'add_clip', cmd: 'addClip', destructive: false, description: '読み込み済み素材（mediaId）をタイムラインに配置する。', schema: { type: 'object', properties: { mediaId: { type: 'string' }, start: { type: 'number' }, trackId: { type: 'string' } }, required: ['mediaId'] } },
  { name: 'export_video', cmd: 'export', destructive: true, description: '動画を書き出す。outputPath（絶対パス）必須。', schema: { type: 'object', properties: { outputPath: { type: 'string' }, format: { type: 'string' }, quality: { type: 'string' } }, required: ['outputPath'] } },
  { name: 'undo', cmd: 'undo', destructive: false, description: '直前の編集を元に戻す。', schema: { type: 'object', properties: {} } },
  { name: 'redo', cmd: 'redo', destructive: false, description: '元に戻した編集をやり直す。', schema: { type: 'object', properties: {} } },
];

export const CMD_BY_TOOL = Object.fromEntries(TOOLS.map((t) => [t.name, t.cmd]));
export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
export function isDestructiveTool(name) { return !!(TOOL_BY_NAME[name] && TOOL_BY_NAME[name].destructive); }
// LLM へ渡すツール定義（Anthropic/OpenAI 共通の素材）
export function llmTools() { return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })); }
