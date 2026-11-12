/*
 * The web version, end to end, on this computer.
 *
 *   npm run smoke:web-vibe            (builds adcode-host first)
 *   npm run smoke:web-vibe -- --no-build
 *
 * Starts adcode-host and the web page (`scripts/web-vibe.mjs`), a fake OpenAI-compatible model,
 * and a headless Edge, then does what a first visitor does: signs in (dev mode), describes a
 * page, watches the agent write it, previews it, sees it under Changes, commits it, loses the
 * connection and gets it back, and checks the page on a phone.
 *
 * Read the printed values, not just the exit code.
 *
 * Env: ADCODE_SMOKE_PORT (9473, DevTools), ADCODE_HOST_PORT (7320), ADCODE_WEB_PORT (5181),
 *      ADCODE_SHOTS (folder for screenshots).
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launchBrowser } from "./lib/headlessEdge.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const HOST_PORT = process.env["ADCODE_HOST_PORT"] ?? "7320";
const WEB_PORT = process.env["ADCODE_WEB_PORT"] ?? "5181";
const SHOTS = process.env["ADCODE_SHOTS"] ?? null;
const PROMPT = "web-smoke: a landing page for a bakery";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── A fake model that builds one page ─────────────────────────────────── */

const PAGE = "<!doctype html><html><head><title>Bakery smoke</title></head><body><h1>Fresh bread daily</h1></body></html>";
const SLOW_PROMPT = "parallel-slow";
const FAST_PROMPT = "parallel-fast";
const LONG_PROMPT = "keep-going-smoke";
const FAIL_PROMPT = "parallel-fail";
const HELPERS_PROMPT = "helpers-smoke";
/** The two sub-agents the fake parent delegates to, by the titles its call carries. */
const HELPER_TITLES = ["Map the auth flow", "Write the tests"];
/** When the fake model was sent the main process's own "Continue" - the page was frozen then. */
let keptGoingAt = 0;
const requests = [];
let viewPageReport = "";
const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  requests.push(request);
  const messages = request.messages ?? [];
  const userTexts = messages.filter((message) => message.role === "user").map((message) => String(message.content));
  const said = (words) => userTexts.some((text) => text.includes(words));
  const answer = (deltas) => {
    const last = deltas.at(-1);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta === last ? (last.tool_calls ? "tool_calls" : "stop") : null }] })}\n\n`).join("")}data: [DONE]\n\n`);
  };
  // Two chats at once: one slow enough to still be working when the other has finished.
  if (said(SLOW_PROMPT)) {
    await sleep(6_000);
    return answer([{ content: "Slow chat done." }]);
  }
  if (said(FAST_PROMPT)) return answer([{ content: "Fast chat done." }]);
  // A chat that fails while another is on screen: refused outright, not worth a retry.
  if (said(FAIL_PROMPT)) {
    await sleep(1_500);
    res.writeHead(400, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "smoke: refused on purpose" } }));
  }
  // A long job: list files until the step limit, then - only once the main process has said
  // "Continue" by itself - finish. Each list is its own call, so none is a repeated failure.
  if (said(LONG_PROMPT)) {
    if (userTexts.at(-1)?.includes("Continue from where you stopped")) {
      keptGoingAt = Date.now();
      return answer([{ content: "Kept going and finished." }]);
    }
    const step = messages.filter((message) => message.role === "tool").length;
    return answer([{ tool_calls: [{ index: 0, id: `list-${String(step)}`, function: { name: "list_files", arguments: JSON.stringify({ path: "." }) } }] }]);
  }
  // A parent that delegates: each helper's own conversation comes back with its brief as the
  // only user message, and returns a report at its own pace.
  const helperTitle = HELPER_TITLES.find((title) => said(`Task: ${title}`));
  if (helperTitle !== undefined) {
    const alreadyRead = messages.some((message) => message.role === "tool");
    if (helperTitle === "Write the tests" && !alreadyRead) {
      await sleep(1_200);
      return answer([{ tool_calls: [{ index: 0, id: "tests-1", function: { name: "read_file", arguments: JSON.stringify({ path: "index.html" }) } }] }]);
    }
    await sleep(2_000);
    return answer([{ content: helperTitle === "Map the auth flow" ? "The login flow starts in src/auth.ts." : "Read index.html; the headline should be tested." }]);
  }
  if (said(HELPERS_PROMPT)) {
    const delegated = messages.filter((message) => message.role === "tool").length;
    if (delegated > 0) return answer([{ content: "Helpers checked the page." }]);
    await sleep(600);
    return answer([{ tool_calls: [{ index: 0, id: "delegate-1", function: { name: "delegate_task", arguments: JSON.stringify({ tasks: [
      { title: HELPER_TITLES[0], instructions: "Find where the login flow starts in this project and report the file.", mode: "explore" },
      { title: HELPER_TITLES[1], instructions: "Read index.html and report what should be tested.", mode: "build" },
    ] }) } }] }]);
  }
  const start = messages.findLastIndex((message) => message.role === "user" && String(message.content).includes(PROMPT));
  const answered = start === -1 ? 0 : messages.slice(start + 1).filter((message) => message.role === "tool").length;
  // Write the page, then look at it with the agent's own browser, then answer.
  const lastTool = start === -1 ? "" : String(messages.filter((message) => message.role === "tool").at(-1)?.content ?? "");
  if (start !== -1 && answered === 2) viewPageReport = lastTool;
  // The first step thinks and says what it will do before writing, as a real model does, so
  // the turn's timeline has a thought, text between steps, and tool rows to show.
  const deltas = start !== -1 && answered === 0
    ? [
      { reasoning_content: "**Planning the bakery page**\nOne index.html with a headline, then check it on a phone." },
      { content: "I will write the page, then check it on a phone." },
      { tool_calls: [{ index: 0, id: "write-1", function: { name: "propose_edit", arguments: JSON.stringify({ path: "index.html", contents: PAGE, summary: "Add the bakery page" }) } }] },
    ]
    : start !== -1 && answered === 1
      ? [{ tool_calls: [{ index: 0, id: "look-1", function: { name: "view_page", arguments: JSON.stringify({ path: "index.html", width: 390, height: 844, screenshot: true }) } }] }]
      : [{ content: "Done - your bakery page is ready." }];
  // A beat before looking at the page, so the smoke can see the turn while it is still working.
  if (start !== -1 && answered === 1) await sleep(2_500);
  const last = deltas.at(-1);
  const finish = last.tool_calls ? "tool_calls" : "stop";
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta === last ? finish : null }] })}\n\n`).join("")}data: [DONE]\n\n`);
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/* ── The stack ─────────────────────────────────────────────────────────── */

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.host.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

