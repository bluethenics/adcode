const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname } = require('node:path');
const ts = require('typescript');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-controls-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'ai.css', 'interface.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const compiled = ts.transpileModule(readFileSync(resolve(renderer, 'ai/assistantControls.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.body.style.cssText = 'margin:0;padding:32px;background:var(--bg-app);font-family:system-ui;box-sizing:border-box';
      const exports = {}; ${compiled}
      let changed;
      const actions = [];
      const state = { workspace: '/project', notice: null, servers: [
        { id: 'project-search', name: 'Project search', transport: 'stdio', endpoint: 'npx', args: [], status: 'connected', error: null, tools: [
          { name: 'search_documents', description: 'Find documentation across connected project sources.', enabled: false, calls: 0, lastDurationMs: null, lastError: null },
          { name: 'read_document', description: '<img src=x onerror=alert(1)>', enabled: false, calls: 0, lastDurationMs: null, lastError: null }
        ] },
        { id: 'browser', name: 'Browser tools', transport: 'http', endpoint: 'http://localhost:8931/mcp', args: [], status: 'error', error: 'Connection refused. Check the server is running, then reconnect.', tools: [] }
      ], skills: [{ id: '.agents/skills/review-code/SKILL.md', scope: 'workspace', source: 'This project', name: 'review-code', description: 'Review changes for bugs and missing test coverage.', path: '.agents/skills/review-code/SKILL.md', enabled: false, error: null, estimatedTokens: 420 },
        { id: 'system:test/SKILL.md', scope: 'system', source: 'Codex', name: 'system-review', description: 'An installed user skill.', path: '/home/.codex/skills/system-review/SKILL.md', enabled: false, error: null, estimatedTokens: 80 }] };
      window.adcode = { ai: {
        controls: async () => structuredClone(state),
        control: async action => {
          actions.push(action);
          if (action.kind === 'set-tool') state.servers[0].tools.find(tool => tool.name === action.tool).enabled = action.enabled;
          if (action.kind === 'set-skill') state.skills[0].enabled = action.enabled;
          if (action.kind === 'save-server') state.servers.push({ ...action.server, status: 'disconnected', error: null, tools: [] });
          return structuredClone(state);
        },
        previewSkill: async () => '---\\nname: review-code\\n---\\n<img src=x onerror=alert(1)>',
        onControlsChanged: listener => { changed = listener; return () => {}; }
      } };
      const controls = exports.createAssistantControls();
      controls.element.style.width = '340px';
      document.body.append(controls.element); controls.show();
      const settle = async () => { for(let i=0;i<8;i++) await new Promise(resolve => setTimeout(resolve, 5)); };
      const click = text => { const node = [...controls.element.querySelectorAll('button')].find(button => button.textContent === text && !button.closest('[hidden]')); if (!node) throw new Error('Button missing: ' + text); node.click(); };
      await settle();
      const results = {};
      results.liveState = controls.element.textContent.includes('1 connected') && controls.element.textContent.includes('Connection refused');
      controls.element.querySelector('details').open = true; await settle();
      controls.element.querySelector('[role=switch]').click(); await settle();
      results.toggleReachesBackend = actions.some(action => action.kind === 'set-tool' && action.enabled) && controls.element.querySelector('[role=switch]').checked;
      results.escapedMetadata = controls.element.querySelectorAll('img').length === 0;
      const search = controls.element.querySelector('[type=search]'); search.value = 'not-a-real-tool'; search.dispatchEvent(new Event('input'));
      results.filter = controls.element.textContent.includes('No matching servers or tools');
      search.value = ''; search.dispatchEvent(new Event('input'));
      click('Skills'); await settle();
      const scope = controls.element.querySelector('[aria-label="Skill location"]');
      scope.value = 'system'; scope.dispatchEvent(new Event('change'));
      results.systemFilter = controls.element.textContent.includes('system-review') && !controls.element.textContent.includes('review-code');
      scope.value = 'workspace'; scope.dispatchEvent(new Event('change'));
      controls.element.querySelector('[role=switch]').click(); await settle();
      results.skillToggle = actions.some(action => action.kind === 'set-skill' && action.enabled);
      click('Preview instructions'); await settle();
      results.skillPreview = controls.element.querySelector('pre').textContent.includes('<img') && !controls.element.querySelector('img');
      click('+ Create skill'); await settle();
      const skillForm = [...controls.element.querySelectorAll('form')].find(form => !form.hidden);
      skillForm.querySelectorAll('input')[0].value = 'test-workflow'; skillForm.querySelectorAll('input')[1].value = 'Help verify changes';
      skillForm.querySelector('textarea').value = 'Inspect changes and run relevant checks.';
      skillForm.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
      results.createSkill = actions.some(action => action.kind === 'create-skill' && action.name === 'test-workflow');
      click('MCP servers'); await settle(); click('+ Add MCP server'); await settle();
      const serverForm = [...controls.element.querySelectorAll('form')].find(form => !form.hidden);
      const inputs = serverForm.querySelectorAll('input');
      inputs[0].value = 'Documentation'; inputs[1].value = 'docs'; inputs[2].value = 'https://example.com/mcp';
      const select = serverForm.querySelector('select'); select.value = 'http'; select.dispatchEvent(new Event('change'));
      serverForm.dispatchEvent(new Event('submit', { cancelable: true })); await settle();
      results.saveServer = actions.some(action => action.kind === 'save-server' && action.server.transport === 'http') && controls.element.textContent.includes('Documentation');
      results.narrow = true;
      for (const width of [280, 340, 420]) { controls.element.style.width = width + 'px'; results.narrow &&= controls.element.scrollWidth <= controls.element.clientWidth + 1; }
      controls.element.style.width = '340px';
      state.servers[0].tools[0].calls = 3; state.servers[0].tools[0].lastDurationMs = 182; changed(); await settle();
      results.liveRefresh = controls.element.textContent.includes('3 calls');
      return results;
    })()`);
    if (process.env.ADCODE_CONTROLS_SCREENSHOT) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const output = resolve(process.env.ADCODE_CONTROLS_SCREENSHOT);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    }
    console.log('ASSISTANT_CONTROLS_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
