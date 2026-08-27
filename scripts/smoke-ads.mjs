/**
 * Does an ad actually reach the user as a notification? Launch the built app, point it
 * at a real ad server, and watch.
 *
 * This is the check the ad system did not have. `packages/ads` has 250-odd tests and an
 * end-to-end suite that runs the real client against the real mock server - but that suite
 * stops at `FakeIdeSignals` and `FakeNotificationSink`, and those two fakes are exactly
 * where the IDE joins on. Everything on the far side of them - whether the editor ever
 * answers the signals port, whether a toast paints, whether the paint is reported back,
 * whether the receipt returns and the balance moves - was unproven, and two real defects
 * had been sitting there: nothing ever called `setWorkspaceSignals` or `setThemeKind`, so
 * every request went out untargeted with a hard-coded dark theme.
 *
 * `scripts/smoke.mjs` is not the place for it: this run needs its own server, its own
 * cadence, and an app whose entire backend origin has been redirected, which would distort
 * every other check in that file.
 *
 * Run after `npm run desktop:build`:  node scripts/smoke-ads.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { createMockServer } from "../mock-server/src/server.ts";
import { releaseDirectory } from "./release-directory.mjs";

const REPO = process.cwd();
const require = createRequire(join(REPO, "package.json"));

const packaged = process.argv.includes("--packaged");
const electronPath = packaged
  ? join(releaseDirectory(REPO), "win-unpacked", "ADCode.exe")
  : require("electron");
const appArgs = packaged ? [] : ["apps/desktop"];

// Not 9333: so this can run beside `scripts/smoke.mjs` without either stealing the other's
// debugger port.
const PORT = 9334;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── The ad server ─────────────────────────────────────────────────────── */

const server = await createMockServer();

/**
 * One creative, named so the assertions can be exact.
 *
 * Seeded rather than taken from the default inventory: a check that asserts on whatever
 * happened to be first is a check that breaks when the fixture list is reordered.
 */
const CREATIVE = {
  creativeId: "cr-smoke-1",
  advertiser: "Smokestack",
  headline: "the only ad in this run",
  body: "and the only one it needs",
  clickUrl: "https://smokestack.example/",
  logoLight: `${server.publicAssetOrigin}/smoke-light.png`,
  logoDark: `${server.publicAssetOrigin}/smoke-dark.png`,
  /*
   * Six seconds, where the server's real default is ten minutes.
   *
   * The TTL is what makes the client ask again, and asking again is the whole subject of
   * the second half of this run. A ten-minute cache is correct in production and untestable
   * in a smoke run, so the fixture shortens the clock rather than the client relaxing a rule.
   */
  ttlMs: 6_000,
};

server.seed([CREATIVE]);

/* ── The app ───────────────────────────────────────────────────────────── */

const userData = await mkdtemp(join(tmpdir(), "adcode-smoke-ads-"));
await mkdir(userData, { recursive: true });

// A restored workspace, so the editor has real languages and real root manifests to
// describe. With no folder open the signals are legitimately empty and the targeting
// assertion below would be testing nothing.
const OPEN_FILE = join(REPO, "packages", "ads", "src", "types.ts");
await writeFile(
  join(userData, "session.json"),
  JSON.stringify({ state: { root: REPO, openFiles: [OPEN_FILE], activeFile: OPEN_FILE } }),
  "utf8",
);

const child = spawn(
  electronPath,
  [...appArgs, "--enable-logging", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
  {
    cwd: REPO,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      // Every /v1/* call in the app now goes here, which is also why this is its own script.
      ADCODE_AD_SERVER: server.url,
      // ADCODE_ASSET_HOST is deliberately NOT set: this exercises the default the shipped
      // app actually uses. It defaulted to `cdn.adcode.test` in every build including
      // packaged ones - a hostname that has never resolved - so production rejected every
      // creative it was ever served. The default now follows the API origin, except against
      // a dev server, where the mock still advertises the fake host the transport bridges.
      // Both development-only overrides, and neither is remote-configurable - see
      // `AdServiceSettings.settleMs` and `tickMs` for why that matters.
      ADCODE_SETTLE_MS: "1500",
      ADCODE_AD_TICK_MS: "2000",
      ADCODE_AD_DEBUG: "1",
      // The ad path is required to stay silent on failure, so its own log is the only way
      // to tell a working system from a broken one. Captured below and printed on failure.
      ADCODE_ADS_DISABLED: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);

let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

/* ── CDP ───────────────────────────────────────────────────────────────── */

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page !== undefined) return page;
    } catch {
      // Not listening yet; normal for the first second or two.
    }
    await sleep(500);
  }
  throw new Error("no renderer target appeared");
}

