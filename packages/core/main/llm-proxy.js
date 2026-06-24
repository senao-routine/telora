'use strict';
// LLM プロキシ（モデル③）。APIキーは main プロセスでのみ保持し、外部API（Anthropic / OpenAI互換）へ
// HTTPS 中継する。ローカル推論サーバ（OpenAI互換）にも対応。設定は userData に保存（プロジェクト/renderer には出さない）。
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const fmt = require('./llm-format'); // メッセージ整形（純粋関数・単体テスト済み）

function configPath() { return path.join(app.getPath('userData'), 'llm-config.json'); }

function getConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch (_) { return { provider: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '', baseUrl: '' }; }
}
function setConfig(cfg) {
  try {
    const cur = getConfig();
    const next = Object.assign({}, cur, cfg || {});
    fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
// renderer へ返す設定（APIキーは伏せ、有無だけ）
function getConfigSafe() {
  const c = getConfig();
  return { provider: c.provider || 'anthropic', model: c.model || '', baseUrl: c.baseUrl || '', hasKey: !!c.apiKey };
}

// HTTP(S) で JSON を POST
function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const body = Buffer.from(JSON.stringify(bodyObj));
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': body.length }, headers),
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function anthropicChat({ model, apiKey, baseUrl, system, timelineJson, messages, tools }) {
  const url = (baseUrl || 'https://api.anthropic.com') + '/v1/messages';
  const body = fmt.buildAnthropicBody({ model, system, timelineJson, messages, tools });
  const r = await postJson(url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body);
  if (r.status !== 200 || !r.json) return { ok: false, error: 'Anthropic API エラー (' + r.status + '): ' + (r.json && r.json.error && r.json.error.message || r.text || '').slice(0, 300) };
  return Object.assign({ ok: true }, fmt.parseAnthropicResponse(r.json));
}

// OpenAI 互換（function calling / tools）。ローカル推論(OpenAI互換)も baseUrl で対応。
async function openaiChat({ model, apiKey, baseUrl, system, timelineJson, messages, tools }) {
  const url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions';
  const body = fmt.buildOpenAiBody({ model, system, timelineJson, messages, tools });
  const headers = {}; if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const r = await postJson(url, headers, body);
  if (r.status !== 200 || !r.json) return { ok: false, error: 'OpenAI API エラー (' + r.status + '): ' + (r.text || '').slice(0, 300) };
  return Object.assign({ ok: true }, fmt.parseOpenAiResponse(r.json));
}

async function llmChat(payload) {
  const cfg = getConfig();
  const provider = (payload && payload.provider) || cfg.provider || 'anthropic';
  const model = (payload && payload.model) || cfg.model;
  const apiKey = cfg.apiKey; // キーは常に main 保持のものを使う（renderer から受け取らない）
  const baseUrl = cfg.baseUrl;
  const isLocal = provider === 'local' || (baseUrl && /^http:\/\/(127\.0\.0\.1|localhost)/.test(baseUrl));
  if (!apiKey && !isLocal) return { ok: false, error: 'APIキーが未設定です。設定画面でAPIキーを入力してください。', needSetup: true };
  const args = { model, apiKey, baseUrl, system: payload.system, timelineJson: payload.timelineJson, messages: payload.messages || [], tools: payload.tools || [] };
  try {
    if (provider === 'openai' || provider === 'local') return await openaiChat(args);
    return await anthropicChat(args);
  } catch (e) { return { ok: false, error: 'LLM呼び出しエラー: ' + String((e && e.message) || e) }; }
}

module.exports = { llmChat, getConfigSafe, setConfig };
