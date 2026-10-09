/*
 * Tag Flow AI, end to end in the built app: what a brand-new install gets with nothing set up.
 *
 * Asked for: Tag Flow's models "already connected" so people "can just go and straight up use
 * the AI", and "when users hit usage limits auto continue after it resetting like Claude".
 * This walks both as a person would and reads what the window shows:
 *
 *   welcome -> an idea -> Build it -> (no connect step: Tag Flow is already connected)
 *   -> the relay says the usage limit is reached, resetting in a few seconds
 *   -> the chat shows the limit card with a countdown -> at the reset the same turn continues
 *   -> the snake game is written and the preview opens
 *
 * The relay is a fake ADCode API on a free port, scripted like the fake Ollama in
 * smoke-first-run.mjs; ADCODE_AD_SERVER points the app at it, so nothing reaches production.
 *
 *   npm run desktop:build && npm run smoke:tagflow
 *
 * Read the printed values, not just the exit code. Screenshots go to ADCODE_SHOTS if set.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const electronPath = require("electron");
const PORT = Number(process.env.ADCODE_TAGFLOW_SMOKE_PORT ?? "9483");
const SHOTS = process.env.ADCODE_SHOTS ?? null;
const RESET_AFTER_MS = 6_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── A fake ADCode API: the Tag Flow relay, and quiet answers for the rest ── */

const call = (index, id, name, args) => ({ index, id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const GAME = "<!doctype html><title>Snake</title><h1 id=title>Snake</h1><canvas id=board width=300 height=300></canvas><p>Score: <span id=score>0</span></p>";
const chats = [];
let limitedAt = null;

const api = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let body = "";
  for await (const chunk of req) body += chunk;

  if (url.pathname === "/v1/ai/tagflow/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ id: "tagflow-code-27b", name: "Tag Flow Code 27B" }] }));
    return;
  }

  if (url.pathname === "/v1/ai/tagflow/chat/completions" && req.method === "POST") {
    const request = JSON.parse(body || "{}");
    chats.push({ at: Date.now(), authorization: req.headers.authorization ?? null, model: request.model, messages: request.messages?.length ?? 0, tools: request.tools?.length ?? 0 });
    const messages = request.messages ?? [];
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const answered = messages.slice(messages.lastIndexOf(lastUser) + 1).filter((message) => message.role === "tool").length;

    // The first build request meets the usage limit, resetting a few seconds from now.
    if (limitedAt === null) {
      limitedAt = Date.now();
      const resetsAt = limitedAt + RESET_AFTER_MS;
      res.writeHead(429, { "content-type": "application/json", "retry-after": String(Math.ceil(RESET_AFTER_MS / 1000)) });
      res.end(JSON.stringify({ error: { message: "You've used this window's Tag Flow AI requests.", type: "usage_limit", code: "tagflow_usage_limit", resets_at: resetsAt, auto_continue: true } }));
      return;
    }

    let delta;
    if (answered === 0) delta = { tool_calls: [call(0, "write-1", "propose_edit", { path: "index.html", contents: GAME, summary: "A snake game" })] };
    else if (answered === 1) delta = { tool_calls: [call(0, "open-1", "open_preview", { path: "/" })] };
    else delta = { content: "Built your snake game and opened it in the preview." };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
    return;
  }

  // Ads, notices, milestones, overrides: nothing to say, which the app takes calmly.
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
const apiOrigin = `http://127.0.0.1:${api.address().port}`;

/* ── The app, as a brand-new install ────────────────────────────────────── */

const userData = await mkdtemp(join(tmpdir(), "adcode-tagflow-"));
const projects = await mkdtemp(join(tmpdir(), "adcode-tagflow-projects-"));
const env = { ...process.env, ADCODE_AD_SERVER: apiOrigin, ADCODE_PROJECTS_HOME: projects };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ADCODE_AUTH_EMULATOR;
const child = spawn(electronPath, [
  "apps/desktop",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

let target;
for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((one) => one.type === "page" && one.webSocketDebuggerUrl);
  } catch {}
  if (target === undefined) await sleep(500);
}
if (target === undefined) throw new Error("no renderer target appeared");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const message = await Promise.race([send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }), sleep(15_000).then(() => null)]);
  if (message === null) return "THREW: timeout";
  if (message.result?.exceptionDetails) return `THREW: ${message.result.exceptionDetails.exception?.description ?? "unknown"}`;
  return message.result?.result?.value;
}
async function waitFor(expression, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await evaluate(expression)) === true) return true;
    await sleep(250);
  }
  return false;
}
async function shot(name) {
  if (SHOTS === null) return;
  await send("Page.bringToFront");
  const message = await Promise.race([send("Page.captureScreenshot", { format: "png" }), sleep(10_000).then(() => null)]);
  if (message?.result?.data) await writeFile(join(SHOTS, `${name}.png`), Buffer.from(message.result.data, "base64"));
}

