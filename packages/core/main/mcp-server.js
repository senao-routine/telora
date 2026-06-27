'use strict';
// ローカル MCP サーバ（モデル②）。127.0.0.1 限定の HTTP で JSON-RPC(MCP) を受け、
// 各ツールを renderer の EditCommands へ IPC で橋渡しして実行する。
// AIモデルはユーザー側エージェント（Claude Code / Cursor 等）任せ＝本体は無料/オフライン維持。
const http = require('http');
const crypto = require('crypto');
const { ipcMain } = require('electron');

const HOST = '127.0.0.1';
const PORT = Number(process.env.TELORA_MCP_PORT) || 19790;

// MCPツール定義: name（MCP公開名）→ cmd（EditCommands コマンド名）+ JSON Schema。
const TOOLS = [
  { name: 'get_timeline', cmd: 'getTimeline', description: 'タイムライン全体（トラック・クリップ・再生位置・総尺）を取得する。編集前にまず呼ぶ。', schema: { type: 'object', properties: {} } },
  { name: 'get_transcript', cmd: 'getTranscript', description: 'テロップ（字幕）の一覧（id/開始/終了/本文）を取得する。', schema: { type: 'object', properties: { clipId: { type: 'string' } } } },
  { name: 'select_clip', cmd: 'selectClip', description: 'クリップを選択する（add_crossfade 等の前に使う）。', schema: { type: 'object', properties: { trackId: { type: 'string' }, clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'split_clip', cmd: 'splitAt', description: '指定時刻（秒）でクリップを分割する。', schema: { type: 'object', properties: { time: { type: 'number' } }, required: ['time'] } },
  { name: 'cut_before', cmd: 'cutBefore', description: '指定時刻より前を切り取る（time 省略時は現在の再生位置）。', schema: { type: 'object', properties: { time: { type: 'number' } } } },
  { name: 'cut_after', cmd: 'cutAfter', description: '指定時刻より後ろを切り取る（time 省略時は現在の再生位置）。', schema: { type: 'object', properties: { time: { type: 'number' } } } },
  { name: 'delete_clip', cmd: 'deleteClip', description: 'クリップを削除する。', schema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'move_clip', cmd: 'moveClip', description: 'クリップを指定開始時刻（秒・任意で別トラック）へ移動する。', schema: { type: 'object', properties: { clipId: { type: 'string' }, start: { type: 'number' }, trackId: { type: 'string' } }, required: ['clipId', 'start'] } },
  { name: 'add_telop', cmd: 'addTelop', description: 'テロップ（字幕）を指定時間に追加する。style で位置/サイズ等を上書き可。', schema: { type: 'object', properties: { text: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, style: { type: 'object' } }, required: ['text'] } },
  { name: 'set_telop', cmd: 'setTelop', description: 'テロップの本文/スタイルを変更する。', schema: { type: 'object', properties: { clipId: { type: 'string' }, text: { type: 'string' }, style: { type: 'object' } }, required: ['clipId'] } },
  { name: 'cut_silence', cmd: 'cutSilence', description: '動画/音声クリップの無音区間を検出して自動カットする（FFmpeg・ローカル完結）。', schema: { type: 'object', properties: { clipId: { type: 'string' }, noiseDb: { type: 'number' }, minDur: { type: 'number' } }, required: ['clipId'] } },
  { name: 'cut_fillers', cmd: 'cutFillers', description: 'フィラー語（えー/あの/um 等）を検出してカットする（ローカルWhisper必要）。', schema: { type: 'object', properties: { clipId: { type: 'string' } }, required: ['clipId'] } },
  { name: 'set_track_mute', cmd: 'setTrackMute', description: 'トラックの音声ミュートを設定する（映像だけ流す）。', schema: { type: 'object', properties: { trackId: { type: 'string' }, muted: { type: 'boolean' } }, required: ['trackId', 'muted'] } },
  { name: 'add_crossfade', cmd: 'addCrossfade', description: '選択中クリップを直前のクリップに重ねてクロスフェードする。', schema: { type: 'object', properties: { duration: { type: 'number' } } } },
  { name: 'import_media', cmd: 'importMedia', description: '素材ファイル（動画/画像/音声）を読み込む。paths は絶対パスの配列。', schema: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } },
  { name: 'add_clip', cmd: 'addClip', description: '読み込み済み素材（mediaId）をタイムラインに配置する。', schema: { type: 'object', properties: { mediaId: { type: 'string' }, start: { type: 'number' }, trackId: { type: 'string' } }, required: ['mediaId'] } },
  { name: 'export_video', cmd: 'export', description: '動画を書き出す。outputPath（絶対パス）必須。', schema: { type: 'object', properties: { outputPath: { type: 'string' }, format: { type: 'string' }, quality: { type: 'string' } }, required: ['outputPath'] } },
  { name: 'undo', cmd: 'undo', description: '直前の編集を元に戻す。', schema: { type: 'object', properties: {} } },
  { name: 'redo', cmd: 'redo', description: '元に戻した編集をやり直す。', schema: { type: 'object', properties: {} } },
  { name: 'get_job_status', cmd: '__job__', description: '時間のかかる処理（書き出し/文字起こし/無音カット等）はジョブIDが返るので、これで完了を確認する。', schema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] } },
];
// ジョブ化する重いコマンド（即 jobId を返し、get_job_status でポーリング）
const LONG_CMDS = new Set(['export', 'cutFillers', 'cutSilence', 'importMedia']);
const CMD_BY_TOOL = Object.fromEntries(TOOLS.map((t) => [t.name, t.cmd]));

