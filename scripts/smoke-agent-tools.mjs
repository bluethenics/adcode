/**
 * The assistant's tools in the built app, against a local fake model.
 *
 *   npm run desktop:build && node scripts/smoke-agent-tools.mjs
 *
 * Two turns, each scripted the way a real model would call the tools:
 *
 * 1. It looks at a page: a plan, `view_page` at phone size with a click, `open_preview` on
 *    that exact page. Checks the report the model received (the click landed, the console
 *    error, the broken image), that a screenshot reached the model, that the chat shows the
 *    plan, what the assistant saw and the page it opened - and that there is at most one
 *    mascot while it works and none once the turn is over.
 * 2. It reorganises files and runs a server: `move_file`, `delete_file`, a background
 *    `run_command` serving a page, `view_page` on that server's address, `stop_command`.
 *    Checks the files moved, the Undo card lists the deletion, and Undo puts everything back.
 *
 * Prints `agentToolsEvidence: {...}` - read the values, not just the exit code.
 * ADCODE_AGENT_SMOKE_PORT picks the DevTools port (default 9461).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const scratch = await mkdtemp(join(tmpdir(), "adcode-agent-tools-"));
const workspace = join(scratch, "site");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/agent-tools");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(artifacts, { recursive: true })]);

await writeFile(join(workspace, "index.html"), '<!doctype html><html><head><title>Home smoke</title></head><body><h1>Home</h1><a href="about.html">About</a></body></html>');
await writeFile(join(workspace, "about.html"), '<!doctype html><html><head><title>About smoke</title><meta name="viewport" content="width=device-width"></head><body><h1>About us</h1><img src="missing-photo.png" alt="Team"><button id="go" onclick="document.querySelector(\'h1\').textContent = \'Clicked through\'">Go</button><script>console.error("smoke console error")</script></body></html>');
await writeFile(join(workspace, "old-notes.txt"), "notes to delete\n");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [join(workspace, "index.html")], activeFile: join(workspace, "index.html") } }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, at: Date.now() }));

/* ── The fake model ───────────────────────────────────────────────────────── */

const requests = [];
const serverScript = "require('http').createServer((q, s) => s.end('<!doctype html><title>Background smoke</title><h1>Served by cmd</h1>')).listen(0, '127.0.0.1', function () { console.log('Local: http://127.0.0.1:' + this.address().port + '/'); })";
const call = (index, id, name, args) => ({ index, id, function: { name, arguments: JSON.stringify(args) } });
const steps = (status) => ({ steps: [{ step: "Look at the about page", status }, { step: "Show it to the user", status: status === "done" ? "done" : "pending" }] });

/** Tool results answered since the prompt, and the address the background server printed. */
function progress(request, prompt) {
  const start = request.messages.findLastIndex((message) => message.role === "user" && message.content === prompt);
  if (start === -1) return null;
  const after = request.messages.slice(start + 1);
  // A screenshot rides in a user message of its own; it is not a new prompt.
  if (after.some((message) => message.role === "user" && typeof message.content === "string" && !/^Picture from |A picture a tool returned/.test(message.content))) return null;
  const tools = after.filter((message) => message.role === "tool");
  const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(tools.map((message) => message.content).join("\n"))?.[0] ?? null;
  return { answered: tools.length, url };
}

