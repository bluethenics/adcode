/** Real keyboard, shared-buffer and surface checks against the built Electron app. */
import { spawn, execFileSync } from "node:child_process";
import { checkPopups } from "./smoke-popups-checks.mjs";
import { checkAi } from "./smoke-ai-checks.mjs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const scratch = await mkdtemp(join(tmpdir(), "adcode-editor-panels-"));
const workspace = join(scratch, "project");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/editor-workspace");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(artifacts, { recursive: true })]);
const files = [join(workspace, "layout.html"), join(workspace, "styles.css")];
await writeFile(files[0], '<main class="workspace">\n  <h1>Your workspace, your way</h1>\n  <p>Two files. One place to build.</p>\n</main>\n');
await writeFile(files[1], '.workspace {\n  display: grid;\n  gap: 16px;\n  border-radius: 14px;\n}\n');
if (process.argv.includes("--popups")) {
  execFileSync("git", ["init", "--quiet", workspace]);
  execFileSync("git", ["-C", workspace, "remote", "add", "origin", "https://github.com/example/popup-fixture.git"]);
}
await writeFile(join(userData, "session.json"), JSON.stringify({ state: {
  root: workspace, openFiles: files, activeFile: files[0],
} }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, at: Date.now() }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const port = Number(process.env.ADCODE_EDITOR_SMOKE_PORT ?? 9347);
const child = spawn(require("electron"), ["apps/desktop", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let log = "";
child.stdout.on("data", (data) => { log += data; });
child.stderr.on("data", (data) => { log += data; });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let socket;
let sequence = 0;
const pending = new Map();

try {
  let target;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((entry) => entry.type === "page");
      if (target) break;
    } catch { /* Electron is starting. */ }
    await sleep(500);
  }
  assert.ok(target, "Electron renderer appears");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  });
  async function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((done, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
      pending.set(id, (message) => {
        clearTimeout(timeout);
        pending.delete(id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else done(message.result);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Renderer error");
    return result.result?.value;
  }
  async function waitFor(expression, attempts = 60) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, 'failure.png'), Buffer.from(screenshot.data, 'base64'));
    process.stderr.write(JSON.stringify(await evaluate(`({focus: document.activeElement?.outerHTML.slice(0, 600), panels: [...document.querySelectorAll('.editor-file-panel')].map(panel => ({path: panel.dataset.path, active: panel.dataset.active, text: panel.textContent.slice(-600)}))})`)) + '\n');
    throw new Error(`Condition did not become true: ${expression}`);
  }
  async function key(key, code, modifiers = 0) {
    const windowsVirtualKeyCode = ({ End: 35, Home: 36, ArrowRight: 39 })[key] ?? key.toUpperCase().charCodeAt(0);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  }
  async function focusPanel(index) {
    const point = await evaluate(`(() => {
      const panel = document.querySelectorAll('.editor-file-panel')[${index}];
      const rect = panel.querySelector('.view-lines').getBoundingClientRect();
      return { x: Math.round(rect.left + 40), y: Math.round(rect.top + 10) };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await sleep(80);
  }
  async function typeText(text) {
    for (const character of text) await send('Input.dispatchKeyEvent', { type: 'char', text: character });
  }
  async function chooseFile(index, path) {
    await evaluate(`(() => {
      const picker = document.querySelectorAll('.editor-file-picker')[${index}];
      picker.value = ${JSON.stringify(path)};
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }
  await waitFor("document.querySelectorAll('.tab').length === 2");
  await evaluate("document.querySelector('dialog.onboarding')?.close()");
  await evaluate("window.adcode.settings.write('adcode.session.autoSave', false)");
  await evaluate("window.adcode.settings.write('adcode.formatting.formatOnSave', false)");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  if (process.argv.includes("--git-badge")) {
    execFileSync("git", ["init", "--quiet", workspace]);
    await waitFor("document.querySelector('#git-badge').hidden === false", 120);
    assert.equal(await evaluate("document.querySelector('#git-badge').textContent"), "2");
    assert.equal(await evaluate("document.querySelector('.activity[data-view=scm]').getAttribute('aria-label')"), "Source control: 2 uncommitted files");
    execFileSync("git", ["-C", workspace, "add", "."]);
    await sleep(5500);
    assert.equal(await evaluate("document.querySelector('#git-badge').textContent"), "2", "Staging does not double-count files");
    execFileSync("git", ["-C", workspace, "-c", "user.name=Badge Test", "-c", "user.email=badge@example.test", "commit", "--quiet", "-m", "Fixture"]);
    await waitFor("document.querySelector('#git-badge').hidden === true", 120);
    await writeFile(files[1], "/* external edit */\n");
    await waitFor("document.querySelector('#git-badge').hidden === false && document.querySelector('#git-badge').textContent === '1'", 120);
    assert.equal(await evaluate("document.querySelector('dialog[data-popup-id=source-control]').open"), false, "Badge updates without opening source control");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, "git-badge.png"), Buffer.from(shot.data, "base64"));
    process.stdout.write("PASS: Git badge tracks untracked, staged, committed and externally edited files while the popup stays closed.\n");
  } else if (process.argv.includes("--ai")) {
    await checkAi({ evaluate, send, waitFor, sleep, artifacts });
  } else if (process.argv.includes("--popups")) {
    await checkPopups({ evaluate, send, waitFor, sleep, artifacts });
  } else {
  await evaluate("document.getElementById('editor-split').click()");
  await waitFor("document.querySelector('.editor-workspace').dataset.split === 'true'");
  assert.equal(await evaluate(`(() => {
    const panels = [...document.querySelectorAll('.editor-file-panel')];
    const [left, right] = panels.map((panel) => panel.getBoundingClientRect());
    return left.width > 200 && right.width > 200 && right.left > left.right &&
      panels.every((panel) => parseFloat(getComputedStyle(panel).borderRadius) >= 10);
  })()`), true, "Two rounded, separate file surfaces");

  // Real keystrokes must save to the focused file, leaving its neighbour untouched.
  const initialLeft = await readFile(files[0], "utf8");
  await focusPanel(1);
  await key("End", "End", 2);
  await typeText("\n/* right panel edit */");
  await waitFor("document.querySelectorAll('.editor-file-panel')[1].textContent.replaceAll('\\u00a0', ' ').includes('right panel edit')");
  await key("s", "KeyS", 2);
  await sleep(400);
  assert.match(await readFile(files[1], "utf8"), /right panel edit/);
  assert.equal(await readFile(files[0], "utf8"), initialLeft);
  await focusPanel(0);
  await key("End", "End", 2);
  await typeText("\n<!-- left panel edit -->");
  await key("s", "KeyS", 2);
  await sleep(400);
  assert.match(await readFile(files[0], "utf8"), /left panel edit/);

  // Both views of one file must see the same unsaved edit and share undo.
  await chooseFile(1, files[0]);
  await key("End", "End", 2);
  await typeText("\nSHARED_BUFFER_PROBE");
  await waitFor(`[...document.querySelectorAll('.editor-file-panel')].every(panel => panel.textContent.includes('SHARED_BUFFER_PROBE'))`);
  await focusPanel(0);
  await key("z", "KeyZ", 2);
  await waitFor(`![...document.querySelectorAll('.editor-file-panel')].some(panel => panel.textContent.includes('SHARED_BUFFER_PROBE'))`);

  // Merging hides a view; it must not discard its dirty buffer.
  await chooseFile(1, files[1]);
  await key("End", "End", 2);
  await typeText("\n/* survives merge */");
  await evaluate("document.getElementById('editor-merge').click()");
  await waitFor("document.querySelector('.editor-workspace').dataset.split === 'false'");
  await key("s", "KeyS", 2);
  await sleep(400);
  assert.match(await readFile(files[1], "utf8"), /survives merge/);
  assert.equal(await evaluate("document.querySelector('.editor-file-picker').value"), files[1]);

  await evaluate("document.getElementById('editor-split').click()");
  await chooseFile(0, files[0]);
  await chooseFile(1, files[1]);
  await evaluate("document.querySelector('.editor-divider').focus()");
  await key("ArrowRight", "ArrowRight");
  assert.ok(await evaluate("Number(document.querySelector('.editor-divider').getAttribute('aria-valuenow')) > 50"));
  await key("Home", "Home");
  assert.equal(await evaluate("document.querySelector('.editor-divider').getAttribute('aria-valuenow')"), "50");

  await focusPanel(0);
  await key("Home", "Home", 2);
  await focusPanel(1);
  await key("Home", "Home", 2);
  await evaluate("document.getElementById('terminal-new').click()");
  await waitFor("document.querySelectorAll('.terminal-tab-body:not([hidden]) .terminal-pane .xterm').length === 1 && !document.getElementById('panel').hidden");
  await evaluate("document.getElementById('terminal-split').click()");
  await waitFor("document.querySelectorAll('.terminal-tab-body:not([hidden]) .terminal-pane .xterm').length === 2");
  assert.equal(await evaluate(`[...document.querySelectorAll('.terminal-tab-body:not([hidden]) .terminal-pane')].every(pane => {
    const style = getComputedStyle(pane);
    return parseFloat(style.borderRadius) >= 10 && parseFloat(style.borderTopWidth) >= 1 && pane.clientHeight > 40;
  })`), true, "Split terminal panes each have a complete rounded border");

  for (const theme of ["dark", "light", "midnight"]) {
    await evaluate(`window.adcode.settings.write('adcode.appearance.theme', '${theme}')`);
    await sleep(200);
    assert.equal(await evaluate(`['.sidebar', '.main', '.editor-file-panel', '.panel', '.terminal-tab-body:not([hidden]) .terminal-pane'].every(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return parseFloat(style.borderRadius) >= 10 && parseFloat(style.borderTopWidth) >= 1;
    })`), true, `Visible boxed surfaces in ${theme}`);
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${theme}.png`), Buffer.from(screenshot.data, "base64"));
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 640, height: 600, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  assert.equal(await evaluate(`(() => {
    const workspace = document.querySelector('.editor-workspace').getBoundingClientRect();
    const merge = document.getElementById('editor-merge').getBoundingClientRect();
    return workspace.width > 0 && merge.right <= innerWidth && merge.bottom < innerHeight;
  })()`), true, "Both panel controls remain reachable in a narrow window");
  assert.doesNotMatch(log, /Uncaught (?:TypeError|ReferenceError)|UnhandledPromiseRejection/);
  process.stdout.write("PASS: split layout, focus/save routing, shared edits/undo, dirty merge, keyboard resize, boxed terminals, three themes, narrow layout.\n");
  }
} finally {
  socket?.close();
  child.kill();
  await sleep(700);
  // Only the mkdtemp directory created by this process is removed.
  await rm(scratch, { recursive: true, force: true }).catch(() => {});
}
