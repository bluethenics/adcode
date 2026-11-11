/**
 * Agent rules and hooks in the built app, against a local fake model.
 *
 *   npm run desktop:build && node scripts/smoke-agent-rules.mjs
 *
 * The project carries a `.adcode/settings.json` that denies `git push`, asks before any
 * deletion, and has a preToolUse guard, a sessionStart hook and a stop hook. One turn, scripted
 * the way a real model would call the tools:
 *
 * 1. `git push origin main` - refused by the deny rule, never run.
 * 2. `npm --version && git push --force` - refused too: a chain is checked part by part.
 * 3. A command the guard hook rejects - blocked with the hook's stderr as the reason.
 * 4. An ordinary command - runs.
 * 5. `delete_file` - the app's own dialog asks; the smoke says Don't allow; the file stays.
 * Then the stop hook sends the agent back once before it may finish.
 *
 * It also checks the project's hooks were approved in the app's dialog first, that the
 * sessionStart output and the rules reached the model, and that the Feature library finds
 * the feature. Prints `agentRulesEvidence: {...}` - read the values, not just the exit code.
 * ADCODE_RULES_SMOKE_PORT picks the DevTools port (default 9463).
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
const scratch = await mkdtemp(join(tmpdir(), "adcode-agent-rules-"));
const workspace = join(scratch, "project");
const userData = join(scratch, "profile");
const artifacts = resolve(root, "artifacts/agent-rules");
await Promise.all([mkdir(join(workspace, ".adcode"), { recursive: true }), mkdir(userData), mkdir(artifacts, { recursive: true })]);

const readStdin = "let input = ''; process.stdin.on('data', (d) => { input += d; }); process.stdin.on('end', () => main(JSON.parse(input)));";
await writeFile(join(workspace, ".adcode", "settings.json"), `{
  // The smoke's rules: pushes are for people, deletions ask first.
  "permissions": {
    "deny": ["run_command(git push*)"],
    "ask": ["delete_file(*)"],
  },
  "hooks": {
    "preToolUse": [{ "matcher": "run_command", "command": "node .adcode/guard.cjs" }],
    "sessionStart": [{ "command": "node .adcode/start.cjs" }],
    "stop": [{ "command": "node .adcode/stop.cjs" }],
  },
}
`);
await writeFile(join(workspace, ".adcode", "guard.cjs"), `${readStdin}
function main(call) {
  require('fs').appendFileSync(require('path').join(__dirname, 'guard-log.txt'), call.hook_event_name + ' ' + call.tool_name + ' ' + call.tool_input.command + '\\n');
  if (String(call.tool_input.command).includes('hook-block-me')) {
    process.stderr.write('guard says no: hook-block-me is off limits');
    process.exit(2);
  }
}
`);
await writeFile(join(workspace, ".adcode", "start.cjs"), "console.log('hook-session-start-ok: on branch smoke');\n");
await writeFile(join(workspace, ".adcode", "stop.cjs"), `${readStdin}
function main(input) {
  const fs = require('fs');
  const marker = require('path').join(__dirname, 'stop-seen.json');
  if (fs.existsSync(marker)) return;
  fs.writeFileSync(marker, JSON.stringify(input));
  process.stderr.write('stop hook: say STOP-HOOK-OK before finishing');
  process.exit(2);
}
`);
await writeFile(join(workspace, "keep.txt"), "do not delete\n");
await writeFile(join(workspace, "index.html"), "<!doctype html><title>Rules smoke</title><h1>Rules</h1>");
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: workspace, openFiles: [join(workspace, "index.html")], activeFile: join(workspace, "index.html") } }));
await writeFile(join(userData, "onboarding.json"), JSON.stringify({ tour: 2, completed: true, at: Date.now() }));

/* ── The fake model ───────────────────────────────────────────────────────── */

const requests = [];
const call = (index, id, name, args) => ({ index, id, function: { name, arguments: JSON.stringify(args) } });

/** Tool results answered since the prompt, while no later user message has arrived. */
function answeredSince(request, prompt) {
  const start = request.messages.findLastIndex((message) => message.role === "user" && message.content === prompt);
  if (start === -1) return null;
  const after = request.messages.slice(start + 1);
  if (after.some((message) => message.role === "user")) return null;
  return after.filter((message) => message.role === "tool").length;
}