let server = null;
let getWindow = null;
const pending = new Map();
let seq = 0;
const sessions = new Set(); // 発行済み Mcp-Session-Id
const jobs = new Map();      // jobId -> { status:'running'|'done'|'error', result?, error?, tool, startedAt }

const serverUrl = () => `http://${HOST}:${PORT}/mcp`;

// MCPツール呼び出しを renderer(EditCommands) へ送り、結果を待つ（id 相関 + タイムアウト）。
function callRenderer(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const win = getWindow && getWindow();
    if (!win || win.isDestroyed()) { reject(new Error('エディタのウィンドウが準備できていません')); return; }
    const id = 'r' + (++seq);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('renderer timeout')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp-invoke', { id, name: cmd, args });
  });
}
function onResult(_e, msg) {
  const p = pending.get(msg && msg.id);
  if (!p) return;
  clearTimeout(p.timer); pending.delete(msg.id);
  p.resolve(msg); // { ok, result, error }
}

// JSON-RPC メソッドのルーティング
async function dispatch(method, params) {
  if (method === 'initialize') {
    const pv = (params && params.protocolVersion) || '2024-11-05';
    return { protocolVersion: pv, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'telora', version: '1.0.0' } };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    return { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) };
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const asText = (obj, isError) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], ...(isError ? { isError: true } : {}) });

    // ジョブ状態の問い合わせ
    if (name === 'get_job_status') {
      const job = jobs.get(args.jobId);
      if (!job) return asText({ error: 'unknown jobId: ' + args.jobId }, true);
      const payload = { jobId: args.jobId, status: job.status, tool: job.tool };
      if (job.status === 'done') payload.result = job.result;
      if (job.status === 'error') payload.error = job.error;
      return asText(payload, job.status === 'error');
    }

    const cmd = CMD_BY_TOOL[name];
    if (!cmd) return asText('unknown tool: ' + name, true);

    // 重い処理はジョブ化：即 jobId を返し、バックグラウンド実行。get_job_status でポーリング。
    if (LONG_CMDS.has(cmd)) {
      const jobId = 'job_' + crypto.randomBytes(6).toString('hex');
      jobs.set(jobId, { status: 'running', tool: name, startedAt: Date.now() });
      callRenderer(cmd, args, 1800000) // 最大30分
        .then((res) => { jobs.set(jobId, { status: (res && res.ok) ? 'done' : 'error', tool: name, result: res && res.ok ? (res.result == null ? { ok: true } : res.result) : undefined, error: res && res.ok ? undefined : ((res && res.error) || 'failed') }); })
        .catch((e) => { jobs.set(jobId, { status: 'error', tool: name, error: String((e && e.message) || e) }); });
      return asText({ jobId, status: 'running', note: 'これは時間のかかる処理です。get_job_status に jobId=' + jobId + ' を渡して完了を確認してください。' });
    }

    // 短い処理は同期実行
    const res = await callRenderer(cmd, args, 30000);
    if (res && res.ok) return asText(res.result == null ? { ok: true } : res.result);
    return asText(String((res && res.error) || 'command failed'), true);
  }
  const err = new Error('Method not found: ' + method); err.code = -32601; throw err;
}

