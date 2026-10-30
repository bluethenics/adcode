const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-projects-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 640, height: 850, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'workbench.css', 'dialogs.css', 'panels.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ entryPoints: [resolve(renderer, 'collab/sharedProjectsPanel.ts')], bundle: true, write: false, format: 'iife', globalName: 'Projects', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css)}; document.head.append(style);
      document.body.style.cssText = 'margin:0;background:var(--bg-app);color:var(--text-primary);font-family:system-ui';
      const actions = [], copied = []; let agreement = true;
      const current = { id: 'owned-1', name: 'My shared project', owner: 'me', isOwner: true, revision: 1, invite: 'adproject:test', members: { friend: 'friend@example.test' } };
      let view = { owned: [current, { ...current, id: 'owned-2', name: 'Long'.repeat(30) }, { ...current, id: 'owned-3', name: 'Another project' }], joined: [{ ...current, id: 'friend-project', name: 'Friend’s project' }], current, syncError: null };
      window.adcode = { clipboard: { writeText: async text => copied.push(text) }, projects: { action: async (kind, input) => { actions.push({ kind, input }); if (kind === 'list') return view; if (kind === 'publish') throw Error('Free includes 3 online projects. Choose a paid plan to create another project.'); return current; } } };
      ${bundle}
      const panel = Projects.sharedProjectsPanel({ notify: () => {}, confirm: async () => agreement, prompt: async () => 'adproject:friend-code' });
      const card = document.createElement('section'); card.className = 'collab-card'; card.style.cssText = 'left:20px;top:20px'; card.append(panel.element); document.body.append(card);
      await panel.refresh();
      const click = async text => { const control = [...card.querySelectorAll('button')].find(b => b.textContent === text); if (!control) throw Error('Missing ' + text); control.click(); for (let i = 0; i < 5; i++) await new Promise(done => setTimeout(done, 5)); };
      const results = { quotaText: card.textContent.includes('3 owned') && card.textContent.includes('joining is free'), noOverflow: true };
      for (const width of [280, 340]) { card.style.width = width + 'px'; results.noOverflow &&= card.scrollWidth <= card.clientWidth + 1; }
      card.style.width = '340px';
      await click('Copy invite'); results.copies = copied[0] === current.invite;
      await click('Open'); results.opens = actions.some(a => a.kind === 'open' && a.input.id === current.id);
      await click('Join project'); results.joins = actions.some(a => a.kind === 'join' && a.input.code === 'adproject:friend-code');
      agreement = false; await click('Delete online project'); results.cancelSafe = !actions.some(a => a.kind === 'delete');
      agreement = true; await click('Share project online'); results.upgradeMessage = card.textContent.includes('Choose a paid plan');
      view.syncError = 'Sync paused: both you and a friend edited app.ts'; await panel.refresh(); await click('Keep my conflicting files');
      results.conflictChoice = actions.some(a => a.kind === 'sync' && a.input.resolution === 'local');
      await panel.refresh();
      return results;
    })()`);
    if (process.env.ADCODE_PROJECTS_SCREENSHOT) {
      win.setPosition(-4000, 0); win.showInactive(); await new Promise(done => setTimeout(done, 300));
      const output = resolve(process.env.ADCODE_PROJECTS_SCREENSHOT); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, (await win.webContents.capturePage()).toPNG());
    }
    console.log('PROJECTS_UI_RESULTS=' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