const checks = {};
try {
  checks.welcomeOpens = await waitFor("document.querySelector('dialog.onboarding[open]') !== null", 40_000);
  await sleep(800);

  /* Nothing set up, and the assistant is ready on Tag Flow AI. */
  checks.status = await evaluate(`(async () => {
    const status = await window.adcode.ai.status();
    const tagflow = status.providers.find((one) => one.id === 'tagflow');
    return {
      activeProvider: status.activeProvider,
      activeModel: status.activeModel,
      ready: status.ready,
      tagflowNeedsKey: tagflow?.needsKey ?? null,
      partner: tagflow?.partner ?? null,
    };
  })()`);

  await evaluate("[...document.querySelectorAll('.onboarding-idea-chip')].find((chip) => chip.textContent === 'Snake game')?.click()");
  await sleep(300);
  await shot("tagflow-01-idea");

  /* Build it: straight to building - the connect step never appears. */
  await evaluate("document.querySelector('.onboarding-next')?.click()");
  let sawConnectStep = false;
  let closed = false;
  for (let i = 0; i < 80 && !closed; i++) {
    const state = await evaluate("({ step: document.querySelector('dialog.onboarding')?.dataset.step ?? null, open: document.querySelector('dialog.onboarding')?.open === true })");
    if (state?.step === "connect") sawConnectStep = true;
    closed = state?.open === false;
    if (!closed) await sleep(250);
  }
  checks.welcomeClosed = closed;
  checks.noConnectStep = !sawConnectStep;

  /* The usage limit: a card says so, says when it resets, and counts down. */
  checks.limitCardShown = await waitFor("/usage limit reached/.test(document.querySelector('.chat-limit-wait')?.textContent ?? '')", 30_000);
  checks.limitCard = await evaluate(`(() => {
    const card = document.querySelector('.chat-limit-wait');
    return card === null ? null : {
      headline: card.querySelector('.chat-limit-wait-headline')?.textContent ?? null,
      countdown: card.querySelector('.chat-limit-wait-countdown')?.textContent ?? null,
      switchButton: card.querySelector('.chat-limit-wait-switch')?.textContent ?? null,
    };
  })()`);
  await shot("tagflow-02-limit");

  /* At the reset the same turn carries on by itself and builds the game. */
  checks.projectMade = await (async () => {
    for (let i = 0; i < 80; i++) {
      const made = await readdir(projects).catch(() => []);
      if (made.length > 0) return made;
      await sleep(250);
    }
    return [];
  })();
  const folder = checks.projectMade[0] === undefined ? null : join(projects, checks.projectMade[0]);
  checks.built = await (async () => {
    for (let i = 0; i < 160 && folder !== null; i++) {
      if (existsSync(join(folder, "index.html"))) return true;
      await sleep(250);
    }
    return false;
  })();
  checks.answered = await waitFor("/Built your snake game/.test(document.querySelector('.chat-conversation')?.textContent ?? '')", 40_000);
  checks.limitCardGone = await evaluate("document.querySelector('.chat-limit-wait') === null");
  const retried = chats.find((one) => limitedAt !== null && one.at > limitedAt);
  checks.continuedAfterResetMs = retried === undefined ? null : retried.at - limitedAt;
  checks.relay = {
    chatRequests: chats.length,
    signedWithAccountToken: chats.every((one) => typeof one.authorization === "string" && one.authorization.startsWith("Bearer ")),
    model: chats[0]?.model ?? null,
    sentTools: chats.every((one) => one.tools > 0),
  };
  await sleep(1500);
  await shot("tagflow-03-built");
  checks.modelPill = await evaluate("document.querySelector('.chat-model')?.textContent ?? null");
} catch (error) {
  checks.threw = String(error?.stack ?? error);
} finally {
  socket.close();
  child.kill();
  api.close();
  await sleep(500);
  await rm(projects, { recursive: true, force: true }).catch(() => undefined);
}

console.log(JSON.stringify(checks, null, 2));
const ok =
  checks.welcomeOpens === true &&
  checks.status?.activeProvider === "tagflow" &&
  checks.status?.ready === true &&
  checks.status?.partner?.privacyUrl === "https://tagflow-ai.com/legal/privacy" &&
  checks.welcomeClosed === true &&
  checks.noConnectStep === true &&
  checks.limitCardShown === true &&
  /resets at/.test(checks.limitCard?.headline ?? "") &&
  /Continuing/.test(checks.limitCard?.countdown ?? "") &&
  Array.isArray(checks.projectMade) && checks.projectMade.length === 1 &&
  checks.built === true &&
  checks.answered === true &&
  checks.limitCardGone === true &&
  typeof checks.continuedAfterResetMs === "number" && checks.continuedAfterResetMs >= RESET_AFTER_MS - 500 &&
  checks.relay?.signedWithAccountToken === true &&
  checks.relay?.model === "tagflow-code-27b";
if (!ok) console.log(output.slice(-3000));
process.exit(ok ? 0 : 1);
