const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const ts = require('typescript');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-commit-browser-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL('about:blank');
    const compiled = ts.transpileModule(readFileSync(resolve(__dirname, '../../src/renderer/panels/commitBrowser.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const ok = await win.webContents.executeJavaScript(`(async () => {
      const exports = {}; ${compiled}
      let finish;
      const commit = { hash: 'abc', shortHash: 'abc', subject: 'Test commit', author: 'Test', date: new Date().toISOString() };
      window.adcode = { git: {
        log: async () => [commit],
        commitDetail: () => new Promise(resolve => { finish = resolve; }),
      }};
      const browser = exports.createCommitBrowser({ openCommitDiff() {}, restoreFile: async () => {}, notify() {} });
      document.body.append(browser.element);
      await browser.refresh();
      document.querySelector('.history-head').click();
      await browser.refresh();
      finish({ ...commit, body: '', files: [] });
      await new Promise(resolve => setTimeout(resolve, 0));
      return document.querySelector('.history-commit[data-open="true"] .history-detail') !== null;
    })()`);
    if (!ok) throw new Error('Refreshed history lost the pending commit detail');
    console.log('COMMIT_REFRESH_OK');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
