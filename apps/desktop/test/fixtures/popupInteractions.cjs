const { app, BrowserWindow } = require("electron");
const { readFileSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const ts = require("typescript");

app.setPath("userData", mkdtempSync(resolve(tmpdir(), "adcode-popup-test-")));

const renderer = resolve(__dirname, "../../src/renderer");
const compiled = (path) => ts.transpileModule(readFileSync(resolve(renderer, path), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadURL("data:text/html,<style>dialog{width:400px;height:300px}section{width:100%;height:100%}.help-popover{position:fixed;width:180px;margin:0}</style>");
    const run = (code) => window.webContents.executeJavaScript(code);
    await run(`window.shellModule = (() => { const exports = {}; ${compiled("workbench/popupShell.ts")} return exports; })();
      window.helpModule = (() => { const exports = {}; ${compiled("help/helpPopover.ts")} return exports; })(); undefined;`);
    await run(`window.backdropModule = (() => { const exports = {}; ${compiled("dialogs/backdropDismissal.ts")} return exports; })(); undefined;`);
    await run(`window.promptModule = (() => { const exports = {}; const require = () => backdropModule; ${compiled("dialogs/promptDialog.ts")} return exports; })();
      window.confirmModule = (() => { const exports = {}; const require = () => backdropModule; ${compiled("dialogs/confirmDialog.ts")} return exports; })(); undefined;`);
    const prompts = await run(`(async () => {
      const results = [];
      for (const [module, factory] of [[promptModule, 'createPromptDialog'], [confirmModule, 'createConfirmDialog']]) {
        const host = document.createElement('div'); document.body.append(host);
        const api = module[factory](host);
        void api.ask({ title: 'First' });
        void api.ask({ title: 'Second' });
        await new Promise(done => setTimeout(done, 60));
        const replacementSurvives = api.isOpen();
        void api.ask({ title: 'Drag' });
        await new Promise(done => setTimeout(done, 60));
        const dialog = host.querySelector('dialog');
        dialog.querySelector('.result-card').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const dragSurvives = api.isOpen();
        dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const backdropCloses = !api.isOpen();
        results.push({ replacementSurvives, dragSurvives, backdropCloses });
        dialog.close(); host.remove();
      }
      return results;
    })()`);
    const labels = await run(`(() => {
      const shells = [0, 1].map(() => {
        const content = document.createElement('div');
        content.innerHTML = '<h1>Connect a model</h1>';
        return shellModule.createPopupShell({ id: 'connect', title: 'Connect a model', size: 'medium',
          modal: true, host: document.body, content, onRequestClose() {} });
      });
      const result = shells.map(shell => {
        const id = shell.element.getAttribute('aria-labelledby');
        return { id, ownsLabel: document.getElementById(id) === shell.element.querySelector('h1') };
      });
      shells.forEach(shell => shell.element.remove());
      return result;
    })()`);
    const dismissal = await run(`(() => {
      const make = () => {
        const shell = shellModule.createPopupShell({ id: 'settings', title: 'Settings', size: 'large',
          modal: true, host: document.body, content: document.createElement('div'),
          onRequestClose() { shell.close({ immediate: true }); } });
        shell.open(); return shell;
      };
      const shell = make();
      shell.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const openingClickSurvives = shell.isOpen();
      shell.open();
      shell.surface.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      shell.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const dragSurvives = shell.isOpen();
      shell.open();
      shell.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      shell.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const backdropCloses = !shell.isOpen();
      shell.close({ immediate: true }); shell.element.remove();
      return { openingClickSurvives, dragSurvives, backdropCloses };
    })()`);
    const motion = await run(`(() => {
      const results = [];
      const sample = (surface) => {
        const style = getComputedStyle(surface);
        return { opacity: style.opacity, scale: style.scale, translate: style.translate };
      };
      for (const reduce of [false, true]) {
        document.documentElement.dataset.reducedMotion = String(reduce);
        const shell = shellModule.createPopupShell({ id: 'settings', title: 'Settings', size: 'large',
          modal: true, host: document.body, content: document.createElement('div'), onRequestClose() {} });
        shell.open({ input: 'pointer' });
        const opening = shell.surface.getAnimations()[0];
        opening.pause(); opening.currentTime = opening.effect.getTiming().duration / 2;
        const beforeClose = sample(shell.surface);
        shell.close();
        const afterClose = sample(shell.surface);
        const closing = shell.surface.getAnimations()[0];
        closing.pause(); closing.currentTime = closing.effect.getTiming().duration / 2;
        const beforeReopen = sample(shell.surface);
        shell.open({ input: 'pointer' });
        const afterReopen = sample(shell.surface);
        results.push({ reduce, beforeClose, afterClose, beforeReopen, afterReopen, open: shell.isOpen() });
        shell.close({ immediate: true }); shell.element.remove();
      }
      return results;
    })()`);
    const repeatedOpen = await run(`(async () => {
      document.documentElement.dataset.reducedMotion = 'false';
      const shell = shellModule.createPopupShell({ id: 'settings', title: 'Settings', size: 'large',
        modal: true, host: document.body, content: document.createElement('div'), onRequestClose() {} });
      const samples = [];
      for (let i = 0; i < 4; i++) {
        shell.open({ input: 'pointer' });
        shell.surface.getAnimations().forEach(animation => animation.finish());
        await Promise.resolve();
        samples.push({ open: shell.isOpen(), opacity: getComputedStyle(shell.surface).opacity });
        shell.close();
        shell.surface.getAnimations().forEach(animation => animation.finish());
        await Promise.resolve();
        if (shell.surface.getAnimations().length !== 0) throw new Error('Closed popup retains an animation effect');
      }
      shell.element.remove();
      return samples;
    })()`);
    const layeredClose = await run(`(async () => {
      const first = shellModule.createPopupShell({ id: 'settings', title: 'Settings', size: 'large',
        modal: true, host: document.body, content: document.createElement('div'), onRequestClose() {} });
      const second = shellModule.createPopupShell({ id: 'features', title: 'Features', size: 'large',
        modal: true, host: document.body, content: document.createElement('div'), onRequestClose() {} });
      first.open({ input: 'pointer' });
      first.close();
      second.open({ input: 'pointer' });
      await new Promise((done) => setTimeout(done, 250));
      const result = { firstOpen: first.isOpen(), secondOpen: second.isOpen() };
      second.close({ immediate: true });
      first.close({ immediate: true });
      first.element.remove(); second.element.remove();
      return result;
    })()`);
    await run(`document.documentElement.dataset.reducedMotion = 'false';
      window.shell = shellModule.createPopupShell({ id: 'settings', title: 'Settings', size: 'large',
        modal: true, host: document.body, content: document.createElement('div'),
        onRequestClose() { shell.close({ immediate: true }); } });
      shell.open();
      document.addEventListener('pointerdown', (event) => {
        if (!shell.surface.contains(event.target)) shell.close({ immediate: true });
      }, true);
      window.help = helpModule.createHelpPopover(shell.surface);
      window.anchor = document.createElement('button'); anchor.textContent = '?'; shell.surface.prepend(anchor);
      window.underlying = document.createElement('button'); underlying.textContent = 'Underlying'; shell.surface.append(underlying);
      underlying.style.cssText = 'position:absolute;right:8px;bottom:8px';
      window.underlyingClicks = 0; underlying.onclick = () => underlyingClicks++;
      window.showHelp = () => { anchor.focus(); help.show(anchor, { title: 'Title', plain: 'Plain', why: 'Why', how: 'How' }); };
      showHelp();`);
    const click = async (x, y) => {
      // showPopover/hidePopover changes the native top layer. Let Chromium commit
      // that change before browser-process input arrives on Linux as well as Windows.
      await run(`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))`);
      window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
      await new Promise((done) => setTimeout(done, 200));
    };
    await click(5, 5);
    const backdrop = await run(`({ helpClosed: !help.isOpen(), settingsOpen: shell.isOpen(), focusReturned: document.activeElement === anchor })`);
    // A fresh gesture must still close the owner; no stale click suppression may remain.
    await click(5, 5);
    const nextPressCloses = await run(`!shell.isOpen()`);
    await run(`shell.open(); showHelp();`);
    const point = await run(`(() => { const r = underlying.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await click(point.x, point.y);
    const inside = await run(`({ helpClosed: !help.isOpen(), settingsOpen: shell.isOpen(), clicks: underlyingClicks })`);
    await click(point.x, point.y);
    const nextControlClick = await run(`underlyingClicks`);
    // Cancel a dismissal before click, then ensure the next independent click still works.
    await run(`showHelp(); underlying.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, bubbles: true }));
      underlying.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 21, bubbles: true }));`);
    await click(point.x, point.y);
    const afterCancelClick = await run(`underlyingClicks`);
    await run(`showHelp(); underlying.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 22, bubbles: true }));
      underlying.dispatchEvent(new PointerEvent('pointerup', { pointerId: 22, bubbles: true }));`);
    await click(point.x, point.y);
    const afterNoClickDrag = await run(`underlyingClicks`);
    console.log("POPUP_RESULTS=" + JSON.stringify({ prompts, labels, dismissal, motion, repeatedOpen, layeredClose, backdrop, nextPressCloses, inside, nextControlClick, afterCancelClick, afterNoClickDrag }));
  } finally {
    window.destroy(); app.quit();
  }
}).catch((error) => { console.error(error); app.exit(1); });
