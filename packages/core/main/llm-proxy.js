'use strict';
// LLM プロキシ（モデル③）。APIキーは main プロセスでのみ保持し、外部API（Anthropic / OpenAI互換）へ
// HTTPS 中継する。ローカル推論サーバ（OpenAI互換）にも対応。設定は userData に保存（プロジェクト/renderer には出さない）。
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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

// 共通メッセージ → Anthropic messages 形式
function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of (m.toolCalls || [])) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
      out.push({ role: 'assistant', content: blocks.length ? blocks : (m.content || '') });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }] });
    }
  }
  return out;
}

async function anthropicChat({ model, apiKey, baseUrl, system, timelineJson, messages, tools }) {
  const url = (baseUrl || 'https://api.anthropic.com') + '/v1/messages';
  const sys = system + '\n\n# 現在のタイムライン(JSON)\n' + (timelineJson || '');
  const body = {
    model: model || 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: sys,
    messages: toAnthropicMessages(messages),
    tools: (tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  };
  const r = await postJson(url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body);
  if (r.status !== 200 || !r.json) return { ok: false, error: 'Anthropic API エラー (' + r.status + '): ' + (r.json && r.json.error && r.json.error.message || r.text || '').slice(0, 300) };
  let text = '';
  const toolCalls = [];
  for (const block of (r.json.content || [])) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
  }
  return { ok: true, text, toolCalls };
}

// OpenAI 互換（function calling / tools）。ローカル推論(OpenAI互換)も baseUrl で対応。
function toOpenAiMessages(system, timelineJson, messages) {
  const out = [{ role: 'system', content: system + '\n\n# 現在のタイムライン(JSON)\n' + (timelineJson || '') }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content || '', tool_calls: (m.toolCalls || []).map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}
async function openaiChat({ model, apiKey, baseUrl, system, timelineJson, messages, tools }) {
  const url = (baseUrl || 'https://api.openai.com') + '/v1/chat/completions';
  const body = {
    model: model || 'gpt-4o-mini',
    messages: toOpenAiMessages(system, timelineJson, messages),
    tools: (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
  };
  const headers = {}; if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  const r = await postJson(url, headers, body);
  if (r.status !== 200 || !r.json) return { ok: false, error: 'OpenAI API エラー (' + r.status + '): ' + (r.text || '').slice(0, 300) };
  const msg = r.json.choices && r.json.choices[0] && r.json.choices[0].message;
  const toolCalls = ((msg && msg.tool_calls) || []).map((tc) => { let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch (_) {} return { id: tc.id, name: tc.function.name, args: a }; });
  return { ok: true, text: (msg && msg.content) || '', toolCalls };
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
