/**
 * Visual probe for the Flow, Mods and Team pages and the conversation sort: launch the built
 * app against a throwaway profile and the mock backend (as smoke.mjs does), drive it over CDP,
 * save screenshots and print what each page actually shows.
 *
 * Run after `npm run desktop:build`:  node scripts/probe-new-pages.mjs [outDir]
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { startSmokeBackend } from "./smoke-backend.mjs";

const REPO = process.cwd();
const OUT = process.argv[2] ?? tmpdir();
const PORT = Number(process.env.ADCODE_PROBE_PORT ?? "9344");
const require = createRequire(join(REPO, "package.json"));
const electronPath = require("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const userData = await mkdtemp(join(tmpdir(), "adcode-probe-"));
await writeFile(join(userData, "session.json"), JSON.stringify({ state: { root: REPO, openFiles: [], activeFile: null } }), "utf8");
const chats = join(userData, "ai-sessions", createHash("sha256").update(REPO).digest("hex").slice(0, 16));
await mkdir(chats, { recursive: true });
const day = 86_400_000, now = Date.now();
for (const [id, title, created, updated, count] of [
  ["s-alpha", "Add dark mode toggle", now - 9 * day, now - 2 * day, 12],
  ["s-beta", "Bug: login crashes", now - 3 * day, now - 60_000, 4],
  ["s-gamma", "Write README", now - 30 * day, now - 20 * day, 30],
]) {
  const messages = Array.from({ length: count }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `${title} message ${i}`, at: created + i }));
  await writeFile(join(chats, `${id}.json`), JSON.stringify({ id, title, renamed: true, createdAt: created, updatedAt: updated, messages }), "utf8");
}

// A team chat (hidden from Solo) and a solo copy of it, to see named bubbles in the real chat.
const groupMessages = [
  { role: "user", text: "Can we make the pricing header blue?", at: now - 5000, seq: 1, author: { id: "u2", name: "Sam", self: false } },
  { role: "assistant", text: "Done - the header uses the accent blue now.", at: now - 4000, seq: 2, author: { id: "u2", name: "Sam", self: false } },
  { role: "user", text: "Nice. Also add a FAQ section under it.", at: now - 3000, seq: 3, author: { id: "u1", name: "Probe", self: true } },
  { role: "assistant", text: "Added a FAQ with four questions below the header.", at: now - 2000, seq: 4, author: { id: "u1", name: "Probe", self: true } },
];
await writeFile(join(chats, "team-probe.json"), JSON.stringify({ id: "team-probe", title: "Launch page", renamed: true, createdAt: now - 6000, updatedAt: now - 1000, messages: groupMessages, team: { projectId: "a".repeat(64), sessionId: "probe", projectName: "Site", aiReplies: true } }), "utf8");
await writeFile(join(chats, "s-teamlook.json"), JSON.stringify({ id: "s-teamlook", title: "Team look", renamed: true, createdAt: now - 6000, updatedAt: now - 500, messages: groupMessages }), "utf8");

const backend = await startSmokeBackend();
const env = { ...process.env, ...backend.env, ADCODE_USER_DATA_DIR: userData, ADCODE_ACCOUNT_GATE: "off" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, ["apps/desktop", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (c) => (log += c));
child.stderr.on("data", (c) => (log += c));

let target;
for (let attempt = 0; attempt < 60 && target === undefined; attempt++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page" && t.webSocketDebuggerUrl); } catch { /* starting */ }
  if (target === undefined) await sleep(500);
}
if (target === undefined) { child.kill(); throw new Error("no window"); }
for (let i = 0; i < 80; i++) { try { await access(join(userData, "ads", "ads", "identity.json")); break; } catch { await sleep(250); } }

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => { const m = JSON.parse(event.data); pending.get(m.id)?.(m); pending.delete(m.id); });
const send = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return m.result?.exceptionDetails ? `THREW: ${m.result.exceptionDetails.exception?.description}` : m.result?.result?.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = join(OUT, `probe-${name}.png`);
  await writeFile(path, Buffer.from(r.result.data, "base64"));
  return path;
};

