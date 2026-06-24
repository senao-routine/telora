'use strict';
// LLM メッセージ整形（純粋関数・electron 非依存＝単体テスト可能）。
// 共通メッセージ {role:'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name?} を
// 各プロバイダのAPI形式へ変換し、応答を {text, toolCalls} に正規化する。

// 共通 → Anthropic messages。
// 重要: Anthropic は user/assistant の交互が必須。1ターンで複数ツールが呼ばれた場合の tool_result は
// 連続 user にならないよう、直前の tool_result(user) メッセージへブロックをまとめる。
function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of (m.toolCalls || [])) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
      out.push({ role: 'assistant', content: blocks.length ? blocks : (m.content || '') });
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
      const last = out[out.length - 1];
      // 直前も tool_result(user・配列content) ならまとめる＝user の連続を防ぐ
      if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

function buildAnthropicBody({ model, system, timelineJson, messages, tools, maxTokens = 1024 }) {
  return {
    model: model || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: (system || '') + '\n\n# 現在のタイムライン(JSON)\n' + (timelineJson || ''),
    messages: toAnthropicMessages(messages || []),
    tools: (tools || []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  };
}

function parseAnthropicResponse(json) {
  let text = '';
  const toolCalls = [];
  for (const block of ((json && json.content) || [])) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: block.input || {} });
  }
  return { text, toolCalls };
}

// 共通 → OpenAI chat messages（tool ロールは連続OKなので単純変換）
function toOpenAiMessages(system, timelineJson, messages) {
  const out = [{ role: 'system', content: (system || '') + '\n\n# 現在のタイムライン(JSON)\n' + (timelineJson || '') }];
  for (const m of (messages || [])) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.content || '', tool_calls: (m.toolCalls || []).map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } })) });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
  }
  return out;
}

function buildOpenAiBody({ model, system, timelineJson, messages, tools }) {
  return {
    model: model || 'gpt-4o-mini',
    messages: toOpenAiMessages(system, timelineJson, messages || []),
    tools: (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
  };
}

function parseOpenAiResponse(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  const toolCalls = ((msg && msg.tool_calls) || []).map((tc) => {
    let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
    return { id: tc.id, name: tc.function.name, args: a };
  });
  return { text: (msg && msg.content) || '', toolCalls };
}

module.exports = { toAnthropicMessages, buildAnthropicBody, parseAnthropicResponse, toOpenAiMessages, buildOpenAiBody, parseOpenAiResponse };
