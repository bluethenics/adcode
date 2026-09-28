/*
 * Drives the real Agents page in Chromium against a scripted `window.adcode`.
 *
 * The page is bundled from source with esbuild (it imports several modules, unlike the
 * single-file fixtures beside this one), styled with the real stylesheets, and exercised the
 * way a person would: starter agents appear, New task starts a solo run, the box moves
 * between columns as the run changes, Stop asks first, the editor saves a look and tool
 * access, and nothing scrolls sideways on a narrow page.
 */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname } = require('node:path');
const esbuild = require('esbuild');

app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-agents-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const root = resolve(__dirname, '../../../..');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'dialogs.css', 'agents.css'].map((file) => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({
      entryPoints: [resolve(renderer, 'agents/agentsPage.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      globalName: 'AgentsPageModule',
      platform: 'browser',
      target: 'es2022',
      alias: { '@adcode/ai/toolAccess': resolve(root, 'packages/ai/src/toolAccess.ts') },
      logLevel: 'silent',
    }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.body.style.cssText = 'margin:0;background:var(--bg-app);font-family:system-ui;height:100vh';
      const calls = [];
      const settings = { 'adcode.ai.agentProfiles': '[]' };
      const settingsListeners = [], teamListeners = [], taskListeners = [];
      const teams = new Map();
      let sequence = 0;
      const view = (id, input, state) => ({
        id, kind: input.kind || 'team', group: input.group || null, hold: null, touchedPaths: [], state, prompt: input.prompt, acceptanceCriteria: input.acceptanceCriteria, concurrency: input.concurrency,
        roles: input.roles, nodes: input.nodes.map((node) => ({ ...node, state: 'pending', failure: null })), handoffs: [], routes: {},
        budget: { usedTokens: 0, tokenLimit: input.tokenLimit, reservedTokens: 0, usedCostMicros: 0, costMicrosLimit: input.costMicrosLimit, reservedCostMicros: 0 },
        merge: { state: 'idle', combinedTaskId: null, conflicts: [] }, baseKind: null, activity: {}, confirmedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
      });
      const emitTeam = (team) => { teams.set(team.id, team); for (const listener of teamListeners) listener(structuredClone(team)); };
      window.__agentsScene = () => {
        const base = (id, roleId, label, title) => view(id, { kind: 'solo', prompt: title, acceptanceCriteria: ['Done'], concurrency: 1, roles: [{ id: roleId, label, objective: 'x', route: { provider: 'anthropic', model: 'claude-sonnet-5' } }], nodes: [{ id: 'task', title, objective: title, roleId, dependsOn: [], acceptanceCriteria: ['Done'], fileHints: [] }], tokenLimit: 2000000, costMicrosLimit: 1000000000000 }, 'running');
        const now = Date.now();
        emitTeam({ ...base('scene-a', 'starter-bug-fixer', 'Bug fixer', 'Fix the login button on Safari'), confirmedAt: now - 190000, nodes: [{ ...base('x', 'starter-bug-fixer', 'x', 'Fix the login button on Safari').nodes[0], state: 'running' }], activity: { task: { text: 'Editing src/auth/login.ts', at: now } }, budget: { usedTokens: 48200, tokenLimit: 2000000, reservedTokens: 0, usedCostMicros: 82000, costMicrosLimit: 1000000000000, reservedCostMicros: 0 } });
        emitTeam({ ...base('scene-b', 'starter-ui-polish', 'UI polish', 'Polish the pricing page'), state: 'failed', nodes: [{ ...base('x', 'starter-ui-polish', 'x', 'Polish the pricing page').nodes[0], state: 'failed', failure: 'No API key for Anthropic. Add one in Connect a model.' }] });
        emitTeam({ ...base('scene-c', 'starter-docs-writer', 'Docs writer', 'Write the README quick start'), state: 'review', merge: { state: 'review', combinedTaskId: 'task-9', conflicts: [] }, handoffs: [{ nodeId: 'task', summary: 'Added a quick start with install and first-run steps.', changedPaths: ['README.md', 'docs/start.md'], completedAt: now }] });
      };
      window.adcode = {
        settings: {
          read: async () => ({ ...settings }),
          write: async (id, value) => { settings[id] = value; for (const listener of settingsListeners) listener({ ...settings }); return { ...settings }; },
          onChanged: (listener) => { settingsListeners.push(listener); return () => {}; },
        },
        aiTeam: {
          list: async () => [...teams.values()].map((team) => structuredClone(team)),
          configure: async (input) => { calls.push(['configure', input]); const team = view('team-' + (++sequence), input, 'configured'); teams.set(team.id, team); return structuredClone(team); },
          start: async (id) => { calls.push(['start', id]); const team = teams.get(id); const next = { ...team, state: 'running', confirmedAt: Date.now(), nodes: team.nodes.map((node) => ({ ...node, state: 'running' })), activity: { task: { text: 'Editing src/login.ts', at: Date.now() } } }; teams.set(id, next); return structuredClone(next); },
          cancel: async (id) => { calls.push(['cancel', id]); const next = { ...teams.get(id), state: 'cancelled', updatedAt: Date.now() }; teams.set(id, next); return structuredClone(next); },
          traces: async (id) => id === 'team-proof' ? [
            { id: 't1', nodeId: null, at: 1, kind: 'tool-call', summary: 'Called run_command', detail: 'npm test', outcome: 'pending' },
            { id: 't2', nodeId: null, at: 2, kind: 'tool-result', summary: 'run_command completed', detail: '', outcome: 'ok' },
            { id: 't3', nodeId: null, at: 3, kind: 'tool-call', summary: 'Called run_command', detail: 'npx tsc --noEmit', outcome: 'pending' },
            { id: 't4', nodeId: null, at: 4, kind: 'tool-result', summary: 'run_command failed', detail: '', outcome: 'failed' },
          ] : [],
          onChanged: (listener) => { teamListeners.push(listener); return () => {}; },
        },
        aiWorkspace: {
          list: async () => [],
          changes: async (taskId) => taskId === 'task-proof' ? [{ path: 'src/config.ts', isNew: false, hunks: [{ id: 'h0', startLine: 1, original: [], replacement: ['const key = "sk-live-4f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c";'] }] }] : [],
          apply: async (taskId) => { calls.push(['apply', taskId]); return { ok: true, message: '', task: null }; },
          discard: async (taskId) => { calls.push(['discard', taskId]); return null; },
          rollback: async () => ({ ok: true, message: '', task: null }),
          onChanged: (listener) => { taskListeners.push(listener); return () => {}; },
        },
        ai: {
          status: async () => ({ providers: [{ id: 'anthropic', displayName: 'Anthropic', models: [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5' }], hasKey: true, needsKey: true, transport: 'native', doc: null }], activeProvider: 'anthropic', activeModel: 'claude-sonnet-5', ready: true, customBaseUrl: '', catalogueTakenOn: '', catalogueIsLive: false }),
        },
        workspace: { current: async () => ({ root: '/project' }), onChanged: () => () => {} },
      };
      ${bundle}
      let busy = false; const busyListeners = [];
      const page = AgentsPageModule.createAgentsPage({
        saveAllOpenFiles: async () => { calls.push(['save']); },
        chat: { busy: () => ({ busy, title: 'Landing page' }), onBusyChange: (listener) => busyListeners.push(listener) },
        showChat: () => calls.push(['showChat']),
        draftInChat: (text) => calls.push(['draft', text]),
        reviewTask: () => calls.push(['review']),
        openConnect: () => calls.push(['connect']),
        openFolder: () => calls.push(['folder']),
        askText: async () => null,
      });
      page.element.style.height = '100vh';
      document.body.append(page.element);
      const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((done) => setTimeout(done, 10)); };
      const q = (selector) => document.querySelector(selector);
      const column = (id) => q('.agents-column[data-column="' + id + '"]');
      const results = {};
      try {
      page.shown(); await settle();

      const starters = JSON.parse(settings['adcode.ai.agentProfiles']);
      results.startersSeeded = starters.length === 5 && document.querySelectorAll('.agent-card:not(.agent-card-new)').length === 5 && document.querySelectorAll('.agent-card .agent-mascot').length === 5;
      results.emptyBoard = column('working').querySelector('.agents-empty').hidden === false && q('.agents-summary').textContent === 'Nothing running';

      // New task from the library's Reviewer: a read-only solo run, saved files first.
      const reviewerRun = [...document.querySelectorAll('.agent-card')].find((card) => card.textContent.includes('Reviewer')).querySelector('.agent-box-action-primary');
      reviewerRun.click(); await settle();
      const dialog = q('dialog.agents-new-task');
      results.dialogOpens = !!dialog && dialog.open && dialog.querySelector('select').value === 'starter-reviewer';
      dialog.querySelector('textarea').value = 'Review the login flow for bugs';
      dialog.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      const configure = calls.find((call) => call[0] === 'configure');
      results.startsSoloRun = !!configure && configure[1].kind === 'solo' && configure[1].roles[0].toolAccess === 'read-only' && calls.findIndex((call) => call[0] === 'save') < calls.findIndex((call) => call[0] === 'configure') && calls.some((call) => call[0] === 'start');

      const box = column('working').querySelector('.agent-box');
      results.boxWorking = !!box && box.textContent.includes('Review the login flow') && box.textContent.includes('Reviewer') && box.textContent.includes('Editing src/login.ts') && box.querySelector('.agent-mascot').dataset.mood === 'thinking';
      results.summary = q('.agents-summary').textContent === '1 working';

      // The run finishes with changes waiting: the same box moves to Ready, its mascot proud.
      const id = configure ? [...teams.keys()][0] : '';
      const mascotBefore = box.querySelector('.agent-mascot');
      emitTeam({ ...teams.get(id), state: 'review', merge: { state: 'review', combinedTaskId: 'task-1', conflicts: [] }, nodes: teams.get(id).nodes.map((node) => ({ ...node, state: 'completed' })), updatedAt: Date.now() });
      await settle();
      const ready = column('ready').querySelector('.agent-box');
      results.movesToReady = ready === box && ready.querySelector('.agent-mascot') === mascotBefore && ready.querySelector('.agent-mascot').dataset.mood === 'proud' && [...ready.querySelectorAll('.agent-box-action')].map((node) => node.textContent).join(',') === 'Review,Apply,Apply & continue,Discard';

      // A running run asks before it is stopped.
      emitTeam({ ...teams.get(id), state: 'running', nodes: teams.get(id).nodes.map((node) => ({ ...node, state: 'running' })) });
      await settle();
      column('working').querySelector('[data-action="stop"]').click(); await settle();
      const confirm = q('dialog.confirm-dialog[open]');
      results.stopAsks = !!confirm && !calls.some((call) => call[0] === 'cancel');
      confirm.querySelector('.result-close').click(); await settle();
      results.stopCancels = calls.some((call) => call[0] === 'cancel' && call[1] === id) && q('.agents-finished').hidden === false;

      // The main chat shows up while it replies.
      busy = true; busyListeners.forEach((listener) => listener(true)); await settle();
      results.chatBox = column('working').querySelector('.agent-box[data-kind="chat"]')?.textContent.includes('Landing page') === true;
      busy = false; busyListeners.forEach((listener) => listener(false)); await settle();

      // Edit an agent: pick a new look and Pick tools, and it is saved.
      [...document.querySelectorAll('.agent-card')].find((card) => card.textContent.includes('Tester')).querySelector('[aria-label="Edit Tester"]').click(); await settle();
      const editor = q('dialog.agents-editor');
      editor.querySelector('.agents-shapes [aria-label="hexagon"]').click();
      editor.querySelector('.agents-colors [aria-label="teal"]').click();
      editor.querySelector('input[value="pick"]').click();
      editor.querySelector('input[value="pick"]').dispatchEvent(new Event('change'));
      editor.querySelector('.agents-tool-picks input[value="search"]').checked = true;
      editor.querySelector('form').requestSubmit(); await settle();
      const tester = JSON.parse(settings['adcode.ai.agentProfiles']).find((agent) => agent.name === 'Tester');
      results.editorSaves = tester.mascot.shape === 'hexagon' && tester.mascot.color === 'teal' && JSON.stringify(tester.toolAccess) === JSON.stringify(['search']);

      results.finishedStays = q('.agents-finished').hidden === false && q('.agents-finished-summary').textContent === 'Finished today (1)';
      // Proof of work: what the agent actually ran and what its change risks, on its box.
      const finished = (id, title, extra = {}) => ({ ...view(id, { kind: 'solo', prompt: title, acceptanceCriteria: ['Done'], concurrency: 1, roles: [{ id: 'starter-bug-fixer', label: 'Bug fixer', objective: 'x' }], nodes: [{ id: 'task', title, objective: title, roleId: 'starter-bug-fixer', dependsOn: [], acceptanceCriteria: ['Done'], fileHints: [] }], tokenLimit: 2000000, costMicrosLimit: 1000000000000 }, 'review'), nodes: [{ id: 'task', title, objective: title, roleId: 'starter-bug-fixer', dependsOn: [], acceptanceCriteria: ['Done'], fileHints: [], state: 'completed', failure: null }], ...extra });
      emitTeam(finished('team-proof', 'Tighten config', { merge: { state: 'review', combinedTaskId: 'task-proof', conflicts: [] }, hold: 'a check failed: npx tsc --noEmit' }));
      await settle(); await settle();
      const proofBox = column('ready').querySelector('.agent-box[data-id="team-proof"]');
      const chips = [...(proofBox?.querySelectorAll('.agent-chip') ?? [])].map((chip) => chip.dataset.tone + ':' + chip.textContent);
      results.proofChips = JSON.stringify(chips) === JSON.stringify(['fail:npx tsc --noEmit failed', 'warn:Possible secret', 'ok:npm test']) && proofBox.textContent.includes('Held for your review: a check failed: npx tsc --noEmit');

      // A race: two lanes, compared, one kept - applied - and the other discarded.
      emitTeam(finished('team-lane-a', 'Dark mode', { group: 'race-abc123', merge: { state: 'review', combinedTaskId: 'task-lane-a', conflicts: [] }, createdAt: Date.now() - 2000, confirmedAt: Date.now() - 2000 }));
      emitTeam(finished('team-lane-b', 'Dark mode', { group: 'race-abc123', merge: { state: 'review', combinedTaskId: 'task-lane-b', conflicts: [] }, createdAt: Date.now() - 1000, confirmedAt: Date.now() - 1000 }));
      await settle();
      const laneA = column('ready').querySelector('.agent-box[data-id="team-lane-a"]');
      const labelled = laneA?.querySelector('.agent-box-race')?.textContent === 'Race · 1 of 2';
      laneA?.querySelector('[data-action="compare"]')?.click(); await settle();
      const compare = q('dialog.agents-race-compare[open]');
      const lanesShown = compare?.querySelectorAll('.agents-race-lane').length === 2;
      compare?.querySelector('.agents-race-lane .result-close')?.click(); await settle(); await settle();
      results.raceCompare = labelled && lanesShown && calls.some((call) => call[0] === 'apply' && call[1] === 'task-lane-a') && calls.some((call) => call[0] === 'discard' && call[1] === 'task-lane-b') && !calls.some((call) => call[0] === 'apply' && call[1] === 'task-lane-b');

      results.escapedText = document.querySelectorAll('img').length === 0;
      results.narrow = true;
      for (const width of [360, 640, 1000]) {
        page.element.style.width = width + 'px'; await settle();
        results.narrow &&= page.element.scrollWidth <= page.element.clientWidth + 1;
      }
      page.element.style.width = '';
      } catch (error) {
        // Surface the failing step in the test's diff instead of a bare null dereference.
        results.error = String(error && error.stack || error);
        results.calls = calls.map((call) => call[0]).join(',');
        results.dialog = !!document.querySelector('dialog[open]');
      }
      return results;
    })()`);
    if (process.env.ADCODE_AGENTS_SCREENSHOT) {
      await win.webContents.executeJavaScript('window.__agentsScene()');
      // A hidden window keeps its last painted frame; show it off-screen so the capture is current.
      win.setPosition(-4000, 0);
      win.showInactive();
      await new Promise((done) => setTimeout(done, 600));
      const output = resolve(process.env.ADCODE_AGENTS_SCREENSHOT);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    }
    console.log('AGENTS_PAGE_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
