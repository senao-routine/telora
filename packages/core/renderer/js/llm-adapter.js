// LLM プロバイダ（renderer 側）。main の llm-chat IPC を叩くだけの薄いアダプタ。
// APIキーは main 側にあり、ここでは扱わない。
export function makeLlmProvider() {
  return async ({ system, timeline, messages, tools }) => {
    const res = await window.api.llmChat({ system, timelineJson: JSON.stringify(timeline), messages, tools });
    if (!res || !res.ok) {
      const e = new Error((res && res.error) || 'LLM呼び出しに失敗しました');
      e.needSetup = !!(res && res.needSetup);
      throw e;
    }
    return { text: res.text || '', toolCalls: res.toolCalls || [] };
  };
}
