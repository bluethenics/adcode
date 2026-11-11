/**
 * Every `/` command in the built app, with real key presses, against a local fake model.
 *
 *   npm run desktop:build && node scripts/smoke-chat-commands.mjs
 *
 * For each prompt and diff command, both ways a person reaches it:
 *   - picked from the menu: the composer holds `/fix `, the words are typed after it;
 *   - typed out in full: `/fix the words` and Enter, with no menu involved.
 * Each is checked where it matters: the request the model received (the command's full
 * instruction, the person's words, the diff for /review and /commit), the bubble (a `/fix`
 * chip and the words, the diff chip kept above them) and the conversation's title.
 *
 * Then the action commands, picked and typed (/new with words sends them, /team with a task
 * sets up a Team, /compact on an empty and on a real conversation), paths that merely start
 * with `/`, a reopened conversation keeping its chips, a fast send leaving the placeholder
 * alone, and /review on a clean tree refusing to send.
 *
 * Prints `chatCommandsEvidence: {...}` - read the values, not just the exit code.
 * ADCODE_COMMANDS_SMOKE_PORT picks the DevTools port (default 9471).
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { SLASH_COMMANDS, expandSlashCommand } from "../apps/desktop/src/shared/slashCommands.ts";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const scratch = await mkdtemp(join(tmpdir(), "adcode-chat-commands-"));
const workspace = join(scratch, "cart");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/chat-commands");
await Promise.all([mkdir(join(workspace, "src"), { recursive: true }), mkdir(userData), mkdir(artifacts, { recursive: true })]);

/* ── A small project with an uncommitted change, for /review and /commit ─── */