await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 120; i++) { if (await evaluate("document.body.dataset.workspaceMode === 'vibe' && !!document.querySelector('.vibe-conversations')")) break; await sleep(250); }
await sleep(1500);
// A fresh profile opens the welcome tour over everything: skip it.
for (let i = 0; i < 6; i++) {
  const skipped = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip' && x.offsetParent !== null); if (b) { b.click(); return true; } return false; })()`);
  if (!skipped) break;
  await sleep(500);
}
await evaluate("window.adcode.onboarding.complete()");
await sleep(600);
const page = (name) => evaluate(`(() => { const b = [...document.querySelectorAll('button, a')].filter(x => x.offsetParent !== null).find(x => x.textContent.trim() === '${name}'); if (!b) return false; b.click(); return true; })()`);
const results = {};
const errors = [];
await send("Runtime.enable", {});

// Conversation sort
results.sortOptions = await evaluate(`[...document.querySelectorAll('.vibe-history-host .chat-history-sort option')].map(o => o.textContent)`);
results.recentOrder = await evaluate(`[...document.querySelectorAll('.vibe-history-host .chat-history-open')].map(b => b.textContent)`);
results.nameOrder = await evaluate(`(async () => { const s = document.querySelector('.vibe-history-host .chat-history-sort'); s.value = 'name'; s.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200)); return [...document.querySelectorAll('.vibe-history-host .chat-history-open')].map(b => b.textContent); })()`);
results.longestOrder = await evaluate(`(async () => { const s = document.querySelector('.vibe-history-host .chat-history-sort'); s.value = 'longest'; s.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 200)); return [...document.querySelectorAll('.vibe-history-host .chat-history-open')].map(b => b.textContent); })()`);
results.sortShot = await shot("sort");
results.teamHiddenFromSolo = await evaluate(`![...document.querySelectorAll('.vibe-history-host .chat-history-open')].some(b => b.textContent.includes('Launch page'))`);
results.sortMenu = await evaluate(`(async () => { document.querySelector('.vibe-history-host .select-menu-trigger').click(); await new Promise(r => setTimeout(r, 300)); const p = document.querySelector('.select-menu-popover:popover-open'); return p ? { options: [...p.querySelectorAll('.select-menu-option')].map(o => o.textContent), selected: p.querySelector('[aria-selected="true"]')?.textContent, search: !p.querySelector('.select-menu-search').hidden } : 'not open'; })()`);
results.sortMenuShot = await shot("sort-menu");
results.sortPick = await evaluate(`(async () => { const o = [...document.querySelectorAll('.select-menu-popover:popover-open .select-menu-option')].find(x => x.textContent.includes('Oldest')); o?.click(); await new Promise(r => setTimeout(r, 300)); return { value: document.querySelector('.vibe-history-host .chat-history-sort').value, button: document.querySelector('.vibe-history-host .select-menu-trigger').textContent, closed: !document.querySelector('.select-menu-popover:popover-open') }; })()`);
results.teamBubbles = await evaluate(`(async () => { const b = [...document.querySelectorAll('.vibe-history-host .chat-history-open')].find(x => x.textContent.includes('Team look')); b?.click(); await new Promise(r => setTimeout(r, 1200)); return [...document.querySelectorAll('.chat-card .chat-bubble')].map(e => ({ cls: e.className.replace('chat-bubble ', ''), author: e.dataset.author, askedBy: e.dataset.askedBy })); })()`);
results.teamBubblesShot = await shot("team-bubbles");

