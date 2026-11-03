/* Real main-chat events and DOM; the fixture never reads the user's profile or project. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-chat-work-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1040, height: 760, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.setPosition(-4000, 0); win.showInactive();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const root = resolve(__dirname, '../../../..');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = [...readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(match => readFileSync(join(renderer, 'styles', match[1]), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ stdin: { contents: `export { createChatWidget } from './ai/chatWidget.ts';`, resolveDir: renderer }, tsconfig: join(root, 'tsconfig.json'), bundle: true, write: false, format: 'iife', globalName: 'ChatWork', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
    const results = await win.webContents.executeJavaScript(`(async () => {
      const errors = []; window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
      window.addEventListener('error', event => { if (event.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(event.message); });
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} + 'body{display:block;margin:0;background:var(--bg-app)}#fixture{height:100vh}.chat-card{position:relative!important;animation:none!important}.chat-transcript{scroll-behavior:auto!important}' }));
      document.documentElement.dataset.theme = 'dark'; document.body.dataset.workspaceMode = 'vibe';
      document.body.innerHTML = '<main id="fixture" class="vibe-workspace"></main><aside id="history"></aside>';
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (test, label) => { const deadline = Date.now() + 4000; while (!test()) { if (Date.now() >= deadline) throw new Error(label + ' did not settle'); await pause(20); } };
      const listeners = new Map();
      const group = (name, values = {}) => new Proxy(values, { get(target, key) { return target[key] ?? (String(key).startsWith('on') ? listener => { const label = name + '.' + key; const entries = listeners.get(label) ?? []; entries.push(listener); listeners.set(label, entries); return () => {}; } : async () => null); } });
      const emit = (key, event) => { for (const listener of listeners.get(key) ?? []) listener(event); };
      const settings = { 'adcode.ai.provider': 'tagflow', 'adcode.ai.model': 'tagflow-code-27b' };
      const saved = { id: 'saved-chat', title: 'Earlier edits', messages: [{ role: 'user', text: 'Build the app', at: 1000 }, { role: 'assistant', text: 'Built three files.', at: 2000 }], createdAt: 1000, updatedAt: 2000 };
      const checkpoint = { id: 'cp-saved-checkpoint', createdAt: 2010, undone: true, files: [{ path: 'app.js', created: true, added: 2, removed: 0, hunks: [] }] };
      const api = {
        settings: group('settings', { read: async () => settings }),
        ai: group('ai', { status: async () => ({ ready: true, activeProvider: 'tagflow', activeModel: 'tagflow-code-27b', providers: [], connections: [] }), contextUsage: async () => ({ tokens: 1000, contextWindow: 262144 }), checkpoints: async id => id === saved.id ? [checkpoint] : [] }),
        chat: group('chat', { sessions: async () => [saved], current: async () => null, resume: async () => saved }),
        aiWorkspace: group('aiWorkspace', { list: async () => [], current: async () => null }),
        aiTeam: group('aiTeam', { list: async () => [] }), aiAutomation: group('aiAutomation', { list: async () => [], due: async () => [] }),
        aiUsage: group('aiUsage', { read: async () => ({ inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0, models: [], entries: [] }), allowance: async () => ({ available: false }) }),
      };
      window.adcode = new Proxy(api, { get(target, key) { return target[key] ?? group(String(key)); } });
      ${bundle}
      const widget = ChatWork.createChatWidget({ openExternalPath() {}, openConnect() {}, saveAllOpenFiles() {}, requestOpen: () => widget.shown(false), requestClose: () => widget.hidden(), askForName: async () => null, mentionFiles: async () => [] });
      document.querySelector('#fixture').append(widget.element); widget.setDocked(true, document.querySelector('#history')); widget.setWorkspace('/fixture-project'); widget.shown(false); await pause(180);
      const transcript = document.querySelector('.chat-transcript');
      emit('ai.onEvent', { kind: 'thinking', text: 'not displayed' });
      const older = document.createElement('div'); older.style.height = '550px'; transcript.prepend(older);
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-1', name: 'propose_edit', path: 'app.js', edit: 0, append: 'const first = 1;\\n' });
      await waitFor(() => transcript.querySelector('.live-code-lines')?.textContent.includes('const first'), 'First code draft');
      // The reader is at the latest line when the code starts, as sending a message leaves
      // them. (The older block above went in while the empty transcript was hidden; since the
      // transcript's items stopped shrinking to fit, it really overflows.)
      transcript.scrollTop = transcript.scrollHeight; transcript.dispatchEvent(new Event('scroll')); await pause(20);
      const live = transcript.querySelector('.live-window-inline');
      const typingInline = live.parentElement === transcript && live.querySelector('.live-window-status').textContent === 'Typing' && live.querySelector('.live-code-tab').textContent === 'app.js' && document.querySelector('.chat-turn-status').textContent === 'Writing app.js' && !!live.querySelector('.live-caret');
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-1', name: 'propose_edit', path: 'app.js', edit: 0, append: Array.from({length: 7}, (_, index) => 'const row' + index + ' = ' + index + ';').join('\\n') + '\\n' });
      await waitFor(() => live.querySelector('.live-code-lines').textContent.includes('row6'), 'Growing code'); await pause(100);
      const followsGrowingCode = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 3;
      transcript.scrollTop = 0; transcript.dispatchEvent(new Event('scroll'));
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-1', name: 'propose_edit', path: 'app.js', edit: 0, append: '\\nconst last = true;\\n' });
      await waitFor(() => live.querySelector('.live-code-lines').textContent.includes('const last'), 'Last code'); await pause(100);
      const respectsScrollUp = transcript.scrollTop === 0;
      emit('ai.onEvent', { kind: 'tool-call', call: { id: 'write-1', name: 'propose_edit', input: { path: 'app.js', contents: 'const first = 1;\\n' } } });
      emit('ai.onEvent', { kind: 'tool-result', toolCallId: 'write-1', name: 'propose_edit', content: 'Written', isError: false });
      emit('ai.onEvent', { kind: 'turn-end' }); await pause(100);
      const settlesCode = live.dataset.settled === 'true' && live.querySelector('.live-window-status').textContent === 'Done' && live.querySelector('.live-code-lines').textContent.includes('const last');
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-2', name: 'edit_file', path: 'styles.css', edit: 0, append: 'body { color: green; }' });
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-2', name: 'edit_file', path: 'styles.css', edit: 0, append: '\\nmain { display: grid; }' });
      await pause(120);
      const oneWindowPerTurn = transcript.querySelectorAll('.live-window-inline').length === 2;
      // The turn's cards follow the work: something lands below them, the next update brings
      // them back under it - plan first, then the live window.
      emit('ai.onEvent', { kind: 'tool-call', call: { id: 'plan-1', name: 'update_plan', input: { steps: [{ step: 'Style the page', status: 'in_progress' }, { step: 'Check it', status: 'pending' }] } } });
      await pause(40);
      const landed = document.createElement('p'); landed.className = 'landed-below'; transcript.append(landed);
      emit('ai.onEvent', { kind: 'tool-draft', id: 'write-2', name: 'edit_file', path: 'styles.css', edit: 0, append: '\\nfooter { gap: 8px; }' });
      await pause(120);
      const plan = transcript.querySelector('.chat-plan'), secondWindow = transcript.querySelectorAll('.live-window-inline')[1];
      const below = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const lastTurn = () => [...transcript.querySelectorAll('.chat-turn')].at(-1);
      const cardsFollowTheWork = !!plan && !!lastTurn() && below(landed, plan) && below(plan, secondWindow) && below(lastTurn(), plan);
      emit('ai.onEvent', { kind: 'text', text: '| File | Purpose |\\n|---|---|\\n| index.html | App shell |\\n| styles.css | Styling |\\n| app.js | Logic |\\n\\n| A | B | C | D | E | F |\\n|---|---|---|---|---|---|\\n|1|2|3|4|5|6|' });
      await waitFor(() => transcript.querySelectorAll('table').length === 2, 'Real tables');
      const table = transcript.querySelector('table');
      const realTable = table.querySelectorAll('thead th[scope="col"]').length === 2 && table.querySelectorAll('tbody tr').length === 3 && getComputedStyle(table).borderCollapse === 'collapse';
      document.querySelector('#fixture').style.width = '420px'; await pause(120);
      const wide = transcript.querySelectorAll('.chat-md-table-wrap')[1];
      const narrowTable = wide.scrollWidth > wide.clientWidth && getComputedStyle(wide).overflowX === 'auto' && wide.tabIndex === 0;
      emit('ai.onEvent', { kind: 'turn-end' }); await pause(60);
      // Settled: plan, the code it wrote, then the folded steps - and the answer last.
      const finishedTurn = lastTurn();
      const cardsSettleAboveTheTurn = below(plan, finishedTurn) && below(secondWindow, finishedTurn) && below(finishedTurn, transcript.querySelectorAll('table')[1]);
      widget.newConversation(); await pause(100);
      const continueButton = [...document.querySelectorAll('.chat-quick-action')].find(button => button.textContent.startsWith('Continue'));
      if (!continueButton) throw new Error('Missing continue saved chat control');
      continueButton.click(); await waitFor(() => transcript.querySelector('[data-checkpoint-id="cp-saved-checkpoint"]'), 'Restored edit card');
      const card = transcript.querySelector('.chat-checkpoint');
      const restoredCard = card.querySelector('.chat-checkpoint-file').textContent === 'app.js' && !!card.querySelector('.chat-checkpoint-review') && transcript.textContent.indexOf('Built three files.') < transcript.textContent.indexOf('Undid edits');
      const restoredUndoState = card.dataset.state === 'undone' && card.querySelector('.chat-checkpoint-undo').hidden;
      const historyButton=document.querySelector('.chat-history-open'); historyButton.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));
      const hoverPreview=document.querySelector('.chat-hover-preview');
      const chatPreview=!!hoverPreview&&hoverPreview.textContent.includes('Earlier edits')&&hoverPreview.textContent.includes('2 messages')&&!hoverPreview.querySelector('img');
      historyButton.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
      const previewDismissed=!document.querySelector('.chat-hover-preview');
      return { chatPreview, previewDismissed, typingInline, followsGrowingCode, respectsScrollUp, settlesCode, oneWindowPerTurn, cardsFollowTheWork, cardsSettleAboveTheTurn, realTable, narrowTable, restoredCard, restoredUndoState, errors };
    })()`);
    console.log('CHAT_WORK_RESULTS=' + JSON.stringify(results)); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
