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
    const css = ['tokens.css', 'ai.css', 'vibeWorkspace.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
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
      const conversation = document.querySelector('.chat-conversation');
      conversation.innerHTML = '<section class="chat-welcome"><h2>Build with ADCode</h2><p>Ask a question or describe a change to your project.</p></section><div class="chat-transcript"></div><form class="chat-composer"><textarea class="chat-input" placeholder="Ask about this project..."></textarea><div class="chat-toolbar"><button class="chat-team-button">@ Files</button><button class="chat-team-button">Team</button><button class="chat-team-button">Schedule</button><span class="chat-toolbar-spacer"></span><button class="chat-model">Model</button><button class="chat-send">↑</button></div></form><div class="chat-quick-actions"><button class="chat-quick-action">Build something</button><button class="chat-quick-action">Fix an error</button><button class="chat-quick-action">Explain this file</button></div>';
      card.dataset.inspectorOpen = 'false'; document.querySelector('.chat-inspector').hidden = true;
      let spacious = true, composerFits = true;
      for (const width of [1200, 850, 480]) {
        card.style.width = width + 'px'; update();
        conversation.dataset.empty = 'true';
        const form = conversation.querySelector('.chat-composer');
        const welcome = conversation.querySelector('.chat-welcome');
        const starters = conversation.querySelector('.chat-quick-actions');
        welcome.hidden = false; starters.hidden = false;
        const box = form.getBoundingClientRect(), area = conversation.getBoundingClientRect();
        spacious &&= box.top > area.top + 70 && box.height >= 130 && box.left >= area.left && box.right <= area.right && starters.getBoundingClientRect().bottom <= area.bottom;
        conversation.dataset.empty = 'false'; welcome.hidden = true; starters.hidden = true;
        conversation.querySelector('.chat-transcript').innerHTML = '<div class="chat-bubble chat-bubble-user">Create a calculator</div><div class="chat-working"><span class="chat-working-text">Thinking</span></div>';
        const active = form.getBoundingClientRect();
        composerFits &&= active.bottom <= area.bottom && active.top > area.top + 100 && conversation.scrollWidth <= conversation.clientWidth;
      }
      document.body.classList.add('vibe-workspace');
      const transcript = conversation.querySelector('.chat-transcript');
      transcript.innerHTML = '<div class="chat-bubble chat-bubble-user">hi</div>';
      const shortBubble = transcript.firstElementChild.getBoundingClientRect();
      const transcriptBox = transcript.getBoundingClientRect();
      const gutter = parseFloat(getComputedStyle(transcript).paddingRight);
      const shortPromptFits = shortBubble.width < 100 &&
        Math.abs(shortBubble.right - (transcriptBox.left + transcript.clientWidth - gutter)) < 2;
      transcript.firstElementChild.textContent = 'A longer prompt '.repeat(60);
      const longBubble = transcript.firstElementChild.getBoundingClientRect();
      const longPromptWraps = longBubble.width <= transcript.clientWidth * .8 + 2 &&
        longBubble.height > shortBubble.height;
      return { keyboard, conversationRoom, medium, compact, hidden, reset, spacious, composerFits, shortPromptFits, longPromptWraps };
    })()`);
    console.log('CHAT_LAYOUT_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
