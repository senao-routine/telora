// アプリ内AIチャット（モデル③）。右側ドロワーのUI。ユーザーの指示を runChatTurn に渡し、
// LLM が EditCommands のツールを呼んで編集する。破壊的操作は確認、結果は逐次表示。model==='chat' 時のみ読み込む。
import { el } from './util.js';
import { runChatTurn } from './chat-orchestrator.js';
import { makeLlmProvider } from './llm-adapter.js';
import { isDestructiveTool } from './commands/tool-catalog.js';

let drawer, msgsEl, inputEl, sendBtn, statusEl;
let busy = false;
const llm = makeLlmProvider();
let history = [];

export function initChatPanel() {
  buildToggle();
  buildDrawer();
  refreshStatus();
}

function buildToggle() {
  const btn = el('button', { class: 'chat-fab', title: 'AIチャットを開閉', onClick: () => toggleDrawer() }, ['🤖 AIチャット']);
  document.body.appendChild(btn);
}

function buildDrawer() {
  msgsEl = el('div', { class: 'chat-msgs' }, [el('div', { class: 'chat-hint', text: '例:「この動画の無音を全部カットして」「最初の3秒にタイトルのテロップを入れて」' })]);
  inputEl = el('textarea', { class: 'chat-input', rows: '2', placeholder: 'AIに編集を指示…（Enterで送信 / Shift+Enterで改行）' });
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  sendBtn = el('button', { class: 'btn btn-primary', onClick: () => send() }, ['送信']);
  statusEl = el('span', { class: 'chat-status' });
  drawer = el('div', { class: 'chat-drawer', hidden: 'hidden' }, [
    el('div', { class: 'chat-head' }, [
      el('span', { class: 'chat-title', text: '🤖 AIチャット編集' }),
      el('div', { class: 'chat-head-actions' }, [
        el('button', { class: 'mini-btn', title: 'API設定', onClick: () => openSettings() }, ['⚙']),
        el('button', { class: 'mini-btn', title: '閉じる', onClick: () => toggleDrawer(false) }, ['✕']),
      ]),
    ]),
    msgsEl,
    el('div', { class: 'chat-foot' }, [statusEl, el('div', { class: 'chat-inputrow' }, [inputEl, sendBtn])]),
  ]);
  document.body.appendChild(drawer);
}

function toggleDrawer(force) {
  const show = force != null ? force : drawer.hidden;
  drawer.hidden = !show;
  if (show) { refreshStatus(); setTimeout(() => inputEl && inputEl.focus(), 0); }
}

async function refreshStatus() {
  try {
    const c = await window.api.llmConfigGet();
    if (!c.hasKey && c.provider !== 'local') { statusEl.textContent = '⚠ APIキー未設定（⚙から設定）'; statusEl.className = 'chat-status warn'; }
    else { statusEl.textContent = `接続: ${c.provider} / ${c.model || '(モデル未設定)'}`; statusEl.className = 'chat-status'; }
  } catch (_) { statusEl.textContent = ''; }
}

function bubble(cls, text) { const b = el('div', { class: 'chat-bubble ' + cls, text }); msgsEl.appendChild(b); msgsEl.scrollTop = msgsEl.scrollHeight; return b; }
function toolLine(text, cls) { const b = el('div', { class: 'chat-tool ' + (cls || ''), text }); msgsEl.appendChild(b); msgsEl.scrollTop = msgsEl.scrollHeight; return b; }

async function send() {
  if (busy) return;
  const text = (inputEl.value || '').trim();
  if (!text) return;
  inputEl.value = '';
  bubble('user', text);
  busy = true; sendBtn.disabled = true; const thinking = toolLine('考え中…', 'thinking');

  const onEvent = (ev) => {
    if (ev.type === 'assistant' && ev.text) bubble('ai', ev.text);
    else if (ev.type === 'tool-start') toolLine('▶ ' + ev.name + '(' + briefArgs(ev.args) + ')', 'run');
    else if (ev.type === 'tool-result') toolLine((ev.ok ? '✓ ' : (ev.cancelled ? '⊘ ' : '✗ ')) + ev.name + (ev.ok ? '' : (ev.cancelled ? '（キャンセル）' : '：' + (ev.error || 'エラー'))), ev.ok ? 'ok' : 'err');
    else if (ev.type === 'error') bubble('err', ev.text);
  };
  const onConfirm = (tc) => Promise.resolve(window.confirm(`AIが破壊的な操作を実行しようとしています:\n\n${tc.name}(${briefArgs(tc.args)})\n\n実行しますか？（取り消しは Cmd/Ctrl+Z）`));

  try {
    const res = await runChatTurn(text, { llm, onConfirm, onEvent, history });
    history = res.messages.slice(-12); // 直近の文脈だけ保持
  } catch (e) {
    if (e && e.needSetup) bubble('err', 'APIキーが未設定です。⚙から設定してください。');
    else bubble('err', 'エラー: ' + String((e && e.message) || e));
  } finally {
    thinking.remove(); busy = false; sendBtn.disabled = false; inputEl.focus();
  }
}

function briefArgs(args) {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args).map(([k, v]) => `${k}:${typeof v === 'object' ? '…' : String(v).slice(0, 18)}`).join(', ').slice(0, 60);
}

// ---- API 設定モーダル ----
async function openSettings() {
  const c = await window.api.llmConfigGet();
  const provSel = el('select', { class: 'select', style: 'width:100%' }, ['anthropic', 'openai', 'local'].map((p) => el('option', { value: p, ...(c.provider === p ? { selected: 'selected' } : {}) }, [p])));
  const modelIn = el('input', { type: 'text', class: 'chat-field', value: c.model || '', placeholder: '例: claude-sonnet-4-6 / gpt-4o-mini' });
  const keyIn = el('input', { type: 'password', class: 'chat-field', placeholder: c.hasKey ? '（設定済み・変更する場合のみ入力）' : 'APIキーを入力' });
  const baseIn = el('input', { type: 'text', class: 'chat-field', value: c.baseUrl || '', placeholder: 'ローカル/互換時のベースURL（任意）' });
  const overlay = el('div', { class: 'chat-modal-bg', onClick: (e) => { if (e.target === overlay) overlay.remove(); } }, [
    el('div', { class: 'chat-modal' }, [
      el('div', { class: 'chat-modal-title', text: 'AIチャット API設定' }),
      el('label', { class: 'chat-lbl', text: 'プロバイダ' }), provSel,
      el('label', { class: 'chat-lbl', text: 'モデル' }), modelIn,
      el('label', { class: 'chat-lbl', text: 'APIキー（main側に安全に保存）' }), keyIn,
      el('label', { class: 'chat-lbl', text: 'ベースURL（任意・ローカル/互換用）' }), baseIn,
      el('p', { class: 'chat-note', text: '外部APIは任意（オプトイン）。キーはアプリ内部にのみ保存され、プロジェクトには含まれません。' }),
      el('div', { class: 'chat-modal-actions' }, [
        el('button', { class: 'btn', onClick: () => overlay.remove() }, ['キャンセル']),
        el('button', { class: 'btn btn-primary', onClick: async () => {
          const cfg = { provider: provSel.value, model: modelIn.value.trim(), baseUrl: baseIn.value.trim() };
          if (keyIn.value) cfg.apiKey = keyIn.value;
          await window.api.llmConfigSet(cfg); overlay.remove(); refreshStatus();
        } }, ['保存']),
      ]),
    ]),
  ]);
  document.body.appendChild(overlay);
}
