/**
 * The live agent room, in the built app, against a fake model that streams slowly.
 *
 * Two journeys, each read as values rather than a pass/fail exit code:
 *
 * 1. The chat assistant writes a file - its arguments streamed in sixty fragments - then runs
 *    a check. The inline live window must appear while the call is still arriving, the code
 *    must grow on screen in several steps (typing, not a jump), and the settled window must
 *    show the file, its line count and "Checks passed".
 * 2. A real three-role Team: Build and Docs at once, Review after Build. Build messages Docs
 *    mid-run; Docs must receive it with its next tool result; Review receives Build's handoff.
 *    The room must show all three, and animate the message and the handoff.
 *
 *   npm run desktop:build && node scripts/smoke-live-agents.mjs
 *
 * With `--record`, journey 2 is also filmed (CDP screencast, ffmpeg from
 * marketing/ad-payback/.tools) into the website's recording: apps/web/public/videos/live-room.*
 * and the dimensions in apps/web/src/lib/liveRecording.ts.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { encodeScreencast, findFfmpeg } from "./recording.mjs";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const scratch = await mkdtemp(join(tmpdir(), "adcode-live-agents-"));
const workspace = join(scratch, "project");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/live-agents");
await Promise.all([mkdir(workspace), mkdir(userData), mkdir(artifacts, { recursive: true })]);
await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "live-smoke", version: "1.0.0" }, null, 2));
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [], activeFile: null } }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, at: Date.now() }));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const record = process.argv.includes("--record");
/** Device pixels per CSS pixel while recording, so the cropped room is sharp at 1280 wide. */
const RECORD_SCALE = 1.6;

/* ── The fake model ───────────────────────────────────────────────────────── */

const APP = Array.from({ length: 30 }, (_, line) => (line % 5 === 0 ? `// Section ${line / 5 + 1}` : `export const value${line} = "line ${line}" + ${line};`)).join("\n");
const LIB = "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n";
const README = "# Greeting\n\nCall `greet(name)` to get a friendly hello.\n\n```js\ngreet(\"Ada\");\n```\n";
const CHECK = `node -e "console.log('all tests passed')"`;
const requests = [];

function answered(request) {
  const firstUser = request.messages.findIndex((message) => message.role === "user");
  return request.messages.slice(firstUser + 1).filter((message) => message.role === "tool").length;
}

/** Tool results since the newest user message that names `marker`: one turn's steps, not the conversation's. */
function answeredSince(request, marker) {
  let from = -1;
  request.messages.forEach((message, index) => {
    if (message.role === "user" && JSON.stringify(message.content).includes(marker)) from = index;
  });
  return from === -1 ? 0 : request.messages.slice(from + 1).filter((message) => message.role === "tool").length;
}

function roleOf(request) {
  const system = request.messages.find((message) => message.role === "system")?.content ?? "";
  return /Role: .* \(id ([a-z-]+)\)/.exec(typeof system === "string" ? system : JSON.stringify(system))?.[1] ?? null;
}