// Solo / Team switch
results.workSwitch = await evaluate(`(() => { const s = document.querySelector('.work-area-switch'); return s ? { area: s.dataset.area, options: [...s.querySelectorAll('.work-area-option')].map(o => o.textContent) } : null; })()`);
results.team = await evaluate(`(async () => { document.querySelector('.work-area-option[data-area="team"]').click(); await new Promise(r => setTimeout(r, 1500)); return { area: document.body.dataset.workArea, label: document.querySelector('.vibe-conversations-label')?.textContent, soloHidden: getComputedStyle(document.querySelector('.vibe-history-host')).display, teamHost: !!document.querySelector('#vibe-page-chat .shared-chat-host:not([hidden])'), nav: document.querySelector('.team-area-nav')?.innerText.slice(0, 200) }; })()`);
results.teamShot = await shot("team");
await evaluate(`document.querySelector('.work-area-option[data-area="solo"]').click()`);
await sleep(400);
results.soloBack = await evaluate(`({ area: document.body.dataset.workArea, chatVisible: getComputedStyle(document.querySelector('#vibe-page-chat > .chat-card, #vibe-page-chat > *:not(.shared-chat-host)')).display })`);

// Flow page
results.navPages = await evaluate(`[...document.querySelectorAll('[data-page]')].filter(x => x.offsetParent !== null).map(b => b.textContent.trim()).filter(Boolean)`);
results.flowClicked = await page('Agents');
await sleep(600);
results.agentsShot = await shot("agents-runs");
results.hubTabs = await evaluate(`[...document.querySelectorAll('.agents-hub-tab')].map(t => t.textContent.trim())`);
await evaluate(`document.querySelector('.agents-hub-tab[data-tab="tools"]')?.click()`);
await sleep(700);
results.toolsShot = await shot("agents-tools");
await evaluate(`document.querySelector('.agents-hub-tab[data-tab="flow"]')?.click()`);
await sleep(1500);
results.flow = await evaluate(`({
  nodes: [...document.querySelectorAll('.flow-node')].map(n => n.querySelector('.flow-node-label strong')?.textContent),
  links: document.querySelectorAll('.flow-link').length,
  entry: document.querySelector('.flow-node.is-entry .flow-node-label strong')?.textContent,
  counter: document.querySelector('.flow-counter')?.textContent,
  on: document.querySelector('.flow-switch input')?.checked,
})`);
results.flowShot = await shot("flow");
results.tryIt = await evaluate(`(async () => { const i = document.querySelector('.flow-try .flow-input'); i.value = 'fix the crash in parser.ts'; document.querySelector('.flow-try').requestSubmit(); await new Promise(r => setTimeout(r, 900)); return { text: document.querySelector('.flow-try-result')?.textContent, lit: [...document.querySelectorAll('.flow-node.is-lit')].map(n => n.dataset.id) }; })()`);
results.tryShot = await shot("flow-try");
results.addAndSelect = await evaluate(`(async () => { document.querySelector('.flow-palette-item[data-role="designer"]').click(); await new Promise(r => setTimeout(r, 400)); return { count: document.querySelectorAll('.flow-node').length, inspector: document.querySelector('.flow-inspector .flow-heading')?.textContent, fields: [...document.querySelectorAll('.flow-inspector .flow-field-label')].map(l => l.textContent) }; })()`);
results.inspectorShot = await shot("flow-inspector");
results.modelMenu = await evaluate(`(async () => { const t = [...document.querySelectorAll('.flow-inspector .select-menu-trigger')].pop(); t.click(); await new Promise(r => setTimeout(r, 300)); const p = document.querySelector('.select-menu-popover:popover-open'); if (!p) return 'not open'; const all = p.querySelectorAll('.select-menu-option').length; const groups = [...p.querySelectorAll('.select-menu-group')].map(g => g.textContent); const input = p.querySelector('.select-menu-search input'); input.value = 'flash'; input.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 200)); return { trigger: t.textContent, all, groups, searchVisible: !p.querySelector('.select-menu-search').hidden, focused: document.activeElement === input, filtered: [...p.querySelectorAll('.select-menu-option')].map(o => o.textContent).slice(0, 8) }; })()`);
results.modelMenuShot = await shot("flow-model-menu");
await evaluate(`document.querySelector('.select-menu-popover:popover-open .select-menu-search input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
results.flowMenu = await evaluate(`(async () => { document.querySelector('.flow-toolbar .select-menu-trigger').click(); await new Promise(r => setTimeout(r, 300)); const p = document.querySelector('.select-menu-popover:popover-open'); return p ? [...p.querySelectorAll('.select-menu-option')].map(o => o.textContent) : 'not open'; })()`);
results.flowMenuShot = await shot("flow-menu");
await evaluate(`document.querySelector('.flow-toolbar .select-menu-trigger').click()`);
results.dragMove = await evaluate(`(async () => {
  const node = document.querySelector('.flow-node[data-id="coder"]'); const r = node.getBoundingClientRect();
  const opts = (x, y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' });
  node.dispatchEvent(new PointerEvent('pointerdown', opts(r.left + 20, r.top + 20)));
  node.dispatchEvent(new PointerEvent('pointermove', opts(r.left + 120, r.top + 80)));
  node.dispatchEvent(new PointerEvent('pointerup', opts(r.left + 120, r.top + 80)));
  await new Promise(res => setTimeout(res, 700));
  const after = node.getBoundingClientRect();
  const saved = JSON.parse((await window.adcode.settings.read())['adcode.ai.agentFlows'] || '[]');
  return { movedBy: [Math.round(after.left - r.left), Math.round(after.top - r.top)], saved: saved[0]?.agents?.find(a => a.id === 'coder') };
})()`);

// Agents board: draw one box per tone with the page's own markup, to see the redesign.
await evaluate(`document.querySelector('.agents-hub-tab[data-tab="runs"]')?.click()`);
results.agentsClicked = true;
await sleep(900);
results.boxes = await evaluate(`(() => {
  const list = document.querySelector('.agents-column[data-column="working"] .agents-list') ?? document.querySelector('.agents-list');
  if (!list) return 'no list';
  const make = (tone, badge, title, who, status, time, chips, progress, actions) => {
    const li = document.createElement('li'); li.className = 'agent-box'; li.dataset.tone = tone;
    li.innerHTML = '<button class="agent-box-open" type="button"><span class="agent-box-head"><span class="agent-box-badge">' + badge + '</span>' + (time ? '<span class="agent-box-time">' + time + '</span>' : '') + '</span><span class="agent-box-identity"><span class="agent-box-mascots"><span style="display:inline-block;width:34px;height:34px;border-radius:50%;background:#2fb57c"></span></span><span class="agent-box-text"><strong class="agent-box-title">' + title + '</strong><span class="agent-box-who">' + who + '</span></span></span><span class="agent-box-status">' + status + '</span>' + (progress ? '<span class="agent-box-progress"></span>' : '') + '<span class="agent-box-meta">' + chips.map(c => '<span class="agent-box-meta-chip">' + c + '</span>').join('') + '</span></button><div class="agent-box-actions">' + actions.map((a, k) => '<button class="agent-box-action' + (k === 0 ? ' agent-box-action-primary' : '') + '">' + a + '</button>').join('') + '</div><div class="agent-box-management"><button class="agent-box-manage">Edit run</button><button class="agent-box-manage">Edit agent</button><button class="agent-box-manage" data-manage="delete">Delete run</button></div>';
    list.append(li);
  };
  make('working', 'Working', 'Fix the login crash on Safari', 'Bug fixer · DeepSeek V4 Flash', 'Editing src/auth/session.ts', '2m 14s', ['3 files', '41K tokens', '$0.02'], true, ['Stop']);
  make('attention', 'Failed', 'Add dark mode toggle', 'UI polish · the chat model', 'Tests failed: settings.test.ts expected 2 themes, got 1.', '', ['2 files', '18K tokens'], false, ['Run again', 'Open in chat']);
  make('ready', 'Ready to review', 'Write tests for the parser', 'Tester · Qwen 3.8', 'Added 12 tests; all pass.', '', ['1 file', '9K tokens', '$0.01'], false, ['Review', 'Apply', 'Discard']);
  return list.children.length;
})()`);
await sleep(400);
results.boxesShot = await shot("agent-boxes");

console.log(JSON.stringify(results, null, 2));
const errorLines = log.split("\n").filter((line) => /Uncaught|TypeError|ReferenceError/.test(line)).slice(0, 10);
console.log("renderer errors:", errorLines.length === 0 ? "none" : errorLines.join("\n"));
socket.close();
child.kill();
await backend.server.close();
process.exit(0);