const target = await findTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  const settle = pending.get(message.id);
  if (settle !== undefined) {
    pending.delete(message.id);
    settle(message);
  }
});

function send(method, params) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
  const message = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (message.result?.exceptionDetails !== undefined) {
    return `THREW: ${message.result.exceptionDetails.exception?.description ?? "unknown"}`;
  }

  return message.result?.result?.value;
}

// Past DOMContentLoaded, so the session has restored and the renderer has had a chance to
// report its signals - the report is coalesced behind a 250ms timer.
await sleep(4000);

/*
 * The window has to be focused, or the scheduler is right to refuse.
 *
 * `window-unfocused` is one of §8.1's restraint rules and this run must not weaken it, so
 * the window is brought forward rather than the rule bypassed. If it still refuses, the
 * reason is reported below and reads as exactly what happened.
 */
await send("Page.bringToFront", {});
await sleep(500);

const checks = {};

checks.signalsReported = await evaluate(
  `typeof window.adcode.ads.reportSignals === 'function'`,
);

/*
 * Drive the ticks rather than wait them out.
 *
 * `refreshEarnings()` runs a real `service.tick()` - the same one the 60s timer runs - so
 * the scheduler, the prefetch, the receipt flush and the balance all take their real path.
 * Nothing here is a shortcut around the decision; it only removes the waiting.
 */
let lastReason = "(never ticked)";
let appeared = false;

for (let attempt = 0; attempt < 20 && !appeared; attempt++) {
  // Asked before the next tick, not after: delivery is asynchronous - the main process
  // fetches the logo before it broadcasts - so the toast usually lands a beat after the
  // tick that decided to show it. Ticking again first would overwrite the reason with the
  // `min-interval` that correctly follows a card the app has just shown.
  appeared = (await evaluate(`document.querySelector('.toast-sponsored') !== null`)) === true;
  if (appeared) break;

  const snapshot = await evaluate(`window.adcode.ads.refreshEarnings()`);
  if (typeof snapshot === "object" && snapshot !== null) {
    lastReason = String(snapshot.suppressedReason);
  }

  await sleep(1000);
}

// Reported only when it failed, and then it says exactly which rule refused - which is the
// difference between "ads are broken" and "you are inside the ten-minute gap".
checks.nothingSuppressedTheAd = appeared ? true : `no ad after 20 ticks, last reason: ${lastReason}`;

/* ── The toast itself ──────────────────────────────────────────────────── */

const toast = await evaluate(
  `(() => {
     const card = document.querySelector('.toast-sponsored');
     if (card === null) return null;

     const box = card.getBoundingClientRect();
     const image = card.querySelector('.toast-logo img');

     return {
       label: card.querySelector('.toast-sponsored-label')?.textContent ?? '',
       title: card.querySelector('.toast-title')?.textContent ?? '',
       body: card.querySelector('.toast-body')?.textContent ?? '',
       // Painted, not merely in the DOM: an element with no box has not reached the user.
       onScreen: box.width > 0 && box.height > 0 &&
                 box.top >= 0 && box.left >= 0 &&
                 box.bottom <= window.innerHeight && box.right <= window.innerWidth,
       // §1: the logo is fetched and cached by us and handed over inline. A remote URL here
       // would mean the renderer opened a connection to an advertiser, carrying the user's IP.
       logoScheme: image === null ? '(no image)' : String(image.src).split(':')[0] + ':',
       hasDismiss: card.querySelector('.toast-close') !== null,
       // It is a notification in our own centre, not a bolted-on popup: same host, same
       // element type as an ordinary toast.
       insideNotificationCentre: card.matches('.toast'),
       ariaLabel: card.getAttribute('aria-label') ?? '',
     };
   })()`,
);

