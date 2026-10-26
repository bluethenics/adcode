/* Run the real chat tabs and styles in Chromium at an overflowing desktop width. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-chat-tabs-scroll-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'webTheme.css', 'webFrame.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ entryPoints: [resolve(renderer, 'workbench/webShell.ts')], bundle: true, write: false, format: 'iife', globalName: 'WebShell', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.documentElement.dataset.frame = 'web'; document.documentElement.dataset.reducedMotion = 'true';
      document.body.dataset.workspaceMode = 'vibe'; document.body.dataset.vibeRail = 'docked';
      const historyHost = document.createElement('div'); document.body.append(historyHost);
      historyHost.innerHTML = Array.from({length: 8}, (_, index) => '<div class="chat-history-row" data-session-id="chat-' + index + '"><button class="chat-history-open">Conversation ' + index + '</button></div>').join('');
      historyHost.lastElementChild.dataset.active = 'true';
      // about:blank has no persistent storage. Supply the eight already-open tabs.
      const sessionStorage = { getItem: () => JSON.stringify(Array.from({length: 8}, (_, index) => ({id: 'chat-' + index, title: 'Conversation ' + index}))), setItem: () => {} };
      ${bundle}
      const view = WebShell.createChatTabs({ historyHost, newChat: () => {}, leading: [], trailing: [] });
      document.body.append(view.element);
      view.element.style.cssText = 'position:static;display:flex;width:400px';
      const strip = view.element.querySelector('.web-tabs-strip');
      const wheel = (deltaY, extra = {}) => { const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...extra }); strip.dispatchEvent(event); return event.defaultPrevented; };
      strip.scrollLeft = 0;
      const overflowed = strip.scrollWidth > strip.clientWidth;
      const wheelMoves = wheel(120) && strip.scrollLeft > 0;
      wheel(10000);
      const last = strip.lastElementChild.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
      const lastTabReachable = last.right <= bounds.right + 1;
      const edgePasses = !wheel(100);
      const previous = strip.scrollLeft;
      const reverseMoves = wheel(-120) && strip.scrollLeft < previous;
      strip.scrollLeft = 0; const startPasses = !wheel(-100);
      const linesMove = wheel(3, { deltaMode: WheelEvent.DOM_DELTA_LINE }) && strip.scrollLeft >= 40;
      strip.scrollLeft = 0; const pagesMove = wheel(1, { deltaMode: WheelEvent.DOM_DELTA_PAGE }) && strip.scrollLeft >= strip.clientWidth - 1;
      const horizontalNative = !wheel(2, { deltaX: 100 });
      const zoomNative = !wheel(100, { ctrlKey: true });
      strip.replaceChildren(strip.firstElementChild);
      const noOverflowPasses = strip.scrollWidth === strip.clientWidth && !wheel(100);
      return { overflowed, wheelMoves, lastTabReachable, edgePasses, reverseMoves, startPasses, linesMove, pagesMove, horizontalNative, zoomNative, noOverflowPasses };
    })()`);
    console.log('CHAT_TABS_SCROLL_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
