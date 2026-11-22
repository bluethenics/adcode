/* Checks the real signed-out gate after it replaces the public HTML splash. No network or sign-in. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-web-launch-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 920, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const web = resolve(__dirname, '../../src/web');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = readFileSync(join(renderer, 'styles/tokens.css'), 'utf8') + readFileSync(join(web, 'web.css'), 'utf8');
    const compiled = await esbuild.build({
      stdin: { contents: "export { gate } from './gate.ts'; export { WEB_APP_SPLASH } from './seo.ts';", resolveDir: web },
      bundle: true, write: false, format: 'iife', globalName: 'WebLaunchFixture', define: { __ADCODE_WEB_DEV__: 'false' },
      plugins: [{ name: 'signed-out-auth', setup(build) {
        build.onResolve({ filter: /\/firebaseAuth\.ts$/ }, () => ({ path: 'signed-out-auth', namespace: 'fixture' }));
        build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
          export const firebaseConfigured = () => true;
          export const currentUser = async () => null;
          export const idToken = async () => null;
          export const resetPassword = async () => {};
          export const signOutHere = async () => {};
          export const signInWith = async () => new Promise(() => {});
          export const signInWithEmail = async () => new Promise(() => {});
        ` }));
      } }],
    });
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const results = await win.webContents.executeJavaScript(`(async () => {
      ${compiled.outputFiles[0].text}
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} }));
      document.body.dataset.surface = 'web';
      document.body.innerHTML = '<div id="web-gate" class="web-gate web-gate-splash">' + WebLaunchFixture.WEB_APP_SPLASH + '</div>';
      const results = { initialCopyVisible: !!document.querySelector('#web-gate h1') };
      void WebLaunchFixture.gate();
      await new Promise(resolve => setTimeout(resolve, 40));
      const gate = document.querySelector('#web-gate');
      results.splashReplaced = !gate.querySelector('.web-splash') && !!gate.querySelector('.web-gate-card');
      results.publicHeadingRetained = gate.querySelector('h1')?.textContent === 'Build apps with AI in your browser';
      results.publicDescriptionRetained = gate.querySelector('.web-gate-lead')?.textContent.includes('Open a GitHub repository and the same assistant as the desktop app works on it right in this tab.');
      results.guideLinkRetained = !!gate.querySelector('a[href="https://adcode.bluethenics.com/online-ai-code-editor"]');
      results.realSignInControls = gate.querySelectorAll('.web-gate-provider').length === 2 && gate.querySelector('input[type="email"]') && gate.querySelector('input[type="password"]') ? true : false;
      results.noProductionBypass = !gate.querySelector('.web-gate-dev');
      return results;
    })()`);
    for (const width of [1100, 390]) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false });
      const fits = await win.webContents.executeJavaScript(`(() => { const heading = document.querySelector('#web-gate h1').getBoundingClientRect(); return heading.width > 0 && heading.left >= 0 && heading.right <= innerWidth && document.querySelector('#web-gate').scrollWidth <= innerWidth; })()`);
      results[`headingFits${width}`] = fits;
    }
    if (process.env.ADCODE_WEB_LAUNCH_SCREENSHOT) writeFileSync(process.env.ADCODE_WEB_LAUNCH_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    console.log('WEB_LAUNCH_RESULTS=' + JSON.stringify(results));
    app.exit(Object.values(results).every(Boolean) ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