const SCRIPT = [
  call(0, "deny-1", "run_command", { command: "git push origin main" }),
  call(0, "chain-1", "run_command", { command: "npm --version && git push --force" }),
  call(0, "hook-1", "run_command", { command: "node -e \"console.log('hook-block-me')\"" }),
  call(0, "allow-1", "run_command", { command: "node -e \"console.log('allowed-ran')\"" }),
  call(0, "ask-1", "delete_file", { path: "keep.txt" }),
];

const fake = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  requests.push(request);
  res.writeHead(200, { "content-type": "text/event-stream" });
  let delta = { content: "ok" };
  const answered = answeredSince(request, "rules-smoke");
  const last = request.messages.findLast((message) => message.role === "user");
  if (answered !== null) {
    delta = answered < SCRIPT.length ? { tool_calls: [SCRIPT[answered]] } : { content: "Rules respected." };
  } else if (typeof last?.content === "string" && last.content.startsWith("A stop hook")) {
    delta = { content: "STOP-HOOK-OK - finished after the stop hook." };
  }
  res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((done) => fake.listen(0, "127.0.0.1", done));
const endpoint = `http://127.0.0.1:${fake.address().port}/v1`;

/* ── The app ──────────────────────────────────────────────────────────────── */

// A dead backend: no check here needs one, and unset it means production.
const env = { ...process.env, ADCODE_AD_SERVER: "http://127.0.0.1:9" };
delete env.ELECTRON_RUN_AS_NODE;
const port = Number(process.env.ADCODE_RULES_SMOKE_PORT ?? 9463);
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
  globalThis.__smokeShot = screenshot;
  const exists = (path) => stat(join(workspace, path)).then(() => true, () => false);

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
  if (!(await evaluate("Boolean(document.querySelector('.chat-card')?.getClientRects().length)"))) await evaluate("document.getElementById('ai-toggle')?.click()");
  await waitFor("Boolean(document.querySelector('.chat-card')?.getClientRects().length)", 15_000);
  await waitFor("document.querySelector('.chat-model')?.dataset.ready === 'true'", 15_000);

  /* The turn, answering the app's own dialogs as a person would. */
  const dialogs = [];
  await evaluate(`void window.adcode.ai.send("rules-smoke"); true`);
  const until = Date.now() + 120_000;
  let finished = false;
  while (Date.now() < until) {
    const open = await evaluate(`(() => {
      const dialog = document.querySelector('dialog.confirm-dialog[open]');
      if (!dialog) return null;
      return { title: dialog.querySelector('.result-title')?.textContent ?? '', body: dialog.querySelector('.result-summary')?.textContent ?? '', confirm: dialog.querySelector('.result-close')?.textContent ?? '', cancel: dialog.querySelector('.confirm-cancel')?.textContent ?? '' };
    })()`);
    if (open !== null) {
      dialogs.push(open);
      await screenshot(open.title.startsWith("Run this project") ? "hooks-approval" : "ask-rule");
      // Approve the project's hooks; turn the deletion down.
      const button = open.title.startsWith("Run this project") ? ".result-close" : ".confirm-cancel";
      await evaluate(`document.querySelector('dialog.confirm-dialog[open] ${button}')?.click()`);
      await sleep(300);
      continue;
    }
    if (await evaluate(`[...document.querySelectorAll('.chat-bubble-assistant')].some((node) => node.textContent.includes('STOP-HOOK-OK')) && document.querySelector('.chat-card')?.dataset.working !== 'true'`)) {
      finished = true;
      break;
    }
    await sleep(150);
  }
  assert.ok(finished, `The turn finishes after the stop hook. Last answer: ${await evaluate("[...document.querySelectorAll('.chat-bubble-assistant')].at(-1)?.textContent ?? 'none'")}`);
  await sleep(400);
  await screenshot("agent-rules");

  const toolResult = (id) => requests.flatMap((request) => request.messages).find((message) => message.role === "tool" && message.tool_call_id === id)?.content ?? "";
  const systems = requests.map((request) => request.messages.filter((message) => message.role === "system").map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content))).join("\n"));
  const guardLog = await readFile(join(workspace, ".adcode", "guard-log.txt"), "utf8").catch(() => "");
  const stopInput = JSON.parse(await readFile(join(workspace, ".adcode", "stop-seen.json"), "utf8").catch(() => "{}"));
  const approval = dialogs.find((dialog) => dialog.title === "Run this project's hooks?");
  const ask = dialogs.find((dialog) => dialog.title === "Let the AI delete this file?");
  // Open the folded turn as a person would: the refused steps carry the error mark.
  await evaluate("document.querySelector('.chat-turn[data-state=done] .chat-turn-toggle')?.click()");
  await sleep(400);
  await evaluate("document.querySelector('.chat-step-call')?.scrollIntoView({ block: 'center' })");
  await sleep(200);
  await screenshot("timeline-refusals");
  const failedSteps = await evaluate("[...document.querySelectorAll('.chat-step-call[data-state=error]')].map((node) => node.textContent.trim())");
  const doneSteps = await evaluate("[...document.querySelectorAll('.chat-step-call[data-state=done]')].map((node) => node.textContent.trim())");

  const library = await evaluate(`(async () => {
    const button = document.querySelector('#open-features');
    if (!button) return { launcher: false };
    button.click();
    await new Promise((done) => setTimeout(done, 400));
    const input = document.querySelector('.feature-library-search');
    if (!input) return { launcher: true, search: false };
    const finds = (query) => {
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return document.querySelector('.feature-library-row[data-feature-id="ai.agentRules"]');
    };
    const row = finds('block git push');
    const actions = [...(row?.querySelectorAll('.feature-library-actions button') ?? [])].map((node) => node.textContent.trim());
    return { launcher: true, search: true, foundByGitPush: row !== null, foundByHooks: finds('hooks') !== null, actions };
  })()`);
  await screenshot("feature-library");
  const opened = await evaluate("window.adcode.ai.openAgentSettings('project')");

  const evidence = {
    hooksApprovalAsked: approval !== undefined && approval.body.includes("node .adcode/guard.cjs") && approval.body.includes("stop: node .adcode/stop.cjs"),
    sessionStartReachedModel: systems.some((text) => text.includes("hook-session-start-ok: on branch smoke")),
    rulesReachedModel: systems.some((text) => text.includes("denied (the call fails): run_command(git push*)")),
    deniedRefused: toolResult("deny-1").includes('Not allowed: the rule deny "run_command(git push*)" in .adcode/settings.json blocks this call'),
    deniedNeverReachedHooks: !guardLog.includes("git push"),
    chainDenied: toolResult("chain-1").includes("Not allowed") && toolResult("chain-1").includes("(git push --force)"),
    hookBlocked: toolResult("hook-1").includes('Blocked by a preToolUse hook in .adcode/settings.json ("node .adcode/guard.cjs"): guard says no: hook-block-me is off limits'),
    hookSawCallJson: guardLog.includes("PreToolUse run_command node -e"),
    allowedRan: toolResult("allow-1").startsWith("exit 0") && toolResult("allow-1").includes("allowed-ran"),
    askDialogShown: ask !== undefined && ask.body.includes("keep.txt") && ask.body.includes("delete_file(*)") && ask.confirm === "Allow once" && ask.cancel === "Don't allow",
    askDeclinedRefused: toolResult("ask-1").includes("The user did not allow this call"),
    fileKept: await exists("keep.txt"),
    stopHookInput: stopInput.hook_event_name === "Stop" && typeof stopInput.session_id === "string",
    stopHookSentBack: requests.some((request) => request.messages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("say STOP-HOOK-OK before finishing"))),
    timelineMarksRefusals: ["git push origin main", "git push --force", "hook-block-me", "keep.txt"].every((text) => failedSteps.some((step) => step.includes(text))) && doneSteps.some((step) => step.includes("allowed-ran")),
    featureLibraryFindsIt: library.foundByGitPush === true && library.foundByHooks === true,
    featureLibraryActions: JSON.stringify(library.actions ?? []),
    openSettingsFile: opened?.ok === true && opened.path.replaceAll("\\", "/").endsWith(".adcode/settings.json"),
  };
  process.stdout.write(`agentRulesEvidence: ${JSON.stringify(evidence)}\n`);
  for (const [name, value] of Object.entries(evidence)) {
    if (name === "featureLibraryActions") assert.ok(value.includes("Open the project rules"), `${name}: ${value}`);
    else assert.equal(value, true, name);
  }
  process.stdout.write("PASS: deny rules refuse commands (chains included), ask rules use the app's dialog, hooks block, report and keep the agent going, and the feature is findable.\n");
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