checks.toastAppeared = toast !== null && typeof toast === "object";

if (checks.toastAppeared) {
  checks.toastOnScreen = toast.onScreen;
  checks.sponsoredLabel = toast.label === "Sponsored" ? true : `label read: ${toast.label}`;
  checks.showsAdvertiser = toast.title.includes(CREATIVE.advertiser)
    ? true
    : `title read: ${toast.title}`;
  checks.showsHeadline = toast.title.includes(CREATIVE.headline)
    ? true
    : `title read: ${toast.title}`;
  checks.showsBody = toast.body.includes(CREATIVE.body) ? true : `body read: ${toast.body}`;
  checks.logoIsInlineData = toast.logoScheme === "data:"
    ? true
    : `logo scheme was ${toast.logoScheme}`;
  checks.hasDismissButton = toast.hasDismiss;
  checks.isAFirstClassNotification = toast.insideNotificationCentre;
  checks.announcedToScreenReaders = toast.ariaLabel.includes(CREATIVE.advertiser)
    ? true
    : `aria-label read: ${toast.ariaLabel}`;
}

/* ── What the app asked the server for ─────────────────────────────────── */

const domTheme = await evaluate(`document.documentElement.dataset.theme ?? ''`);
const serve = server.lastServe();

checks.serveRequestMade = serve !== null;

if (serve !== null) {
  // The defect this whole file exists for: with no signals wired, this list is always empty.
  checks.serveWasTargeted = serve.tags.length > 0 ? true : "serve went out with no tags";

  // package.json is at this repository's root and maps to `tool:npm`. If the workspace
  // filenames never reached the tagger, this is the assertion that says so.
  checks.taggedFromWorkspaceFiles = serve.tags.includes("tool:npm")
    ? true
    : `tags were: ${serve.tags.join(", ")}`;

  // types.ts is the restored open editor, so the language signal has to have arrived too.
  checks.taggedFromOpenEditors = serve.tags.includes("lang:typescript")
    ? true
    : `tags were: ${serve.tags.join(", ")}`;

  // §8.2: only compiled-in vocabulary tags leave the machine, ever.
  checks.onlyVocabularyTagsSent = serve.tags.every((t) => /^(lang|fw|tool|platform):/.test(t))
    ? true
    : `tags were: ${serve.tags.join(", ")}`;

  // The theme the user is actually looking at, not the hard-coded default. `midnight` is
  // a dark theme, which is why this compares against the collapsed value.
  const expectedKind = domTheme === "light" ? "light" : "dark";
  checks.themeReportedHonestly = serve.themeKind === expectedKind
    ? true
    : `app theme is ${domTheme}, serve asked for ${serve.themeKind}`;
}

/* ── The round trip: dwell, dismiss, receipt, balance ──────────────────── */

/*
 * Wait out the 8s auto-dismiss.
 *
 * Not shortened, because the thing being measured is §1's impression rule: the toast has to
 * have painted, held focus, and lasted four seconds before a receipt may be written at all.
 * A run that dismissed it early would prove delivery and quietly skip the part where the
 * user earns something.
 */
await sleep(10_000);

checks.toastDismissedItself = (await evaluate(
  `document.querySelector('.toast-sponsored') === null`,
)) === true;

// One more tick, which is what flushes the receipt queue and re-reads the balance.
let earnings = null;
for (let attempt = 0; attempt < 8; attempt++) {
  earnings = await evaluate(`window.adcode.ads.refreshEarnings()`);
  if (server.receiptCount() > 0) break;
  await sleep(1000);
}

checks.receiptReachedServer = server.receiptCount() > 0
  ? true
  : "no receipt was ever posted";

