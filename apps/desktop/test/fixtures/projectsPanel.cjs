const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-projects-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = [...readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(m => readFileSync(join(renderer, 'styles', m[1]), 'utf8')).join('\n');
    const script = esbuild.buildSync({ stdin: { contents: `export { createProjectsPanel } from './collab/projectsPanel.ts';`, resolveDir: renderer }, bundle: true, write: false, format: 'iife', globalName: 'ProjectsFixture' }).outputFiles[0].text;
    const results = await win.webContents.executeJavaScript(`(async () => {
      ${script}
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} + 'body{display:block;margin:0;background:var(--bg-app);font-family:var(--font-ui)}' }));
      document.documentElement.dataset.theme = 'dark';
      document.body.innerHTML = '<button id="open-projects">Projects</button>';
      const pause = () => new Promise(r => setTimeout(r, 100));
      let projects = [{ path: 'C:/Aurora', name: 'Aurora', openedAt: 2 }, { path: 'C:/Website', name: 'Website', openedAt: 1 }];
      let fail = false, shared = 0, opened = '', demoSafe = false;
      window.adcode = { collab: { projects: async () => projects, projectDetails: async root => {
        if (fail) throw new Error('History unavailable');
        return { branch: 'main', commitCount: 10, repository: 'https://github.com/team/aurora', changedFiles: 3,
          contributors: [{ name: 'Alex Morgan', email: 'alex@example.test', commits: 8 }, { name: demoSafe ? 'Sam Rivera' : '<img src=x onerror=alert(1)>', email: 'sam@example.test', commits: 2 }],
          commits: [{ hash: 'abc123', author: 'Alex', date: '2026-11-01', subject: 'Add project overview' }] };
      } } };
      const panel = ProjectsFixture.createProjectsPanel({ workspaceRoot: () => 'C:/Aurora', openProject: async p => { opened = p; }, share: () => { shared++; } });
      panel.open(); await pause();
      const text = () => document.querySelector('.projects-content').textContent;
      const result = {};
      result.projects = document.querySelectorAll('.projects-item').length === 2;
      result.contributions = text().includes('10 commits') && document.querySelectorAll('progress').length === 2;
      result.escaped = !document.querySelector('.projects-content img') && text().includes('<img src=x');
      result.overview = text().includes('Uncommitted files') && text().includes('main') && text().includes('Add project overview');
      panel.update({ mode: 'hosting', participants: [{ id: 'a', name: 'Alex', role: 'host' }, { id: 'b', name: 'Sam', role: 'editor' }], selfId: 'a' }); await pause();
      result.people = text().includes('2 connected') && text().includes('Sam') && text().includes('Can edit');
      document.querySelector('.projects-button-primary').click();
      result.share = shared === 1;
      document.querySelectorAll('.projects-item')[1].click(); await pause();
      result.separateSessions = !document.querySelector('.projects-detail').textContent.includes('2 connected');
      document.querySelector('.projects-actions button').click(); await pause();
      result.open = opened === 'C:/Website';
      fail = true; document.querySelector('.projects-refresh').click(); await pause();
      result.failure = text().includes('History unavailable');
      fail = false; document.querySelectorAll('.projects-item')[0].click(); await pause();
      const focused = document.querySelector('.projects-item'); focused.focus();
      const history = document.querySelector('.projects-history');
      const detail = document.querySelector('.projects-detail'); detail.scrollTop = 70;
      const scrollBefore = detail.scrollTop;
      panel.update({ mode: 'hosting', participants: [{ id: 'a', name: 'Alex', role: 'host' }, { id: 'b', name: 'Sam', role: 'editor' }], selfId: 'a' });
      result.historyStable = history === document.querySelector('.projects-history');
      result.focusStable = document.activeElement === focused;
      result.scrollStable = scrollBefore > 0 && Math.abs(detail.scrollTop - scrollBefore) < 1;
      document.querySelectorAll('.projects-item')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      result.pointerMotion = document.querySelector('.projects-detail').getAnimations().length > 0;
      await pause();
      document.querySelectorAll('.projects-item')[0].click();
      result.keyboardInstant = document.querySelector('.projects-detail').getAnimations().length === 0;
      await pause(); detail.scrollTop = 0;
      const search = document.querySelector('input[type=search]'); search.value = 'missing'; search.dispatchEvent(new Event('input'));
      result.search = text().includes('No matching projects.');
      search.value = ''; search.dispatchEvent(new Event('input'));
      demoSafe = true; document.querySelector('.projects-refresh').click(); await pause();
      window.testPanel = panel;
      return result;
    })()`);
    const out = resolve(__dirname, '../../../../output'); mkdirSync(out, { recursive: true });
    await new Promise(r => setTimeout(r, 250));
    writeFileSync(join(out, 'projects-panel-desktop.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(420, 740); await new Promise(r => setTimeout(r, 250));
    results.narrow = await win.webContents.executeJavaScript(`(() => { const e = document.querySelector('.projects-content'); return e.scrollWidth <= e.clientWidth + 1 && document.querySelector('.floating-panel').getBoundingClientRect().right <= innerWidth + 1; })()`);
    writeFileSync(join(out, 'projects-panel-mobile.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    results.reducedMotion = await win.webContents.executeJavaScript(`(() => {
      document.querySelectorAll('.projects-item')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      const frames = document.querySelector('.projects-detail').getAnimations().flatMap(a => a.effect.getKeyframes());
      return frames.length > 0 && frames.every(f => !f.transform || f.transform === 'none');
    })()`);
    win.setSize(1100, 800);
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'light'; document.querySelectorAll('.projects-item')[0].click(); document.querySelector('.projects-detail').scrollTop = 0;`);
    await new Promise(r => setTimeout(r, 250));
    writeFileSync(join(out, 'projects-panel-light.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'dark'; document.querySelector('.projects-detail').scrollTop = 0;`);
    // Hidden Chromium windows need an invalidated surface before capturing the latest theme.
    win.setSize(1101, 800); await new Promise(r => setTimeout(r, 150));
    win.setSize(1100, 800); await new Promise(r => setTimeout(r, 250));
    const rectangle = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('.floating-panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
    writeFileSync(join(out, 'projects-panel-desktop.png'), (await win.webContents.capturePage(rectangle)).toPNG());
    console.log('PROJECTS_RESULTS=' + JSON.stringify(results));
    app.exit(Object.values(results).every(Boolean) ? 0 : 1);
  } catch (error) { console.error(error); app.exit(1); }
});
