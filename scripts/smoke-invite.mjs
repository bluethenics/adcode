/*
 * An invite, end to end, in the built app: what a new person who followed a friend's link
 * sees, and what the friend's Invite & earn panel then says.
 *
 *   the invite page copied "ADCode invite: smoke-invite"  ->  ADCode opens for the first time
 *   -> the welcome finds it on the clipboard and claims it  ->  "Sam invited you"
 *   -> Earnings -> Invite & earn  ->  their own link, "Invited by Sam", the live terms
 *
 * Against the mock server (never production): it knows one inviter, "Sam", by the code
 * `smoke-invite`, and records every claim it accepts, so the run can prove the app sent
 * exactly that code - and nothing else from the clipboard. The clipboard is the real system
 * clipboard; whatever was on it is put back afterwards.
 *
 *   npm run desktop:build && node scripts/smoke-invite.mjs
 *
 * Read the printed values, not just the exit code. Screenshots go to ADCODE_SHOTS if set.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSmokeBackend } from "./smoke-backend.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));
const electronPath = require("electron");
const PORT = Number(process.env.ADCODE_INVITE_SMOKE_PORT ?? "9491");
const SHOTS = process.env.ADCODE_SHOTS ?? null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const INVITE_LINE = "ADCode invite: smoke-invite";

/* ── The system clipboard, saved and put back ───────────────────────────── */

const powershell = (command) =>
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
const onWindows = process.platform === "win32";
const savedClipboard = onWindows ? powershell("Get-Clipboard -Raw").stdout ?? "" : "";
const setClipboard = (text) => {
  if (!onWindows) return false;
  const quoted = text.replaceAll("'", "''");
  return powershell(`Set-Clipboard -Value '${quoted}'`).status === 0;
};

/* ── The app, as a brand-new install that followed an invite ────────────── */

const backend = await startSmokeBackend();
const userData = await mkdtemp(join(tmpdir(), "adcode-invite-smoke-"));
const env = { ...process.env, ...backend.env, ADCODE_PROJECTS_HOME: join(userData, "projects") };
delete env.ELECTRON_RUN_AS_NODE;

const checks = {};
checks.clipboardSet = setClipboard(INVITE_LINE);

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

try {
  /* The welcome finds the invite on the clipboard and says who sent it. */
  checks.welcomeOpens = await waitFor("document.querySelector('dialog.onboarding[open]') !== null", 40_000);
  let named = await waitFor("(() => { const line = document.querySelector('.onboarding-invited'); return !!line && !line.hidden; })()", 15_000);
  if (!named) {
    // The clipboard may have been written after the welcome looked: coming back to the window
    // is the second look, exactly as for someone who copied the code from the page late.
    await evaluate("window.dispatchEvent(new Event('focus'))");
    named = await waitFor("(() => { const line = document.querySelector('.onboarding-invited'); return !!line && !line.hidden; })()", 15_000);
    checks.claimedOnFocus = named;
  }
  checks.welcomeLine = await evaluate("document.querySelector('.onboarding-invited')?.textContent ?? null");
  checks.claimSent = backend.server.claims();
  await shot("invite-01-welcome");

  /* A second look sends nothing more: the code is claimed, and the clipboard is left alone. */
  setClipboard("const secret = 'hunter2';");
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await sleep(1500);
  checks.claimsAfterUnrelatedClipboard = backend.server.claims().length;

  /* Close the welcome, then Earnings -> Invite & earn, as a person would find it. */
  await evaluate("document.querySelector('.onboarding-skip')?.click()");
  await waitFor("document.querySelector('dialog.onboarding')?.open !== true", 10_000);
  await evaluate("document.getElementById('open-earnings')?.click()");
  checks.earningsDoor = await waitFor("!!document.querySelector('.earnings-invite') && document.querySelector('.earnings-invite').offsetParent !== null", 10_000);
  checks.earningsDoorText = await evaluate("document.querySelector('.earnings-invite')?.textContent ?? null");
  await evaluate("document.querySelector('.earnings-invite')?.click()");
  checks.panelOpens = await waitFor("(() => { const card = document.querySelector('.invite-card'); return !!card && card.dataset.state === 'ready' && card.offsetParent !== null; })()", 15_000);
  await sleep(500);
  checks.panel = await evaluate(`(() => {
    const card = document.querySelector('.invite-card');
    const text = (selector) => card?.querySelector(selector)?.textContent ?? null;
    const shown = (selector) => { const node = card?.querySelector(selector); return !!node && !node.hidden; };
    return {
      title: text('.invite-title'),
      link: text('.invite-link'),
      people: text('.invite-people'),
      invitedBy: shown('.invite-invited') ? text('.invite-invited') : null,
      claimBoxShown: shown('.invite-claim'),
      terms: [...(card?.querySelectorAll('.invite-how-line') ?? [])].map((li) => li.textContent),
      shareButtons: [...(card?.querySelectorAll('.invite-share-button') ?? [])].map((b) => b.textContent),
      namePreview: text('.invite-name-preview'),
      pitch: shown('.invite-pitch'),
    };
  })()`);
  await shot("invite-02-panel");

  /* The panel's Copy puts the account's own link on the clipboard. */
  await evaluate("document.querySelector('.invite-copy')?.click()");
  await sleep(800);
  checks.copiedLink = onWindows ? (powershell("Get-Clipboard -Raw").stdout ?? "").trim() : "skipped";

  checks.accountMadeLocally = backend.server.signUpCount() >= 1;
} catch (error) {
  checks.threw = String(error?.stack ?? error);
} finally {
  socket.close();
  child.kill();
  await sleep(500);
  if (onWindows) setClipboard(savedClipboard.replace(/\r?\n$/, ""));
  await backend.server.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true }).catch(() => undefined);
}

console.log(JSON.stringify(checks, null, 2));
const ok =
  checks.welcomeOpens === true &&
  JSON.stringify(checks.claimSent) === JSON.stringify([{ code: "smoke-invite", how: "clipboard" }]) &&
  checks.welcomeLine === "Sam invited you - welcome to ADCode." &&
  checks.claimsAfterUnrelatedClipboard === 1 &&
  checks.earningsDoor === true &&
  checks.panelOpens === true &&
  checks.panel?.invitedBy === "Invited by Sam" &&
  checks.panel?.claimBoxShown === false &&
  checks.panel?.terms?.length === 3 &&
  checks.accountMadeLocally === true;
if (!ok) console.log(output.slice(-3000));
process.exit(ok ? 0 : 1);
