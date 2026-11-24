/**
 * Two chats, two models, in the built app - against a local fake model that names the model
 * every request asked for.
 *
 *   npm run desktop:build && node scripts/smoke-chat-models.mjs
 *
 * Reported for 2.6.5: "there is an issue when I try to use new, different models in two
 * different chats." The model was one setting for the whole app, so choosing a model in one
 * chat moved every other chat onto it - the chip, the next message, a turn that kept going by
 * itself. This drives what the person did:
 *
 *   1. chat A on "Alpha" starts a slow answer;
 *   2. a new chat B, the model picker, "Beta", a message there - while A is still writing;
 *   3. back to A: its chip, and its next message, must still be Alpha;
 *   4. back to B: still Beta;
 *   5. quit, launch again on the same profile: A reopens on Alpha, B on Beta.
 *
 * Every request the fake model receives is recorded with the model it named, so the checks
 * read what was actually sent, not what the window says.
 *
 * Then, on the same profile, two long saved chats: switching between them must land on the
 * newest message on the first frame, with no smooth scroll still running (2.6.5 glided down
 * past every message).
 *
 * Prints `chatModelsEvidence: {...}` - read the values, not just the exit code. Screenshots
 * land in artifacts/chat-models/. ADCODE_CHAT_MODELS_PORT picks the DevTools port (9481).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const scratch = await mkdtemp(join(tmpdir(), "adcode-chat-models-"));
const workspace = join(scratch, "project");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/chat-models");
await Promise.all([mkdir(workspace, { recursive: true }), mkdir(userData), mkdir(artifacts, { recursive: true })]);
await writeFile(join(workspace, "README.md"), "# Two models\n");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [], activeFile: null } }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ tour: 2, completed: true, at: Date.now() }));

/* ── The fake model: streams slowly, says which model it is ─────────────── */

/** Every request: the model it named and the newest thing the person said. */
const requests = [];
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  let request;
  try { request = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
  const said = lastUserText(request);
  const tools = request.tools?.length ?? 0;
  requests.push({ model: request.model, said: said.slice(0, 80), tools, at: Date.now() });
  // A summary or title request offers no tools: answer it at once.
  if (tools === 0) {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "Summary." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    return;
  }
  // "slow" in the message: about six seconds of streaming, so another chat can start meanwhile.
  const slow = /slow/i.test(said);
  const words = `Answered by ${request.model}: ${slow ? "working through it step by step, one piece at a time, until the whole answer is written out." : "done."}`.split(" ");
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const word of words) {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${word} ` } }] })}\n\n`);
    if (slow) await sleep(6_000 / words.length);
  }
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((done) => fake.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

function lastUserText(request) {
  const message = [...(request?.messages ?? [])].reverse().find((entry) => entry.role === "user");
  if (message === undefined) return "";
  return typeof message.content === "string" ? message.content : message.content.map((part) => part.text ?? "").join("");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const port = Number(process.env.ADCODE_CHAT_MODELS_PORT ?? 9481);
const ALPHA = { id: "connection-alpha", name: "Alpha", model: "alpha-free" };
const BETA = { id: "connection-beta", name: "Beta", model: "beta-paid" };

/** Launch the app on the profile, run `drive` against its window, quit. */
async function withApp(drive) {
  const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9", ADCODE_ACCOUNT_GATE: "off", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), ["apps/desktop", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"], {
    cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (data) => { log += data; });
  child.stderr.on("data", (data) => { log += data; });
  let socket;
  let sequence = 0;
  const pending = new Map();
  try {
    let target;
    for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = targets.find((entry) => entry.type === "page" && entry.url.includes("index.html"));
      } catch { /* Electron is starting. */ }
      if (target === undefined) await sleep(500);
    }
    if (target === undefined) throw new Error("The app's window did not appear");
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
    const waitFor = async (expression, timeout = 20_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        try { if (await evaluate(expression)) return true; } catch { /* still loading */ }
        await sleep(120);
      }
      return false;
    };
    const screenshot = async (name) => {
      // One-time notices (ads, privacy) sit over the model chip in the corner; the chip is the point.
      await evaluate(`(() => {
        for (const button of document.querySelectorAll('button')) {
          if (!['OK', 'Keep on'].includes(button.textContent.trim())) continue;
          let card = button.parentElement;
          const notice = (node) => node.textContent.includes('Sponsored cards that match') || node.textContent.includes('Help improve ADCode');
          for (let up = 0; card !== null && up < 6 && !notice(card); up++) card = card.parentElement;
          if (card !== null && notice(card)) button.click();
        }
        return true;
      })()`).catch(() => undefined);
      await sleep(300);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
    };
    const type = (text) => send("Input.insertText", { text });
    const press = async (key) => {
      const codes = { Enter: [13, "\r"], Escape: [27, undefined] };
      const [code, text] = codes[key];
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, text });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
    };
    await evaluate("document.querySelector('dialog.onboarding')?.close(); true");
    if (!(await evaluate("Boolean(document.querySelector('.chat-card')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click(); true");
    await waitFor("Boolean(document.querySelector('.chat-card')?.getClientRects().length)", 15_000);
    return await drive({ evaluate, waitFor, screenshot, type, press });
  } finally {
    try { socket?.close(); } catch { /* closing */ }
    child.kill();
    await new Promise((done) => { if (child.exitCode !== null) done(); else child.once("exit", done); setTimeout(done, 5_000); });
    if (process.env.ADCODE_SMOKE_TRACE === "1") process.stderr.write(log.slice(-4000));
  }
}