const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  res.writeHead(200, { "content-type": "text/event-stream" });
  let delta = { content: "ok" };
  const look = progress(request, "look-smoke");
  const files = progress(request, "files-smoke");
  if (look !== null) {
    delta = look.answered === 0
      ? { tool_calls: [call(0, "plan-1", "update_plan", steps("in_progress")), call(1, "look-1", "view_page", { path: "about.html", width: 390, height: 844, actions: [{ type: "click", text: "Go" }] })] }
      : look.answered === 2
        ? { tool_calls: [call(0, "open-1", "open_preview", { path: "about.html" }), call(1, "plan-2", "update_plan", steps("done"))] }
        : { content: "I looked at the about page and opened it for you." };
  } else if (files !== null) {
    delta = files.answered === 0
      ? { tool_calls: [call(0, "move-1", "move_file", { from: "about.html", to: "pages/about.html" }), call(1, "delete-1", "delete_file", { path: "old-notes.txt" })] }
      : files.answered === 2
        ? { tool_calls: [call(0, "bg-1", "run_command", { command: `node -e "${serverScript}"`, background: true })] }
        : files.answered === 3
          ? { tool_calls: [call(0, "look-bg", "view_page", { url: files.url ?? "http://127.0.0.1:1/", screenshot: false })] }
          : files.answered === 4
            ? { tool_calls: [call(0, "stop-1", "stop_command", { id: "cmd-1" })] }
            : { content: "Moved, deleted, served and stopped." };
  }
  res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((done) => fake.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/* ── The app ──────────────────────────────────────────────────────────────── */

// A dead backend, as in smoke-first-run.mjs: no check here needs one, and unset it means
// production, where every run signed up a new anonymous account.
const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9" };
delete env.ELECTRON_RUN_AS_NODE;
const port = Number(process.env.ADCODE_AGENT_SMOKE_PORT ?? 9461);
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
  const waitFor = async (expression, timeout = 60_000) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      // The page may still be loading (no body yet); that is "not yet", not a failure.
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        last = error;
      }
      await sleep(200);
    }
    throw new Error(`Condition did not become true: ${expression}${last === null ? "" : ` (last error: ${last.message})`}`);
  };
  const screenshot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
  };
  const exists = (path) => stat(join(workspace, path)).then(() => true, () => false);
  const mascots = () => evaluate("document.querySelectorAll('.chat-transcript .chat-mascot').length");

  /** Send a prompt and follow the turn to its answer, counting mascots on the way. */
  async function turn(prompt, answer) {
    let most = 0;
    // Not awaited: send resolves when the turn is over, and the mascots are counted during it.
    await evaluate(`void window.adcode.ai.send(${JSON.stringify(prompt)}); true`);
    const until = Date.now() + 120_000;
    while (Date.now() < until) {
      const now = await mascots();
      if (now > 0 && most === 0) await screenshot(`${prompt}-working`);
      most = Math.max(most, now);
      if (await evaluate(`[...document.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes(${JSON.stringify(answer)})) && document.querySelector('.chat-card')?.dataset.working !== 'true'`)) return most;
      await sleep(150);
    }
    throw new Error(`${prompt} never finished. Last answer: ${await evaluate("[...document.querySelectorAll('.chat-bubble-assistant')].at(-1)?.textContent ?? 'none'")}`);
  }

  await waitFor("document.body.dataset.sessionReady === 'true'", 90_000);
  await evaluate("document.querySelector('dialog.onboarding')?.close()");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
  })()`);
  await waitFor("window.adcode.ai.status().then((status) => status.ready)");
  globalThis.__smokeShot = screenshot;
  // Vibe opens on the chat. (An empty transcript is hidden behind the welcome, so wait on the card.)
  if (!(await evaluate("Boolean(document.querySelector('.chat-card')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click()");
  await waitFor("Boolean(document.querySelector('.chat-card')?.getClientRects().length)", 15_000);

  /* 1. Looking at a page. */
  // The model pill reads the status on its own clock; wait for it, so screenshots show the real state.
  await waitFor("document.querySelector('.chat-model')?.dataset.ready === 'true'", 15_000);
  const mostWhileLooking = await turn("look-smoke", "opened it for you");
  const lookRequest = requests.find((request) => request.messages.some((message) => message.role === "tool" && message.tool_call_id === "look-1"));
  const report = lookRequest?.messages.find((message) => message.role === "tool" && message.tool_call_id === "look-1")?.content ?? "";
  await evaluate("document.querySelector('.chat-agent-view')?.scrollIntoView({ block: 'center' })");
  await sleep(500);
  await screenshot("agent-view");
  const look = {
    reportTitle: report.includes("About smoke"),
    clickLanded: report.includes("Clicked through"),
    phoneViewport: report.includes("Viewport 390x844"),
    consoleError: report.includes("smoke console error"),
    brokenImage: report.includes("Broken image: missing-photo.png"),
    failedRequest: /Request failed: 404 http:\/\/127\.0\.0\.1:\d+\/missing-photo\.png/.test(report),
    screenshotToModel: lookRequest?.messages.some((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => part.type === "image_url" && part.image_url.url.startsWith("data:image/jpeg;base64,"))) === true,
    previewOnThatPage: await evaluate("document.querySelector('.chat-live-preview iframe')?.getAttribute('src')?.endsWith('/about.html') === true"),
    // Drawn at its real size: a flex item that may shrink once collapsed to its 2px border.
    agentViewCard: await evaluate("document.querySelector('.chat-agent-view-image')?.src.startsWith('data:image/jpeg;base64,') === true && document.querySelector('.chat-agent-view').getBoundingClientRect().height > 150"),
    agentViewVerdict: await evaluate("document.querySelector('.chat-agent-view-verdict')?.textContent ?? ''"),
    planSummary: await evaluate("document.querySelector('.chat-plan-summary')?.textContent ?? ''"),
    planCards: await evaluate("document.querySelectorAll('.chat-plan').length"),
    planCardDrawn: await evaluate("(document.querySelector('.chat-plan')?.getBoundingClientRect().height ?? 0) > 50"),
    mostMascotsWhileWorking: mostWhileLooking,
    mascotsAfter: await mascots(),
    settledMarks: await evaluate("document.querySelectorAll('.chat-transcript .chat-activity-settled:not([hidden])').length"),
  };
  await evaluate("[...document.querySelectorAll('.chat-live-preview button')].find((button) => button.textContent.trim() === 'Close preview')?.click()");
  await evaluate("window.adcode.preview.stop()");

  /* 2. Files and a background server. */
  await evaluate("document.querySelector('[aria-label=\"Start a new conversation\"]')?.click()");
  await sleep(300);
  const mostWhileFiling = await turn("files-smoke", "Moved, deleted, served and stopped.");
  const toolResult = (id) => requests.flatMap((request) => request.messages).find((message) => message.role === "tool" && message.tool_call_id === id)?.content ?? "";
  await waitFor("[...document.querySelectorAll('.chat-checkpoint')].length > 0", 20_000);
  await evaluate("document.querySelector('.chat-checkpoint')?.scrollIntoView({ block: 'center' })");
  await sleep(300);
  await screenshot("agent-files");
  const files = {
    moved: await exists("pages/about.html") && !(await exists("about.html")),
    deleted: !(await exists("old-notes.txt")),
    backgroundStarted: toolResult("bg-1").includes("Started cmd-1 in the background") && /127\.0\.0\.1:\d+\//.test(toolResult("bg-1")),
    viewedServerByUrl: toolResult("look-bg").includes("Served by cmd"),
    stopped: toolResult("stop-1").includes("exited"),
    undoCardListsDeletion: await evaluate("[...document.querySelectorAll('.chat-checkpoint-file[data-deleted=\"true\"]')].some((node) => node.textContent.includes('old-notes.txt'))"),
    mostMascotsWhileWorking: mostWhileFiling,
  };
  await evaluate("document.querySelector('.chat-checkpoint .chat-checkpoint-undo')?.click()");
  await waitFor("document.querySelector('.chat-checkpoint')?.dataset.state === 'undone'", 20_000);
  files.undoRestored = (await exists("about.html")) && !(await exists("pages/about.html")) && (await readFile(join(workspace, "old-notes.txt"), "utf8")) === "notes to delete\n";

  const evidence = { look, files };
  process.stdout.write(`agentToolsEvidence: ${JSON.stringify(evidence)}\n`);
  for (const [name, value] of Object.entries({ ...look, ...Object.fromEntries(Object.entries(files).map(([key, item]) => [`files.${key}`, item])) })) {
    if (name === "mostMascotsWhileWorking" || name === "files.mostMascotsWhileWorking") assert.ok(value <= 1, `${name}: at most one mascot while working, saw ${value}`);
    else if (name === "mascotsAfter") assert.equal(value, 0, "No mascot is left once the turn is over");
    else if (name === "settledMarks") assert.ok(value >= 1, "Finished blocks show their mark");
    else if (name === "planCards") assert.equal(value, 1, "One plan card per turn");
    else if (name === "planSummary") assert.equal(value, "All 2 steps done");
    else if (name === "agentViewVerdict") assert.match(value, /problems? found/);
    else assert.equal(value, true, name);
  }
  process.stdout.write("PASS: the assistant looks at pages in its own browser, opens the exact page, keeps a plan, moves and deletes with Undo, and runs a server in the background.\n");
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