if (typeof earnings === "object" && earnings !== null) {
  checks.balanceMoved = earnings.hasServerBalance === true && earnings.availableLabel !== "$0.00"
    ? true
    : `available read: ${earnings.availableLabel} (hasServerBalance: ${earnings.hasServerBalance})`;
  checks.adsReportedEnabled = earnings.enabled === true;
} else {
  checks.balanceMoved = "no earnings snapshot came back";
}

/* ── A card queued after the editor had already filled its cache ───────── */

/*
 * The admin panel's "Queue test ad", reproduced.
 *
 * The server holds a queued card and hands it over on the next `/v1/serve` - that call is
 * the only place one is ever read. So this asserts the thing that was actually broken: that
 * an editor which has already fetched its creatives goes back and asks again. It did not.
 * `prefetch` refused to fetch while it held anything and nothing expired what it held, so
 * the queued card sat on the server while the admin screen said "Queued".
 */
const QUEUED = {
  ...CREATIVE,
  creativeId: "cr-smoke-queued",
  advertiser: "Latecomer",
  headline: "queued after the cache was already full",
  body: null,
  // What `/v1/serve` marks an admin test card with, so it skips the cadence exactly as a
  // real one does. It still obeys every restraint rule above pacing.
  test: true,
};

server.seed([QUEUED]);

let queuedArrived = false;

// Counted, not merely observed: a client that has stopped asking looks identical to one
// that is asking and being refused, if all you record is the last request.
const servesBefore = server.serveCount();

for (let attempt = 0; attempt < 25 && !queuedArrived; attempt++) {
  queuedArrived = (await evaluate(
    `document.querySelector('.toast-sponsored .toast-title')?.textContent?.includes(${JSON.stringify(QUEUED.advertiser)}) === true`,
  )) === true;
  if (queuedArrived) break;

  await evaluate(`window.adcode.ads.refreshEarnings()`);
  await sleep(1000);
}

const servesAfter = server.serveCount();

checks.queuedCardArrives = queuedArrived
  ? true
  : "a card queued after the first fetch never arrived - the client stopped asking";

checks.clientAskedTheServerAgain = servesAfter > servesBefore
  ? true
  : `the client made no further serve request (still ${servesAfter})`;

checks.statusBarShowsEarnings = await evaluate(
  `(() => {
     const text = document.getElementById('status-earnings')?.textContent ?? '';
     return text.includes('earned') ? true : 'status bar read: "' + text + '"';
   })()`,
);

/* ── Done ──────────────────────────────────────────────────────────────── */

socket.close();
child.kill();
await server.close();
await sleep(500);

const bad = output
  .split(/\r?\n/)
  .filter((line) =>
    /ERROR|Uncaught|Unhandled|Failed to load|Refused to|is not defined|Cannot read|TypeError|SyntaxError/i.test(
      line,
    ),
  )
  .filter(
    (line) =>
      !/gpu|dxgi|passthrough|swiftshader|d3d|vulkan|GLES|cache_util|registration_protocol|Autofill|DevTools listening|AttachConsole/i.test(
        line,
      ),
  );

for (const [name, value] of Object.entries(checks)) {
  process.stdout.write(`  ${name}: ${JSON.stringify(value)}\n`);
}

const adLog = output.split(/\r?\n/).filter((line) => line.includes("[ads]"));
if (adLog.length > 0) {
  process.stdout.write(`\n--- ad client log ---\n`);
  for (const line of adLog) process.stdout.write(`  ${line}\n`);
}

process.stdout.write(`\n--- ${bad.length} suspicious log line(s) ---\n`);
for (const line of bad) process.stdout.write(`  ${line}\n`);

/*
 * Only `true` passes.
 *
 * `smoke.mjs` counts a check that returns a descriptive string as a pass - it is printed
 * but not failed on - which means a check can report a real problem and still exit 0.
 * Every string above is a failure message, so this harness treats it as one.
 */
const failed = Object.entries(checks).filter(([, value]) => value !== true);
if (failed.length > 0) process.stdout.write(`\nfailed: ${failed.map(([n]) => n).join(", ")}\n`);

process.exit(bad.length === 0 && failed.length === 0 ? 0 : 1);