const home = await mkdtemp(join(tmpdir(), "adcode-web-smoke-"));
let stackLog = "";
const stack = spawn(process.execPath, ["scripts/web-vibe.mjs", "--no-build"], {
  env: { ...process.env, ADCODE_HOME: home, ADCODE_HOST_PORT: HOST_PORT, ADCODE_WEB_PORT: WEB_PORT, ADCODE_AD_SERVER: "http://127.0.0.1:9" },
  stdio: ["ignore", "pipe", "pipe"],
});
stack.stdout.on("data", (chunk) => { stackLog += chunk; });
stack.stderr.on("data", (chunk) => { stackLog += chunk; });

for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok && (await fetch(`http://127.0.0.1:${HOST_PORT}/__adcode/health`)).ok) break;
  } catch {
    // starting
  }
  await sleep(500);
}

const checks = {};
const browser = await launchBrowser({ port: Number(process.env["ADCODE_SMOKE_PORT"] ?? 9473) });
const shot = async (name) => {
  if (SHOTS !== null) await browser.screenshot(join(SHOTS, `web-${name}.png`));
};

try {
  await browser.viewport(1280, 820);
  await browser.goto(`http://localhost:${WEB_PORT}/`);
  checks.gateShown = await browser.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60_000 });
  await shot("gate");
  checks.gateDevMode = await browser.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode')); button?.click(); return Boolean(button); })()`);
  checks.vibeVisible = await browser.waitFor("document.querySelector('.vibe-pages') && document.body.dataset.sessionReady === 'true'", { timeoutMs: 90_000 });
  if (!checks.vibeVisible) throw new Error("The browser workspace did not finish starting after sign-in");
  checks.onboardingAsks = await browser.waitFor("document.querySelector('dialog.onboarding')?.open", { timeoutMs: 15_000 });
  checks.desktopButtonInsteadOfIde = await browser.evaluate("[...document.querySelectorAll('.vibe-ide-button')].map((b) => b.textContent.trim()).join('|')");

  // Connected first, so "Build it" goes straight to building rather than asking for a model.
  await browser.evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
    return true;
  })()`);
  checks.modelReady = await browser.waitFor("window.adcode.ai.status().then((status) => status.ready)", { timeoutMs: 20_000 });

  // What a first visitor does: describe it in the onboarding sheet and press Build it.
  await browser.evaluate(`(() => {
    const box = document.querySelector('dialog.onboarding .onboarding-idea');
    box.value = ${JSON.stringify(PROMPT)};
    box.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('dialog.onboarding .onboarding-next').click();
    return true;
  })()`);
  // While it works: one timeline with its heading live, the pixel spinner at the foot.
  checks.timelineWhileWorking = await browser.waitFor(`document.querySelector('.chat-turn[data-state="running"] .chat-step.is-tools') !== null`, { timeoutMs: 90_000 });
  checks.liveHeading = await browser.evaluate(`document.querySelector('.chat-turn[data-state="running"] .chat-turn-lead')?.textContent ?? null`);
  checks.spinnerAtFoot = await browser.evaluate(`(() => {
    const spinner = document.querySelector('.chat-working:not([hidden]) .chat-pixel-spinner');
    return spinner !== null && spinner.getBoundingClientRect().width > 0;
  })()`);
  checks.mascotsWhileWorking = await browser.evaluate("document.querySelectorAll('.chat-transcript :is(.chat-mascot, .adcode-mascot)').length");
  await shot("chat-working");
  checks.chatReply = await browser.waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((bubble) => bubble.textContent.includes('bakery page is ready'))", { timeoutMs: 90_000 });
  // Once it is done: folded to "Worked for", the answer below the fold, the steps inside it.
  await browser.waitFor(`document.querySelector('.chat-turn[data-state="done"]') !== null`, { timeoutMs: 20_000 });
  checks.timeline = await browser.evaluate(`(() => {
    const turn = document.querySelector('.chat-turn[data-state="done"]');
    if (turn === null) return null;
    const bubbles = [...document.querySelectorAll('.chat-bubble-assistant')];
    const answer = bubbles.find((bubble) => bubble.textContent.includes('bakery page is ready'));
    const between = bubbles.find((bubble) => bubble.textContent.includes('then check it on a phone'));
    return ({
      heading: turn.querySelector('.chat-turn-lead').textContent,
      folded: turn.dataset.collapsed === 'true',
      answerOutsideFold: answer !== undefined && !turn.contains(answer),
      textBetweenStepsInFold: between !== undefined && turn.contains(between),
      thought: turn.querySelector('.chat-step.is-thinking .chat-step-summary')?.textContent ?? null,
      toolRows: [...turn.querySelectorAll('.chat-step.is-tools .chat-step-label')].map((label) => label.textContent),
      mascotsLeft: document.querySelectorAll('.chat-transcript :is(.chat-mascot, .adcode-mascot)').length,
    });
  })()`);
  // Unfolding shows the steps again; opening a step shows its calls.
  checks.unfolds = await browser.evaluate(`(async () => {
    const turn = document.querySelector('.chat-turn[data-state="done"]');
    turn.querySelector('.chat-turn-toggle').click();
    turn.querySelector('.chat-step.is-tools .chat-step-row').click();
    turn.querySelector('.chat-step.is-thinking .chat-step-row').click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const call = turn.querySelector('.chat-step.is-tools .chat-step-call');
    return turn.dataset.collapsed === 'false' && call !== null && call.getBoundingClientRect().height > 0 && call.dataset.state === 'done';
  })()`);
  await shot("chat-timeline");
  const project = await browser.evaluate("window.adcode.workspace.current()");
  checks.projectCreated = project?.name ?? null;
  checks.sidebarShowsProject = await browser.evaluate(`document.querySelector('.vibe-sidebar')?.textContent.includes(${JSON.stringify(project?.name ?? "?")}) ?? false`);
  await sleep(800);
  await shot("chat");

  const sep = project.root.includes("\\") ? "\\" : "/";
  const file = await browser.evaluate(`window.adcode.files.read(${JSON.stringify(`${project.root}${sep}index.html`)}).then((content) => content.text ?? content.content ?? JSON.stringify(content))`);
  checks.fileWritten = typeof file === "string" && file.includes("Fresh bread daily");

  const preview = await browser.evaluate("window.adcode.preview.start().then((status) => status)");
  let previewUrl = preview?.url ?? null;
  for (let attempt = 0; previewUrl === null && attempt < 40; attempt += 1) {
    await sleep(500);
    previewUrl = (await browser.evaluate("window.adcode.preview.status()"))?.url ?? null;
  }
  checks.previewUrl = previewUrl;
  checks.previewServes = previewUrl === null ? false : (await (await fetch(previewUrl)).text()).includes("Fresh bread daily");

  // The user sees the same Chromium session used by view_page, beside the chat.
  await browser.viewport(1440, 900);
  await browser.evaluate("document.querySelector('.workspace-control-trigger').click()");
  checks.workspaceMenu = await browser.waitFor("document.querySelector('.workspace-control-panel:popover-open') !== null");
  await shot("workspace-menu");
  await browser.evaluate("[...document.querySelectorAll('.workspace-control-panel button')].find(b => b.textContent === 'Browser').click()");
  checks.browserFollowsAgent = await browser.waitFor("document.querySelector('.agent-browser-image')?.src.startsWith('data:image/') && document.querySelector('.agent-browser-report').textContent.includes('Fresh bread daily')");
  checks.noNestedWorkspaceFrame = await browser.evaluate("[document.querySelector('.main'),document.querySelector('#workbench')].every(e=>parseFloat(getComputedStyle(e).borderTopWidth)===0 && getComputedStyle(e).boxShadow==='none')");
  checks.browserDocked = await browser.evaluate("document.querySelector('#floating-browser').classList.contains('workspace-panel-docked') && document.querySelector('#floating-browser').getBoundingClientRect().left >= document.querySelector('.vibe-workspace').getBoundingClientRect().right");
  await shot("browser-docked");
  // Exercise the newly consolidated divider with real pointer and keyboard input.
  const divider = await browser.evaluate(`(() => {
    const edge = document.querySelector('#workspace-review-splitter').getBoundingClientRect();
    return { x: edge.left + edge.width / 2, y: edge.top + Math.min(100, edge.height / 2), width: document.querySelector('#floating-browser').getBoundingClientRect().width };
  })()`);
  await browser.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: divider.x, y: divider.y, button: 'left', buttons: 1, clickCount: 1 });
  await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: divider.x - 80, y: divider.y, button: 'left', buttons: 1 });
  await browser.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: divider.x - 80, y: divider.y, button: 'left', buttons: 0, clickCount: 1 });
  checks.reviewResizes = await browser.waitFor(`!document.body.dataset.resizing && document.querySelector('#floating-browser').getBoundingClientRect().width > ${divider.width + 60}`);
  await browser.evaluate("document.querySelector('#workspace-review-splitter').focus()");
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  await browser.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 });
  checks.reviewKeyboardReset = await browser.waitFor(`Math.abs(document.querySelector('#floating-browser').getBoundingClientRect().width - ${divider.width}) < 3`);
  checks.browserNavigation = await browser.evaluate(`window.adcode.browser.view({url:${JSON.stringify(previewUrl)}, screenshot:true}).then(v => v.report.includes('Fresh bread daily') && v.image?.startsWith('data:image/'))`);
  checks.staleBrowserClickRejected = await browser.evaluate("window.adcode.browser.view({expectedUpdatedAt:1,actions:[{type:'eval',expression:'document.body.textContent=\"Wrong page\"'}]}).then(() => false, e => e.message.includes('changed the page'))");
  const fixture = "document.body.innerHTML = '<button style=\"position:fixed;left:20px;top:20px\" onclick=\"this.textContent=String(40+2)\">Click me</button><input aria-label=\"Browser test field\" style=\"position:fixed;left:20px;top:90px\">'; true";
  await browser.evaluate(`window.adcode.browser.view({actions:[{type:'eval',expression:${JSON.stringify(fixture)}}],width:800,height:600,screenshot:true})`);
  await browser.waitFor("document.querySelector('.agent-browser-report').textContent.includes('Click me')");
  const clickPage = async (x,y) => browser.evaluate(`(() => { const img=document.querySelector('.agent-browser-image'), r=img.getBoundingClientRect(); img.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+${x}/800*r.width,clientY:r.top+${y}/800*r.width})); return true; })()`);
  await clickPage(45,30);
  checks.browserClickWorks = await browser.waitFor("document.querySelector('.agent-browser-report').textContent.includes('42') && !document.querySelector('.agent-browser').dataset.busy");
  await clickPage(50,100);
  await browser.waitFor("!document.querySelector('.agent-browser').dataset.busy");
  await browser.evaluate("(() => { document.querySelector('.agent-browser-input input').value='Shared browser works'; document.querySelector('.agent-browser-input').requestSubmit(); return true; })()");
  checks.browserTypeWorks = await browser.waitFor("document.querySelector('.agent-browser-report').textContent.includes('Shared browser works') && !document.querySelector('.agent-browser').dataset.busy");
  await browser.evaluate(`window.adcode.browser.view({url:${JSON.stringify(previewUrl)},screenshot:true})`);
  await browser.viewport(390,844,true);
  checks.browserMobileFits = await browser.evaluate("document.querySelector('#floating-browser').getBoundingClientRect().width <= innerWidth && !document.querySelector('#floating-browser').inert");
  await shot("browser-phone");
  await browser.viewport(1440,900);
  await browser.evaluate("document.querySelector('#floating-browser .floating-panel-close').click()");
  checks.browserCloses = await browser.waitFor("document.querySelector('#floating-browser').hidden && !document.body.classList.contains('workspace-review-open')");
  checks.usageRingsRemoved = await browser.evaluate("document.querySelector('.composer-usage, .context-meter-ring') === null");

  const status = await browser.evaluate("window.adcode.git.status()");
  checks.changesShowsFile = JSON.stringify(status ?? null).includes("index.html");
  await browser.evaluate("window.adcode.git.stage(['index.html'])").catch(() => null);
  const committed = await browser.evaluate("window.adcode.git.commit('Bakery page from the web smoke').then(() => window.adcode.git.log(1))").catch((error) => String(error));
  checks.commitWorks = JSON.stringify(committed).includes("Bakery page from the web smoke");

  checks.uploadWorks = await browser.evaluate(`(async () => {
    const root = await window.__adcodeTestOp("createProjectFolder", ["Uploaded site"]);
    await window.__adcodeTestOp("writeFile", [root, "css/site.css", new TextEncoder().encode("h1 { color: red }")]);
    const escaped = await window.__adcodeTestOp("writeFile", [root, "../outside.txt", new Uint8Array([1])]).then(() => true, () => false);
    const projects = await window.__adcodeTestOp("projects", []);
    return projects.some((project) => project.name === "uploaded-site") && !escaped;
  })()`);
  const download = await browser.evaluate("fetch('/__adcode/download?project=uploaded-site').then(async (response) => ({ status: response.status, bytes: (await response.arrayBuffer()).byteLength }))");
  checks.downloadWorks = download.status === 200 && download.bytes > 50;

  const before = await browser.evaluate("window.adcode.chat.sessions().then((sessions) => sessions.length)");
  await browser.evaluate("window.__adcodeTestDrop(); true");
  await sleep(300);
  const after = await browser.evaluate("window.adcode.chat.sessions().then((sessions) => sessions.length)", { timeoutMs: 30_000 });
  checks.reconnectRestores = before > 0 && after === before;

  /* ── Chats that keep working ──────────────────────────────────────────── */

  /** Where the run is, as it goes: a smoke that hangs says where. */
  const phase = async (name) => console.log(`[smoke ${new Date().toISOString().slice(11, 19)}] ${name} - runs: ${JSON.stringify(await browser.evaluate("window.adcode.ai.runs().then((runs) => runs.map((run) => run.title + (run.shown ? ' (shown)' : '')))").catch(() => "?"))}`);

  const newChat = () => browser.evaluate(`(() => { document.querySelector('[aria-label="Start a new conversation"]').click(); return true; })()`);
  const sendInChat = (text) => browser.evaluate(`(() => {
    const input = document.querySelector('.chat-card .chat-input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-toolbar .chat-send').click();
    return true;
  })()`);
  const bubbleSays = (words) => `[...document.querySelectorAll('.chat-bubble-assistant')].some((bubble) => bubble.textContent.includes(${JSON.stringify(words)}))`;
  // A chat's mark in the list, as drawn: the right kind, a real size, and a colour that shows.
  // (A spinner once passed every check while drawn in a colour that did not exist there.)
  const markDrawn = (id, status) => `(() => {
    const icon = document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(id)}] .chat-history-status');
    if (icon === null || icon.dataset.status !== ${JSON.stringify(status)}) return false;
    const mark = getComputedStyle(icon, '::before');
    const ink = ${JSON.stringify(status)} === 'working' ? mark.borderTopColor : mark.backgroundColor;
    const box = icon.getBoundingClientRect();
    return box.width > 0 && getComputedStyle(icon).display !== 'none' && parseFloat(mark.width) >= 6 && ink !== 'rgba(0, 0, 0, 0)' && ink !== 'transparent';
  })()`;
  /** The conversation list, at twice its size, to see the marks themselves. */
  const listShot = async (name) => {
    if (SHOTS === null) return;
    const box = await browser.evaluate("(() => { const list = document.querySelector('.vibe-history-host') ?? document.querySelector('.chat-history'); const r = list?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, Math.min(r.height, 400)) } : null; })()");
    if (box === null) return;
    const { data } = await browser.cdp("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    await writeFile(join(SHOTS, `web-${name}.png`), Buffer.from(data, "base64"));
  };

  // One chat working slowly; a second sent while it works, which finishes first.
  await newChat();
  await sleep(300);
  await sendInChat(`${SLOW_PROMPT}: take your time`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const slowId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  await sleep(300);
  await sendInChat(`${FAST_PROMPT}: quick one`);
  checks.twoChatsAtOnce = await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 2)", { timeoutMs: 10_000 });
  checks.fastChatAnswered = await browser.waitFor(bubbleSays("Fast chat done."), { timeoutMs: 20_000 });
  checks.slowChatStillWorking = await browser.evaluate(`window.adcode.ai.runs().then((runs) => runs.some((run) => run.sessionId === ${JSON.stringify(slowId)}))`);
  checks.slowChatMarkedWorking = await browser.waitFor(markDrawn(slowId, "working"), { timeoutMs: 5_000 });
  await shot("chats-at-once");
  await listShot("list-working");
  // Opening the working chat shows its turn so far, then its answer when it comes.
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(slowId)}] .chat-history-open').click(); return true; })()`);
  checks.workingChatReplays = await browser.waitFor(`document.querySelector('.chat-turn[data-state="running"]') !== null || ${bubbleSays("Slow chat done.")}`, { timeoutMs: 10_000 });
  checks.slowChatAnswered = await browser.waitFor(bubbleSays("Slow chat done."), { timeoutMs: 20_000 });
  checks.fastAnswerNotInSlowChat = !(await browser.evaluate(bubbleSays("Fast chat done.")));
  await phase("failing chat");
  // A chat that fails while another is on screen is marked as needing the person, not as done.
  await newChat();
  await sleep(300);
  await sendInChat(`${FAIL_PROMPT}: this one will not work`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const failId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 30_000 });
  checks.failedChatMarked = await browser.waitFor(markDrawn(failId, "attention"), { timeoutMs: 5_000 });
  await phase("left chat");
  // A chat left while it works, that finishes elsewhere: a dot, until it is opened.
  await sendInChat(`${SLOW_PROMPT}: and another one`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const leftId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await newChat();
  checks.leftChatSpinsThenDots = await browser.waitFor(markDrawn(leftId, "working"), { timeoutMs: 5_000 });
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 30_000 });
  checks.leftChatSpinsThenDots = checks.leftChatSpinsThenDots && await browser.waitFor(markDrawn(leftId, "finished"), { timeoutMs: 5_000 });
  await listShot("list-finished");
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(leftId)}] .chat-history-open').click(); return true; })()`);
  checks.dotClearsWhenOpened = await browser.waitFor(`document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(leftId)}] .chat-history-status')?.dataset.status !== 'finished'`, { timeoutMs: 5_000 });

  await phase("long job");
  // A long job past its step limit, with the page frozen solid: only the main process can
  // carry it on. The page comes back to the finished answer.
  await newChat();
  await sleep(300);
  await sendInChat(`${LONG_PROMPT}: list everything, over and over`);
  await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 1)", { timeoutMs: 15_000 });
  const longId = await browser.evaluate("window.adcode.ai.runs().then((runs) => runs[0]?.sessionId ?? null)");
  await browser.cdp("Page.setWebLifecycleState", { state: "frozen" });
  const frozenAt = Date.now();
  for (let waited = 0; keptGoingAt === 0 && waited < 120_000; waited += 250) await sleep(250);
  await sleep(1_000);
  await browser.cdp("Page.setWebLifecycleState", { state: "active" });
  checks.keptGoingWhilePageFrozen = keptGoingAt > frozenAt;
  await phase("coming back");
  // Coming back. The dev server reloads a page whose live-reload socket dropped while it was
  // frozen - which is the tab coming back after being away, so the job must be there either way.
  await sleep(1_500);
  if (await browser.evaluate("document.querySelector('.web-gate-card') !== null")) {
    await browser.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode'))?.click(); return true; })()`);
    await browser.waitFor("document.querySelector('.vibe-pages') && document.body.dataset.sessionReady === 'true'", { timeoutMs: 90_000 });
  }
  await browser.waitFor(`document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(longId)}] .chat-history-open') !== null`, { timeoutMs: 20_000 });
  await browser.evaluate(`(() => { document.querySelector('.chat-history-row[data-session-id=${JSON.stringify(longId)}] .chat-history-open').click(); return true; })()`);
  checks.longJobFinished = await browser.waitFor(bubbleSays("Kept going and finished."), { timeoutMs: 30_000 });
  checks.noChatLeftWorking = await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 10_000 });
  await shot("kept-going");

  // Account controls open inside Vibe and leave the current conversation intact.
  const accountShadow = "document.querySelector('.web-account-dialog > div')?.shadowRoot";
  const currentChat = await browser.evaluate("window.adcode.chat.current().then(session => session?.id ?? null)");
  await browser.evaluate("document.querySelector('[data-rail=account]').click()");
  checks.accountOpens = await browser.waitFor(`${accountShadow}?.querySelector('.account-shell')`);
  checks.accountSections = await browser.evaluate(`[...${accountShadow}.querySelectorAll('.account-nav > button')].map(button => button.textContent.replace('↗', '').trim()).join('|')`);
  checks.accountLocalHonest = await browser.evaluate(`${accountShadow}.textContent.includes("You're exploring a local workspace")`);
  await shot("account");
  await browser.viewport(390, 844, true);
  checks.accountMobileFits = await browser.evaluate(`(() => { const panel = document.querySelector('.web-account-dialog'); return panel.getBoundingClientRect().width <= innerWidth && ${accountShadow}.querySelector('.account-main').scrollWidth <= ${accountShadow}.querySelector('.account-main').clientWidth; })()`);
  await shot("account-phone");
  await browser.evaluate(`${accountShadow}.querySelector('.account-back').click()`);
  checks.accountDisposed = await browser.waitFor("document.querySelector('.web-account-dialog') === null");
  checks.accountChatPreserved = currentChat !== null && currentChat === await browser.evaluate("window.adcode.chat.current().then(session => session?.id ?? null)");
  checks.accountAnswerVisible = await browser.evaluate(bubbleSays("Kept going and finished."));
  checks.accountReturnsToChat = checks.accountDisposed && checks.accountChatPreserved && checks.accountAnswerVisible;
  await browser.viewport(1440, 1000, false);

  await phase("helpers");
  // A turn that hands work to two sub-agents: a row each while they run - title, mode, live
  // line - then their endings and reports.
  await newChat();
  await sleep(300);
  await sendInChat(`${HELPERS_PROMPT}: check the page with helpers`);
  const lastTurn = "[...document.querySelectorAll('.chat-turn')].at(-1)";
  // The row is live once a status line has reached it (its detail is empty until then).
  checks.helpersWhileWorking = await browser.waitFor(`${lastTurn}?.querySelector('.chat-step.is-helpers .chat-helper[data-state="running"] .chat-helper-detail:not(:empty)') != null`, { timeoutMs: 90_000 });
  checks.helperRowsWhileWorking = await browser.evaluate(`(() => {
    const step = ${lastTurn}?.querySelector('.chat-step.is-helpers');
    if (step == null) return null;
    return {
      titles: [...step.querySelectorAll('.chat-helper-title')].map((title) => title.textContent),
      modes: [...step.querySelectorAll('.chat-helper-mode')].map((mode) => mode.textContent),
      spinning: step.querySelectorAll('.chat-helper[data-state="running"] .chat-pixel-spinner').length,
      details: [...step.querySelectorAll('.chat-helper-detail')].map((detail) => detail.textContent),
      liveSummary: step.querySelector('.chat-step-summary')?.textContent ?? "",
    };
  })()`);
  await shot("chat-helpers-working");
  checks.helpersAnswered = await browser.waitFor(bubbleSays("Helpers checked the page."), { timeoutMs: 90_000 });
  // All helpers ended: checks and call counts, the report a click away. The collapses animate
  // on the frame clock, and a headless browser can hold frames back, so each step waits for the
  // open geometry itself rather than for a fixed time.
  checks.helpersSettle = await browser.evaluate(`(async () => {
    const turn = ${lastTurn};
    const step = turn?.querySelector('.chat-step.is-helpers');
    if (step == null) return null;
    const rows = [...step.querySelectorAll('.chat-helper')];
    const settle = async (condition) => {
      const deadline = performance.now() + 15_000;
      while (performance.now() < deadline) {
        if (condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return condition();
    };
    // The turn ends folded; unfold it, open the helpers step, then the first report.
    turn.querySelector('.chat-turn-toggle').click();
    step.querySelector('.chat-step-row').click();
    const collapse = step.querySelector('.chat-step-collapse');
    const stepOpen = await settle(() => collapse.getBoundingClientRect().height > 0);
    await settle(() => step.querySelector('.chat-step-detail').getBoundingClientRect().height > 0);
    const report = rows[0].querySelector('.chat-helper-report');
    rows[0].querySelector('.chat-helper-row').click();
    const reportOpen = await settle(() => report.getBoundingClientRect().height > 0);
    const box = report.getBoundingClientRect();
    // How many frames this browser produced in half a second: if this is tiny, the collapses
    // above opened on a starved frame clock, not promptly - useful when a check goes red.
    const framesInHalfASecond = await new Promise((resolve) => {
      let ticks = 0;
      let live = true;
      const tick = () => { if (!live) return; ticks += 1; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      setTimeout(() => { live = false; resolve(ticks); }, 500);
    });
    return {
      states: rows.map((row) => row.dataset.state),
      spinners: step.querySelectorAll('.chat-pixel-spinner').length,
      calls: rows.map((row) => row.querySelector('.chat-helper-calls')?.textContent ?? null),
      summary: step.querySelector('.chat-step-summary')?.textContent ?? "",
      unfolded: turn.dataset.collapsed === "false" && step.dataset.open === "true" && rows[0].dataset.open === "true",
      stepOpen,
      reportOpen,
      framesInHalfASecond,
      reportVisible: report.textContent.includes('src/auth.ts') && box.height > 0,
    };
  })()`);
  await shot("chat-helpers");
  checks.noChatLeftWorkingAfterHelpers = await browser.waitFor("window.adcode.ai.runs().then((runs) => runs.length === 0)", { timeoutMs: 10_000 });

  await phase("phone");
  await browser.viewport(390, 844, true);
  await browser.cdp("Page.bringToFront");
  await browser.evaluate(`(() => { if (document.body.dataset.vibeDrawer === 'open') document.querySelector('.web-sidebar-close')?.click(); return true; })()`);
  checks.phoneReadable = await browser.waitFor(`(() => {
    const sidebar = document.querySelector('.vibe-sidebar');
    const scrim = document.querySelector('.vibe-drawer-scrim');
    const transcript = document.querySelector('.vibe-workspace .chat-transcript');
    if (!sidebar || !transcript || document.body.dataset.vibeRail !== 'compact' || document.body.dataset.vibeDrawer === 'open') return false;
    const hidden = element => !element || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden' || Number(getComputedStyle(element).opacity) === 0;
    const bounds = transcript.getBoundingClientRect();
    return (hidden(sidebar) || sidebar.getBoundingClientRect().right <= 1)
      && hidden(scrim) && bounds.width >= innerWidth - 40 && bounds.height > 0
      && bounds.left >= -1 && bounds.right <= innerWidth + 1;
  })()`, { timeoutMs: 15_000 });
  checks.phoneLayout = await browser.evaluate(`(() => {
    const describe = element => element ? {
      bounds: element.getBoundingClientRect().toJSON(),
      display: getComputedStyle(element).display,
      visibility: getComputedStyle(element).visibility,
      opacity: getComputedStyle(element).opacity,
      hiddenParent: element.closest('[hidden]')?.className ?? null,
    } : null;
    return {
      viewport: innerWidth,
      drawer: document.body.dataset.vibeDrawer,
      rail: document.body.dataset.vibeRail,
      sidebar: describe(document.querySelector('.vibe-sidebar')),
      scrim: describe(document.querySelector('.vibe-drawer-scrim')),
      transcripts: [...document.querySelectorAll('.chat-transcript')].map(describe),
    };
  })()`);
  await shot("phone");
  checks.phoneOverflow = await browser.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
  checks.modelRequests = requests.length;
  checks.viewPageSawPage = viewPageReport.includes("Fresh bread daily") || viewPageReport.includes("Bakery smoke");
  if (!checks.viewPageSawPage) checks.viewPageReport = viewPageReport.slice(0, 400);
  checks.consoleErrors = browser.consoleErrors.filter((text) => !/127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|Failed to load resource/.test(text));
} catch (error) {
  checks.threw = String(error?.stack ?? error);
  // What the page looked like when it went wrong: enough to tell a product bug from a test one.
  checks.consoleErrors = browser.consoleErrors;
  checks.pageAtFailure = await browser.evaluate(`({
    transcript: document.querySelector('.chat-transcript')?.innerText.slice(-1500) ?? null,
    history: [...document.querySelectorAll('.chat-history-row')].map((row) => row.dataset.sessionId + ' ' + (row.querySelector('.chat-history-status')?.dataset.status ?? '')),
    dialogs: [...document.querySelectorAll('dialog[open]')].map((dialog) => dialog.className),
  })`).catch((reason) => String(reason));
  checks.runsAtFailure = await browser.evaluate("window.adcode.ai.runs()").catch((reason) => String(reason));
} finally {
  await browser.close();
  stack.kill();
  fake.close();
  await sleep(500);
  await rm(home, { recursive: true, force: true }).catch(() => undefined);
}