async function handleOne(msg) {
  const isNotification = !msg || msg.id === undefined;
  try {
    const result = await dispatch(msg.method, msg.params);
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id, result };
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: '2.0', id: msg.id != null ? msg.id : null, error: { code: e.code || -32603, message: String((e && e.message) || e) } };
  }
}

function sendJson(res, status, obj, extraHeaders) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': body.length }, extraHeaders || {}));
  res.end(body);
}

// windowGetter: () => BrowserWindow。サーバを起動して URL を返す。
function start(windowGetter) {
  if (server) return { ok: true, url: serverUrl() };
  getWindow = windowGetter;
  ipcMain.removeAllListeners('mcp-result');
  ipcMain.on('mcp-result', onResult);

  server = http.createServer((req, res) => {
    // ループバック以外は拒否（DNSリバインド/外部アクセス対策）
    const ra = req.socket.remoteAddress || '';
    if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) { res.writeHead(403); res.end('forbidden'); return; }
    // 任意トークン認証：TELORA_MCP_TOKEN 設定時のみ Authorization: Bearer を要求
    const token = process.env.TELORA_MCP_TOKEN || '';
    if (token && (req.headers.authorization || '') !== 'Bearer ' + token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized' } }));
      return;
    }
    // GET: サーバ起点の SSE ストリームは提供しないため 405（MCP Streamable HTTP 仕様準拠）
    if (req.method === 'GET') { res.writeHead(405, { Allow: 'POST, DELETE', 'Content-Type': 'text/plain' }); res.end('Telora MCP: POST JSON-RPC 2.0 to /mcp'); return; }
    // DELETE: セッション終了
    if (req.method === 'DELETE') { const sid = req.headers['mcp-session-id']; if (sid) sessions.delete(sid); res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST, DELETE' }); res.end('method not allowed'); return; }

    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(data || '{}'); } catch (_) { sendJson(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
      try {
        // initialize には Mcp-Session-Id を発行して返す（実クライアントのセッション管理に対応）
        const extra = {};
        if (!Array.isArray(msg) && msg && msg.method === 'initialize') { const sid = crypto.randomBytes(16).toString('hex'); sessions.add(sid); extra['Mcp-Session-Id'] = sid; }
        if (Array.isArray(msg)) { // JSON-RPC バッチ
          const out = (await Promise.all(msg.map(handleOne))).filter(Boolean);
          if (!out.length) { res.writeHead(202); res.end(); return; }
          sendJson(res, 200, out);
        } else {
          const out = await handleOne(msg);
          if (!out) { res.writeHead(202); res.end(); return; } // 通知（notifications/initialized 等）
          sendJson(res, 200, out, extra);
        }
      } catch (e) { sendJson(res, 200, { jsonrpc: '2.0', id: null, error: { code: -32603, message: String(e) } }); }
    });
  });
  server.on('error', (e) => { console.log('[mcp] server error: ' + e); });
  server.listen(PORT, HOST, () => { console.log('[mcp] listening on ' + serverUrl()); });
  return { ok: true, url: serverUrl() };
}

function stop() { if (server) { try { server.close(); } catch (_) {} server = null; } }
function isRunning() { return !!server; }

module.exports = { start, stop, isRunning, url: serverUrl, TOOLS };
