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
    const point = await run(`(() => { const r = underlying.getBoundingClientRect(); return { x: Math.round(r.right - 3), y: Math.round(r.bottom - 3) }; })()`);
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
    console.log("POPUP_RESULTS=" + JSON.stringify({ motion, backdrop, nextPressCloses, inside, nextControlClick, afterCancelClick, afterNoClickDrag }));
  } finally {
    window.destroy(); app.quit();
  }
}).catch((error) => { console.error(error); app.exit(1); });