/*
 * When the cloud refuses a tab - here, today's time is spent - the sandbox never says hello.
 * The page must still say why, not sit on "Waking your workspace…" for ever.
 */
if (checks.threw === undefined) {
  const { WebSocketServer } = require("ws");
  const refuser = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  refuser.on("connection", (socket) => {
    socket.send(JSON.stringify({ t: "cloud", status: { state: "spent", allowanceMs: 3_600_000, usedMs: 3_600_000, resetsAt: Date.now() + 3_600_000 } }));
    socket.close(4429, "spent");
  });
  await new Promise((resolve) => refuser.once("listening", resolve));
  const refusedPort = String(Number(WEB_PORT) + 1);
  const page = spawn(process.execPath, [vite, "--config", "apps/desktop/vite.web.config.ts", "--port", refusedPort, "--strictPort"], {
    env: { ...process.env, ADCODE_HOST_PORT: String(refuser.address().port) },
    stdio: "ignore",
  });
  const second = await launchBrowser({ port: Number(process.env["ADCODE_SMOKE_PORT"] ?? 9473) + 1 });
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(`http://127.0.0.1:${refusedPort}/`)).ok) break;
      } catch {
        // starting
      }
      await sleep(500);
    }
    await second.goto(`http://localhost:${refusedPort}/`);
    await second.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60_000 });
    await second.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode'))?.click(); return true; })()`);
    checks.refusalExplained = await second.waitFor("document.querySelector('#web-gate')?.textContent.includes(\"That's this session's cloud time\")", { timeoutMs: 30_000 });
    if (SHOTS !== null) await second.screenshot(join(SHOTS, "web-refused.png"));
  } catch (error) {
    checks.refusalExplained = `THREW: ${error}`;
  } finally {
    await second.close();
    page.kill();
    refuser.close();
  }
}

