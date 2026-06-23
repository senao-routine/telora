// チャットのオーケストレータ（モデル③）。LLMには「自由実行」させず、EditCommands のツールだけを
// function calling で呼ばせ、実行は EditCommands.run が握る（安全・決定的・undo可能）。
// llm はプロバイダ非依存の関数: ({ system, timeline, messages, tools }) => { text?, toolCalls?[] }。
import { run } from './commands/edit-commands.js';
import { llmTools, CMD_BY_TOOL, isDestructiveTool } from './commands/tool-catalog.js';

export const SYSTEM_PROMPT = [
  'あなたは動画編集ソフト「Telora」のアシスタントです。ユーザーの日本語の指示を、提供されたツール呼び出しに変換して編集を行います。',
  '必ずツールを使って編集してください（自由なコードや説明だけで終わらせない）。',
  '対象クリップが曖昧なときは、まず get_timeline で現在の状態を確認し、id を特定してから実行してください。',
  '破壊的な操作（カット・削除・移動・書き出し）はユーザー確認が入る場合があります。',
  '作業が完了したら、何をしたかを日本語で簡潔に説明してください。',
].join('\n');

// 1ターン実行。onConfirm(toolCall)→Promise<bool>、onEvent(event) で逐次UI更新。
// 返り値: { final: string, events: [...], messages: [...] }
export async function runChatTurn(userText, { llm, onConfirm, onEvent, maxSteps = 6, history = [] } = {}) {
  if (typeof llm !== 'function') throw new Error('llm provider が未指定です');
  const messages = history.slice();
  messages.push({ role: 'user', content: userText });
  const events = [];
  const emit = (ev) => { events.push(ev); if (onEvent) { try { onEvent(ev); } catch (_) {} } };
  const tools = llmTools();

  for (let step = 0; step < maxSteps; step++) {
    const timeline = (await run('getTimeline')).result; // 毎ターン最新状態を渡す
    let resp;
    try { resp = await llm({ system: SYSTEM_PROMPT, timeline, messages, tools }); }
    catch (e) { const msg = 'AIの呼び出しに失敗しました: ' + String((e && e.message) || e); emit({ type: 'error', text: msg }); return { final: msg, events, messages, error: true }; }

    if (resp.text) emit({ type: 'assistant', text: resp.text });
    const calls = resp.toolCalls || [];
    if (!calls.length) { return { final: resp.text || '（応答なし）', events, messages }; }

    messages.push({ role: 'assistant', content: resp.text || '', toolCalls: calls });

    for (const tc of calls) {
      const cmd = CMD_BY_TOOL[tc.name] || tc.name;
      emit({ type: 'tool-start', name: tc.name, args: tc.args });
      if (isDestructiveTool(tc.name) && onConfirm) {
        let ok = true;
        try { ok = await onConfirm(tc); } catch (_) { ok = false; }
        if (!ok) {
          const out = { ok: false, error: 'ユーザーがこの操作をキャンセルしました' };
          messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: JSON.stringify(out) });
          emit({ type: 'tool-result', name: tc.name, ok: false, cancelled: true });
          continue;
        }
      }
      const res = await run(cmd, tc.args || {});
      messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: JSON.stringify(res) });
      emit({ type: 'tool-result', name: tc.name, ok: res.ok, result: res.result, error: res.error });
    }
  }
  const msg = '（ステップ上限に達したため中断しました）';
  emit({ type: 'assistant', text: msg });
  return { final: msg, events, messages };
}