/** What a chat in the window shows: its chip, and the session id the history marks current. */
const CHIP = "document.querySelector('.chat-model-name')?.textContent ?? ''";

async function sendMessage(app, text) {
  await app.evaluate("(() => { const input = document.querySelector('.chat-input'); input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); return true; })()");
  await app.type(text);
  await app.press("Enter");
}

const idle = (app) => app.waitFor("document.querySelector('.chat-toolbar .chat-send')?.dataset.mode === 'send'", 30_000);

/** The model picker, as a person uses it: the chip, the model's name in search, Enter. */
async function pick(app, model) {
  await app.evaluate("document.querySelector('.chat-model')?.click(); true");
  const opened = await app.waitFor("Boolean(document.querySelector('.model-picker-search')?.getClientRects().length)", 5_000);
  if (!opened) return false;
  await app.evaluate("(() => { const search = document.querySelector('.model-picker-search'); search.focus(); search.value = ''; search.dispatchEvent(new Event('input')); return true; })()");
  await app.type(model.model);
  await sleep(300);
  await app.press("Enter");
  return app.waitFor(`document.querySelector('.chat-model-name')?.textContent.includes(${JSON.stringify(model.model)})`, 8_000);
}

/** Open a saved conversation from the history list by its title. */
async function openChat(app, title) {
  await app.evaluate("document.querySelector('[aria-label=\"Show conversations\"], [aria-label=\"Conversation history\"], .chat-history-toggle')?.click(); true");
  const opened = await app.evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-session-id]')].find((node) => node.textContent.includes(${JSON.stringify(title)}));
    (row?.querySelector('.chat-history-open') ?? row)?.click();
    return Boolean(row);
  })()`);
  if (!opened) return false;
  return app.waitFor(`[...document.querySelectorAll('.chat-transcript .chat-bubble-user')].some((node) => node.textContent.includes(${JSON.stringify(title)}))`, 8_000);
}

const modelsFor = (said) => requests.filter((one) => one.tools > 0 && one.said.includes(said)).map((one) => one.model);

const evidence = {};
let failed = false;
try {
  await withApp(async (app) => {
    // Two models on two connections, both keys saved; Alpha in use, as a person would have it.
    await app.evaluate(`(async () => {
      await window.adcode.settings.write('adcode.ai.connections', ${JSON.stringify(JSON.stringify([ALPHA, BETA].map((one) => ({ ...one, rpm: 600, baseUrl: endpoint }))))});
      await window.adcode.ai.setKey(${JSON.stringify(ALPHA.id)}, 'local-key-a');
      await window.adcode.ai.setKey(${JSON.stringify(BETA.id)}, 'local-key-b');
      await window.adcode.settings.write('adcode.ai.provider', ${JSON.stringify(ALPHA.id)});
      await window.adcode.settings.write('adcode.ai.model', ${JSON.stringify(ALPHA.model)});
      return true;
    })()`);
    evidence.ready = await app.waitFor(`document.querySelector('.chat-model')?.dataset.ready === 'true' && ${CHIP}.includes('alpha-free')`, 20_000);

    // 1. Chat A on Alpha: a slow answer.
    await sendMessage(app, "Chat A slow first question");
    evidence.aStarted = await app.waitFor("document.querySelector('.chat-toolbar .chat-send')?.dataset.mode === 'stop'", 10_000);
    await sleep(800);

    // 2. A new chat while A is still writing; Beta from the picker; a message there.
    await app.evaluate("document.querySelector('[aria-label=\"Start a new conversation\"]')?.click(); true");
    await app.waitFor("document.querySelectorAll('.chat-transcript .chat-bubble').length === 0", 5_000);
    evidence.pickedBeta = await pick(app, BETA);
    await sendMessage(app, "Chat B slow question");
    await sleep(1_500);
    evidence.chipInBWhileBothWork = await app.evaluate(CHIP);
    await app.screenshot("1-chat-b-on-beta-while-a-works");
    evidence.bothWorkedAtOnce = (() => {
      const a = requests.find((one) => one.said.includes("Chat A slow"));
      const b = requests.find((one) => one.said.includes("Chat B slow"));
      return a !== undefined && b !== undefined && b.at - a.at < 6_000;
    })();
    await idle(app);
    await sleep(6_000);

    // 3. Back to A: still Alpha, on the chip and on the wire.
    evidence.reopenedA = await openChat(app, "Chat A slow first question");
    await sleep(2_500);
    evidence.chipInA = await app.evaluate(CHIP);
    await sendMessage(app, "Chat A second question");
    await idle(app);
    await app.waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes('Answered by') && node.textContent.includes('done.'))", 15_000);
    await app.screenshot("2-chat-a-still-on-alpha");

    // 4. Back to B: still Beta.
    evidence.reopenedB = await openChat(app, "Chat B slow question");
    await sleep(2_500);
    evidence.chipInB = await app.evaluate(CHIP);
    await sendMessage(app, "Chat B second question");
    await idle(app);
    await sleep(1_000);
    await app.screenshot("3-chat-b-still-on-beta");
  });

  // Two long saved chats, for switching: each must open at its newest message at once.
  const sessions = join(userData, "ai-sessions", createHash("sha256").update(workspace).digest("hex").slice(0, 16));
  await mkdir(sessions, { recursive: true });
  const paragraph = "This is a long answer that fills the screen, so the chat is many screens tall and a glide from the top would be seen. ".repeat(6);
  for (const name of ["Long chat one", "Long chat two"]) {
    const messages = [];
    for (let turn = 0; turn < 30; turn++) {
      messages.push({ role: "user", text: turn === 0 ? name : `${name}, question ${String(turn)}`, at: 1_000 + turn * 2 });
      messages.push({ role: "assistant", text: turn === 29 ? `${name} newest answer.` : paragraph, at: 1_001 + turn * 2 });
    }
    const id = name.replace(/\s+/g, "-").toLowerCase();
    await writeFile(join(sessions, `${id}.json`), JSON.stringify({ id, title: name, renamed: true, createdAt: 1_000, updatedAt: 1_100, messages, model: { provider: ALPHA.id, model: ALPHA.model } }));
  }

  // 5. Launch again on the same profile: each chat comes back on its own model.
  await withApp(async (app) => {
    await app.waitFor("document.querySelector('.chat-model')?.dataset.ready === 'true'", 20_000);
    /**
     * Open a chat from the list and read, on the frame its newest answer appears, how far from
     * the bottom it is - then again a little later. A glide shows as a gap, or as a moving top.
     */
    const landing = (title, newest) => app.evaluate(`(async () => {
      const row = [...document.querySelectorAll('[data-session-id]')].find((node) => node.textContent.includes(${JSON.stringify(title)}));
      if (!row) return null;
      (row.querySelector('.chat-history-open') ?? row).click();
      const transcript = document.querySelector('.chat-transcript');
      const started = performance.now();
      while (![...transcript.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes(${JSON.stringify(newest)}))) {
        if (performance.now() - started > 8000) return null;
        await new Promise(requestAnimationFrame);
      }
      await new Promise(requestAnimationFrame);
      const gap = () => Math.round(transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight);
      const first = { gap: gap(), top: transcript.scrollTop, height: transcript.scrollHeight };
      await new Promise((done) => setTimeout(done, 250));
      return { firstFrameGap: first.gap, gapLater: gap(), topMovedAfter: Math.round(transcript.scrollTop - first.top), scrollHeight: first.height, clientHeight: transcript.clientHeight };
    })()`);
    evidence.switchToLongOne = await landing("Long chat one", "Long chat one newest answer.");
    evidence.switchToLongTwo = await landing("Long chat two", "Long chat two newest answer.");
    evidence.switchBackToLongOne = await landing("Long chat one", "Long chat one newest answer.");
    await app.screenshot("6-long-chat-opened-at-newest");

    await app.waitFor("document.querySelector('.chat-model')?.dataset.ready === 'true'", 20_000);
    evidence.afterRestartReopenedA = await openChat(app, "Chat A slow first question");
    await sleep(2_500);
    evidence.afterRestartChipInA = await app.evaluate(CHIP);
    await app.screenshot("4-after-restart-chat-a");
    evidence.afterRestartReopenedB = await openChat(app, "Chat B slow question");
    await sleep(2_500);
    evidence.afterRestartChipInB = await app.evaluate(CHIP);
    await sendMessage(app, "Chat B after restart");
    await idle(app);
    await sleep(500);
    await app.screenshot("5-after-restart-chat-b");
  });

  evidence.sent = {
    aFirst: modelsFor("Chat A slow first question"),
    bFirst: modelsFor("Chat B slow question"),
    aSecond: modelsFor("Chat A second question"),
    bSecond: modelsFor("Chat B second question"),
    bAfterRestart: modelsFor("Chat B after restart"),
  };
  const only = (list, model) => list.length > 0 && list.every((one) => one === model);
  evidence.checks = {
    aFirstOnAlpha: only(evidence.sent.aFirst, ALPHA.model),
    bFirstOnBeta: only(evidence.sent.bFirst, BETA.model),
    bothWorkedAtOnce: evidence.bothWorkedAtOnce === true,
    aChipStillAlpha: String(evidence.chipInA).includes(ALPHA.model),
    aSecondOnAlpha: only(evidence.sent.aSecond, ALPHA.model),
    bChipStillBeta: String(evidence.chipInB).includes(BETA.model),
    bSecondOnBeta: only(evidence.sent.bSecond, BETA.model),
    afterRestartAOnAlpha: String(evidence.afterRestartChipInA).includes(ALPHA.model),
    afterRestartBOnBeta: String(evidence.afterRestartChipInB).includes(BETA.model) && only(evidence.sent.bAfterRestart, BETA.model),
    // Long enough to scroll, at the bottom on the first frame, and nothing still moving after.
    switchLandsAtNewest: [evidence.switchToLongOne, evidence.switchToLongTwo, evidence.switchBackToLongOne].every((one) =>
      one !== null && one !== undefined && one.scrollHeight > one.clientHeight * 3 && one.firstFrameGap <= 2 && one.gapLater <= 2 && one.topMovedAfter === 0),
  };
  failed = Object.values(evidence.checks).some((ok) => ok !== true);
} catch (error) {
  failed = true;
  evidence.error = error instanceof Error ? error.message : String(error);
} finally {
  fake.close();
  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
}

process.stdout.write(`chatModelsEvidence: ${JSON.stringify(evidence, null, 2)}\n`);
process.exit(failed ? 1 : 0);
