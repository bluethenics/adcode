/* Render the real shared CSS in Electron and check native control interaction.
 * Optional argv URL also captures a local web build. */
const electron = require('electron');
if (typeof electron === 'string') {
  const { spawn } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename, ...process.argv.slice(2)], {
    env, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} else {
const { app, BrowserWindow } = electron;
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'adcode-design-review-'));
app.setPath('userData', join(output, 'profile'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  try {
    const capture = async () => {
      // Prime the hidden window's compositor, then capture its updated frame.
      await win.webContents.capturePage();
      await new Promise(resolve => setTimeout(resolve, 180));
      return win.webContents.capturePage();
    };
    const errors = [];
    win.webContents.on('console-message', event => {
      if (event.level === 'error') errors.push(event.message);
    });
    await win.loadFile(resolve(__dirname, '../docs/design-system.html'));
    win.setContentSize(1440, 1150);
    // A hidden review window has no OS focus. Emulate an active page so :focus
    // states can be measured without bringing an automated window to the front.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const check = await win.webContents.executeJavaScript(`(async () => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const byId = id => document.getElementById(id);
      const check = {};
      const toggle = document.querySelector('.ad-switch input:not(:disabled)');
      const original = toggle.checked; toggle.click(); check.switchWorks = toggle.checked !== original; toggle.click();
      const radio = document.querySelectorAll('.ad-radio input')[1]; radio.click();
      check.radioWorks = radio.checked && !document.querySelector('.ad-radio input').checked;
      const slider = document.querySelector('.ad-slider'); slider.value = '63'; slider.dispatchEvent(new Event('input'));
      check.sliderWorks = slider.nextElementSibling.value === '63%' && slider.style.getPropertyValue('--progress') === '63%';
      byId('overview-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      check.keyboardTabs = byId('files-tab').getAttribute('aria-selected') === 'true' && !byId('files-panel').hidden && byId('overview-panel').hidden;
      byId('overview-tab').click();
      document.querySelector('[data-demo]').click();
      check.dialogWorks = byId('dialog').open && byId('dialog').contains(document.activeElement);
      byId('dialog').close(); await frame();
      document.querySelector('#notifications button').click(); check.dismissWorks = document.querySelector('#notifications article').hidden;
      byId('restore').click(); check.restoreWorks = !document.querySelector('#notifications article').hidden;
      const field = document.querySelector('.ad-input:not(:disabled)'); field.focus(); await frame();
      await new Promise(resolve => setTimeout(resolve, 160));
      check.focusVisible = getComputedStyle(field).boxShadow !== 'none';
      check.noHorizontalOverflow = document.documentElement.scrollWidth <= innerWidth;
      check.hiddenPanelsStayHidden = byId('files-panel').getBoundingClientRect().height === 0;
      check.darkNativeControls = getComputedStyle(document.documentElement).colorScheme === 'dark';
      return check;
    })()`);
    for (const theme of ['dark', 'light', 'midnight']) {
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'; document.getElementById('theme').value = '${theme}'; window.scrollTo(0, 0);`);
      await new Promise(resolve => setTimeout(resolve, 180));
      const shot = await capture();
      writeFileSync(join(output, `components-${theme}.png`), shot.toPNG());
    }
    win.setContentSize(390, 844);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    check.narrowNoHorizontalOverflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth');
    writeFileSync(join(output, 'components-narrow.png'), (await capture()).toPNG());
    const webUrl = process.argv.find(arg => /^http:\/\/localhost:\d+/.test(arg));
    if (webUrl) {
      win.setContentSize(1440, 1000);
      await win.loadURL(webUrl);
      await win.webContents.executeJavaScript(`new Promise(resolve => {
        let tries = 0;
        const ready = () => document.querySelector('h1') || tries++ > 100 ? resolve() : setTimeout(ready, 100);
        ready();
      })`);
      await win.webContents.executeJavaScript('document.fonts.ready');
      writeFileSync(join(output, 'web.png'), (await capture()).toPNG());
      check.webNoHorizontalOverflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth');
      win.setContentSize(390, 844);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      check.webNarrowNoHorizontalOverflow = await win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth');
      writeFileSync(join(output, 'web-narrow.png'), (await capture()).toPNG());
    }
    const result = { checks: check, consoleErrors: errors, screenshots: output };
    writeFileSync(join(output, 'results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    app.exit(Object.values(check).every(Boolean) && errors.length === 0 ? 0 : 1);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
}
