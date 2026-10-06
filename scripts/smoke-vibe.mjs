/*
 * Vibe's chat at the model's limits, end to end, in the built app.
 *
 * Reported: Vibe answered "I stopped at a limit before finishing... Continue" again and
 * again, and Continue changed nothing. A reasoning model spent the whole 8,192-token
 * allowance thinking and wrote nothing; Continue sent the same request again. And the
 * Connect screen called Ollama ready on a computer that did not have it.
 *
 * The model is a fake Ollama on 127.0.0.1:11434. It answers the build request the hard way:
 *
 *   1. all thinking, no answer, finish_reason "length"
 *   2. "Part one of the plan", cut off by the limit
 *   3. " and part two - done."
 *
 * The window should show one finished answer - no Continue button, no error - and each
 * request should have asked for more room than the last. Then a second request that never
 * fits: one Continue is offered, and the second time the limit stops it the chat says what
 * will help instead of offering Continue again. Last, Connect must say what is true of
 * Ollama: running with its one chat model, then - once it is gone - not running.
 *
 *   npm run desktop:build && npm run smoke:vibe
 *
 * Read the printed values, not just the exit code. Screenshots go to ADCODE_SHOTS if set.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const electronPath = require("electron");
const PORT = Number(process.env.ADCODE_VIBE_PORT ?? "9491");
const SHOTS = process.env.ADCODE_SHOTS ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── A fake Ollama that reaches its limits ──────────────────────────────── */

const chatRequests = [];
let script = "build";
let buildStep = 0;

const sse = (res, chunks) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
};

