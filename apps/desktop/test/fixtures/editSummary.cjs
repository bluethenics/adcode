const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-edit-summary-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 700, height: 650, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'ai.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ entryPoints: [resolve(renderer, 'ai/editSummary.ts')], bundle: true, write: false, format: 'iife', globalName: 'EditSummary', platform: 'browser', target: 'es2022' }).outputFiles[0].text;
    await win.webContents.executeJavaScript(`
      document.documentElement.dataset.theme = 'dark';
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css + '\nbody { margin: 28px; background: var(--bg-app); color: var(--text-primary); font-family: var(--font-ui); } .chat-checkpoint { width: 100%; max-width: 560px; box-sizing: border-box; }')}; document.head.append(style);
      ${bundle}
      window.calls = []; window.opened = [];
      const files = Array.from({length: 6}, (_, index) => ({ path: index === 0 ? 'src/components/Assistant.tsx' : 'src/components/very-long-project-folder-name/File' + index + '.tsx', created: false, added: index + 1, removed: index, hunks: [{ id: 'h' + index, startLine: index, original: ['old <script>'], replacement: ['new "quoted" line'] }] }));
      files[5].deleted = true;
      document.body.append(EditSummary.createEditSummary({id: 'cp-fixture', createdAt: 10, files}, {openFile: path => window.opened.push(path), undo: async (id, force) => { window.calls.push({id, force}); return force ? {ok: true, restored: [], conflicts: [], message: 'Undone.'} : {ok: false, restored: [], conflicts: ['later.ts'], message: 'Your later edits need confirmation.'}; }}));
      const eol = EditSummary.createEditSummary({id: 'cp-eol', createdAt: 11, files: [{ path: 'src/app.js', created: false, deleted: false, added: 0, removed: 0, lineEndingsOnly: true, hunks: [] }]}, {openFile: () => {}, undo: async () => ({ok: true, restored: [], conflicts: [], message: 'Undone.'})});
      eol.id = 'eol-card'; document.body.append(eol);
    `);
    const output = resolve(__dirname, '../../../../.tmp/edit-summary'); mkdirSync(output, { recursive: true });
    await new Promise(resolve => setTimeout(resolve, 600));
    await win.webContents.executeJavaScript("document.getAnimations().forEach(animation => animation.finish())");
    writeFileSync(resolve(output, 'dark.png'), (await win.webContents.capturePage()).toPNG());
    const results = await win.webContents.executeJavaScript(`(async () => {
      const card = document.querySelector('.chat-checkpoint');
      const visible = () => [...card.querySelectorAll('.chat-checkpoint-row')].filter(row => !row.hidden).length;
      const summary = card.querySelector('strong').textContent === 'Edited 6 files' && card.querySelector('.chat-checkpoint-body').textContent.includes('+21−15');
      const startsCollapsed = visible() === 3;
      const more = card.querySelector('.chat-checkpoint-more'); more.click(); const showsMore = visible() === 6 && more.textContent === 'Show fewer files'; more.click();
      card.querySelector('.chat-checkpoint-file').click(); const opensFile = window.opened[0] === 'src/components/Assistant.tsx';
      const review = card.querySelector('.chat-checkpoint-review'); review.click();
      const reviewsRecordedDiff = !card.querySelector('.chat-checkpoint-diffs').hidden && card.querySelector('.diff-removed').textContent === '− old <script>' && card.querySelector('.diff-added').textContent === '+ new "quoted" line' && !card.querySelector('script');
      review.click(); const collapsesReview = card.querySelector('.chat-checkpoint-diffs').hidden && review.getAttribute('aria-expanded') === 'false';
      const deletedDisabled = card.querySelector('[data-deleted]').disabled;
      const undo = card.querySelector('.chat-checkpoint-undo'); undo.click(); await new Promise(resolve => setTimeout(resolve, 0));
      const preservesLaterEdits = window.calls.length === 1 && !window.calls[0].force && undo.textContent === 'Undo anyway' && card.dataset.state !== 'undone';
      undo.click(); await new Promise(resolve => setTimeout(resolve, 0));
      const explicitForceUndo = window.calls[1].force && card.dataset.state === 'undone' && undo.hidden;
      const eol = document.getElementById('eol-card'); eol.querySelector('.chat-checkpoint-review').click();
      const lineEndingsOnly = eol.querySelector('.chat-checkpoint-row .chat-checkpoint-counts').textContent === 'Line endings only' && !eol.textContent.includes('+0') && eol.querySelector('.chat-checkpoint-body .chat-checkpoint-counts').textContent === 'Line endings only' && eol.querySelector('.chat-checkpoint-diffs p').textContent.startsWith('Only the line endings changed') && !eol.querySelector('.chat-checkpoint-diffs pre');
      return { summary, startsCollapsed, showsMore, opensFile, reviewsRecordedDiff, collapsesReview, deletedDisabled, preservesLaterEdits, explicitForceUndo, lineEndingsOnly };
    })()`);
    await win.webContents.executeJavaScript("document.documentElement.dataset.theme = 'light'");
    writeFileSync(resolve(output, 'light.png'), (await win.webContents.capturePage()).toPNG());
    win.setSize(380, 650);
    await new Promise(resolve => setTimeout(resolve, 100));
    results.narrow = await win.webContents.executeJavaScript("document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.chat-checkpoint-header button')].every(button => {const box=button.getBoundingClientRect();return box.left >= 0 && box.right <= innerWidth})");
    writeFileSync(resolve(output, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
    console.log('EDIT_SUMMARY_RESULTS=' + JSON.stringify(results));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
