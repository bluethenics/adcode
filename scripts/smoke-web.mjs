/*
 * The web version, end to end: its main process in the tab (src/browserHost), projects from GitHub.
 *
 *   npm run smoke:web                (builds the browser host first)
 *   npm run smoke:web -- --no-build
 *
 * Starts the web page (`scripts/web-vibe.mjs`), a fake
 * OpenAI-compatible model and a fake of the cloud Worker's GitHub routes, then in headless Edge:
 * signs in (dev mode), opens a repository from GitHub through Open a project, asks the assistant
 * to change it, sees the change under git status, commits it as a pull request, has it build a page
 * and sees that page in Preview - served from the tab's own files by the preview origin's Service
 * Worker, styled, and reloading by itself on the next edit - then reloads and finds the project and
 * the chat still there.
 *
 * Read the printed values, not just the exit code.
 *
 * Env: ADCODE_SMOKE_PORT (9503, DevTools), ADCODE_WEB_PORT (5193), ADCODE_SHOTS (folder for screenshots).
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { launchBrowser } from "./lib/headlessEdge.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const WEB_PORT = process.env["ADCODE_WEB_PORT"] ?? "5193";
const SHOTS = process.env["ADCODE_SHOTS"] ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.browserHost.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

/* ── A fake model: edits the README, then builds a page, when asked ───── */

const PROMPT = "web-smoke: say the bakery opens daily";
const README = "# Bakery\n\nFresh bread daily, from 7am.\n";
// A root-relative stylesheet, as people write them: the preview must resolve it against the project.
const PAGE = (extra) => `<!doctype html>\n<html><head><title>Bakery</title><link rel="stylesheet" href="/style.css"></head>\n<body><h1>Bakery</h1><p id="bread">Sourdough every morning.</p>${extra}</body></html>\n`;
const STYLE = "#bread { color: rgb(170, 51, 0); }\n";
/** Each prompt the smoke sends, and the tool calls the fake model answers it with, one per request. */
const SCRIPTS = [
  { prompt: PROMPT, done: "The README now says the bakery opens daily.", steps: [
    { name: "read_file", args: { path: "README.md" } },
    { name: "propose_edit", args: { path: "README.md", contents: README, summary: "Say it opens daily" } },
  ] },
  { prompt: "web-smoke: build the bakery a page", done: "The page lists the sourdough.", steps: [
    { name: "propose_edit", args: { path: "index.html", contents: PAGE(""), summary: "A page for the bakery" } },
    { name: "propose_edit", args: { path: "style.css", contents: STYLE, summary: "Colour the bread" } },
  ] },
  { prompt: "web-smoke: add rye to the page", done: "Rye is on the page now.", steps: [
    { name: "propose_edit", args: { path: "index.html", contents: PAGE('<p id="rye">Rye on Saturdays.</p>'), summary: "Add rye" } },
  ] },
];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
const modelRequests = [];
const model = createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body || "{}");
  modelRequests.push(request);
  const messages = request.messages ?? [];
  const send = (deltas) => {
    const last = deltas.at(-1);
    res.writeHead(200, { "content-type": "text/event-stream", ...cors });
    res.end(`${deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta === last ? (last.tool_calls ? "tool_calls" : "stop") : null }] })}\n\n`).join("")}data: [DONE]\n\n`);
  };
  // The latest prompt picks the script; the tool results since it say which step is next.
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const asked = String(messages[lastUser]?.content ?? "");
  const script = SCRIPTS.find((candidate) => asked.includes(candidate.prompt));
  if (script === undefined) return send([{ content: "ok" }]);
  const tools = messages.slice(lastUser + 1).filter((m) => m.role === "tool").length;
  const step = script.steps[tools];
  if (step === undefined) return send([{ content: script.done }]);
  return send([{ tool_calls: [{ index: 0, id: `${SCRIPTS.indexOf(script)}-${tools}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] }]);
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${model.address().port}/v1`;

/* ── A fake of the cloud Worker's GitHub routes (apps/cloud/src/githubWorkspace.ts) ── */

const FILES = { "README.md": "# Bakery\n\nFresh bread.\n", "index.html": "<h1>Bakery</h1>\n", "src/menu.ts": "export const menu = [\"bread\"];\n" };
const pulls = [];
const github = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url ?? "/", "http://fake");
  const json = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  // The API (/v1) has nothing for this smoke; a 404 is not a refused sign-in.
  if (url.pathname.startsWith("/v1/")) return json(404, { error: "not-found" });
  if (!(req.headers["authorization"] ?? "").startsWith("Bearer ")) return json(401, { error: { code: "unauthenticated", message: "Sign in first." } });
  switch (url.pathname) {
    case "/api/github/status": return json(200, { connected: true, login: "baker" });
    case "/api/github/repos": return json(200, { repos: [{ fullName: "baker/bakery", defaultBranch: "main", private: false, canPush: true, htmlUrl: "https://github.com/baker/bakery" }], nextPage: null });
    case "/api/github/tree": return json(200, { repo: "baker/bakery", ref: url.searchParams.get("ref"), commit: "a".repeat(40), files: Object.keys(FILES).map((path) => ({ path, sha: "b".repeat(40), size: FILES[path].length })), truncated: false });
    case "/api/github/file": {
      const path = url.searchParams.get("path");
      return json(200, { path, sha: "c".repeat(40), content: FILES[path], bytes: FILES[path].length });
    }
    case "/api/github/pull-request": {
      pulls.push(JSON.parse(body));
      return json(200, { url: "https://github.com/baker/bakery/pull/1", branch: "adcode/smoke", number: 1 });
    }
    default: return json(404, { error: { code: "not-found", message: "Not found." } });
  }
});
await new Promise((resolve) => github.listen(0, "127.0.0.1", resolve));

/* ── The page ──────────────────────────────────────────────────────────── */

let stackLog = "";
const stack = spawn(process.execPath, ["scripts/web-vibe.mjs", "--no-build"], {
  // /v1 goes to the fake too: the real API would refuse the smoke's unsigned token, and a refused
  // token is one the worker stops using.
  env: { ...process.env, ADCODE_WEB_PORT: WEB_PORT, ADCODE_WEB_API_ORIGIN: `http://127.0.0.1:${github.address().port}`, ADCODE_ACCOUNT_API_ORIGIN: `http://127.0.0.1:${github.address().port}` },
  stdio: ["ignore", "pipe", "pipe"],
});
stack.stdout.on("data", (chunk) => { stackLog += chunk; });
stack.stderr.on("data", (chunk) => { stackLog += chunk; });
for (let attempt = 0; attempt < 120; attempt += 1) {
  try { if ((await fetch(`http://localhost:${WEB_PORT}/`)).ok) break; } catch { /* starting */ }
  await sleep(500);
}

