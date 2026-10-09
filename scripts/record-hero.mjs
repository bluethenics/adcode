/**
 * The homepage hero, filmed in the real app.
 *
 * One Vibe turn, start to finish, in the built ADCode: the request typed into the composer,
 * the plan, the code typing into the live window as the model writes it, and the game opening
 * in the live preview and playing. The model is a scripted stand-in for Ollama on
 * 127.0.0.1:11434 that calls the real tools - every window, card and preview on screen is the
 * app doing what it does. Filmed once per theme, so the hero matches the visitor's.
 *
 *   npm run desktop:build && node scripts/record-hero.mjs           # dark and light
 *   node scripts/record-hero.mjs --theme light                      # one theme
 *
 * Writes apps/web/public/videos/hero-{dark,light}.{mp4,webm,webp}. Needs ffmpeg from
 * `node marketing/ad-payback/fetch-tools.mjs`, and port 11434 free (stop a real Ollama first).
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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const themeArg = process.argv.indexOf("--theme");
const themes = themeArg === -1 ? ["dark", "light"] : [process.argv[themeArg + 1]];
const ffmpeg = findFfmpeg(root);
if (ffmpeg === null) throw new Error("No ffmpeg: run node marketing/ad-payback/fetch-tools.mjs");

const PROMPT = "Make a snake game I can play in the browser, with a score, a best score and a restart button.";
const MODEL = "qwen2.5-coder:7b";
const INDEX = await readFile(resolve(root, "scripts/fixtures/hero-snake/index.html"), "utf8");
const GAME = await readFile(resolve(root, "scripts/fixtures/hero-snake/game.js"), "utf8");
const SUMMARY = "Your snake game is ready. Steer with the arrow keys, press R or Restart to play again, and your best score is kept between visits. Until you press a key, it plays itself.";
const plan = (statuses) => ({
  steps: [
    { step: "Lay out the page and score bar", status: statuses[0] },
    { step: "Write the game loop and controls", status: statuses[1] },
    { step: "Open it in the preview", status: statuses[2] },
  ],
});

/* ── A scripted Ollama ─────────────────────────────────────────────────────── */

function answered(request) {
  const prompt = request.messages.findLastIndex((message) => message.role === "user" && JSON.stringify(message.content).includes("snake game"));
  return prompt === -1 ? -1 : request.messages.slice(prompt + 1).filter((message) => message.role === "tool").length;
}

async function streamCalls(res, calls) {
  for (const [index, call] of calls.entries()) {
    const json = JSON.stringify(call.args);
    const size = Math.max(1, Math.ceil(json.length / (call.chunks ?? 1)));
    for (let at = 0; at < json.length; at += size) {
      const piece = json.slice(at, at + size);
      const delta = at === 0
        ? { index, id: call.id, type: "function", function: { name: call.name, arguments: piece } }
        : { index, function: { arguments: piece } };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [delta] } }] })}\n\n`);
      if (call.gap) await sleep(call.gap);
    }
  }
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
}

async function streamText(res, text) {
  for (const word of text.split(/(?<= )/)) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`);
    await sleep(28);
  }
  res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
}

const ollama = createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/api/tags")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL, size: 4_683_087_332, details: { family: "qwen2", parameter_size: "7.6B" } }] }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  // A beat of thinking before each reply, as a local model takes.
  await sleep(600);
  const step = answered(request);
  // The plan goes in a reply of its own, before the code it describes: a plan that arrives
  // together with a file only updates once that file has finished streaming.
  if (step === 0) return streamCalls(res, [{ id: "plan-1", name: "update_plan", args: plan(["in_progress", "pending", "pending"]) }]);
  if (step === 1) {
    return streamCalls(res, [{ id: "page-1", name: "propose_edit", args: { path: "index.html", contents: INDEX, summary: "The page, score bar and board" }, chunks: 34, gap: 42 }]);
  }
  if (step === 2) return streamCalls(res, [{ id: "plan-2", name: "update_plan", args: plan(["done", "in_progress", "pending"]) }]);
  if (step === 3) {
    return streamCalls(res, [{ id: "game-1", name: "propose_edit", args: { path: "game.js", contents: GAME, summary: "Game loop, controls and best score" }, chunks: 60, gap: 40 }]);
  }
  if (step === 4) {
    return streamCalls(res, [
      { id: "open-1", name: "open_preview", args: { path: "index.html" } },
      { id: "plan-3", name: "update_plan", args: plan(["done", "done", "done"]) },
    ]);
  }
  return streamText(res, step === -1 ? "ok" : SUMMARY);
});
await new Promise((done, fail) => {
  ollama.once("error", (error) => fail(error.code === "EADDRINUSE" ? new Error("Port 11434 is in use - stop Ollama while recording") : error));
  ollama.listen(11434, "127.0.0.1", done);
});