async function streamCall(res, id, name, args, chunks = 1, gap = 0) {
  const json = JSON.stringify(args);
  const size = Math.max(1, Math.ceil(json.length / chunks));
  for (let at = 0; at < json.length; at += size) {
    // Stopped mid-stream: the client has gone, and writing on would throw.
    if (res.destroyed) return;
    const piece = json.slice(at, at + size);
    const call = at === 0 ? { index: 0, id, type: "function", function: { name, arguments: piece } } : { index: 0, function: { arguments: piece } };
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`);
    if (gap > 0) await sleep(gap);
  }
  if (res.destroyed) return;
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
}

function say(res, text) {
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
}

const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const step = answered(request);
  const role = roleOf(request);
  const prompt = JSON.stringify(request.messages);

  if (role === "build") {
    if (step === 0) return streamCall(res, "b-msg", "message_teammate", { to: "docs", text: "The greet() API is ready in lib.js" });
    if (step === 1) return streamCall(res, "b-edit", "propose_edit", { path: "lib.js", contents: LIB }, 30, 60);
    if (step === 2) return streamCall(res, "b-test", "run_command", { command: CHECK });
    return say(res, "Built lib.js; its check passes.");
  }
  if (role === "docs") {
    if (step === 0) return streamCall(res, "d-edit", "propose_edit", { path: "README.md", contents: README }, 50, 70);
    return say(res, "Documented greet().");
  }
  if (role === "review") {
    if (step === 0) return streamCall(res, "r-read", "read_messages", {});
    return say(res, "Reviewed lib.js: it reads well.");
  }
  // Slow on purpose: long enough for the smoke to press Stop while it is still writing.
  if (prompt.includes("stop-chat-smoke")) {
    if (answeredSince(request, "stop-chat-smoke") === 0) return streamCall(res, "s-edit", "propose_edit", { path: "slow.js", contents: APP }, 80, 120);
    return say(res, "Stopped too late.");
  }
  if (prompt.includes("live-chat-smoke")) {
    if (step === 0) return streamCall(res, "c-edit", "propose_edit", { path: "app.js", contents: APP }, 60, 55);
    if (step === 1) return streamCall(res, "c-test", "run_command", { command: CHECK });
    return say(res, "Wrote app.js and its check passes.");
  }
  return say(res, "ok");
});
await new Promise((done) => fake.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/* ── Filming (--record) ───────────────────────────────────────────────────── */

/**
 * Crop the room out of the screencast and write the website's recording: an H.264 MP4, a
 * VP9 WebM and a WebP poster of the last frame, 1280 wide.
 */
async function encodeRecording(frames, box, ms) {
  if (box === null) return { error: "the room never appeared" };
  const ffmpeg = findFfmpeg(root);
  if (ffmpeg === null) return { error: "no ffmpeg: run node marketing/ad-payback/fetch-tools.mjs" };
  const pad = 14;
  const crop = {
    left: box.x - pad,
    top: box.y - pad,
    width: Math.min(box.width + pad * 2, 1360 - box.x + pad),
    height: Math.min(box.height + pad * 2, 900 - box.y + pad),
  };
  const out = resolve(root, "apps/web/public/videos");
  const result = await encodeScreencast({
    frames,
    ffmpeg,
    sharp: require("sharp"),
    crop,
    viewportWidth: 1360,
    width: 1280,
    out: { mp4: join(out, "live-room.mp4"), webm: join(out, "live-room.webm"), poster: join(out, "live-room.webp") },
  });
  const lib = resolve(root, "apps/web/src/lib/liveRecording.ts");
  const source = await readFile(lib, "utf8");
  await writeFile(lib, source.replace(/width: \d+,/, `width: ${result.width},`).replace(/height: \d+,/, `height: ${result.height},`));
  return { ...result, recordedMs: ms };
}


/* ── The app ──────────────────────────────────────────────────────────────── */

const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9" };
delete env.ELECTRON_RUN_AS_NODE;
const port = Number(process.env.ADCODE_LIVE_SMOKE_PORT ?? 9471);
const child = spawn(require("electron"), ["apps/desktop", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let log = "";
child.stdout.on("data", (data) => { log += data; });
child.stderr.on("data", (data) => { log += data; });

const results = {};
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
  if (target === undefined) throw new Error("The app's window never appeared");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const frames = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Page.screencastFrame") {
      frames.push({ data: message.params.data, at: message.params.metadata.timestamp });
      socket.send(JSON.stringify({ id: ++sequence, method: "Page.screencastFrameAck", params: { sessionId: message.params.sessionId } }));
      return;
    }
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
    while (Date.now() < until) {
      try { if (await evaluate(expression)) return true; } catch { /* still loading */ }
      await sleep(150);
    }
    return false;
  };
  const screenshot = async (name) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, `${name}.png`), Buffer.from(shot.data, "base64"));
  };

  await waitFor("document.body.dataset.sessionReady === 'true'", 90_000);
  await evaluate("document.querySelector('dialog.onboarding')?.close()");
  await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: record ? RECORD_SCALE : 1, mobile: false });
  await evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
  })()`);
  await waitFor("window.adcode.ai.status().then((status) => status.ready)");
  if (!(await evaluate("Boolean(document.querySelector('.chat-card')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click()");
  await waitFor("Boolean(document.querySelector('.chat-card')?.getClientRects().length)", 15_000);

  /* 1. The chat assistant, typing a file. (Not filmed: when recording it only settles the layout.) */
  {
  await evaluate("void window.adcode.ai.send('live-chat-smoke: write app.js and check it'); true");
  results.chatWindowAppeared = await waitFor("Boolean(document.querySelector('.chat-transcript .live-window'))", 20_000);
  const lengths = new Set();
  let shotTaken = false;
  // While it works: the "is writing" row at the bottom names the assistant and offers Stop,
  // and the turn's live window has a Stop of its own.
  results.chatWorkingRow = false;
  results.chatInlineMenu = false;
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const state = await evaluate(`(() => {
      const win = document.querySelector('.chat-transcript .live-window');
      const working = document.querySelector('.chat-transcript .chat-working');
      return {
        length: win?.querySelector('.live-code-lines')?.textContent.length ?? 0,
        activity: win?.dataset.activity ?? '',
        status: win?.dataset.status ?? '',
        workingRow: !!working && !working.hidden && working.getBoundingClientRect().height > 0 &&
          (working.querySelector('.chat-working-name')?.textContent ?? '').length > 0 &&
          working.querySelector('.chat-working-stop')?.disabled === false && working === working.parentElement?.lastElementChild,
        workingEvidence: (() => {
          const any = document.querySelector('.chat-working');
          if (!any) return 'no .chat-working anywhere';
          const box = any.getBoundingClientRect();
          return {
            parent: any.parentElement?.className ?? null,
            hidden: any.hidden,
            display: getComputedStyle(any).display,
            last: any === any.parentElement?.lastElementChild,
            height: Math.round(box.height),
            top: Math.round(box.top),
            name: any.querySelector('.chat-working-name')?.textContent ?? null,
            text: any.querySelector('.chat-working-text')?.textContent ?? null,
          };
        })(),
        // The turn's own window offers its actions (Stop among them) behind ⋯, not a second Stop.
        inlineMenu: !!win && win.dataset.status === 'working' && win.querySelector('.live-window-menu')?.hidden === false &&
          win.querySelector('.live-window-stop')?.hidden === true,
      };
    })()`);
    if (state.workingRow) results.chatWorkingRow = true;
    if (state.status === "working") results.chatWorkingEvidence = state.workingEvidence;
    if (state.inlineMenu) results.chatInlineMenu = true;
    if (state.activity === "code" && state.length > 0) lengths.add(state.length);
    if (!shotTaken && state.length > 200) { await screenshot("chat-typing"); shotTaken = true; }
    if (state.status === "done" || state.status === "failed") break;
    await sleep(120);
  }
  results.chatTypingSteps = lengths.size;
  await waitFor("document.querySelector('.chat-transcript .live-window')?.dataset.status === 'done'", 30_000);
  Object.assign(results, await evaluate(`(() => {
    const win = document.querySelector('.chat-transcript .live-window');
    return {
      chatTab: win?.querySelector('.live-code-tab')?.textContent ?? null,
      chatFiles: win?.querySelector('.live-window-files')?.textContent ?? null,
      chatProof: win?.querySelector('.live-window-proof')?.textContent ?? null,
      chatStep: win?.querySelector('.live-window-step')?.textContent ?? null,
      chatSettledShows: win?.dataset.activity ?? null,
      chatWindows: document.querySelectorAll('.chat-transcript .live-window').length,
      chatAuthorLine: (document.querySelector('.chat-transcript .chat-author .chat-author-name')?.textContent ?? '').length > 0,
    };
  })()`));
  await sleep(400);
  results.chatWorkingRowGoneAfter = await evaluate("!document.querySelector('.chat-transcript .chat-working:not([hidden])')");
  await screenshot("chat-settled");
  }

  /* 1b. Stop, pressed in the conversation while the assistant is still writing. */
  {
  await evaluate("void window.adcode.ai.send('stop-chat-smoke: write slow.js'); true");
  const writing = await waitFor("[...document.querySelectorAll('.chat-transcript .live-window')].length >= 2 && [...document.querySelectorAll('.chat-transcript .live-window')].pop()?.dataset.status === 'working'", 20_000);
  await screenshot("chat-stop-row");
  await evaluate("document.querySelector('.chat-transcript .chat-working .chat-working-stop')?.click(); true");
  const stopped = await waitFor("!document.querySelector('.chat-transcript .chat-working:not([hidden])') && document.querySelector('.chat-card')?.dataset.working === 'false'", 15_000);
  results.chatStopButtonStops = writing === true && stopped === true;
  results.chatStopNeverFinished = !requests.some((request) => answeredSince(request, "stop-chat-smoke") >= 1);
  }

  results.chatHasDesignSkillTool = requests.some((request) => (request.tools ?? []).some((tool) => (tool.function?.name ?? tool.name) === "load_builtin_skill"));

  /* 2. A real Team. */
  const team = await evaluate(`window.adcode.aiTeam.configure({
    prompt: 'Add a greet() helper with docs and a review',
    acceptanceCriteria: ['greet works and is documented'],
    roles: [
      { id: 'build', label: 'Build', objective: 'Write lib.js', route: { provider: 'custom', model: 'smoke-model' } },
      { id: 'docs', label: 'Docs', objective: 'Write README.md', route: { provider: 'custom', model: 'smoke-model' } },
      { id: 'review', label: 'Review', objective: 'Review the change', route: { provider: 'custom', model: 'smoke-model' } },
    ],
    nodes: [
      { id: 'build', roleId: 'build', title: 'Build it', objective: 'Write greet in lib.js', dependsOn: [], acceptanceCriteria: ['lib.js exports greet'], fileHints: [] },
      { id: 'docs', roleId: 'docs', title: 'Document it', objective: 'Document greet', dependsOn: [], acceptanceCriteria: ['README explains greet'], fileHints: [] },
      { id: 'review', roleId: 'review', title: 'Review it', objective: 'Review greet', dependsOn: ['build'], acceptanceCriteria: ['Problems are written down'], fileHints: [] },
    ],
    concurrency: 2,
    claims: [],
    tokenLimit: 200000,
    costMicrosLimit: 20000000,
  }).then((view) => view.id)`);
  if (record) await send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
  const recordStarted = Date.now();
  await evaluate(`window.adcode.aiTeam.start(${JSON.stringify(team)}).then(() => true)`);
  results.roomShown = await waitFor("Boolean(document.querySelector('.live-room:not([hidden])'))", 30_000);
  let most = 0;
  let roomShot = false;
  let roomBox = null;
  results.roomStopButtons = 0;
  results.roomStopAllShown = false;
  const teamUntil = Date.now() + 120_000;
  while (Date.now() < teamUntil) {
    const view = await evaluate(`(() => {
      const room = document.querySelector('.live-room');
      const box = room?.getBoundingClientRect();
      return {
        windows: room?.querySelectorAll('.live-window').length ?? 0,
        members: room?.querySelectorAll('.live-member').length ?? 0,
        working: Number(room?.dataset.working ?? 0),
        box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
        stops: room?.querySelectorAll('.live-window-stop:not([hidden])').length ?? 0,
        stopAll: room?.querySelector('.live-room-stop')?.hidden === false,
      };
    })()`);
    most = Math.max(most, view.members);
    results.roomStopButtons = Math.max(results.roomStopButtons, view.stops);
    if (view.stopAll) results.roomStopAllShown = true;
    if (view.box !== null && view.box.height > (roomBox?.height ?? 0)) roomBox = view.box;
    if (!roomShot && view.working >= 2) { await sleep(700); await screenshot("room-working"); roomShot = true; }
    const state = await evaluate(`window.adcode.aiTeam.read(${JSON.stringify(team)}).then((view) => view?.state ?? 'gone')`);
    if (!["configured", "preparing", "running", "merging"].includes(state)) { results.teamState = state; break; }
    await sleep(250);
  }
  await sleep(1_500);
  if (record) {
    await sleep(1_500);
    await send("Page.stopScreencast");
    results.recording = await encodeRecording(frames, roomBox, Date.now() - recordStarted);
  }
  Object.assign(results, await evaluate(`(() => {
    const room = document.querySelector('.live-room');
    return {
      roomAnimated: Number(room?.dataset.animated ?? 0),
      roomLog: room?.querySelector('.live-room-log')?.textContent ?? null,
      roomWindowsNow: room?.querySelectorAll('.live-window').length ?? 0,
      roomProofs: [...(room?.querySelectorAll('.live-window-proof') ?? [])].map((node) => node.textContent),
    };
  })()`));
  results.roomMostMembers = most;
  await screenshot("room-finished");

  const docsRequests = requests.filter((request) => roleOf(request) === "docs");
  results.messageReachedDocs = docsRequests.some((request) => JSON.stringify(request.messages).includes("The greet() API is ready"));
  const buildTools = (requests.find((request) => roleOf(request) === "build")?.tools ?? []).map((tool) => tool.function?.name ?? tool.name);
  results.buildHasTeamTools = buildTools.includes("message_teammate") && buildTools.includes("read_messages");
  results.buildHasMemoryTools = buildTools.includes("project_context");
  results.reviewSawHandoff = requests.filter((request) => roleOf(request) === "review").some((request) => JSON.stringify(request.messages).includes("Built lib.js"));
  results.agentsHaveDesignSkillTool = buildTools.includes("load_builtin_skill");
  // The fake model reports no token counts, so every request is counted as an estimate.
  results.usageCounted = await evaluate(`window.adcode.aiUsage.read('today').then((view) => ({
    requests: view.totals.requests,
    models: view.models.map((model) => model.model),
    estimated: view.totals.estimated,
    chat: view.models.reduce((sum, model) => sum + model.chatRequests, 0),
    agents: view.models.reduce((sum, model) => sum + model.agentRequests, 0),
  }))`);
} catch (error) {
  results.error = String(error?.stack ?? error);
} finally {
  socket?.close();
  child.kill();
  fake.close();
}

for (const [key, value] of Object.entries(results)) console.log(`${key}: ${JSON.stringify(value)}`);
const errors = log.split("\n").filter((line) => /error|exception/i.test(line) && !/DevTools|GPU|Autofill|ERR_CONNECTION_REFUSED|net::/i.test(line)).slice(0, 8);
if (errors.length > 0) console.log(`logErrors: ${JSON.stringify(errors)}`);
process.exit(results.error === undefined ? 0 : 1);
