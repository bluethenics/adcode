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

// A fake Ollama with more models than the picker shows at once, so its rail, list and
// "Show more" have something to show. Skipped when a real Ollama already holds the port.
const OLLAMA_MODELS = ["qwen3-coder:30b", "qwen2.5-coder:7b", "llama3.3:70b", "deepseek-r1:14b", "gemma3:12b", "mistral-small:24b", "phi4:14b", "codestral:22b", "granite3.3:8b", "devstral:24b"];
const ollama = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(req.url === "/api/tags" ? JSON.stringify({ models: OLLAMA_MODELS.map((name) => ({ name })) }) : "{}");
});
const ollamaRunning = await new Promise((resolve) => {
  ollama.once("error", () => resolve(false));
  ollama.listen(11434, "127.0.0.1", () => resolve(true));
});

const userData = await mkdtemp(join(tmpdir(), "adcode-smoke-new-"));
const project = join(userData, "project");
await mkdir(project, { recursive: true });
await writeFile(join(project, "index.html"), "<h1>Project</h1>\n", "utf8");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: project, openFiles: [], activeFile: null } }), "utf8");
// Welcomed already, so the first-run sheet does not cover what is being checked.
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ tour: 2, completed: true, completedAt: 1 }), "utf8").catch(() => undefined);

