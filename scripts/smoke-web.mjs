/*
 * The web version, end to end: its main process in the tab (src/browserHost), projects from GitHub.
 *
 *   npm run smoke:web                (builds the browser host first)
 *   npm run smoke:web -- --no-build
 *
 * Starts the web page (`scripts/web-vibe.mjs`, whose adcode-host this never connects to), a fake
 * OpenAI-compatible model and a fake of the cloud Worker's GitHub routes, then in headless Edge:
 * signs in (dev mode), opens a repository from GitHub through Open a project, asks the assistant
 * to change it, sees the change under git status, commits it as a pull request, reloads and finds
 * the project and the chat still there.
 *
 * Read the printed values, not just the exit code.
 *
 * Env: ADCODE_SMOKE_PORT (9503, DevTools), ADCODE_WEB_PORT (5193), ADCODE_SHOTS (folder for screenshots).
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { launchBrowser } from "./lib/headlessEdge.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const vite = join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
const WEB_PORT = process.env["ADCODE_WEB_PORT"] ?? "5193";
const HOST_PORT = "7350";
const SHOTS = process.env["ADCODE_SHOTS"] ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.argv.includes("--no-build")) {
  const built = spawnSync(process.execPath, [vite, "build", "-c", "apps/desktop/vite.browserHost.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (built.status !== 0) process.exit(built.status ?? 1);
}

/* ── A fake model: edits the README when asked, then says so ───────────── */

const PROMPT = "web-smoke: say the bakery opens daily";
const README = "# Bakery\n\nFresh bread daily, from 7am.\n";
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
  if (!messages.some((m) => m.role === "user" && String(m.content).includes(PROMPT))) return send([{ content: "ok" }]);
  const tools = messages.filter((m) => m.role === "tool").length;
  if (tools === 0) return send([{ tool_calls: [{ index: 0, id: "r1", function: { name: "read_file", arguments: JSON.stringify({ path: "README.md" }) } }] }]);
  if (tools === 1) return send([{ tool_calls: [{ index: 0, id: "w1", function: { name: "propose_edit", arguments: JSON.stringify({ path: "README.md", contents: README, summary: "Say it opens daily" }) } }] }]);
  return send([{ content: "The README now says the bakery opens daily." }]);
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

const home = await mkdtemp(join(tmpdir(), "adcode-web-smoke-"));
let stackLog = "";
const stack = spawn(process.execPath, ["scripts/web-vibe.mjs", "--no-build"], {
  // /v1 goes to the fake too: the real API would refuse the smoke's unsigned token, and a refused
  // token is one the worker stops using.
  env: { ...process.env, ADCODE_HOME: home, ADCODE_HOST_PORT: HOST_PORT, ADCODE_WEB_PORT: WEB_PORT, ADCODE_WEB_API_ORIGIN: `http://127.0.0.1:${github.address().port}`, ADCODE_ACCOUNT_API_ORIGIN: `http://127.0.0.1:${github.address().port}` },
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
const clickText = (selector, text) => browser.evaluate(`(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) => n.textContent.includes(${JSON.stringify(text)})); node?.click(); return node !== undefined; })()`);

try {
  await browser.viewport(1280, 820);
  checks.ready = await signIn();
  checks.mode = await browser.evaluate("document.body.dataset.webMode");
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
  void browser.evaluate("window.adcode.workspace.open({ newWindowIfOpen: true }).then((opened) => { window.__opened = opened; })", { awaitPromise: false }).catch(() => undefined);
  checks.pickerShown = await browser.waitFor("[...document.querySelectorAll('dialog.web-picker button')].some((b) => b.textContent.includes('Open from GitHub'))", { timeoutMs: 20_000 });
  await clickText("dialog.web-picker button", "Open from GitHub");
  checks.reposListed = await browser.waitFor("[...document.querySelectorAll('.web-github-repo-list button')].some((b) => b.textContent.includes('baker/bakery'))", { timeoutMs: 20_000 });
  await shot("github-repos");
  await clickText(".web-github-repo-list button", "baker/bakery");
  checks.opened = await browser.waitFor("window.__opened?.root?.endsWith('/bakery') === true", { timeoutMs: 30_000 });
  checks.gitStatus = await browser.evaluate("window.adcode.git.status().then((s) => ({ isRepo: s.isRepo, branch: s.branch, entries: s.entries.length }))");

  // The assistant reads and edits a file from the repository.
  await browser.evaluate(`(() => {
    const input = document.querySelector('.chat-card .chat-input');
    input.value = ${JSON.stringify(PROMPT)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.chat-toolbar .chat-send').click();
    return true;
  })()`);
  checks.chatReply = await browser.waitFor("[...document.querySelectorAll('.chat-bubble-assistant')].some((b) => b.textContent.includes('opens daily'))", { timeoutMs: 90_000 });
  checks.readTheRepoFile = modelRequests.some((r) => (r.messages ?? []).some((m) => m.role === "tool" && String(m.content).includes("Fresh bread.")));
  checks.changes = await browser.evaluate("window.adcode.git.status().then((s) => s.entries.map((e) => e.path + ':' + e.worktree + ':+' + e.added + '-' + e.removed))");
  checks.diffShowsLine = await browser.evaluate("window.adcode.git.diff('README.md').then((d) => d.includes('+Fresh bread daily, from 7am.'))");
  await shot("github-chat");

  // Commit = a pull request with the change, from the commit that was opened.
  checks.commit = await browser.evaluate("window.adcode.git.commit('Say the bakery opens daily').then((r) => r.message)");
  checks.pullRequest = pulls.length === 1 && pulls[0].repo === "baker/bakery" && pulls[0].baseBranch === "main" && pulls[0].baseCommit === "a".repeat(40) && pulls[0].files.length === 1 && pulls[0].files[0].path === "README.md" && pulls[0].files[0].content === README;

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

const passed = checks.threw === undefined && checks.ready && checks.mode === "browser-host" && checks.modelReady && checks.pickerShown && checks.reposListed && checks.opened &&
  checks.gitStatus?.isRepo === true && checks.gitStatus?.branch === "main" && checks.gitStatus?.entries === 0 &&
  checks.chatReply && checks.readTheRepoFile && checks.changes?.join("|") === "README.md:modified:+1-1" && checks.diffShowsLine &&
  typeof checks.commit === "string" && checks.commit.includes("pull/1") && checks.pullRequest &&
  checks.reloaded && checks.projectsAfterReload?.includes("bakery") && checks.chatsAfterReload >= 1;
if (!passed) console.log(`--- stack log (tail) ---\n${stackLog.slice(-3000)}`);
process.exit(passed ? 0 : 1);