const ollama = createServer(async (req, res) => {
  if (req.url === "/api/tags") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }, { name: "qwen2.5-coder:7b" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  const messages = request.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const userText = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
  if (/Reply with the single word: ok/.test(userText)) {
    sse(res, [{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]);
    return;
  }
  chatRequests.push({ script, maxTokens: request.max_tokens ?? null });
  if (script === "slow") {
    if (/make it dark/i.test(userText)) {
      sse(res, [{ choices: [{ delta: { content: "Follow-up answer." }, finish_reason: "stop" }] }]);
      return;
    }
    await sleep(3000);
    sse(res, [{ choices: [{ delta: { content: "Slow answer." }, finish_reason: "stop" }] }]);
    return;
  }
  if (script === "build") {
    buildStep += 1;
    if (buildStep === 1) {
      sse(res, [
        { choices: [{ delta: { reasoning_content: "Planning the whole thing in detail..." } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ]);
    } else if (buildStep === 2) {
      sse(res, [
        { choices: [{ delta: { content: "Part one of the plan" } }] },
        { choices: [{ delta: {}, finish_reason: "length" }] },
      ]);
    } else {
      sse(res, [{ choices: [{ delta: { content: " and part two - done." }, finish_reason: "stop" }] }]);
    }
    return;
  }
  // "endless": every reply is cut off, however much room it gets.
  sse(res, [
    { choices: [{ delta: { content: "More words. " } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
  ]);
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

const userData = await mkdtemp(join(tmpdir(), "adcode-vibe-"));
const projects = await mkdtemp(join(tmpdir(), "adcode-vibe-projects-"));
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

/** Type a prompt into the chat and press Enter. */
async function sendPrompt(text) {
  return evaluate(`(() => {
    const input = [...document.querySelectorAll('.chat-input')].find((one) => one.getBoundingClientRect().width > 0);
    if (!input) return false;
    input.focus();
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    return true;
  })()`);
}

const transcript = "document.querySelector('.chat-conversation')?.textContent ?? ''";

const checks = {};
try {
  /* The welcome: an idea, then the local model. */
  checks.welcomeOpens = await waitFor("document.querySelector('dialog.onboarding[open]') !== null", 40_000);
  await sleep(600);
  await evaluate("[...document.querySelectorAll('.onboarding-idea-chip')].find((chip) => chip.textContent === 'Snake game')?.click()");
  await sleep(300);
  await evaluate("document.querySelector('.onboarding-next')?.click()");
  checks.localOffered = await waitFor("(() => { const card = document.querySelector('.quick-connect-card[data-route=local]'); return !!card && !card.hidden; })()", 10_000);
  await evaluate("document.querySelector('.quick-connect-card[data-route=local] button')?.click()");
  checks.welcomeClosed = await waitFor("document.querySelector('dialog.onboarding')?.open === false", 20_000);

  /* 1. Thinking only, then a cut-off reply, then the rest: one finished answer. */
  checks.finishedAnswer = await waitFor(`/Part one of the plan and part two - done\\./.test(${transcript})`, 60_000);
  await sleep(1500);
  checks.noContinueButton = await evaluate("document.querySelector('[data-nudge=\"continue\"]') === null && !/I stopped at a limit/.test(" + transcript + ")");
  checks.noFailureCard = await evaluate("document.querySelector('.chat-failure') === null");
  const build = chatRequests.filter((one) => one.script === "build").map((one) => one.maxTokens);
  checks.buildBudgets = build;
  checks.roomGrew = build.length === 3 && build[1] > build[0];
  await shot("01-finished-answer");

  /* The model chip switches model from a small menu, not the full Connect screen. */
  await evaluate("document.querySelector('.chat-model')?.click()");
  await sleep(600);
  checks.modelMenu = await evaluate(`(() => {
    const panel = document.querySelector('.menu-panel');
    const labels = [...(panel?.querySelectorAll('.menu-item') ?? [])].map((item) => item.textContent ?? '');
    return {
      open: !!panel,
      offersCurrent: labels.some((label) => label.includes('qwen2.5-coder:7b')),
      offersMore: labels.some((label) => label.includes('More models and providers')),
      connectStayedShut: !document.querySelector('dialog[data-popup-id="connect"][open]'),
      chip: document.querySelector('.chat-model')?.textContent ?? null,
    };
  })()`);
  await shot("01b-model-menu");
  await evaluate("document.querySelector('.menu-panel')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sleep(300);

  /* 2. A reply that never fits: Continue once, then the chat says what will help. */
  script = "endless";
  await sendPrompt("Write the longest essay you can.");
  checks.firstLimitOffersContinue = await waitFor("document.querySelector('[data-nudge=\"continue\"]') !== null", 60_000);
  await shot("02-continue-offered");
  await evaluate("document.querySelector('[data-nudge=\"continue\"] button')?.click()");
  checks.secondLimitExplains = await waitFor("document.querySelector('.chat-failure[data-failure=\"output-limit\"]') !== null", 60_000);
  checks.noSecondContinue = await evaluate("document.querySelectorAll('[data-nudge=\"continue\"]').length <= 1");
  await shot("03-limit-explained");

  /* 3. A follow-up typed while the assistant works is queued - it used to stop the turn. */
  script = "slow";
  await sendPrompt("Take your time with this one.");
  await sleep(800);
  await sendPrompt("And make it dark.");
  checks.followUpQueued = await waitFor("document.querySelector('.chat-queued-item') !== null", 5_000);
  await shot("04-follow-up-queued");
  checks.turnNotStopped = await evaluate("document.querySelector('.chat-interrupted') === null");
  checks.slowAnswerFinished = await waitFor(`/Slow answer\\./.test(${transcript})`, 30_000);
  checks.followUpSentAfter = await waitFor(`/Follow-up answer\\./.test(${transcript})`, 30_000);
  checks.queueEmptied = await evaluate("document.querySelector('.chat-queued-item') === null");

  /* 4. Connect says what is true of Ollama: running, with its one chat model. */
  const ollamaRow = `(async () => {
    const status = await window.adcode.ai.status();
    const local = status.providers.find((one) => one.id === 'ollama');
    return { local: local?.local ?? null, models: (local?.models ?? []).map((one) => one.id), hasKey: local?.hasKey ?? null };
  })()`;
  checks.ollamaWhileRunning = await evaluate(ollamaRow);
  checks.ollamaRunningIsTrue = checks.ollamaWhileRunning?.local?.running === true &&
    JSON.stringify(checks.ollamaWhileRunning?.models) === JSON.stringify(["qwen2.5-coder:7b"]);

  /* ...and, once it is gone, that it is not running - not "no key needed". */
  await new Promise((resolve) => ollama.close(resolve));
  await sleep(11_000);
  checks.ollamaAfterStop = await evaluate(ollamaRow);
  checks.ollamaStoppedIsTrue = checks.ollamaAfterStop?.local?.running === false && checks.ollamaAfterStop?.hasKey === false;
  checks.notReadyWithoutOllama = await evaluate("window.adcode.ai.status().then((status) => status.ready === false)");
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
  checks.welcomeClosed === true &&
  checks.finishedAnswer === true &&
  checks.noContinueButton === true &&
  checks.noFailureCard === true &&
  checks.roomGrew === true &&
  checks.firstLimitOffersContinue === true &&
  checks.secondLimitExplains === true &&
  checks.modelMenu?.open === true &&
  checks.modelMenu?.offersMore === true &&
  checks.modelMenu?.connectStayedShut === true &&
  checks.followUpQueued === true &&
  checks.turnNotStopped === true &&
  checks.followUpSentAfter === true &&
  checks.queueEmptied === true &&
  checks.ollamaRunningIsTrue === true &&
  checks.ollamaStoppedIsTrue === true &&
  checks.notReadyWithoutOllama === true;
if (!ok) console.log(output.slice(-3000));
process.exit(ok ? 0 : 1);