// Usage rows for the Usage page check: smoke data, shaped like what 2.6.1 records (chats,
// projects, hours, the cost split), spread over 30 days and three providers.
{
  const day = (back) => { const d = new Date(Date.now() - back * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const hours = (at, count) => Array.from({ length: 24 }, (_v, h) => (h === at ? count : 0));
  const rows = [];
  for (let back = 0; back < 30; back++) {
    const wave = 1 + Math.round(2 + 2 * Math.sin(back / 3));
    if (back % 7 !== 5) rows.push({ day: day(back), provider: "anthropic", model: "claude-sonnet-4-5", source: "chat", chat: `smoke-chat-${back % 4}`, project: join(userData, "project"), requests: wave * 3, inputTokens: wave * 42_000, cachedTokens: wave * 30_000, outputTokens: wave * 3_200, estimatedRequests: 0, pricedRequests: wave * 3, costMicros: wave * 99_000, inputCostMicros: wave * 36_000, cacheReadCostMicros: wave * 9_000, outputCostMicros: wave * 48_000, cacheSavedMicros: wave * 81_000, hours: hours(9 + (back % 8), wave * 3), timedRequests: wave * 3, durationMs: wave * 3 * 9_000, firstResponseMs: wave * 3 * 1_400, timedOutputTokens: wave * 3_200 });
    if (back % 2 === 0) rows.push({ day: day(back), provider: "openai", model: "gpt-5", source: "agents", project: join(userData, "project"), requests: 4, inputTokens: 60_000, cachedTokens: 20_000, outputTokens: 6_000, estimatedRequests: 0, pricedRequests: 4, costMicros: 135_000, inputCostMicros: 50_000, cacheReadCostMicros: 25_000, outputCostMicros: 60_000, cacheSavedMicros: 22_000, hours: hours(14 + (back % 5), 4), timedRequests: 4, durationMs: 4 * 15_000, firstResponseMs: 4 * 2_000, timedOutputTokens: 6_000 });
    if (back % 3 === 0) rows.push({ day: day(back), provider: "tagflow", model: "tagflow-code", source: "chat", chat: `smoke-free-${back % 2}`, requests: 5, inputTokens: 30_000, cachedTokens: 0, outputTokens: 4_000, estimatedRequests: 1, pricedRequests: 0, costMicros: 0, hours: hours(20, 5) });
  }
  await writeFile(join(userData, "ai-usage.json"), JSON.stringify({ version: 1, rows }), "utf8");
}

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
  // The drawing, not just the box: a stray icon rule once drew Buck as a 15px speck in a 184px frame.
  check("browserMascotIsBig", await evaluate(`(() => { const svg = document.querySelector('.live-browser-start .adcode-mascot svg'); const box = svg?.getBoundingClientRect(); return !!box && box.width >= 120 && box.height >= 120; })()`));
  check("browserStartPage", await evaluate(`(() => { const s = document.querySelector('.live-browser-start'); return { shown: !s.hidden, hasMascot: !!s.querySelector('.adcode-mascot'), hasSearch: !!s.querySelector('input') }; })()`));
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
  /* ── Annotate: pins on the live page, sent to the chat ── */
  check("annotateButton", await evaluate(`(() => {
    const button = document.querySelector('.live-browser .annotate-toggle');
    return { present: !!button, labelled: button?.textContent === 'Annotate', hasTooltip: (button?.title ?? '').startsWith('Annotate:') };
  })()`));
  await evaluate(`(() => { document.querySelector('.live-browser .annotate-toggle').click(); return true; })()`);
  check("annotateModeOn", await waitFor(`(() => {
    const layer = document.querySelector('.live-browser .annotate-layer');
    return !!layer && !layer.hidden && document.querySelector('.live-browser .annotate-toggle').getAttribute('aria-pressed') === 'true'
      && layer.querySelector('.annotate-coach-text strong').textContent === 'Click anything you want changed, then type what to change'
      && layer.querySelector('.annotate-empty').textContent === 'No pins yet - click anything on the page';
  })()`, 5_000));
  // Where the heading and the button are, asked through the same channel the sheet uses.
  const spots = await evaluate(`(async () => {
    const answer = await window.adcode.browser.annotate({ surface: 'browser', tab: 1 }, { kind: 'locate', selectors: ['h1', '#b'] });
    return answer.rects;
  })()`);
  checks.annotateLocate = spots;
  const pinAt = (rect, words) => evaluate(`(async () => {
    const layer = document.querySelector('.live-browser .annotate-layer');
    const box = layer.getBoundingClientRect();
    const rect = ${JSON.stringify(rect)};
    const x = box.left + rect.x + Math.min(rect.width / 2, 40), y = box.top + rect.y + rect.height / 2;
    const catcher = layer.querySelector('.annotate-catcher');
    catcher.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 7, bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const label = layer.querySelector('.annotate-outline-label');
    const hovered = label.hidden ? null : label.textContent;
    catcher.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 7, bubbles: true }));
    catcher.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, button: 0, pointerId: 7, bubbles: true }));
    const editor = layer.querySelector('.annotate-editor');
    for (let i = 0; i < 40 && (editor.hidden || editor.querySelector('.annotate-editor-what').textContent.startsWith('Reading')); i++) await new Promise((r) => setTimeout(r, 100));
    const what = editor.querySelector('.annotate-editor-what').textContent;
    const note = editor.querySelector('textarea');
    note.value = ${JSON.stringify(words)};
    note.dispatchEvent(new Event('input', { bubbles: true }));
    editor.requestSubmit();
    await new Promise((r) => setTimeout(r, 300));
    return { hovered, what };
  })()`);
  if (Array.isArray(spots) && spots[0] && spots[1]) {
    checks.annotatePin1 = await pinAt(spots[0], "make this blue");
    checks.annotatePin2 = await pinAt(spots[1], "this button does nothing");
  }
  check("annotateTwoPins", await evaluate(`(() => {
    const layer = document.querySelector('.live-browser .annotate-layer');
    const pins = [...layer.querySelectorAll('.annotate-pin')];
    const send = layer.querySelector('.annotate-send');
    return {
      twoPins: pins.length === 2,
      numbered: pins.map((pin) => pin.querySelector('.annotate-pin-number').textContent).join(',') === '1,2',
      pinsAreBig: pins.every((pin) => pin.getBoundingClientRect().width >= 30),
      listed: layer.querySelectorAll('.annotate-row').length === 2,
      sendCounts: send.getAttribute('aria-label') === 'Send to chat (2)' && !send.disabled,
      editorClosed: layer.querySelector('.annotate-editor').hidden,
    };
  })()`));
  // Hover over the heading again so the picture shows the outline gliding to it.
  if (Array.isArray(spots) && spots[0]) {
    await evaluate(`(() => {
      const layer = document.querySelector('.live-browser .annotate-layer');
      const box = layer.getBoundingClientRect();
      const rect = ${JSON.stringify(spots[0])};
      layer.querySelector('.annotate-catcher').dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + rect.x + 120, clientY: box.top + rect.y + rect.height / 2, pointerId: 7, bubbles: true }));
      return true;
    })()`);
    await sleep(600);
  }
  // A first-run notice can sit over the panel's corner; close it (its X, not its OK) so the picture shows the coach.
  await evaluate(`(() => {
    for (const heading of document.querySelectorAll('h1, h2, h3, strong, p, div')) {
      if (heading.children.length > 0 || !/Sponsored cards that match/.test(heading.textContent ?? '')) continue;
      const card = heading.closest('[role="dialog"], [role="alert"], [role="status"], article, section, aside');
      card?.querySelector('button[aria-label^="Close"], button[aria-label^="Dismiss"], button[title^="Close"], button[title^="Dismiss"]')?.click();
    }
    return true;
  })()`);
  await sleep(1200);
  // The window as painted, guest page included (a DevTools screenshot leaves the webview blank).
  const windowShot = await evaluate(`window.adcode.browser.captureForAnnotate({ surface: 'preview', rect: { x: 0, y: 0, width: innerWidth, height: innerHeight } }).catch(() => null)`);
  const shot = typeof windowShot === "string" && windowShot.startsWith("data:image/png;base64,") ? windowShot.slice("data:image/png;base64,".length) : (await send("Page.captureScreenshot", { format: "png" })).result?.data;
  if (shot) {
    await mkdir(join(REPO, "output"), { recursive: true });
    await writeFile(join(REPO, "output", "annotate.png"), Buffer.from(shot, "base64"));
    checks.annotateScreenshot = join(REPO, "output", "annotate.png");
  }
  await evaluate(`(() => { document.querySelector('.live-browser .annotate-send').click(); return true; })()`);
  check("annotateSentToChat", await waitFor(`(() => {
    const input = [...document.querySelectorAll('.chat-input')].find((node) => node.value.includes('1. '));
    return !!input && input.value.includes('make this blue') && input.value.includes('this button does nothing');
  })()`, 15_000));
  checks.annotateComposedText = await evaluate(`[...document.querySelectorAll('.chat-input')].map((node) => node.value).find((value) => value.includes('1. ')) ?? null`);
  check("annotateScreenshotAttached", await waitFor(`[...document.querySelectorAll('.chat-attachment')].some((chip) => chip.textContent.includes('annotated-page'))`, 10_000));
  // The picture the assistant gets: the page with the numbered pins drawn on it.
  const sentImage = await evaluate(`document.querySelector('.chat-attachment-thumb')?.src ?? null`);
  if (typeof sentImage === "string" && sentImage.startsWith("data:image/")) {
    await writeFile(join(REPO, "output", "annotate-sent.png"), Buffer.from(sentImage.slice(sentImage.indexOf(",") + 1), "base64"));
    checks.annotateSentImage = join(REPO, "output", "annotate-sent.png");
  }
  check("annotateSentConfirmation", await evaluate(`(() => { const sent = document.querySelector('.live-browser .annotate-sent'); return !!sent && sent.textContent === 'Sent 2 notes to chat'; })()`));
  check("annotateModeOffAfterSend", await evaluate(`document.querySelector('.live-browser .annotate-layer').hidden && document.querySelector('.live-browser .annotate-toggle').getAttribute('aria-pressed') === 'false'`));
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

  /* ── The composer's model picker ── */
  checks.fakeOllama = ollamaRunning;
  checks.modelPickerCommand = await runCommand("AI: Choose Model and Reasoning");
  check("modelPickerOpens", await waitFor(`!!document.querySelector('.model-picker[data-state="open"]')`, 10_000));
  // Wait for the fake Ollama to be seen, when it runs, so the list is the one being checked.
  if (ollamaRunning) {
    await waitFor(`window.adcode.ai.status().then((s) => s.providers.some((p) => p.id === 'ollama' && p.local?.running))`, 15_000);
    await evaluate(`(() => { document.querySelector('.model-picker [data-rail="ollama"]')?.click(); return true; })()`);
    await sleep(300);
  }
  checks.modelPicker = await evaluate(`(() => {
    const p = document.querySelector('.model-picker');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return {
      railButtons: p.querySelectorAll('.model-picker-rail-button').length,
      railNames: [...p.querySelectorAll('.model-picker-rail-button')].map((b) => b.getAttribute('aria-label')),
      railLabels: [...p.querySelectorAll('.model-picker-rail-name')].map((n) => n.textContent),
      railTabsFit: [...p.querySelectorAll('.model-picker-rail-button')].every((b) => b.scrollWidth <= b.clientWidth + 1),
      rows: p.querySelectorAll('.model-picker-pick').length,
      showMore: p.querySelector('.model-picker-more')?.textContent ?? null,
      reasoningOptions: [...p.querySelectorAll('.model-picker-effort-label')].map((n) => n.textContent),
      reasoningSentence: p.querySelector('.model-picker-reasoning-for')?.textContent ?? null,
      footer: p.querySelector('.model-picker-footer')?.textContent ?? null,
      everyButtonNamed: [...p.querySelectorAll('button, select, input')].every((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() !== ''),
      fitsWindow: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 300,
      chip: document.querySelector('.chat-model')?.textContent ?? null,
    };
  })()`);
  check("modelPickerFits", checks.modelPicker?.fitsWindow === true && checks.modelPicker?.everyButtonNamed === true && checks.modelPicker?.railButtons >= 1);
  if (ollamaRunning) check("modelPickerListsOllama", checks.modelPicker?.rows === 8 && /Show 2 more/.test(checks.modelPicker?.showMore ?? ""));
  check("modelPickerNamedTabs", checks.modelPicker?.railLabels?.[0] === "Favourites" && checks.modelPicker?.railLabels?.length === checks.modelPicker?.railButtons && checks.modelPicker?.railTabsFit === true);
  // Show more grows the popover smoothly: a height animation on the body, ending taller.
  if (ollamaRunning) {
    checks.modelPickerHeightMotion = await evaluate(`(async () => {
      const body = document.querySelector('.model-picker-body');
      const before = body.offsetHeight;
      document.querySelector('.model-picker-more')?.click();
      const animated = body.getAnimations().some((a) => a.effect?.getKeyframes?.().some((k) => 'height' in k));
      const midway = await new Promise((r) => setTimeout(() => r(body.offsetHeight), 60));
      await new Promise((r) => setTimeout(r, 400));
      return { reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true', before, midway, after: body.offsetHeight, animated, rows: document.querySelectorAll('.model-picker-pick').length };
    })()`);
    check("modelPickerHeightEases", (checks.modelPickerHeightMotion?.animated === true || checks.modelPickerHeightMotion?.reduceMotion === true) && checks.modelPickerHeightMotion?.rows === 10 && checks.modelPickerHeightMotion?.after >= checks.modelPickerHeightMotion?.before);
  }
  // Star the first two: they gain Ctrl+1 and Ctrl+2, and the setting keeps them.
  checks.modelPickerFavourites = await evaluate(`(async () => {
    const stars = [...document.querySelectorAll('.model-picker-star')];
    if (stars.length < 2) return { skipped: 'fewer than two models' };
    stars[0].click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelectorAll('.model-picker-star')[1].click();
    await new Promise((r) => setTimeout(r, 400));
    const kbd = [...document.querySelectorAll('.model-picker-kbd')].map((n) => n.textContent);
    const saved = JSON.parse((await window.adcode.settings.read())['adcode.ai.favoriteModels'] || '[]');
    return { shortcuts: kbd, saved: saved.length };
  })()`);
  checks.modelPickerSearch = await evaluate(`(async () => {
    const input = document.querySelector('.model-picker-search input');
    const focused = document.activeElement === input || document.querySelector('.model-picker').contains(document.activeElement);
    input.focus();
    input.value = 'zzzz-no-model';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const none = document.querySelectorAll('.model-picker-pick').length === 0 && /No model matches/.test(document.querySelector('.model-picker-empty')?.textContent ?? '');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    return { focusInPicker: focused, noMatchSaysSo: none };
  })()`);
  // Every provider on the rail, and the thinking levels its first model offers.
  checks.modelPickerProviders = await evaluate(`(async () => {
    const out = [];
    for (const button of [...document.querySelectorAll('.model-picker-rail-button')]) {
      document.querySelector('.model-picker [data-rail="' + button.dataset.rail + '"]').click();
      await new Promise((r) => setTimeout(r, 150));
      out.push({ rail: button.dataset.rail, rows: document.querySelectorAll('.model-picker-pick').length, reasoning: [...document.querySelectorAll('.model-picker-effort-label')].map((n) => n.textContent) });
    }
    return out;
  })()`);
  // For the picture: the provider whose model shows the most thinking levels, else Ollama.
  const pictured = [...(Array.isArray(checks.modelPickerProviders) ? checks.modelPickerProviders : [])].filter((one) => one.rail !== "favorites").sort((a, b) => b.reasoning.length - a.reasoning.length)[0]?.rail ?? "ollama";
  await evaluate(`(() => { (document.querySelector('.model-picker [data-rail=' + JSON.stringify(${JSON.stringify(pictured)}) + ']') ?? document.querySelector('.model-picker [data-rail="favorites"]'))?.click(); return true; })()`);
  await sleep(300);
  {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (shot?.result?.data) {
      await mkdir(join(REPO, "output"), { recursive: true });
      await writeFile(join(REPO, "output", "model-picker.png"), Buffer.from(shot.result.data, "base64"));
      checks.modelPickerScreenshot = "output/model-picker.png";
    }
  }
  checks.modelPickerEscape = await evaluate(`(async () => {
    document.querySelector('.model-picker-search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { closed: !document.querySelector('.model-picker'), focusBackOnChip: document.activeElement === document.querySelector('.chat-model') };
  })()`);
  check("modelPickerEscapeCloses", checks.modelPickerEscape?.closed === true);

  /* ── The Usage page ── */
  await evaluate(`(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); return true; })()`);
  checks.usageCommand = await runCommand("AI: Show Usage");
  await waitFor(`!!document.querySelector("dialog.ai-usage-dialog[open] .usage-provider")`, 15_000);
  await evaluate(`(() => { document.querySelector(".ai-usage-dialog .usage-view[data-view=\\"cost\\"]")?.click(); document.querySelector(".ai-usage-dialog .usage-tabs [data-range=\\"30d\\"]")?.click(); return true; })()`);
  await sleep(900);
  checks.usagePage = await evaluate(`(() => {
    const dialog = document.querySelector("dialog.ai-usage-dialog[open]");
    if (!dialog) return { open: false };
    const text = (selector) => dialog.querySelector(selector)?.textContent?.trim() ?? null;
    return {
      open: true,
      crumbs: text(".usage-crumbs"),
      range: text(".usage-tabs [aria-selected=\\"true\\"]"),
      view: text(".usage-views [aria-checked=\\"true\\"]"),
      sections: dialog.querySelectorAll(".usage-body .usage-panel").length,
      providerRows: dialog.querySelectorAll(".usage-provider").length,
      total: text(".usage-hero-value"),
      totalLine: text(".usage-hero-sub"),
      summary: [...dialog.querySelectorAll(".usage-summary li")].map((li) => li.textContent),
      chartLayers: dialog.querySelectorAll(".usage-area-layer").length,
      breakdownRows: dialog.querySelectorAll(".usage-breakdown tbody tr").length,
      hourCells: dialog.querySelectorAll(".usage-hours-grid .usage-hours-cell").length,
      chats: dialog.querySelectorAll(".usage-chat").length,
      whatIf: text(".usage-whatif-value"),
      sectionTabs: [...dialog.querySelectorAll(".usage-section-tab")].map((tab) => tab.textContent),
      modelCards: [...dialog.querySelectorAll(".usage-model-card .usage-model-title strong")].map((name) => name.textContent),
      compareWith: [...dialog.querySelectorAll(".usage-whatif-select option")].map((option) => option.textContent),
      speed: text(".usage-speed-line"),
      noMarkup: !/plus 35%|markup/i.test(dialog.textContent),
      overflow: dialog.querySelector(".usage-body").scrollWidth > dialog.querySelector(".usage-body").clientWidth + 1,
    };
  })()`);
  // Only models actually used: the seed used three, so three cards, and nothing else offered to compare.
  check("usagePageBuilt", checks.usagePage?.open === true && checks.usagePage.sections >= 9 && checks.usagePage.providerRows === 3 && checks.usagePage.chartLayers >= 2 && checks.usagePage.overflow === false
    && checks.usagePage.sectionTabs.length === 4 && checks.usagePage.modelCards.length === 3 && checks.usagePage.compareWith.length <= 3 && checks.usagePage.noMarkup === true);
  const usageShot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    if (!shot?.result?.data) return null;
    await mkdir(join(REPO, "output"), { recursive: true });
    await writeFile(join(REPO, "output", name), Buffer.from(shot.result.data, "base64"));
    return `output/${name}`;
  };
  checks.usageScreenshot = await usageShot("usage-page.png");
  await evaluate(`(() => { document.querySelector('.ai-usage-dialog .usage-section-tab[data-section="models"]')?.click(); document.querySelector(".ai-usage-dialog .usage-model-head")?.click(); return true; })()`);
  await sleep(500);
  checks.usageScreenshotModels = await usageShot("usage-page-models.png");
  await evaluate(`(() => { document.querySelector('.ai-usage-dialog .usage-section-tab[data-section="overview"]')?.click(); document.querySelector('.ai-usage-dialog .usage-view[data-view="limits"]')?.click(); return true; })()`);
  // Limits must settle: within a few seconds it says something more than "Checking...", and by
  // the read's 10-second deadline it shows a real allowance, or words saying why there is none.
  const limitsStarted = Date.now();
  const limitsSpoke = await waitFor(`(() => { const box = document.querySelector(".ai-usage-dialog .usage-limits"); return !!box && !box.hidden && [...box.querySelectorAll(".usage-allowance, .usage-panel-empty")].some((node) => !node.hidden && !node.textContent.includes("Checking included AI allowance")); })()`, 6_000);
  const limitsSpokeMs = Date.now() - limitsStarted;
  const limitsSettled = limitsSpoke && await waitFor(`(() => { const box = document.querySelector(".ai-usage-dialog .usage-limits"); return [...box.querySelectorAll(".usage-allowance, .usage-panel-empty")].some((node) => !node.hidden && !/checking/i.test(node.textContent)); })()`, 12_000);
  checks.usageLimits = await evaluate(`(() => {
    const box = document.querySelector(".ai-usage-dialog .usage-limits");
    const shown = [...box.querySelectorAll(".usage-allowance, .usage-panel-empty")].filter((node) => !node.hidden).map((node) => node.textContent.replace(/\\s+/g, " ").trim().slice(0, 140));
    const select = document.querySelector(".ai-usage-dialog .usage-crumb-select");
    return { shown, filtersHidden: !select || select.offsetWidth === 0, noMarkup: !/plus 35%|markup/i.test(box.textContent) };
  })()`);
  if (typeof checks.usageLimits === "object" && checks.usageLimits !== null) Object.assign(checks.usageLimits, { firstWordsMs: limitsSpokeMs, settledMs: Date.now() - limitsStarted });
  check("usageLimitsSettle", limitsSettled && checks.usageLimits?.shown?.length > 0 && checks.usageLimits.filtersHidden === true && checks.usageLimits.noMarkup === true);
  await sleep(300);
  checks.usageScreenshotLimits = await usageShot("usage-page-limits.png");
  await evaluate(`(() => { document.querySelector('.ai-usage-dialog .usage-view[data-view="cost"]')?.click(); return true; })()`);
  await sleep(300);
  checks.usageViews = await evaluate(`(async () => {
    const pause = () => new Promise((r) => setTimeout(r, 250));
    const view = (name) => document.querySelector(".ai-usage-dialog .usage-view[data-view=\\"" + name + "\\"]");
    view("tokens").click(); await pause();
    const tokens = document.querySelector(".ai-usage-dialog .usage-body").textContent.includes("Tokens by type");
    view("limits").click(); await pause();
    const limits = !document.querySelector(".ai-usage-dialog .usage-limits").hidden && document.querySelector(".ai-usage-dialog .usage-body").hidden;
    view("cost").click(); await pause();
    document.querySelector(".ai-usage-dialog .usage-footer .ad-btn-primary")?.click(); await pause();
    return { tokens, limits, closed: !document.querySelector("dialog.ai-usage-dialog[open]") };
  })()`);
  check("usageViewsSwitch", checks.usageViews);

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
  ollama.close();
  await sleep(800);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
}

for (const [name, value] of Object.entries(checks)) console.log(`  ${name}: ${JSON.stringify(value)}`);
console.log(failed ? "\nFAILED: read the values above." : "\nAll new-surface checks passed.");
process.exitCode = failed ? 1 : 0;