/** An unsigned token in Firebase's shape: the fake routes take any bearer; the worker reads its claims. */
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const TOKEN = `${b64({ alg: "none" })}.${b64({ sub: "web-smoke-user", exp: Math.floor(Date.now() / 1000) + 3600, email: "smoke@example.com" })}.sig`;

const checks = {};
const browser = await launchBrowser({ port: Number(process.env["ADCODE_SMOKE_PORT"] ?? 9503) });
const shot = async (name) => { if (SHOTS !== null) await browser.screenshot(join(SHOTS, `web-${name}.png`)); };
const signIn = async () => {
  await browser.goto(`http://localhost:${WEB_PORT}/`);
  await browser.waitFor("document.querySelector('.web-gate-card')", { timeoutMs: 60_000 });
  await browser.evaluate(`(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.includes('dev mode'))?.click(); return true; })()`);
  const ready = await browser.waitFor("document.querySelector('.vibe-pages') && document.body.dataset.sessionReady === 'true'", { timeoutMs: 90_000 });
  await browser.evaluate(`window.__adcodeTestAuth(${JSON.stringify(TOKEN)}), true`);
  return ready;
};
/** Sends a chat message and waits for the assistant's closing line. */
const askAssistant = async (prompt, reply) => {
  await browser.evaluate(`(() => {
    const input = document.querySelector('.chat-card .chat-input');
    input.value = ${JSON.stringify(prompt)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-toolbar .chat-send').click();
    return true;
  })()`);
  return browser.waitFor(`[...document.querySelectorAll('.chat-bubble-assistant')].some((b) => b.textContent.includes(${JSON.stringify(reply)}))`, { timeoutMs: 90_000 });
};

/*
 * Runs an expression inside the Preview frame. The frame is on the preview origin, so the page's
 * own script cannot read it - which is the point - and DevTools is asked instead: in the page's
 * process when the frame shares it, or through the frame's own target when it runs out of process.
 */
