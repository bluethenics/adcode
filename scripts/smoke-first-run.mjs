/*
 * The first run, end to end, in the built app: what a new person sees.
 *
 * Production on 2026-10-03: of 419 installs, 394 were gone within five minutes. The first
 * thing anybody typed met "No model connected", and the welcome before it never built
 * anything. This walks the replacement as a person would, and reads what the window shows:
 *
 *   welcome "What do you want to build?" -> an idea -> Build it
 *   -> "Connect your AI" (no model yet) -> the local model card -> Use it
 *   -> a project folder is made for the idea -> the assistant builds it -> the preview opens
 *
 * The model is a fake Ollama on 127.0.0.1:11434 - the address ADCode looks for - that writes
 * index.html and opens the preview. Ads point at a dead port and new projects at a temporary
 * folder, so a run leaves nothing in production analytics or in the runner's Documents.
 *
 *   npm run desktop:build && npm run smoke:first-run
 *
 * Read the printed values, not just the exit code. Screenshots go to ADCODE_SHOTS if set.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const electronPath = require("electron");
const PORT = Number(process.env.ADCODE_FIRSTRUN_PORT ?? "9481");
const SHOTS = process.env.ADCODE_SHOTS ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── A fake Ollama that builds a snake game ─────────────────────────────── */

const call = (index, id, name, args) => ({ index, id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const GAME = "<!doctype html><title>Snake</title><h1 id=title>Snake</h1><canvas id=board width=300 height=300></canvas><p>Score: <span id=score>0</span></p>";
const requests = [];

const ollama = createServer(async (req, res) => {
  if (req.url === "/api/tags") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }, { name: "qwen2.5-coder:7b" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  requests.push(request);
  const messages = request.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
  const answered = messages.slice(messages.lastIndexOf(lastUser) + 1).filter((message) => message.role === "tool").length;
  let delta;
  if (/Reply with the single word: ok/.test(userText)) delta = { content: "ok" };
  else if (answered === 0) delta = { tool_calls: [call(0, "write-1", "propose_edit", { path: "index.html", contents: GAME, summary: "A snake game" })] };
  else if (answered === 1) delta = { tool_calls: [call(0, "open-1", "open_preview", { path: "/" })] };
  else delta = { content: "Built your snake game and opened it in the preview." };
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
});

const portFree = await new Promise((resolve) => {
  ollama.once("error", () => resolve(false));
  ollama.listen(11434, "127.0.0.1", () => resolve(true));
});
if (!portFree) {
  console.log(JSON.stringify({ skipped: "port 11434 is in use - stop Ollama and run again" }, null, 2));
  process.exit(2);
}

/* ── The app, as a brand-new install ────────────────────────────────────── */

const userData = await mkdtemp(join(tmpdir(), "adcode-first-run-"));
const projects = await mkdtemp(join(tmpdir(), "adcode-first-run-projects-"));
const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9", ADCODE_PROJECTS_HOME: projects };
delete env.ELECTRON_RUN_AS_NODE;
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
  /* The welcome asks one question. */
  checks.welcomeOpens = await waitFor("document.querySelector('dialog.onboarding[open]') !== null", 40_000);
  await sleep(600);
  checks.welcome = await evaluate(`(() => {
    const sheet = document.querySelector('dialog.onboarding');
    return {
      heading: sheet?.querySelector('.onboarding-head h2')?.textContent ?? null,
      ideaBox: sheet?.querySelector('textarea.onboarding-idea') !== null,
      ideas: [...(sheet?.querySelectorAll('.onboarding-idea-chip') ?? [])].map((chip) => chip.textContent),
      buildDisabledWhenEmpty: sheet?.querySelector('.onboarding-next')?.disabled === true,
      saysHowItIsFree: /sponsored card/.test(sheet?.querySelector('.onboarding-ads-note')?.textContent ?? ''),
    };
  })()`);
  await shot("01-welcome");

  await evaluate("[...document.querySelectorAll('.onboarding-idea-chip')].find((chip) => chip.textContent === 'Snake game')?.click()");
  await sleep(300);
  checks.ideaFilled = await evaluate("document.querySelector('textarea.onboarding-idea')?.value ?? ''");
  await shot("02-idea");

  /* No model yet: the next step is connecting one, and the local model is offered. */
  await evaluate("document.querySelector('.onboarding-next')?.click()");
  checks.connectStep = await waitFor("document.querySelector('dialog.onboarding')?.dataset.step === 'connect'", 10_000);
  checks.localOffered = await waitFor("(() => { const card = document.querySelector('.quick-connect-card[data-route=local]'); return !!card && !card.hidden; })()", 10_000);
  checks.connectStepText = await evaluate(`(() => ({
    heading: document.querySelector('dialog.onboarding .onboarding-head h2')?.textContent ?? null,
    freeFirst: document.querySelector('.quick-connect-card')?.dataset.route ?? null,
    localButton: document.querySelector('.quick-connect-card[data-route=local] button')?.textContent ?? null,
    sayFreeTierTerms: /improve its products/.test(document.querySelector('.quick-connect-fine')?.textContent ?? ''),
  }))()`);
  await shot("03-connect");

  /* Use it: checked, saved, and the build starts by itself. */
  await evaluate("document.querySelector('.quick-connect-card[data-route=local] button')?.click()");
  checks.welcomeClosed = await waitFor("document.querySelector('dialog.onboarding')?.open === false", 20_000);
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
  await sleep(1500);
  await shot("04-built");
  checks.modelPill = await evaluate("document.querySelector('.chat-model')?.textContent ?? null");
  checks.firstPromptAskedForPlainHtml = requests.some((request) => (request.messages ?? []).some((message) => typeof message.content === "string" && message.content.includes("plain HTML, CSS and JavaScript")));

  /* What the install remembers: the funnel, and that it has had its first success. */
  await sleep(4000);
  const state = JSON.parse(await readFile(join(userData, "milestones.json"), "utf8").catch(() => "{}"));
  checks.firstValueRecorded = typeof state.firstValueAt === "number";
  checks.milestonesQueued = (state.pending ?? []).map((item) => item.name);
} catch (error) {
  checks.threw = String(error?.stack ?? error);
} finally {
  socket.close();
  child.kill();
  ollama.close();
  await sleep(500);
  await rm(projects, { recursive: true, force: true }).catch(() => undefined);
}

console.log(JSON.stringify(checks, null, 2));
const ok =
  checks.welcomeOpens === true &&
  checks.connectStep === true &&
  checks.localOffered === true &&
  checks.welcomeClosed === true &&
  Array.isArray(checks.projectMade) && checks.projectMade.length === 1 &&
  checks.built === true &&
  checks.answered === true &&
  checks.firstValueRecorded === true;
if (!ok) console.log(output.slice(-3000));
process.exit(ok ? 0 : 1);
