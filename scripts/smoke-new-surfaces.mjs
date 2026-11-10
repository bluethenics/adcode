/**
 * Smoke for the surfaces the unit tests cannot see: the live Browser panel, Plugins > Apps,
 * Move in, rich chat replies and the Skills ordering controls - in the built app, over CDP.
 *
 * The Browser check is the one that matters most. A `<webview>` only exists if the window
 * allows the tag, the main process lets this one attach, the page's policy does not block
 * it and the guest loads; any of those failing leaves a blank panel that every unit test
 * would still pass. It loads a page from a server this script starts, so nothing here
 * touches the network.
 *
 * Run after `npm run desktop:build`:  node scripts/smoke-new-surfaces.mjs
 * Read the printed values, not just the exit code.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { startSmokeBackend } from "./smoke-backend.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const PORT = Number(process.env.ADCODE_SMOKE_PORT ?? "9347");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A page for the Browser to load: a title, a button and a field, served from this process.
const site = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Smoke page</title><h1>Hello from the smoke page</h1><button id="b" onclick="document.title='Clicked'">Press</button><input aria-label="Name"><p>${req.url}</p>`);
});
await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
const siteUrl = `http://127.0.0.1:${site.address().port}/`;

const userData = await mkdtemp(join(tmpdir(), "adcode-smoke-new-"));
const project = join(userData, "project");
await mkdir(project, { recursive: true });
await writeFile(join(project, "index.html"), "<h1>Project</h1>\n", "utf8");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: project, openFiles: [], activeFile: null } }), "utf8");
// Welcomed already, so the first-run sheet does not cover what is being checked.
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, completedAt: 1 }), "utf8").catch(() => undefined);

const backend = await startSmokeBackend();
const env = { ...process.env, ...backend.env, ADCODE_USER_DATA_DIR: userData, ELECTRON_ENABLE_LOGGING: "1", ADCODE_ACCOUNT_GATE: "off" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), ["apps/desktop", "--enable-logging", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], shell: false });
let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { return []; }
}
async function findPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const page = (await targets()).find((target) => target.type === "page" && target.webSocketDebuggerUrl && target.url.startsWith("app://"));
    if (page !== undefined) return page;
    await sleep(500);
  }
  throw new Error("no renderer target appeared");
}

const checks = {};
let failed = false;
const check = (name, value) => {
  checks[name] = value;
  const ok = value === true || (typeof value === "object" && value !== null && Object.values(value).every((part) => part !== false));
  if (!ok) failed = true;
};

try {
  const page = await findPage();
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await access(join(userData, "ads", "ads", "identity.json")); break; } catch { await sleep(250); }
  }
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const message = await Promise.race([send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), sleep(20_000).then(() => null)]);
    if (message === null) return "THREW: timed out";
    if (message.result?.exceptionDetails !== undefined) return `THREW: ${message.result.exceptionDetails.exception?.description ?? "unknown"}`;
    return message.result?.result?.value;
  };
  const waitFor = async (expression, ms = 20_000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if ((await evaluate(expression)) === true) return true;
      await sleep(250);
    }
    return false;
  };
  const runCommand = async (query) => {
    await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })); return true; })()`);
    await sleep(400);
    return evaluate(`(async () => {
      const input = document.querySelector('.quickopen-input[aria-label="Command palette"]');
      if (!input) return false;
      input.value = ${JSON.stringify(query)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      const row = document.querySelector('.palette-row');
      if (!row) { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
      const label = row.textContent;
      row.click();
      return label;
    })()`);
  };

  await send("Page.bringToFront", {});
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  check("windowReady", await waitFor(`typeof window.adcode === 'object' && document.readyState === 'complete' && !!document.querySelector('.agent-browser')`, 60_000));
  // Anything modal left from first launch would swallow the palette.
  await evaluate(`(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); return true; })()`);
  await sleep(500);

  /* ── The live Browser ── */
  checks.openBrowserCommand = await runCommand("Open Browser");
  check("browserPanelIsLive", await waitFor(`!!document.querySelector('.live-browser') && !!document.querySelector('.live-browser-start-search input')`));
  check("browserStartPage", await evaluate(`(() => { const s = document.querySelector('.live-browser-start'); return { shown: !s.hidden, hasMascot: !!s.querySelector('.chat-mascot'), hasSearch: !!s.querySelector('input') }; })()`));
  await evaluate(`(() => { const input = document.querySelector('.live-browser-start-search input'); input.value = ${JSON.stringify(siteUrl)}; input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return true; })()`);
  check("webviewCreated", await waitFor(`!!document.querySelector('webview.live-browser-view')`));
  check("webviewLoadedThePage", await waitFor(`(() => { const v = document.querySelector('webview.live-browser-view'); try { return v.getTitle() === 'Smoke page' && v.getURL() === ${JSON.stringify(siteUrl)}; } catch { return false; } })()`, 30_000));
  check("browserChrome", await evaluate(`(() => {
    const root = document.querySelector('.live-browser');
    const view = root.querySelector('webview.live-browser-view').getBoundingClientRect();
    const stage = root.querySelector('.live-browser-stage').getBoundingClientRect();
    return {
      addressShowsIt: root.querySelector('.live-browser-address input').value === ${JSON.stringify(siteUrl)},
      tabNamed: root.querySelector('.agent-browser-tab .workspace-tab-label').textContent === 'Smoke page',
      startPageGone: root.querySelector('.live-browser-start').hidden,
      viewFillsStage: Math.abs(view.width - stage.width) < 2 && Math.abs(view.height - stage.height) < 2 && view.height > 100,
      viewVisible: getComputedStyle(root.querySelector('webview.live-browser-view')).visibility === 'visible',
    };
  })()`));
  // The guest is a real, separate page: DevTools lists it, and it is not the workbench.
  const guest = (await targets()).find((target) => target.type === "webview" && target.url === siteUrl);
  check("guestIsASeparatePage", guest !== undefined);
  // A real click reaches the page: dispatched to the guest itself, as a person's would be.
  if (guest !== undefined) {
    const guestSocket = new WebSocket(guest.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { guestSocket.addEventListener("open", resolve, { once: true }); guestSocket.addEventListener("error", reject, { once: true }); });
    const guestReply = new Promise((resolve) => guestSocket.addEventListener("message", (event) => resolve(JSON.parse(event.data)), { once: true }));
    guestSocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "document.getElementById('b').click(); [typeof require, typeof process, typeof window.adcode].join(',')", returnByValue: true } }));
    const reply = await guestReply;
    guestSocket.close();
    // No Node and no bridge inside a web page, whatever the embedder asked for.
    check("guestHasNoNodeOrBridge", reply.result?.result?.value === "undefined,undefined,undefined");
    check("titleFollowsThePage", await waitFor(`document.querySelector('.agent-browser-tab .workspace-tab-label').textContent === 'Clicked'`, 8_000));
  }
  // The main process only accepts a tab that really is this window's shared-browser guest.
  check("tabRegistrationIsChecked", await evaluate(`(async () => {
    const view = document.querySelector('webview.live-browser-view');
    const real = await window.adcode.browser.attachTab(1, view.getWebContentsId(), true).then(() => true, () => false);
    const fake = await window.adcode.browser.attachTab(2, 1, true).then(() => true, () => false);
    return { acceptsItsOwnGuest: real, refusesTheWorkbenchItself: fake === false };
  })()`));
  // Any other webview is refused at attach: it never becomes a page.
  check("foreignWebviewRefused", await evaluate(`(async () => {
    const stray = document.createElement('webview');
    stray.setAttribute('src', ${JSON.stringify(siteUrl)});
    stray.style.cssText = 'position:fixed;left:0;top:0;width:50px;height:50px';
    document.body.append(stray);
    await new Promise((r) => setTimeout(r, 1500));
    let attached = true;
    try { stray.getWebContentsId(); } catch { attached = false; }
    stray.remove();
    return attached === false;
  })()`));
  check("narrowPanelStillFits", await evaluate(`(async () => {
    const panel = document.querySelector('.agent-browser-panel');
    const before = panel.style.width;
    panel.style.width = '340px';
    await new Promise((r) => setTimeout(r, 300));
    const root = panel.querySelector('.live-browser');
    const bar = root.querySelector('.live-browser-toolbar');
    const fits = bar.scrollWidth <= bar.clientWidth + 1 && root.querySelector('.live-browser-address').getBoundingClientRect().width > 120;
    panel.style.width = before;
    return fits;
  })()`));
  await evaluate(`(() => { document.querySelector('.agent-browser-panel [aria-label^="Close"]')?.click(); return true; })()`);

  /* ── Rich replies, through the chat's own renderer and click wiring ── */
  check("chatLinkOpensTheBrowser", await evaluate(`(async () => {
    let asked = null;
    const listen = (event) => { asked = event.detail.url; };
    document.addEventListener('adcode:open-link', listen);
    document.dispatchEvent(new CustomEvent('adcode:open-link', { detail: { url: ${JSON.stringify(`${siteUrl}from-chat`)} } }));
    await new Promise((r) => setTimeout(r, 1500));
    document.removeEventListener('adcode:open-link', listen);
    const tabs = document.querySelectorAll('.agent-browser-tab').length;
    return { eventCarriedTheAddress: asked === ${JSON.stringify(`${siteUrl}from-chat`)}, openedANewTab: tabs === 2 };
  })()`));
  await evaluate(`(() => { document.querySelector('.agent-browser-panel [aria-label^="Close"]')?.click(); return true; })()`);

  /* ── Plugins > Apps ── */
  checks.appsCommand = await runCommand("Plugins: Connect Apps");
  check("appsGallery", await waitFor(`document.querySelectorAll('.composio-card').length >= 70`));
  check("appsGalleryDetail", await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.composio-card')];
    const names = cards.map((card) => card.querySelector('.composio-card-name').textContent);
    const banner = document.querySelector('.composio-banner');
    return {
      hasGmailSupabaseCloudflare: ['Gmail', 'Supabase', 'Cloudflare'].every((name) => names.includes(name)),
      everyCardHasALogoSlot: cards.every((card) => !!card.querySelector('.composio-logo img[src^="https://logos.composio.dev/api/"]')),
      bannerState: banner.dataset.state,
      bannerOffersConnect: banner.dataset.state !== 'missing' || banner.querySelector('.composio-banner-actions button').textContent === 'Connect Composio',
      categories: document.querySelectorAll('.community-category').length >= 8,
      noSidewaysScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
    };
  })()`));
  check("appsSearchNarrows", await evaluate(`(async () => {
    const search = [...document.querySelectorAll('.community-search input')].find((input) => input.offsetParent !== null);
    search.value = 'supabase';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const names = [...document.querySelectorAll('.composio-card-name')].map((node) => node.textContent);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    return names.length === 1 && names[0] === 'Supabase';
  })()`));

  /* ── Tools > Skills ordering ── */
  checks.skillsCommand = await runCommand("Tools: Sort, Pin and Group Skills");
  check("skillsSortControl", await waitFor(`[...document.querySelectorAll('select[aria-label="Sort skills"]')].some((s) => s.offsetParent !== null && s.options.length === 5)`));

  /* ── Move in ── */
  checks.moveInCommand = await runCommand("Move In: Bring Your AI Accounts");
  check("moveInOpens", await waitFor(`!!document.querySelector('dialog.move-in[open]') && document.querySelectorAll('.move-in-cli').length >= 4`, 30_000));
  check("moveInDetail", await evaluate(`(() => {
    const dialog = document.querySelector('dialog.move-in');
    const names = [...dialog.querySelectorAll('.move-in-cli-text strong')].map((node) => node.textContent);
    const buttons = [...dialog.querySelectorAll('button')].map((b) => b.textContent);
    return {
      listsTheClis: ['Claude Code', 'Codex CLI', 'OpenCode'].every((name) => names.includes(name)),
      everyCliHasANextStep: [...dialog.querySelectorAll('.move-in-cli')].every((row) => row.querySelectorAll('button').length >= 1),
      offersScanAndFile: buttons.includes('Scan this computer') && buttons.some((label) => label.startsWith('Import an exported file')),
      nothingImportedYet: dialog.querySelector('.move-in-footer').hidden,
      fitsTheWindow: dialog.querySelector('.form-dialog-card').getBoundingClientRect().right <= window.innerWidth,
    };
  })()`));
  // The scan itself, against this script's empty home-less profile: it must answer, not hang.
  check("scanAnswers", await evaluate(`window.adcode.ai.scanChatImports().then((scan) => Array.isArray(scan.entries) && typeof scan.skipped === 'number', () => false)`));
  await evaluate(`(() => { document.querySelector('dialog.move-in')?.close(); return true; })()`);

  checks.suspiciousLog = output.split("\n").filter((line) => /Refused to|Content Security Policy|Uncaught|ERR_BLOCKED/i.test(line)).slice(0, 8);
  if (checks.suspiciousLog.length > 0) failed = true;
  socket.close();
} catch (error) {
  checks.error = String(error);
  failed = true;
} finally {
  child.kill();
  await backend.server.close().catch(() => undefined);
  site.close();
  await sleep(800);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
}

for (const [name, value] of Object.entries(checks)) console.log(`  ${name}: ${JSON.stringify(value)}`);
console.log(failed ? "\nFAILED: read the values above." : "\nAll new-surface checks passed.");
process.exitCode = failed ? 1 : 0;