/** Keep painting when another window covers this one, or the take stops part way. */
const KEEP_PAINTING = ["--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-background-timer-throttling"];

/* ── One take per theme ────────────────────────────────────────────────────── */

async function film(theme, take) {
  const scratch = await mkdtemp(join(tmpdir(), "adcode-hero-"));
  const workspace = join(scratch, "snake-game");
  const userData = join(scratch, "profile");
  await Promise.all([mkdir(workspace), mkdir(userData)]);
  await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [], activeFile: null } }));
  await writeFile(join(userData, "onboarding.json"), JSON.stringify({ completed: true, at: Date.now() }));

  const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9" };
  delete env.ELECTRON_RUN_AS_NODE;
  // A port per take: the previous take's app may still be letting go of its own.
  const port = Number(process.env.ADCODE_HERO_PORT ?? 9477) + take;
  const child = spawn(require("electron"), ["apps/desktop", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ...KEEP_PAINTING], { cwd: root, env, stdio: "ignore", windowsHide: true });
  let socket;
  try {
    let target;
    for (let attempt = 0; attempt < 80 && target === undefined; attempt++) {
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((entry) => entry.type === "page" && entry.url.includes("index.html"));
      } catch { /* starting */ }
      if (target === undefined) await sleep(500);
    }
    if (target === undefined) throw new Error("The app's window never appeared");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done) => socket.addEventListener("open", done, { once: true }));
    let sequence = 0;
    const pending = new Map();
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
      pending.set(id, (message) => {
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
    const waitFor = async (expression, timeout) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        try { if (await evaluate(expression)) return; } catch { /* loading */ }
        await sleep(150);
      }
      throw new Error(`Never became true: ${expression}`);
    };

    await waitFor("document.body.dataset.sessionReady === 'true'", 90_000);
    await evaluate("document.querySelector('dialog.onboarding')?.close(); true");
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1.2, mobile: false });
    await evaluate(`(async () => {
      await window.adcode.settings.write('adcode.ai.provider', 'ollama');
      await window.adcode.settings.write('adcode.ai.model', ${JSON.stringify(MODEL)});
      await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
      return true;
    })()`);
    await waitFor("window.adcode.ai.status().then((status) => status.ready)", 30_000);
    // The take: the visitor's theme; no toasts; and the folder as a person's would read.
    await evaluate(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const style = document.createElement('style');
      style.textContent = '.toast, .chat-scroll-bottom { display: none !important; }';
      document.head.append(style);
      const relabel = () => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.nodeValue.includes('adcode-hero-')) node.nodeValue = '…\\\\Documents\\\\ADCode Projects\\\\snake-game';
        }
      };
      relabel();
      new MutationObserver(relabel).observe(document.body, { subtree: true, childList: true, characterData: true });
      return true;
    })()`);
    if (!(await evaluate("Boolean(document.querySelector('.chat-input')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click(); true");
    await waitFor("Boolean(document.querySelector('.chat-input')?.getClientRects().length)", 15_000);
    await sleep(1_200);

    await send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    await sleep(900);
    await evaluate("document.querySelector('.chat-input').focus(); true");
    for (const character of PROMPT) {
      await send("Input.insertText", { text: character });
      await sleep(26);
    }
    await sleep(450);
    for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes('plays itself'))", 90_000);
    // Then look at what was built, as a person would, and let the game play - it is the point
    // of the shot, and the last frame becomes the poster.
    await sleep(1_200);
    await evaluate("document.querySelector('.chat-live-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); true");
    await sleep(4_800);
    await send("Page.stopScreencast");

    const out = resolve(root, "apps/web/public/videos");
    return await encodeScreencast({
      frames,
      ffmpeg,
      sharp: require("sharp"),
      crop: null,
      width: 1440,
      out: { mp4: join(out, `hero-${theme}.mp4`), webm: join(out, `hero-${theme}.webm`), poster: join(out, `hero-${theme}.webp`) },
    });
  } finally {
    socket?.close();
    const exited = new Promise((done) => child.once("exit", done));
    child.kill();
    await exited;
  }
}

try {
  for (const [take, theme] of themes.entries()) console.log(`${theme}: ${JSON.stringify(await film(theme, take))}`);
} finally {
  ollama.close();
}