console.log(JSON.stringify(checks, null, 2));
const passed = checks.accountOpens && checks.accountLocalHonest && checks.accountMobileFits && checks.accountReturnsToChat && checks.accountSections === "Overview|Earnings|Invites|Payouts|Activity|Ledger|Email preferences" && checks.threw === undefined && checks.gateShown && checks.gateDevMode && checks.vibeVisible && checks.onboardingAsks && checks.modelReady && checks.sidebarShowsProject &&
  checks.chatReply && checks.fileWritten && checks.previewServes && checks.changesShowsFile && checks.commitWorks &&
  checks.workspaceMenu && checks.browserFollowsAgent && checks.noNestedWorkspaceFrame && checks.browserDocked &&
  checks.reviewResizes && checks.reviewKeyboardReset && checks.browserNavigation && checks.staleBrowserClickRejected &&
  checks.browserClickWorks && checks.browserTypeWorks && checks.browserMobileFits && checks.browserCloses && checks.usageRingsRemoved &&
  checks.timelineWhileWorking && checks.liveHeading === "Working" && checks.spinnerAtFoot && checks.mascotsWhileWorking <= 1 &&
  checks.timeline?.heading === "Worked" && checks.timeline.folded && checks.timeline.answerOutsideFold && checks.timeline.textBetweenStepsInFold &&
  checks.timeline.thought === "Planning the bakery page" && checks.timeline.mascotsLeft === 0 && checks.unfolds &&
  checks.twoChatsAtOnce && checks.fastChatAnswered && checks.slowChatStillWorking && checks.slowChatMarkedWorking && checks.workingChatReplays &&
  checks.slowChatAnswered && checks.fastAnswerNotInSlowChat && checks.failedChatMarked && checks.leftChatSpinsThenDots && checks.dotClearsWhenOpened && checks.keptGoingWhilePageFrozen && checks.longJobFinished && checks.noChatLeftWorking &&
  checks.helpersWhileWorking && checks.helperRowsWhileWorking?.titles?.join("|") === "Map the auth flow|Write the tests" && checks.helperRowsWhileWorking?.modes?.join("|") === "explore|build" &&
  checks.helperRowsWhileWorking?.spinning >= 1 && checks.helperRowsWhileWorking?.details?.some((text) => text.length > 0) &&
  checks.helpersAnswered && checks.helpersSettle?.states?.join("|") === "done|done" && checks.helpersSettle?.spinners === 0 && checks.helpersSettle?.calls?.join("|") === "0 calls|1 call" &&
  checks.helpersSettle?.summary === "all 2 finished" && checks.helpersSettle?.unfolded === true && checks.helpersSettle?.stepOpen === true && checks.helpersSettle?.reportOpen === true && checks.helpersSettle?.reportVisible === true && checks.noChatLeftWorkingAfterHelpers &&
  checks.reconnectRestores && checks.uploadWorks && checks.downloadWorks && checks.viewPageSawPage && checks.refusalExplained === true && checks.phoneOverflow === 0 && checks.phoneReadable === true && checks.consoleErrors.length === 0;
if (!passed) {
  console.log("--- stack log (tail) ---");
  console.log(stackLog.slice(-4000));
}
process.exit(passed ? 0 : 1);
