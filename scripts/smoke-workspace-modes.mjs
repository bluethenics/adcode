/** Real Electron mode transitions. No replacement bridge, editor, terminal or preview. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function checkModes({ evaluate, send, waitFor, sleep, artifacts }) {
  const click = async selector => {
    const point = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !element.getClientRects().length) throw new Error('Control is not visible: ' + ${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    await sleep(300);
  };
  const mode = async value => {
    await click(`.workspace-mode-switch [data-mode=${value}]`);
    await waitFor(`document.body.dataset.workspaceMode === '${value}'`);
  };
  const toolbar = async text => {
    if (text === 'Terminal') {
      await click('[aria-label="More tools"]');
      await waitFor("[...document.querySelectorAll('.menu-item')].some(b => b.textContent === 'Terminal')");
      await evaluate("[...document.querySelectorAll('.menu-item')].find(b => b.textContent === 'Terminal').click()");
      await sleep(200);
      return;
    }
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('.project-toolbar button')].find(b => b.textContent === ${JSON.stringify(text)});
      if (!button) throw new Error('Toolbar action missing');
      button.click();
    })()`);
    await sleep(200);
  };
  const screenshot = async name => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `modes-${name}.png`), Buffer.from(shot.data, "base64"));
  };
  await waitFor("document.querySelector('.workspace-mode-switch') && document.querySelectorAll('.tab').length === 2");
  assert.equal(await evaluate("document.body.dataset.workspaceMode"), "vibe", "New installs start in Vibe; restoring files does not override it");
  assert.equal(await evaluate("document.querySelectorAll('.workspace-navigation').length"), 0, 'No duplicate workspace navigation');
  assert.equal(await evaluate("document.querySelector('#sidebar').getClientRects().length"), 0, 'Vibe has no file explorer');
  assert.equal(await evaluate("document.querySelector('#sidebar').inert"), true, 'Hidden file controls are not keyboard targets');
  assert.equal(await evaluate("document.querySelector('#assistant-dock').hidden"), true, 'Context is on demand');
  await screenshot('vibe-minimal');
  const projectName = await evaluate("document.querySelector('.project-toolbar-name').textContent");
  await click('[aria-label="More tools"]');
  await evaluate("[...document.querySelectorAll('.menu-item')].find(b => b.textContent === 'Search in files').click()");
  await waitFor("document.querySelector('#view-search').getClientRects().length > 0");
  assert.equal(await evaluate("document.body.dataset.workspaceMode"), 'code', 'File search reveals Code');
  assert.equal(await evaluate("document.querySelector('.project-toolbar-name').textContent"), projectName, 'Search does not replace the project name');
  await click('.project-toolbar-name');
  await waitFor("document.querySelector('#filetree').getClientRects().length > 0");
  await evaluate(`(() => {
    window.__modeEvidence = {
      chat: document.querySelector('.chat-card'),
      editor: document.querySelector('.editor-workspace'),
      input: document.querySelector('.chat-input'),
      errors: [],
    };
    addEventListener('error', e => window.__modeEvidence.errors.push(e.message));
    addEventListener('unhandledrejection', e => window.__modeEvidence.errors.push(String(e.reason)));
    const input = window.__modeEvidence.input;
    input.value = 'Keep this unsent project request across modes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await mode("code");
  assert.equal(await evaluate("document.querySelector('#assistant-dock').hidden"), true, 'Code opens without the assistant');
  assert.equal(await evaluate("document.querySelector('#sidebar .chat-history') === null && document.querySelector('.editor-ask-ai') === null"), true, 'Code has no conversation rail or duplicate AI button');
  const sidebarBefore = await evaluate("document.querySelector('#sidebar').getBoundingClientRect().width");
  const dividerPoint = await evaluate("(() => { const divider = document.querySelector('#splitter-sidebar'); const r = divider.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...dividerPoint, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dividerPoint.x + 64, y: dividerPoint.y, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dividerPoint.x + 64, y: dividerPoint.y, button: 'left', buttons: 0 });
  await sleep(150);
  const sidebarAfter = await evaluate("document.querySelector('#sidebar').getBoundingClientRect().width");
  assert.ok(Math.abs(sidebarAfter - sidebarBefore - 64) < 4, `Sidebar responds to a real drag: ${sidebarBefore} -> ${sidebarAfter}`);
  await evaluate("document.querySelector('#splitter-sidebar').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#assistant-dock > .chat-card') === window.__modeEvidence.chat"), true);
  // Edit the real Monaco buffer without saving it.
  const editorPoint = await evaluate(`(() => {
    const rect = document.querySelector('.editor-file-panel .view-lines').getBoundingClientRect();
    return { x: rect.left + 45, y: rect.top + 10 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...editorPoint, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...editorPoint, button: "left", clickCount: 1 });
  await send("Input.insertText", { text: "UNSAVED_MODE_CHECK" });
  await waitFor("document.querySelector('.editor-file-panel').textContent.includes('UNSAVED_MODE_CHECK')");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'P', code: 'KeyP', modifiers: 10, windowsVirtualKeyCode: 80 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'P', code: 'KeyP', modifiers: 10, windowsVirtualKeyCode: 80 });
  await waitFor("document.querySelector('.quickopen-input[aria-label=\"Command palette\"]')?.getClientRects().length > 0");
  await evaluate("(() => { const input = document.querySelector('.quickopen-input[aria-label=\"Command palette\"]'); input.value = 'Ask AI about Selection or File'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await waitFor("document.querySelector('.palette-row')?.textContent.includes('Ask AI about Selection or File')");
  await evaluate("document.querySelector('.palette-row').click()");
  await waitFor("document.querySelector('.chat-input').value.includes('UNSAVED_MODE_CHECK')");
  assert.equal(await evaluate("document.querySelector('.chat-input').value.startsWith('Keep this unsent project request')"), true, "Ask AI retains the existing draft and includes unsaved buffer context");
  assert.notEqual(await evaluate("document.querySelector('.chat-card').dataset.working"), "true", "Ask AI prepares instructions without sending");
  await evaluate("(() => { const input = document.querySelector('.chat-input'); input.value = 'Keep this unsent project request across modes'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await toolbar("Terminal");
  await waitFor("document.querySelector('.xterm') && !document.querySelector('#panel').hidden");
  await evaluate("window.__modeEvidence.terminal = document.querySelector('.xterm')");
  await mode("vibe");
  await click('.chat-more-actions summary');
  await evaluate("[...document.querySelectorAll('.chat-more-menu button')].find(b => b.textContent === 'History').click()");
  await waitFor("document.querySelector('.chat-history').getClientRects().length > 0");
  assert.equal(await evaluate("document.querySelector('#sidebar').getClientRects().length"), 0, 'History stays inside the conversation');
  await screenshot('vibe-history');
  await click('.chat-more-actions summary');
  await evaluate("[...document.querySelectorAll('.chat-more-menu button')].find(b => b.textContent === 'History').click()");
  assert.equal(await evaluate("document.querySelector('#vibe-workspace > .chat-card') === window.__modeEvidence.chat"), true);
  assert.equal(await evaluate("document.querySelector('.chat-input').value"), "Keep this unsent project request across modes");
  assert.equal(await evaluate("document.querySelector('.editor-workspace') === window.__modeEvidence.editor && document.querySelector('.xterm') === window.__modeEvidence.terminal"), true);
  assert.equal(await evaluate("document.querySelector('#panel').getBoundingClientRect().height > 100"), true, "Real terminal is usable in Vibe");
  await screenshot("vibe-terminal");
  await click("#panel-maximize");
  assert.equal(await evaluate("document.querySelector('#panel').getBoundingClientRect().height > 500"), true, "Panel maximize works in Vibe");
  await click("#panel-maximize");
  await click("#panel-close");
  await waitFor("document.querySelector('#panel').hidden");
  await toolbar("Context");
  // Context may already have been open on a wide initial layout.
  if (!await evaluate("document.querySelector('.project-context').getClientRects().length > 0")) await toolbar("Context");
  await click("#context-tab-tasks");
  await waitFor("document.querySelector('.context-content').textContent.includes('No tasks yet')");
  await click("#context-tab-changes");
  await waitFor("document.querySelector('.context-content').textContent.includes('Source control')");
  await evaluate("[...document.querySelectorAll('.context-content .context-action')].find(button => button.textContent === 'Open Source Control').click()");
  await waitFor("document.querySelector('dialog[data-popup-id=source-control]').open");
  await click(".scm-close");
  await waitFor("!document.querySelector('dialog[data-popup-id=source-control]').open");
  await click("#context-tab-project");
  await waitFor("document.querySelector('.context-content').textContent.includes('files')");
  const contextBefore = await evaluate("document.querySelector('#assistant-dock').getBoundingClientRect().width");
  const contextDivider = await evaluate("(() => { const r = document.querySelector('#splitter-assistant').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...contextDivider, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: contextDivider.x - 48, y: contextDivider.y, button: 'left', buttons: 1 });
  await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: contextDivider.x - 48, y: contextDivider.y, button: 'left', buttons: 0 });
  await sleep(150);
  assert.ok(Math.abs(await evaluate("document.querySelector('#assistant-dock').getBoundingClientRect().width") - contextBefore - 48) < 4, 'Project context responds to a real drag');
  await evaluate("document.querySelector('#splitter-assistant').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#assistant-dock').getBoundingClientRect().width"), 320, 'Context resets to its own compact default');
  await screenshot("vibe-context");
  await click('[aria-label="About Vibe and Code modes"]');
  await waitFor("[...document.querySelectorAll('.help-popover')].some(p => p.textContent.includes('Two ways') && !p.hidden)");
  await screenshot("mode-help");
  await click('[aria-label="About Vibe and Code modes"]');
  await mode("code");
  assert.equal(await evaluate("document.querySelector('.editor-file-panel').textContent.includes('UNSAVED_MODE_CHECK')"), true, "Unsaved buffer preserved");
  await screenshot("code");
  await mode("vibe");
  // File navigation should reveal the existing editor rather than open a hidden buffer.
  await evaluate("document.querySelector('.tab').click()");
  await waitFor("document.body.dataset.workspaceMode === 'code'");
  await toolbar("Preview");
  await sleep(600);
  await evaluate("window.__modeEvidence.preview = document.querySelector('.preview-pane')");
  await mode("vibe");
  assert.equal(await evaluate("document.querySelector('.preview-pane') === window.__modeEvidence.preview"), true, "Same preview instance across modes");
  await screenshot("vibe-preview");
  await toolbar("Preview");
  for (const theme of ["light", "dark", "midnight"]) {
    await evaluate(`window.adcode.settings.write('adcode.appearance.theme', '${theme}')`);
    await waitFor(`document.documentElement.dataset.theme === '${theme}'`);
    await sleep(250); // Let theme transitions settle before visual evidence.
    assert.equal(await evaluate(`getComputedStyle(document.body).getPropertyValue('--bg-editor').trim() === getComputedStyle(document.documentElement).getPropertyValue('--bg-editor').trim()`), true, `Vibe respects the ${theme} palette`);
    await screenshot(theme);
  }
  await evaluate("window.adcode.settings.write('adcode.appearance.theme', 'light')");
  // The primary surface must retain usable width at each breakpoint.
  for (const width of [1440, 1100, 820, 640]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
    for (const value of ["vibe", "code"]) {
      await mode(value);
      const geometry = await evaluate(`(() => {
        const rect = document.querySelector('${value === "vibe" ? "#vibe-workspace" : "#editor-host"}').getBoundingClientRect();
        return { width: rect.width, height: rect.height, right: rect.right, viewport: innerWidth };
      })()`);
      assert.ok(geometry.width >= 300 && geometry.height >= 250 && geometry.right <= geometry.viewport + 1, `Usable ${value} at ${width}: ${JSON.stringify(geometry)}`);
      if (value === 'vibe') {
        assert.equal(await evaluate(`(() => {
          const pane = document.querySelector('.chat-conversation');
          const composer = pane.querySelector('.chat-composer').getBoundingClientRect();
          const bounds = pane.getBoundingClientRect();
          return pane.scrollWidth <= pane.clientWidth + 1 && composer.left >= bounds.left && composer.right <= bounds.right + 1;
        })()`), true, `Vibe composer fits at ${width}`);
        await screenshot(`vibe-responsive-${width}`);
      }
    }
    await screenshot(`responsive-${width}`);
  }
  await click('[aria-label="More tools"]');
  await waitFor("document.querySelector('[role=menu] .menu-item') !== null");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  assert.equal(await evaluate("document.activeElement?.textContent"), 'Search in files', 'Tools menu supports keyboard navigation');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("document.activeElement?.getAttribute('aria-label') === 'More tools'");
  assert.equal(await evaluate("document.querySelector('.project-tools').getAttribute('aria-expanded')"), 'false', 'Escape dismisses the menu and restores focus');
  assert.deepEqual(await evaluate("window.__modeEvidence.errors"), []);
  process.stdout.write("PASS: Vibe/Code, live DOM identity, unsent prompt, dirty buffer, terminal, maximize, context tabs, file navigation, preview identity, help, all themes, four window sizes.\n");
}
