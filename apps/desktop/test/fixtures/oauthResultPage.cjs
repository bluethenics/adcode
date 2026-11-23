const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-oauth-page-')));
app.whenReady().then(async () => {
  const root = resolve(__dirname, '../../../..');
  const directory = join(root, '.tmp', 'oauth-page');
  mkdirSync(directory, { recursive: true });
  const bundle = join(directory, 'result-page.cjs');
  const contents = readFileSync(join(root, 'apps/desktop/src/main/oauthResultPage.ts'), 'utf8').replace('"../../../../services/api/src/doneCard.ts"', JSON.stringify(join(root, 'services/api/src/doneCard.ts')));
  esbuild.buildSync({ stdin: { contents, loader: 'ts', resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  const { resultPage, RESULT_PAGE_HEADERS } = require(bundle);
  const server = createServer((req, res) => {
    res.writeHead(200, RESULT_PAGE_HEADERS);
    const error = req.url === '/error';
    res.end(resultPage(error ? "Sign-in didn't finish" : "You're connected", error ? 'The code expired. Try again from ADCode.' : 'Your GitHub account is connected. Return to ADCode to carry on.', !error, error ? 'Google' : 'GitHub', { account: error ? undefined : 'maya.okafor@gmail.com' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    for (const [name, width, theme, path] of [['github-dark', 1440, 'dark', '/'], ['github-phone', 320, 'light', '/'], ['google-error', 390, 'dark', '/error']]) {
      win.setContentSize(width, width === 1440 ? 900 : 844);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
      await win.loadURL(`http://127.0.0.1:${server.address().port}${path}`);
      await win.webContents.executeJavaScript(axe);
      const checks = await win.webContents.executeJavaScript(`(async () => ({ overflow: document.documentElement.scrollWidth > innerWidth, logo: document.querySelector('.done-icon svg')?.getAttribute('viewBox'), masked: document.body.textContent.includes('m***@gmail.com') === ${path === '/'}, animations: document.getAnimations().length, violations: (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } })).violations.map(v => v.id) }))()`);
      assert.equal(checks.overflow, false, name + ' overflow');
      assert.equal(checks.logo, '0 0 1024 1024', name + ' current logo');
      assert.equal(checks.masked, true, name + ' masked account');
      assert.equal(checks.animations, 0, name + ' reduced motion');
      assert.deepEqual(checks.violations, [], name + ' accessibility');
      writeFileSync(join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    process.stdout.write('OAUTH_PAGE_RESULTS=passed\n');
  } finally { win.destroy(); await new Promise(resolve => server.close(resolve)); }
  app.exit(0);
}).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); app.exit(1); });