const DEVTOOLS_PORT = Number(process.env["ADCODE_SMOKE_PORT"] ?? 9503);
const PREVIEW_ORIGIN = `http://preview.localhost:${WEB_PORT}`;
async function inPreview(expression) {
  try {
    const { frameTree } = await browser.cdp("Page.getFrameTree");
    const find = (node) => node.frame.url.startsWith(PREVIEW_ORIGIN + "/preview/") ? node.frame : (node.childFrames ?? []).map(find).find(Boolean);
    const frame = find(frameTree);
    if (frame !== undefined) {
      const { executionContextId } = await browser.cdp("Page.createIsolatedWorld", { frameId: frame.id, worldName: "web-smoke" });
      const result = await browser.cdp("Runtime.evaluate", { expression, contextId: executionContextId, returnByValue: true });
      return result.result?.value ?? null;
    }
  } catch { /* out of process: its own target, below */ }
  const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "iframe" && t.url.startsWith(PREVIEW_ORIGIN + "/preview/"));
  if (target === undefined) return null;
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    const reply = new Promise((resolve) => socket.addEventListener("message", (event) => { const message = JSON.parse(String(event.data)); if (message.id === 1) resolve(message.result?.result?.value ?? null); }));
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
    return await Promise.race([reply, sleep(5_000).then(() => null)]);
  } finally {
    socket.close();
  }
}
const waitInPreview = async (expression, timeoutMs = 30_000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await inPreview(expression).catch(() => null)) === true) return true;
    await sleep(400);
  }
  return false;
};

