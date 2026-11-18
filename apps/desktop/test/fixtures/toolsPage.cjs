/*
 * Drives the real Tools page in Chromium against a scripted `window.adcode`.
 *
 * Bundled from source with esbuild and styled with the real stylesheets. It replaces the old
 * MCP/skills drawer's fixture and keeps every behaviour that one proved - live state, a
 * switch that reaches the backend, escaped server metadata, filters, skill preview and
 * creation, saving a server, live refresh - and adds the catalogue, memory editing, sharing,
 * "Used by" and narrow layouts.
 *
 * Connectors are covered too, because this is the only place the real page meets real
 * Chromium: kind badges on MCP, Actions and Plugin cards, the locked-values row and its
 * Forget flow, the Add-connector dialog's Scan this computer step with its dashed drafts
 * (Add through the questions dialog, Discard), the catalogue's one click, the hand
 * typed form's NAME=value lines reaching the save action, and the direct custom
 * connector route that derives its ID and connects in one press.
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
    const css = ['tokens.css', 'dialogs.css', 'agents.css', 'tools.css', 'motion.css'].map((file) => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
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
      const state = { workspace: '/project', notice: null, drafts: [], servers: [
        { id: 'project-search', name: 'Project search', transport: 'stdio', endpoint: 'npx', args: [], kind: 'mcp', origin: 'custom', source: 'Added by hand', purpose: 'Find things in the docs.', valueKeys: [], values: [], spec: null, auth: null, homepage: null, root: null, version: null, status: 'connected', error: null, tools: [
          { name: 'search_documents', description: 'Find documentation across connected project sources.', enabled: false, calls: 0, lastDurationMs: null, lastError: null },
          { name: 'read_document', description: '<img src=x onerror=alert(1)>', enabled: false, calls: 0, lastDurationMs: null, lastError: null },
        ] },
        { id: 'browser', name: 'Browser tools', transport: 'http', endpoint: 'http://localhost:8931/mcp', args: [], kind: 'openapi', origin: 'actions', source: 'Imported link: localhost', purpose: '', valueKeys: ['token'], values: [{ key: 'token', secret: true }], spec: '{}', auth: { kind: 'bearer', name: null, needsToken: true }, homepage: null, root: null, version: null, status: 'error', error: 'Connection refused. Check the server is running, then reconnect.', tools: [] },
        { id: 'team-tools', name: 'Team Tools', transport: 'stdio', endpoint: '/home/.adcode/plugins/team-tools', args: [], kind: 'plugin', origin: 'plugin', source: 'Plugin folder: team-tools', purpose: 'Team routines.', valueKeys: [], values: [], spec: null, auth: null, homepage: null, root: '/home/.adcode/plugins/team-tools', version: '1.2.0', status: 'disconnected', error: null, tools: [] },
      ], skills: [
        { id: '.agents/skills/review-code/SKILL.md', scope: 'workspace', source: 'This project', name: 'review-code', description: 'Review changes for bugs and missing test coverage.', path: '.agents/skills/review-code/SKILL.md', enabled: false, error: null, estimatedTokens: 420 },
        { id: 'system:test/SKILL.md', scope: 'system', source: 'Codex', name: 'system-review', description: 'An installed user skill.', path: '/home/.codex/skills/system-review/SKILL.md', enabled: false, error: null, estimatedTokens: 80 },
      ] };
      const memories = [{ name: 'use-pnpm', description: 'The project uses pnpm, never npm', type: 'convention', created: '2026-09-28', agents: ['adcode-chat'], body: 'Always run pnpm install.' }];
      const profiles = JSON.stringify([
        { id: 'starter-reviewer', name: 'Reviewer', instructions: 'x', provider: 'anthropic', model: 'm', toolAccess: 'read-only' },
        { id: 'starter-tester', name: 'Tester', instructions: 'x', provider: 'anthropic', model: 'm' },
      ]);
      const cursorDraft = () => ({ handle: 'draft-cursor', kind: 'mcp', name: 'Cursor tools', slug: 'cursor-tools', purpose: 'An MCP server imported from Cursor.', source: 'Cursor', origin: 'import', transport: 'stdio', endpoint: 'node', values: [], warnings: [], homepage: null, skills: [], servers: [], operations: 0, version: null, installable: true, problem: null });
      const teamDraft = () => ({ handle: 'draft-team', kind: 'plugin', name: 'Team Tools', slug: 'team-tools', purpose: 'Team routines.', source: 'Plugin folder: team-tools', origin: 'plugin', transport: 'stdio', endpoint: '', values: [], warnings: ['Hooks were copied but never run.'], homepage: null, skills: ['skills/standup'], servers: [{ name: 'Team search', transport: 'stdio' }], operations: 0, version: '1.2.0', installable: true, problem: null });
      const serverFromDraft = (draft, values) => ({ id: draft.slug, name: draft.name, transport: draft.transport, endpoint: draft.endpoint !== '' ? draft.endpoint : 'https://example.com', args: [], kind: draft.kind, origin: draft.origin, source: draft.source, purpose: draft.purpose, valueKeys: Object.keys(values ?? {}), values: [], spec: null, auth: null, homepage: null, root: null, version: draft.version });
      window.adcode = {
        ai: {
          controls: async () => structuredClone(state),
          control: async (action) => {
            actions.push(action);
            if (action.kind === 'set-tool') state.servers[0].tools.find((tool) => tool.name === action.tool).enabled = action.enabled;
            if (action.kind === 'set-skill') state.skills.find((skill) => skill.id === action.id).enabled = action.enabled;
            if (action.kind === 'save-server') { const extra = Object.keys(action.values ?? {}).map((key) => ({ key, secret: key === 'API_KEY' })); state.servers.push({ kind: 'mcp', origin: 'custom', source: 'Added by hand', purpose: '', valueKeys: [], values: [], spec: null, auth: null, homepage: null, root: null, version: null, ...action.server, valueKeys: extra.map((item) => item.key), values: extra, status: 'disconnected', error: null, tools: [] }); }
            if (action.kind === 'connect') { const server = state.servers.find((item) => item.id === action.id); if (server) server.status = 'connecting'; }
            if (action.kind === 'forget-values') { const server = state.servers.find((item) => item.id === action.id); if (server) { server.valueKeys = []; server.values = []; } }
            if (action.kind === 'scan-imports') state.drafts.push(cursorDraft(), teamDraft());
            if (action.kind === 'discard-draft') state.drafts = state.drafts.filter((draft) => draft.handle !== action.handle);
            if (action.kind === 'add-draft') { const draft = state.drafts.find((item) => item.handle === action.handle); if (draft) { state.drafts = state.drafts.filter((item) => item.handle !== action.handle); state.servers.push({ ...serverFromDraft(draft, action.values), status: 'disconnected', error: null, tools: [] }); } }
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
        results.counts = tab('built-in').textContent.includes('23') && tab('servers').textContent.includes('3') && tab('skills').textContent.includes('2') && tab('memory').textContent.includes('1');
        results.qualityTools = ['inspect_project', 'run_project_checks', 'audit_page'].every(name => [...panel('built-in').querySelectorAll('.tool-card')].some(card => card.textContent.includes(name))) && panel('built-in').textContent.includes('Quality');
        const readFile = [...panel('built-in').querySelectorAll('.tool-card')].find((card) => card.textContent.includes('read_file'));
        const editFile = [...panel('built-in').querySelectorAll('.tool-card')].find((card) => card.textContent.includes('edit_file'));
        results.usedBy = readFile.textContent.includes('Used by: Chat, Reviewer, Tester') && editFile.textContent.includes('Used by: Chat, Tester');

        tab('servers').click(); await settle();
        results.liveState = panel('servers').textContent.includes('Connected') && panel('servers').textContent.includes('Nothing is answering at that address');
        // The badge says which kind each connector is, from the record, not from its transport.
        results.kindBadges = panel('servers').textContent.includes('MCP') && panel('servers').textContent.includes('Actions') && panel('servers').textContent.includes('Plugin');
        results.pluginCard = panel('servers').textContent.includes('Claude Code plugin · v1.2.0') && panel('servers').textContent.includes('Its skills appear on the Skills tab');
        // The stored token shows as a locked row with one way out; Forget clears it in the store.
        const lockedRow = q('[aria-label="Forget stored values for Browser tools"]', panel('servers'));
        results.lockedValues = !!lockedRow && panel('servers').textContent.includes('token · kept in the OS-encrypted store');
        lockedRow.click(); await settle();
        q('dialog.confirm-dialog[open] .result-close').click(); await settle();
        results.lockedValues = results.lockedValues && actions.some((action) => action.kind === 'forget-values' && action.id === 'browser') && !panel('servers').textContent.includes('OS-encrypted store');

        clickText(panel('servers'), 'Tools'); await settle();
        const detail = q('dialog.tools-server-detail[open]');
        detail.querySelector('[role=switch]').click(); await settle();
        results.toggleReachesBackend = actions.some((action) => action.kind === 'set-tool' && action.enabled && action.tool === 'search_documents');
        results.escapedMetadata = document.querySelectorAll('img').length === 0 && detail.textContent.includes('<img src=x');
        clickText(detail, 'Done'); await settle();

        const search = q('.tools-search');
        search.value = 'not-a-real-tool'; search.dispatchEvent(new Event('input'));
        results.filter = panel('servers').textContent.includes('No connectors or tools match');
        search.value = ''; search.dispatchEvent(new Event('input'));

        // One click from the catalogue: saved through the same validator, then connected.
        clickText(panel('servers'), 'Add connector'); await settle();
        let add = q('dialog.tools-add-connector[open]');
        clickText(add, 'Catalogue'); await settle();
        add.querySelector('[aria-label="Add Playwright browser"]').click(); await settle();
        const saved = actions.find((action) => action.kind === 'save-server' && action.server.id === 'playwright');
        results.catalogueAdd = !!saved && saved.server.endpoint === 'npx' && saved.server.args.includes('@playwright/mcp@latest') && actions.some((action) => action.kind === 'connect' && action.id === 'playwright') && !q('dialog.tools-add-connector[open]');

        // Scan this computer: drafts wait as dashed cards; Add walks their questions, Discard drops one.
        clickText(panel('servers'), 'Add connector'); await settle();
        const importDialog = q('dialog.tools-add-connector[open]');
        clickText(importDialog, 'Scan this computer'); await settle();
        const drafts = q('.tools-dialog-drafts', importDialog);
        const listed = drafts.hidden === false && drafts.textContent.includes('Cursor tools') && drafts.textContent.includes('Team Tools');
        importDialog.querySelector('[aria-label="Add Cursor tools"]').click(); await settle();
        const valuesDialog = q('dialog.tools-draft-values[open]');
        clickText(valuesDialog, 'Add'); await settle();
        importDialog.querySelector('[aria-label="Discard Team Tools"]').click(); await settle();
        results.importScan = listed
          && actions.some((action) => action.kind === 'add-draft' && action.handle === 'draft-cursor')
          && actions.some((action) => action.kind === 'discard-draft' && action.handle === 'draft-team')
          && panel('servers').textContent.includes('Cursor tools')
          && q('.tools-dialog-drafts', importDialog).hidden === true;
        clickText(importDialog, 'Close'); await settle();

        // A hand-typed server, with its values typed as NAME=value lines.
        clickText(panel('servers'), 'Add connector'); await settle();
        const custom = q('dialog.tools-add-connector[open]');
        clickText(custom, 'Custom connector');
        const form = custom.querySelector('form');
        form.querySelector('[aria-label="Connector name"]').value = 'Documentation';
        form.querySelector('[aria-label="Connector ID"]').value = 'docs';
        form.querySelector('[aria-label="MCP server URL"]').value = 'https://example.com/mcp';
        form.querySelector('[aria-label="Headers or environment values"]').value = 'API_KEY=abc';
        form.requestSubmit(); await settle();
        const customSaved = actions.find((action) => action.kind === 'save-server' && action.server.id === 'docs');
        results.saveServer = !!customSaved && customSaved.server.transport === 'http' && customSaved.values?.API_KEY === 'abc' && panel('servers').textContent.includes('Documentation');

        // The direct route takes a name and a URL, derives the ID, and connects without a second press.
        clickText(panel('servers'), 'Add custom connector'); await settle();
        const direct = q('dialog.tools-add-connector[open]');
        const directClose = q('.form-dialog-card > .confirm-buttons', direct);
        const directIntro = q('.tools-dialog-sub', direct);
        const directLinks = [...direct.querySelectorAll('.tools-dialog-link')].map((item) => item.getAttribute('href'));
        const directChrome = q('.result-title', direct)?.textContent === 'Add custom connector'
          && q('.tools-dialog-close', direct)?.getAttribute('aria-label') === 'Close'
          && q('.tools-dialog-tabs', direct)?.hidden === true
          && [...direct.querySelectorAll('.form-dialog-form button:not(.select-menu-trigger)')].map((item) => item.textContent).join('|') === 'Cancel|Continue'
          && directClose !== null && getComputedStyle(directClose).display === 'none'
          && directIntro?.textContent.includes('Learn more about connectors')
          && directIntro.textContent.includes('get started with pre-built ones')
          && directLinks.includes('https://adcode.bluethenics.com/docs/connectors')
          && directLinks.includes('https://modelcontextprotocol.io')
          && direct.textContent.includes('Building an MCP server?')
          && direct.querySelector('[aria-label="MCP server URL"]')?.placeholder === 'https://mcp.example.com/mcp'
          && direct.textContent.includes('Only use connectors from developers you trust')
          && q('details', direct)?.open === false;
        const prebuiltLink = q('.tools-dialog-inline-link', direct);
        prebuiltLink.click(); await settle();
        const prebuiltShown = q('.tools-dialog-tabs', direct).hidden === false
          && [...direct.querySelectorAll('.tools-catalogue-item')].some((item) => item.textContent.includes('Playwright'));
        clickText(direct, 'Custom connector'); await settle();
        direct.querySelector('[aria-label="Connector name"]').value = 'Notes API';
        direct.querySelector('[aria-label="MCP server URL"]').value = 'https://notes.example.com/mcp';
        direct.querySelector('form').requestSubmit(); await settle();
        const directSaved = actions.find((action) => action.kind === 'save-server' && action.server.id === 'notes-api');
        clickText(panel('servers'), 'Add custom connector'); await settle();
        q('.tools-dialog-close').click(); await settle();
        const closeWorks = !q('dialog.tools-add-connector[open]');
        results.customConnector = directChrome && prebuiltShown && closeWorks && !!directSaved && directSaved.server.transport === 'http'
          && actions.some((action) => action.kind === 'connect' && action.id === 'notes-api')
          && !q('dialog.tools-add-connector[open]')
          && panel('servers').textContent.includes('Notes API');

        // Browser imports use the cloud workspace, URL or pasted text, without invoking a local file picker.
        document.documentElement.dataset.surface = 'web';
        clickText(panel('servers'), 'Add connector'); await settle();
        const webImportDialog = q('dialog.tools-add-connector[open]');
        const cloudScan = [...webImportDialog.querySelectorAll('button')].some((item) => item.textContent.includes('Scan cloud workspace'));
        const localScan = [...webImportDialog.querySelectorAll('button')].some((item) => item.textContent.includes('Scan this computer'));
        clickText(webImportDialog, 'Link or text'); await settle();
        const localPicker = [...webImportDialog.querySelectorAll('button')].some((item) => item.textContent === 'Choose a file or folder…');
        webImportDialog.querySelector('[aria-label="Path in cloud workspace"]').value = '/workspace/project/my-plugin';
        clickText(webImportDialog, 'Read workspace path'); await settle();
        webImportDialog.querySelector('[aria-label="Address of a connector file or API description"]').value = 'https://example.com/openapi.json';
        clickText(webImportDialog, 'Read link'); await settle();
        webImportDialog.querySelector('[aria-label="Pasted connector document"]').value = '{"mcpServers":{}}';
        clickText(webImportDialog, 'Read pasted text'); await settle();
        results.webImports = cloudScan && !localScan && !localPicker && webImportDialog.textContent.includes('cannot read apps or files on your computer')
          && actions.some((action) => action.kind === 'import-path' && action.from === '/workspace/project/my-plugin')
          && actions.some((action) => action.kind === 'import-url' && action.from === 'https://example.com/openapi.json')
          && actions.some((action) => action.kind === 'import-text' && action.text === '{"mcpServers":{}}');
        clickText(webImportDialog, 'Close'); await settle();
        delete document.documentElement.dataset.surface;

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