await writeFile(join(workspace, "package.json"), `${JSON.stringify({ name: "cart", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
await writeFile(join(workspace, "index.html"), '<!doctype html><html><head><title>Cart</title></head><body><h1>Cart</h1></body></html>\n');
await writeFile(join(workspace, "src/cart.js"), "export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n");
const git = (...args) => execFileSync("git", ["-c", "safe.directory=*", "-c", "user.name=Smoke", "-c", "user.email=smoke@example.com", ...args], { cwd: workspace });
git("init", "-q");
git("add", ".");
git("commit", "-q", "-m", "cart");
await writeFile(join(workspace, "src/cart.js"), "export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n\nexport function shipping(total) {\n  return total > 50 ? 0 : 4.99;\n}\n");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [join(workspace, "src/cart.js")], activeFile: join(workspace, "src/cart.js") } }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ tour: 2, completed: true, at: Date.now() }));

/* ── The fake model: records every request, answers in one chunk ─────────── */

const requests = [];
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  if (process.env.ADCODE_SMOKE_TRACE === "1") process.stderr.write(`request ${requests.length} (${request.tools?.length ?? 0} tools): ${lastUserText(request).slice(0, 60).replace(/\s+/g, " ")}\n`);
  // A compaction asks for a summary without offering tools; a turn always offers them.
  const content = (request.tools?.length ?? 0) === 0 ? "Summary: the person is working on a cart." : `Fake reply #${requests.length}`;
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((done) => fake.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/** The text of the newest user message a request carried. */
function lastUserText(request) {
  const message = [...(request?.messages ?? [])].reverse().find((entry) => entry.role === "user");
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? "").join("");
}

/* ── The app ──────────────────────────────────────────────────────────────── */

const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
delete env.ELECTRON_RUN_AS_NODE;
const port = Number(process.env.ADCODE_COMMANDS_SMOKE_PORT ?? 9471);
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
let failed = false;

try {
  let target;
  for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((entry) => entry.type === "page" && entry.url.includes("index.html"));
    } catch { /* Electron is starting. */ }
    if (target === undefined) await sleep(500);
  }
  assert.ok(target, "The app's window appears");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
  });
  const send = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      pending.delete(id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else done(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Renderer error");
    return result.result?.value;
  };
  // ADCODE_SMOKE_TRACE=1 names every wait over 1.5s, so a slow step is found, not guessed.
  const trace = process.env.ADCODE_SMOKE_TRACE === "1";
  const waitFor = async (expression, timeout = 20_000) => {
    const started = Date.now();
    const until = started + timeout;
    const report = (ok) => {
      if (trace && Date.now() - started > 1500) process.stderr.write(`slow wait ${Date.now() - started}ms ${ok ? "ok" : "TIMEOUT"}: ${expression.slice(0, 120)}\n`);
      return ok;
    };
    while (Date.now() < until) {
      try { if (await evaluate(expression)) return report(true); } catch { /* still loading */ }
      await sleep(120);
    }
    return report(false);
  };
  const screenshot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  globalThis.__smokeShot = screenshot;

  /** Real keys: text is inserted as typed, Enter and Escape are key presses. */
  const type = (text) => send("Input.insertText", { text });
  const press = async (key) => {
    const codes = { Enter: [13, "\r"], Escape: [27, undefined] };
    const [code, text] = codes[key];
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
  };
  const clearComposer = () => evaluate("(() => { const input = document.querySelector('.chat-input'); input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); return true; })()");
  const composer = () => evaluate("document.querySelector('.chat-input').value");
  const newConversation = async () => {
    await evaluate("document.querySelector('[aria-label=\"Start a new conversation\"]')?.click(); true");
    await waitFor("document.querySelectorAll('.chat-transcript .chat-bubble').length === 0", 5_000);
  };
  const idle = () => waitFor("document.querySelector('.chat-toolbar .chat-send')?.dataset.mode === 'send'", 30_000);
  /** Wait for the answer to `count` requests, then for the turn to end. */
  const answered = async (count) => {
    const ok = await waitFor(`[...document.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes('Fake reply #${count}'))`, 30_000);
    await idle();
    return ok;
  };
  /** Press Enter and wait for that turn's answer. The fake model answers within a few
   * milliseconds, often before the key press returns, so the number is taken first. */
  const enterAndWait = async () => {
    const expected = requests.length + 1;
    await press("Enter");
    return answered(expected);
  };
  const lastBubble = () => evaluate(`(() => {
    const bubble = [...document.querySelectorAll('.chat-transcript .chat-bubble-user')].at(-1);
    return bubble === undefined ? null : {
      badge: bubble.querySelector('.chat-command-badge')?.textContent ?? null,
      text: bubble.textContent.trim(),
      attachments: [...bubble.querySelectorAll('.chat-bubble-attachment')].map((chip) => chip.textContent.trim()),
    };
  })()`);
  // The stored title is what History lists and the header shows.
  const title = () => evaluate("window.adcode.chat.current().then((session) => session?.title ?? '')");

  await waitFor("document.body.dataset.sessionReady === 'true'", 90_000);
  await evaluate("document.querySelector('dialog.onboarding')?.close()");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
  })()`);
  await waitFor("window.adcode.ai.status().then((status) => status.ready)");
  if (!(await evaluate("Boolean(document.querySelector('.chat-card')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click()");
  await waitFor("Boolean(document.querySelector('.chat-card')?.getClientRects().length)", 15_000);
  await waitFor("document.querySelector('.chat-model')?.dataset.ready === 'true'", 15_000);

  /* 1. The menu offers every command. */
  await clearComposer();
  await type("/");
  await sleep(150);
  const menu = await evaluate("[...document.querySelectorAll('.composer-menu:not([hidden]) .composer-menu-label')].map((node) => node.textContent)");
  await screenshot("menu");
  await press("Escape");

  /* 2. Every prompt and diff command, picked from the menu and typed out in full. */
  const prompts = {};
  // ADCODE_SMOKE_ONLY=fix,review narrows this loop while investigating one command.
  const only = process.env.ADCODE_SMOKE_ONLY?.split(",") ?? null;
  for (const command of SLASH_COMMANDS.filter((entry) => entry.kind !== "action" && (only === null || only.includes(entry.id)))) {
    const words = `cart totals ${command.id}`;
    const result = {};

    await newConversation();
    await clearComposer();
    await type(`/${command.id}`);
    await sleep(120);
    result.menuFirst = await evaluate("document.querySelector('.composer-menu-item[aria-selected=\"true\"] .composer-menu-label')?.textContent ?? null");
    // A prompt command waits for the person's words; /review and /commit need none and go
    // as soon as they are picked, with the diff attached.
    const pickedWords = command.kind === "diff" ? "" : words;
    if (command.kind === "diff") {
      result.pickedAnswered = await enterAndWait();
      result.pickedComposer = await composer();
    } else {
      await press("Enter");
      result.pickedComposer = await composer();
      await type(words);
      result.pickedAnswered = await enterAndWait();
    }
    result.pickedWords = pickedWords;
    const picked = lastUserText(requests.at(-1));
    result.pickedModelGot = picked.startsWith(expandSlashCommand(`/${command.id} ${pickedWords}`));
    result.pickedDiffSent = command.kind !== "diff" || picked.includes("shipping(total)");
    result.pickedBubble = await lastBubble();
    result.pickedTitle = await title();

    await newConversation();
    await clearComposer();
    await type(`/${command.id} ${words}`);
    result.typedAnswered = await enterAndWait();
    const typed = lastUserText(requests.at(-1));
    result.typedModelGot = typed.startsWith(expandSlashCommand(`/${command.id} ${words}`));
    result.typedDiffSent = command.kind !== "diff" || typed.includes("shipping(total)");
    result.typedBubble = await lastBubble();
    prompts[command.id] = result;
  }
  await screenshot("typed-command");

  /* 3. A bare command closes the menu first; a path that starts with / is sent as written. */
  await newConversation();
  await clearComposer();
  await type("/explain");
  await press("Escape");
  const bareAnswered = await enterAndWait();
  const bare = { answered: bareAnswered, modelGot: lastUserText(requests.at(-1)) === expandSlashCommand("/explain") };
  await clearComposer();
  await type("/src/cart.js has a bug");
  const pathAnswered = await enterAndWait();
  const path = { answered: pathAnswered, modelGot: lastUserText(requests.at(-1)) === "/src/cart.js has a bug", badge: (await lastBubble())?.badge ?? null };

  /* 4. A reopened conversation keeps its chips. */
  const firstSession = await evaluate("window.adcode.chat.sessions().then((sessions) => sessions.find((session) => session.title.startsWith('/review'))?.id ?? null)");
  await evaluate(`(() => { const row = [...document.querySelectorAll('[data-session-id]')].find((node) => node.dataset.sessionId === ${JSON.stringify(firstSession)}); row?.querySelector('.chat-history-open')?.click(); return Boolean(row); })()`);
  const reopened = await waitFor("document.querySelector('.chat-transcript .chat-bubble-user .chat-command-badge')?.textContent === '/review'", 10_000);

  /* 5. Action commands, picked from the menu. */
  const visible = (selector) => evaluate(`Boolean([...document.querySelectorAll(${JSON.stringify(selector)})].some((node) => !node.hidden && node.getClientRects().length > 0))`);
  const pickAction = async (id) => {
    await clearComposer();
    await type(`/${id}`);
    await sleep(120);
    await press("Enter");
    await sleep(700);
  };
  const actions = {};
  await pickAction("new");
  actions.newClears = await evaluate("document.querySelectorAll('.chat-transcript .chat-bubble').length === 0");
  await pickAction("history");
  actions.historyFocusesSearch = await evaluate("document.activeElement?.getAttribute('aria-label') === 'Search conversations' || !document.querySelector('.chat-history')?.hidden");
  await pickAction("model");
  actions.modelOpensConnect = await visible(".connect-view");
  await screenshot("action-model");
  await press("Escape");
  await evaluate("document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); true");
  await pickAction("preview");
  actions.previewShows = await waitFor("Boolean(document.querySelector('.chat-live-preview')?.getClientRects().length)", 10_000);
  await evaluate("[...document.querySelectorAll('.chat-live-preview button')].find((button) => button.textContent.trim() === 'Close preview')?.click(); window.adcode.preview.stop()");
  await pickAction("schedule");
  actions.scheduleOpens = await visible(".ai-automation-panel");
  await evaluate("document.querySelector('.ai-automation-panel .ghost-button')?.click(); true");
  await pickAction("compact");
  actions.compactEmptySays = await waitFor("document.querySelector('.chat-card')?.textContent.includes('There is nothing to compact yet.')", 5_000);
  await pickAction("team");
  actions.teamEmptyWaitsForTask = (await composer()) === "/team ";
  const placeholder = await evaluate("document.querySelector('.chat-input').placeholder");
  await type("Add a discount code field to the cart page and test it");
  await press("Enter");
  actions.teamWithTaskSuggests = await waitFor("Boolean(document.querySelector('.ai-team-panel:not([hidden])')?.getClientRects().length)", 10_000);
  await screenshot("action-team");
  actions.placeholderUntouched = placeholder === (await evaluate("document.querySelector('.chat-input').placeholder"));

  /* 6. Action commands typed out, with their words. */
  await clearComposer();
  await type("/model ");
  await press("Enter");
  actions.typedModelOpensConnect = await waitFor("[...document.querySelectorAll('.connect-view')].some((node) => node.getClientRects().length > 0)", 5_000);
  await press("Escape");
  await evaluate("document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); true");
  await clearComposer();
  await type("/new hello from a fresh start");
  actions.typedNewSends = await enterAndWait() && lastUserText(requests.at(-1)) === "hello from a fresh start"
    && (await evaluate("document.querySelectorAll('.chat-transcript .chat-bubble-user').length")) === 1;
  // A two-message conversation is too short to summarise; what matters here is that the
  // typed command went to compaction - its answer shows - and nothing was sent as chat.
  const beforeCompact = requests.length;
  const bubblesBeforeCompact = await evaluate("document.querySelectorAll('.chat-transcript .chat-bubble-user').length");
  await clearComposer();
  await type("/compact keep the cart decisions");
  await press("Enter");
  actions.typedCompactGoesToCompaction = await waitFor("/not enough conversation to compact/i.test(document.querySelector('.chat-composer-notice')?.textContent ?? '')", 10_000)
    && requests.filter((request) => (request.tools?.length ?? 0) > 0).length === requests.slice(0, beforeCompact).filter((request) => (request.tools?.length ?? 0) > 0).length
    && (await evaluate("document.querySelectorAll('.chat-transcript .chat-bubble-user').length")) === bubblesBeforeCompact
    && (await composer()) === "";

  /* 7. A fast send never leaves the placeholder hijacked by a late Team suggestion. */
  const placeholderBefore = await evaluate("document.querySelector('.chat-input').placeholder");
  await clearComposer();
  await type("Rename the subtotal function to cartSubtotal everywhere");
  await enterAndWait();
  await sleep(700);
  actions.fastSendKeepsPlaceholder = placeholderBefore === (await evaluate("document.querySelector('.chat-input').placeholder"));

  /* 8. /review with nothing to review says so and sends nothing. */
  git("add", ".");
  git("commit", "-q", "-m", "shipping");
  const beforeClean = requests.length;
  await clearComposer();
  await type("/review ");
  await press("Enter");
  actions.cleanReviewSays = await waitFor("document.querySelector('.chat-card')?.textContent.includes('No uncommitted changes to look at')", 10_000);
  await sleep(500);
  actions.cleanReviewSendsNothing = requests.length === beforeClean;
  await screenshot("final");

  const evidence = { menu: { count: menu.length, all: SLASH_COMMANDS.every((command) => menu.includes(`/${command.id}`)) }, prompts, bare, path, reopened, actions };
  process.stdout.write(`chatCommandsEvidence: ${JSON.stringify(evidence)}\n`);

  assert.equal(evidence.menu.count, SLASH_COMMANDS.length, "the menu lists every command");
  assert.ok(evidence.menu.all, "the menu lists every command by name");
  for (const [id, result] of Object.entries(prompts)) {
    const diff = SLASH_COMMANDS.find((command) => command.id === id).kind === "diff";
    assert.equal(result.menuFirst, `/${id}`, `/${id}: typing it selects it first`);
    assert.equal(result.pickedComposer, diff ? "" : `/${id} `, diff ? `/${id}: picking it sends at once` : `/${id}: picking it leaves the short command in the composer`);
    for (const way of ["picked", "typed"]) {
      const words = way === "picked" ? result.pickedWords : `cart totals ${id}`;
      assert.ok(result[`${way}Answered`], `/${id} (${way}): the turn is answered`);
      assert.ok(result[`${way}ModelGot`], `/${id} (${way}): the model gets the full instruction and the words`);
      assert.ok(result[`${way}DiffSent`], `/${id} (${way}): the diff reaches the model`);
      const bubble = result[`${way}Bubble`];
      assert.equal(bubble?.badge, `/${id}`, `/${id} (${way}): the bubble shows the command chip`);
      assert.ok(bubble?.text.endsWith(words) && !bubble.text.includes(SLASH_COMMANDS.find((command) => command.id === id).prompt.slice(0, 30)), `/${id} (${way}): the bubble shows the words, not the instruction`);
      if (diff) assert.ok(bubble?.attachments.some((chip) => chip.includes("uncommitted-changes.diff")), `/${id} (${way}): the diff chip stays on the sent message`);
    }
    assert.equal(result.pickedTitle, `/${id}${result.pickedWords ? ` ${result.pickedWords}` : ""}`, `/${id}: the conversation is titled with what was typed`);
  }
  assert.ok(bare.answered && bare.modelGot, "a bare /explain asks about the open file in a whole sentence");
  assert.ok(path.answered && path.modelGot && path.badge === null, "a message starting with a path is sent as written");
  assert.ok(reopened, "a reopened conversation still shows its command chips");
  for (const [name, value] of Object.entries(actions)) assert.equal(value, true, name);
  process.stdout.write(`PASS: ${menu.length} commands, each prompt command picked and typed, ${Object.keys(actions).length} action checks.\n`);
} catch (error) {
  failed = true;
  await globalThis.__smokeShot?.("failure").catch(() => undefined);
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n--- app log ---\n${log.slice(-4000)}\n`);
} finally {
  socket?.close();
  fake.closeAllConnections();
  fake.close();
  child.kill();
  await sleep(1500);
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(failed ? 1 : 0);
