/*
 * Drives the real Tools page in Chromium against a scripted `window.adcode`.
 *
 * Bundled from source with esbuild and styled with the real stylesheets. It replaces the old
 * MCP/skills drawer's fixture and keeps every behaviour that one proved - live state, a
 * switch that reaches the backend, escaped server metadata, filters, skill preview and
 * creation, saving a server, live refresh - and adds the catalogue, memory editing, sharing,
 * "Used by" and narrow layouts.
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname } = require('node:path');
const esbuild = require('esbuild');

app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-tools-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const root = resolve(__dirname, '../../../..');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'dialogs.css', 'agents.css', 'tools.css'].map((file) => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({
      entryPoints: [resolve(renderer, 'tools/toolsPage.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'ToolsPageModule',
      platform: 'browser',
      target: 'es2022',
      alias: { '@adcode/ai/toolAccess': resolve(root, 'packages/ai/src/toolAccess.ts') },
      logLevel: 'silent',
    }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.body.style.cssText = 'margin:0;background:var(--bg-app);font-family:system-ui;height:100vh';
      const actions = [], copied = [], memoryCalls = [];
      let changed = () => {};
      const state = { workspace: '/project', notice: null, servers: [
        { id: 'project-search', name: 'Project search', transport: 'stdio', endpoint: 'npx', args: [], status: 'connected', error: null, tools: [
          { name: 'search_documents', description: 'Find documentation across connected project sources.', enabled: false, calls: 0, lastDurationMs: null, lastError: null },
          { name: 'read_document', description: '<img src=x onerror=alert(1)>', enabled: false, calls: 0, lastDurationMs: null, lastError: null },
        ] },
        { id: 'browser', name: 'Browser tools', transport: 'http', endpoint: 'http://localhost:8931/mcp', args: [], status: 'error', error: 'Connection refused. Check the server is running, then reconnect.', tools: [] },
      ], skills: [
        { id: '.agents/skills/review-code/SKILL.md', scope: 'workspace', source: 'This project', name: 'review-code', description: 'Review changes for bugs and missing test coverage.', path: '.agents/skills/review-code/SKILL.md', enabled: false, error: null, estimatedTokens: 420 },
        { id: 'system:test/SKILL.md', scope: 'system', source: 'Codex', name: 'system-review', description: 'An installed user skill.', path: '/home/.codex/skills/system-review/SKILL.md', enabled: false, error: null, estimatedTokens: 80 },
      ] };
      const memories = [{ name: 'use-pnpm', description: 'The project uses pnpm, never npm', type: 'convention', created: '2026-09-28', agents: ['adcode-chat'], body: 'Always run pnpm install.' }];
      const profiles = JSON.stringify([
        { id: 'starter-reviewer', name: 'Reviewer', instructions: 'x', provider: 'anthropic', model: 'm', toolAccess: 'read-only' },
        { id: 'starter-tester', name: 'Tester', instructions: 'x', provider: 'anthropic', model: 'm' },
      ]);
      window.adcode = {
        ai: {
          controls: async () => structuredClone(state),
          control: async (action) => {
            actions.push(action);
            if (action.kind === 'set-tool') state.servers[0].tools.find((tool) => tool.name === action.tool).enabled = action.enabled;
            if (action.kind === 'set-skill') state.skills.find((skill) => skill.id === action.id).enabled = action.enabled;
            if (action.kind === 'save-server') state.servers.push({ ...action.server, status: 'disconnected', error: null, tools: [] });
            if (action.kind === 'connect') { const server = state.servers.find((item) => item.id === action.id); if (server) server.status = 'connecting'; }
            return structuredClone(state);
          },
          previewSkill: async () => '---\\nname: review-code\\n---\\n<img src=x onerror=alert(1)>',
          onControlsChanged: (listener) => { changed = listener; return () => {}; },
        },
        settings: { read: async () => ({ 'adcode.ai.agentProfiles': profiles }), onChanged: () => () => {} },
        memory: {
          // An old Node.js, so the card has to say so while still offering the command.
          connection: async () => ({ command: 'claude mcp add adcode -- node "bin" "/project"', storePath: '/project/.adcode/memory', available: true, node: { status: 'old', version: 'v20.11.1' } }),
          list: async () => structuredClone(memories),
          write: async (input) => { memoryCalls.push(['write', input]); memories.unshift({ ...input, created: '2026-09-28', agents: ['you'] }); return { ...input, created: '2026-09-28', agents: ['you'] }; },
          remove: async (name) => { memoryCalls.push(['remove', name]); const index = memories.findIndex((item) => item.name === name); if (index >= 0) memories.splice(index, 1); return index >= 0; },
        },
        workspace: { onChanged: () => () => {} },
      };
      ${bundle}
      const page = ToolsPageModule.createToolsPage({ copy: async (text) => { copied.push(text); } });
      page.element.style.height = '100vh';
      document.body.append(page.element);
      const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done, 10)); };
      const q = (selector, scope = document) => scope.querySelector(selector);
      const panel = (id) => q('#tools-panel-' + id);
      const tab = (id) => q('#tools-tab-' + id);
      const clickText = (scope, text) => { const node = [...scope.querySelectorAll('button')].find((item) => item.textContent === text && !item.closest('[hidden]')); if (!node) throw new Error('Button missing: ' + text); node.click(); };
      const results = {};
      try {
        page.shown(); await settle();
        results.counts = tab('built-in').textContent.includes('12') && tab('servers').textContent.includes('2') && tab('skills').textContent.includes('2') && tab('memory').textContent.includes('1');
        const readFile = [...panel('built-in').querySelectorAll('.tool-card')].find((card) => card.textContent.includes('read_file'));
        const editFile = [...panel('built-in').querySelectorAll('.tool-card')].find((card) => card.textContent.includes('edit_file'));
        results.usedBy = readFile.textContent.includes('Used by: Chat, Reviewer, Tester') && editFile.textContent.includes('Used by: Chat, Tester');

        tab('servers').click(); await settle();
        results.liveState = panel('servers').textContent.includes('Connected') && panel('servers').textContent.includes('Nothing is answering at that address');
        clickText(panel('servers'), 'Tools'); await settle();
        const detail = q('dialog.tools-server-detail[open]');
        detail.querySelector('[role=switch]').click(); await settle();
        results.toggleReachesBackend = actions.some((action) => action.kind === 'set-tool' && action.enabled && action.tool === 'search_documents');
        results.escapedMetadata = document.querySelectorAll('img').length === 0 && detail.textContent.includes('<img src=x');
        clickText(detail, 'Done'); await settle();

        const search = q('.tools-search');
        search.value = 'not-a-real-tool'; search.dispatchEvent(new Event('input'));
        results.filter = panel('servers').textContent.includes('No servers or tools match');
        search.value = ''; search.dispatchEvent(new Event('input'));

        // One click from the catalogue: saved through the same validator, then connected.
        clickText(panel('servers'), 'Add server'); await settle();
        const add = q('dialog.tools-add-server[open]');
        add.querySelector('[aria-label="Add Playwright browser"]').click(); await settle();
        const saved = actions.find((action) => action.kind === 'save-server' && action.server.id === 'playwright');
        results.catalogueAdd = !!saved && saved.server.endpoint === 'npx' && saved.server.args.includes('@playwright/mcp@latest') && actions.some((action) => action.kind === 'connect' && action.id === 'playwright') && !q('dialog.tools-add-server[open]');

        // A hand-typed server.
        clickText(panel('servers'), 'Add server'); await settle();
        const custom = q('dialog.tools-add-server[open]');
        clickText(custom, 'Custom');
        const form = custom.querySelector('form');
        const inputs = form.querySelectorAll('input');
        inputs[0].value = 'Documentation'; inputs[1].value = 'docs';
        const select = form.querySelector('select'); select.value = 'http'; select.dispatchEvent(new Event('change'));
        inputs[2].value = 'https://example.com/mcp';
        form.requestSubmit(); await settle();
        results.saveServer = actions.some((action) => action.kind === 'save-server' && action.server.transport === 'http' && action.server.id === 'docs') && panel('servers').textContent.includes('Documentation');

        tab('skills').click(); await settle();
        const scope = q('[aria-label="Skill location"]');
        scope.value = 'system'; scope.dispatchEvent(new Event('change')); await settle();
        results.systemFilter = panel('skills').textContent.includes('system-review') && !panel('skills').textContent.includes('review-code');
        const scope2 = q('[aria-label="Skill location"]'); scope2.value = 'all'; scope2.dispatchEvent(new Event('change')); await settle();
        q('[aria-label="Offer review-code"]').click(); await settle();
        results.skillToggle = actions.some((action) => action.kind === 'set-skill' && action.enabled);
        q('[aria-label="Preview review-code"]').click(); await settle();
        const preview = q('dialog.tools-skill-preview[open]');
        results.skillPreview = preview.querySelector('pre').textContent.includes('<img') && document.querySelectorAll('img').length === 0;
        clickText(preview, 'Close'); await settle();
        clickText(panel('skills'), 'New skill'); await settle();
        const skillForm = q('dialog.tools-new-skill[open] form');
        skillForm.querySelectorAll('input')[0].value = 'test-workflow';
        skillForm.querySelectorAll('input')[1].value = 'Help verify changes';
        skillForm.querySelector('textarea').value = 'Inspect changes and run relevant checks.';
        skillForm.requestSubmit(); await settle();
        results.createSkill = actions.some((action) => action.kind === 'create-skill' && action.name === 'test-workflow');

        tab('memory').click(); await settle();
        results.memoryListed = panel('memory').textContent.includes('Conventions') && panel('memory').textContent.includes('The project uses pnpm');
        q('[aria-label="Copy the memory sharing command"]').click(); await settle();
        results.shareCopies = copied.length === 1 && copied[0].startsWith('claude mcp add adcode');
        const share = q('.tools-share');
        results.shareStatesNode = /Node\\.js \\d+\\.\\d+ or newer/.test(share.textContent) &&
          (share.querySelector('.tool-card-problem')?.textContent ?? '').includes('v20.11.1');
        clickText(panel('memory'), 'Add memory'); await settle();
        const memoryForm = q('dialog.tools-memory-editor[open] form');
        memoryForm.querySelectorAll('input')[0].value = 'dark-mode-first';
        memoryForm.querySelector('select').value = 'decision';
        memoryForm.querySelectorAll('input')[1].value = 'New screens are designed dark first';
        memoryForm.querySelector('textarea').value = 'Most users run the dark theme.';
        memoryForm.requestSubmit(); await settle();
        results.memoryAdded = memoryCalls.some((call) => call[0] === 'write' && call[1].name === 'dark-mode-first' && call[1].type === 'decision') && panel('memory').textContent.includes('Decisions');
        q('[aria-label="Delete use-pnpm"]').click(); await settle();
        q('dialog.confirm-dialog[open] .result-close').click(); await settle();
        results.memoryDeleted = memoryCalls.some((call) => call[0] === 'remove' && call[1] === 'use-pnpm') && !panel('memory').textContent.includes('The project uses pnpm');

        tab('servers').click(); await settle();
        state.servers[0].tools[0].calls = 3; state.servers[0].tools[0].lastDurationMs = 182; changed(); await settle();
        results.liveRefresh = panel('servers').textContent.includes('2 tools · 3 uses');

        results.keyboardTabs = (() => { tab('built-in').focus(); tab('built-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); return document.activeElement === tab('servers') && tab('servers').getAttribute('aria-selected') === 'true'; })();
        results.narrow = true;
        for (const width of [360, 640, 1000]) {
          page.element.style.width = width + 'px'; await settle();
          results.narrow &&= page.element.scrollWidth <= page.element.clientWidth + 1;
        }
        page.element.style.width = '';
      } catch (error) {
        results.error = String(error && error.stack || error);
      }
      return results;
    })()`);
    if (process.env.ADCODE_TOOLS_SCREENSHOT) {
      win.setPosition(-4000, 0);
      win.showInactive();
      await new Promise((done) => setTimeout(done, 600));
      const output = resolve(process.env.ADCODE_TOOLS_SCREENSHOT);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    }
    console.log('TOOLS_PAGE_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