/** Runs a command from the palette, as a person does: Ctrl+Shift+P, type, pick the first row. */
const runCommand = async (query) => {
  await browser.evaluate("(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true })); return true; })()");
  await sleep(400);
  return browser.evaluate(`(async () => {
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

const clickText = (selector, text) => browser.evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent.includes(${JSON.stringify(text)})); node?.click(); return node !== undefined; })()`);

try {
  await browser.viewport(1280, 820);
  checks.ready = await signIn();
  checks.mode = await browser.evaluate("document.body.dataset.webMode");
  // No loading screen: once the app is up, nothing of the gate is left over it.
  checks.noGateOverApp = await browser.evaluate("document.getElementById('web-gate')?.hidden !== false && document.body.dataset.shell === 'ready'");
  // Ads on the web: the sponsored box above the message box asks the partner page for a card.
  checks.sponsoredFrame = await browser.waitFor("document.querySelector('.chat-sponsor-strip .chat-sponsored-frame')?.src.endsWith('/sponsored/chat') === true", { timeoutMs: 20_000 });
  // Out of the first-run sheet; the project comes from GitHub instead.
  if (await browser.waitFor("document.querySelector('dialog.onboarding')?.open", { timeoutMs: 15_000 })) await clickText("dialog.onboarding button", "Skip");
  await browser.evaluate(`(async () => {
    await window.adcode.settings.write('adcode.ai.customBaseUrl', ${JSON.stringify(endpoint)});
    await window.adcode.settings.write('adcode.ai.provider', 'custom');
    await window.adcode.settings.write('adcode.ai.model', 'smoke-model');
    await window.adcode.settings.write('adcode.ai.editPolicy', 'trusted');
    await window.adcode.ai.setKey('custom', 'local-smoke-key');
    return true;
  })()`);
  checks.modelReady = await browser.waitFor("window.adcode.ai.status().then((s) => s.ready)", { timeoutMs: 20_000 });

  // Open a project -> Open from GitHub -> the repository: the real picker, as a person does it.
  // Through the command palette's Open Folder, so the renderer adopts the project as it does for a
  // person (calling window.adcode.workspace.open directly leaves the Preview pane without one).
  checks.openCommand = await runCommand("Open Folder");
  checks.pickerShown = await browser.waitFor("[...document.querySelectorAll('dialog.web-picker button')].some((b) => b.textContent.includes('Open from GitHub'))", { timeoutMs: 20_000 });
  await clickText("dialog.web-picker button", "Open from GitHub");
  checks.reposListed = await browser.waitFor("[...document.querySelectorAll('.web-github-repo-list button')].some((b) => b.textContent.includes('baker/bakery'))", { timeoutMs: 20_000 });
  await shot("github-repos");
  await clickText(".web-github-repo-list button", "baker/bakery");
  checks.opened = await browser.waitFor("window.adcode.workspace.current().then((w) => w?.root?.endsWith('/bakery') === true)", { timeoutMs: 30_000 });
  checks.gitStatus = await browser.evaluate("window.adcode.git.status().then((s) => ({ isRepo: s.isRepo, branch: s.branch, entries: s.entries.length }))");

  // The assistant reads and edits a file from the repository.
  checks.chatReply = await askAssistant(PROMPT, "opens daily");
  checks.readTheRepoFile = modelRequests.some((r) => (r.messages ?? []).some((m) => m.role === "tool" && String(m.content).includes("Fresh bread.")));
  checks.changes = await browser.evaluate("window.adcode.git.status().then((s) => s.entries.map((e) => e.path + ':' + e.worktree + ':+' + e.added + '-' + e.removed))");
  checks.diffShowsLine = await browser.evaluate("window.adcode.git.diff('README.md').then((d) => d.includes('+Fresh bread daily, from 7am.'))");
  await shot("github-chat");

  // Commit = a pull request with the change, from the commit that was opened.
  checks.commit = await browser.evaluate("window.adcode.git.commit('Say the bakery opens daily').then((r) => r.message)");
  checks.pullRequest = pulls.length === 1 && pulls[0].repo === "baker/bakery" && pulls[0].baseBranch === "main" && pulls[0].baseCommit === "a".repeat(40) && pulls[0].files.length === 1 && pulls[0].files[0].path === "README.md" && pulls[0].files[0].content === README;

  // The assistant builds a page, and Preview shows it - with no server anywhere: the preview
  // origin's Service Worker answers from the files in this tab (src/browserHost/liveServer.ts).
  checks.pageReply = await askAssistant("web-smoke: build the bakery a page", "lists the sourdough");
  // The Preview button is an icon (its name is its aria-label): the one on screen, as a person presses it.
  checks.previewButton = await browser.evaluate("(() => { const button = [...document.querySelectorAll('button.web-tabs-preview, button.vibe-topbar-preview, button.vibe-preview-nav')].find((b) => b.offsetParent !== null); button?.click(); return button?.getAttribute('aria-label') ?? null; })()");
  checks.previewUrl = await browser.waitFor(`document.querySelector('.preview-frame')?.getAttribute('src') === ${JSON.stringify(`${PREVIEW_ORIGIN}/preview/bakery/`)}`, { timeoutMs: 20_000 })
    ? await browser.evaluate("document.querySelector('.preview-frame').getAttribute('src')")
    : await browser.evaluate("window.adcode.preview.status().then((s) => String(s.url) + ' ' + String(s.error))");
  checks.previewShowsPage = await waitInPreview("document.querySelector('#bread')?.textContent === 'Sourdough every morning.'");
  // The root-relative /style.css came from the project too.
  checks.previewStyled = await inPreview("getComputedStyle(document.querySelector('#bread')).color").catch(() => null);
  // On its own origin: the project's script cannot reach into ADCode's page.
  checks.previewIsolated = await inPreview("(() => { try { return window.parent.document ? 'same origin' : 'none'; } catch { return location.origin; } })()").catch(() => null);
  await shot("preview");
  // The next edit reloads the frame by itself.
  checks.ryeReply = await askAssistant("web-smoke: add rye to the page", "Rye is on the page");
  checks.previewReloaded = await waitInPreview("document.querySelector('#rye')?.textContent === 'Rye on Saturdays.'");

  // Everything lives in this tab's storage: a reload brings the project and the chat back.
  await sleep(1_500);
  checks.reloaded = await signIn();
  checks.projectsAfterReload = await browser.evaluate("window.__adcodeTestOp('projects', []).then((p) => p.map((x) => x.name))");
  // Chats belong to their project: open it again, then count them.
  checks.chatsAfterReload = await browser.evaluate("window.__adcodeTestOp('projects', []).then(async (p) => { await window.adcode.workspace.openPath(p[0].path); return (await window.adcode.chat.sessions()).length; })");
  checks.consoleErrors = await browser.evaluate("(window.__adcodeConsoleErrors ?? []).length");
} catch (error) {
  checks.threw = String(error);
} finally {
  console.log(JSON.stringify(checks, null, 2));
  await browser.close().catch(() => undefined);
  stack.kill();
  model.close();
  github.close();
}

const passed = checks.threw === undefined && checks.ready && checks.mode === "browser-host" && checks.noGateOverApp && checks.sponsoredFrame && checks.modelReady && checks.pickerShown && checks.reposListed && checks.opened &&
  checks.gitStatus?.isRepo === true && checks.gitStatus?.branch === "main" && checks.gitStatus?.entries === 0 &&
  checks.chatReply && checks.readTheRepoFile && checks.changes?.join("|") === "README.md:modified:+1-1" && checks.diffShowsLine &&
  typeof checks.commit === "string" && checks.commit.includes("pull/1") && checks.pullRequest &&
  checks.pageReply && checks.previewUrl === `${PREVIEW_ORIGIN}/preview/bakery/` && checks.previewShowsPage && checks.previewStyled === "rgb(170, 51, 0)" &&
  checks.previewIsolated === PREVIEW_ORIGIN && checks.ryeReply && checks.previewReloaded &&
  checks.reloaded && checks.projectsAfterReload?.includes("bakery") && checks.chatsAfterReload >= 1;
if (!passed) console.log(`--- stack log (tail) ---\n${stackLog.slice(-3000)}`);
process.exit(passed ? 0 : 1);
