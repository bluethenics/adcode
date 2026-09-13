const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const ts = require('typescript');
const output = mkdtempSync(join(tmpdir(), 'adcode-connect-review-'));
app.setPath('userData', join(output, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: { backgroundThrottling: false } });
  try {
    win.webContents.on('console-message', event => {
      if (event.level === 'error') console.error(event.message);
    });
    await win.loadURL('about:blank');
    win.setContentSize(1100, 850);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens', 'workbench', 'settings', 'ai', 'design-system', 'connect']
      .map(name => readFileSync(join(renderer, 'styles', name + '.css'), 'utf8')).join('\n');
    const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const connections = compile(resolve(__dirname, '../../../../packages/ai/src/connections.ts'));
    const view = compile(join(renderer, 'ai/connectView.ts'));
    const results = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)} + ' body{display:block;padding:20px;overflow:auto} .fixture{height:760px;width:980px;border:1px solid var(--border-hairline);border-radius:16px;overflow:hidden}'; document.head.append(style);
      document.documentElement.dataset.theme = 'dark';
      const exports = {}; ${connections}
      const require = () => exports;
      ${view}
      const make = (id, displayName, hasKey, needsKey, models) => ({ id, displayName, hasKey, needsKey, models, transport: 'native', doc: null });
      const model = (id, name, reasoning = false) => ({ id, name, reasoning, toolCall: true });
      let state = { providers: [
        make('anthropic', 'Anthropic', false, true, [model('claude-fast', 'Fast model'), model('claude-reasoning', 'Reasoning model', true)]),
        make('openai', 'OpenAI', true, true, [model('openai-default', 'Default model')]),
        make('local', 'Local models', false, false, [model('local-model', 'Local model')]),
      ], activeProvider: 'openai', activeModel: 'openai-default', ready: true, connections: [], customBaseUrl: '', catalogueTakenOn: '2026-09-12', catalogueIsLive: false };
      let failLoad = true, keyAccepted = false, savedKeys = 0;
      const fixture = document.createElement('div'); fixture.className = 'fixture'; document.body.append(fixture);
      const result = {};
      const ui = exports.createConnectView({
        status: async () => { if (failLoad) throw new Error('Providers could not be loaded'); return state; },
        checkKey: async () => ({ ok: keyAccepted, message: 'Key was rejected' }),
        setKey: async id => { savedKeys++; state = { ...state, providers: state.providers.map(p => p.id === id ? { ...p, hasKey: true } : p) }; return state; },
        clearKey: async () => { throw new Error('Password store unavailable'); },
        write: async (id, value) => {
          if (id === 'adcode.ai.provider') state = { ...state, activeProvider: value };
          if (id === 'adcode.ai.model') state = { ...state, activeModel: value };
          if (id === 'adcode.ai.connections') state = { ...state, connections: JSON.parse(value) };
        }, requestOpen() {}, requestClose() {},
      });
      fixture.append(ui.element); ui.shown();
      const settle = () => new Promise(resolve => setTimeout(resolve, 70));
      const clickText = text => [...fixture.querySelectorAll('button')].find(button => button.textContent === text).click();
      await settle();
      result.loadError = !!fixture.querySelector('[role=alert]');
      failLoad = false; clickText('Try again'); await settle();
      result.retry = fixture.querySelectorAll('.connect-row').length === 3 && !fixture.querySelector('[role=alert]');
      fixture.querySelector('.connect-row').click();
      result.providerFocus = document.activeElement.matches('.connect-row[aria-pressed=true]');
      const search = fixture.querySelector('.connect-model-search'); search.value = 'reasoning'; search.dispatchEvent(new Event('input'));
      result.modelSearch = fixture.querySelectorAll('.connect-model:not([hidden])').length === 1;
      search.value = 'missing'; search.dispatchEvent(new Event('input'));
      result.emptySearch = fixture.querySelector('.connect-model-count').textContent === 'No models match your search.';
      search.value = ''; search.dispatchEvent(new Event('input'));
      fixture.querySelector('.connect-show-key').click();
      result.showKey = fixture.querySelector('.connect-key-row input').type === 'text' && fixture.querySelector('.connect-show-key').getAttribute('aria-pressed') === 'true';
      fixture.querySelector('.connect-show-key').click();
      const key = fixture.querySelector('.connect-key-row input'); key.value = 'test-fixture-only'; clickText('Check and save'); await settle();
      result.rejectedKeyNotSaved = savedKeys === 0 && fixture.querySelector('.connect-result[data-tone=error]').textContent === 'Key was rejected';
      result.retryEnabled = [...fixture.querySelectorAll('button')].some(button => button.textContent === 'Check and save' && !button.disabled);
      keyAccepted = true; clickText('Check and save'); await settle();
      result.verifiedKeySaved = savedKeys === 1 && state.activeProvider === 'anthropic' && fixture.querySelector('.connect-key-row input').value === '';
      fixture.querySelectorAll('.connect-model')[1].click(); await settle();
      result.modelSelection = state.activeModel === 'claude-reasoning' && fixture.querySelector('.connect-model[aria-pressed=true]')?.textContent.includes('Reasoning model');
      result.savedKeyDisclosure = !fixture.querySelector('.connect-key-section').open;
      fixture.querySelector('.connect-key-section').open = true;
      clickText('Forget key'); await settle();
      result.forgetFailureVisible = fixture.querySelector('.connect-result[data-tone=error]')?.textContent === 'Password store unavailable';
      clickText('+ Add connection');
      result.profileFocus = document.activeElement.getAttribute('aria-label') === 'Connection name' && fixture.querySelectorAll('.connect-row[aria-pressed=true]').length === 0;
      clickText('Use NVIDIA NIM preset');
      result.preset = fixture.querySelector('[aria-label="API base URL"]').value === exports.NIM_BASE_URL;
      clickText('Back to provider');
      result.back = !!fixture.querySelector('.connect-key-section') && !!fixture.querySelector('.connect-row[aria-pressed=true]');
      result.responsive = true;
      for (const width of [980, 600, 360]) {
        fixture.style.width = width + 'px'; await settle();
        const panel = fixture.querySelector('.connect-panel');
        const detail = fixture.querySelector('.connect-detail');
        const close = fixture.querySelector('.connect-header > button');
        const footer = fixture.querySelector('.connect-footer');
        result.responsive &&= panel.scrollWidth <= panel.clientWidth + 1 && detail.scrollWidth <= detail.clientWidth + 1 && close.getBoundingClientRect().right <= panel.getBoundingClientRect().right && footer.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom + 1;
      }
      fixture.style.width = '980px';
      fixture.querySelector('.connect-detail').scrollTop = 0;
      ui.hidden();
      return result;
    })().catch(error => ({ fixtureError: error.stack }))`);
    if (results.fixtureError) throw new Error(results.fixtureError);
    if (process.env.ADCODE_CONNECT_SCREENSHOTS) {
      for (const width of [980, 600, 360]) {
        await win.webContents.executeJavaScript(`document.querySelector('.fixture').style.width = '${width}px'; document.querySelector('.connect-detail').scrollTop = 0;`);
        await win.webContents.capturePage();
        await new Promise(resolve => setTimeout(resolve, 180));
        writeFileSync(join(output, `connect-${width}.png`), (await win.webContents.capturePage()).toPNG());
      }
      console.log('CONNECT_SCREENSHOTS=' + output);
    }
    console.log('CONNECT_RESULTS=' + JSON.stringify(results));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.exit(process.exitCode || 0); }
});
