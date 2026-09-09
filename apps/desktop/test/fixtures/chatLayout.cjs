const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const ts = require('typescript');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-chat-layout-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'ai.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const compiled = ts.transpileModule(readFileSync(resolve(renderer, 'ai/chatLayout.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.body.innerHTML = '<section class="chat-card" data-history-open="true" data-inspector-open="true" style="width:1200px;height:700px"><header class="chat-header"></header><div class="chat-body"><aside class="chat-history"></aside><main class="chat-conversation"></main><aside class="chat-inspector"></aside></div></section>';
      const exports = {}; ${compiled}
      const card = document.querySelector('.chat-card'), body = document.querySelector('.chat-body');
      const update = exports.attachChatLayout(card, body); update();
      const handles = [...document.querySelectorAll('[role=separator]')];
      handles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      const keyboard = document.querySelector('.chat-history').getBoundingClientRect().width === 256;
      handles[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
      const conversationRoom = document.querySelector('.chat-conversation').getBoundingClientRect().width >= 360;
      card.style.width = '850px'; update();
      const medium = card.dataset.layout === 'medium' && getComputedStyle(document.querySelector('.chat-inspector')).position === 'absolute';
      card.style.width = '600px'; update();
      const compact = card.dataset.layout === 'compact' && document.querySelector('.chat-conversation').getBoundingClientRect().width === 600;
      card.dataset.historyOpen = 'false'; document.querySelector('.chat-history').hidden = true; update();
      const hidden = handles[0].hidden && document.querySelector('.chat-history').getBoundingClientRect().width === 0;
      card.style.width = '1200px'; update();
      handles[0].dispatchEvent(new MouseEvent('dblclick'));
      const reset = handles[0].getAttribute('aria-valuenow') === '240';
      return { keyboard, conversationRoom, medium, compact, hidden, reset };
    })()`);
    console.log('CHAT_LAYOUT_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
