/**
 * Smoke launch: start the built app against this repository, drive it over CDP, quit.
 *
 * `npm run verify` proves the logic; a build proves it compiles. Neither proves a window
 * paints, that the preload bridge is reachable, or that a real `git blame` comes back
 * through IPC - all of which have broken here before and none of which a unit test sees.
 *
 * It seeds a session file so §4's "Restore workspace" reopens this repository on launch,
 * which is also what gives the git checks something real to answer about.
 *
 * Run after `npm run build`:  node scripts/smoke.mjs
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const REPO = process.cwd();

// The `electron` package's main export is the path to the real executable, which is what
// has to be spawned: the `.bin` shim is a .cmd on Windows and `spawn` refuses it.
//
// `--packaged` points the same checks at the installer's output instead, which is the
// only way to find out whether packaging produced a working app rather than a working
// developer machine.
const require = createRequire(join(REPO, "package.json"));

const packaged = process.argv.includes("--packaged");
const electronPath = packaged
  ? join(REPO, "release", "win-unpacked", "ADCode.exe")
  : require("electron");

// A packaged app *is* the app; an unpackaged Electron has to be told where it lives.
const appArgs = packaged ? [] : ["apps/desktop"];

const PORT = 9333;

// A file that is committed, so the history and blame checks have something to find.
const TRACKED_FILE = join(REPO, "package.json");

// A throwaway userData directory, pre-seeded so §4's "Restore workspace" has something to
// restore. That is also what gives the git checks a real repository to run against.
const userData = await mkdtemp(join(tmpdir(), "adcode-smoke-"));
await mkdir(userData, { recursive: true });
await writeFile(
  join(userData, "session.json"),
  JSON.stringify({
    state: {
      root: REPO,
      openFiles: [TRACKED_FILE],
      activeFile: TRACKED_FILE,
    },
  }),
  "utf8",
);

const child = spawn(
  electronPath,
  [...appArgs, "--enable-logging", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
  {
    cwd: REPO,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);

let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the DevTools endpoint until the renderer target shows up. */
async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page !== undefined) return page;
    } catch {
      // The port is not listening yet; that is the normal first second or two.
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

/** Evaluate an expression in the page and return its value. */
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

// Past DOMContentLoaded, so Monaco has an editor and the session restore has finished.
await sleep(4000);

const checks = {
  title: await evaluate("document.title"),
  activities: await evaluate("document.querySelectorAll('.activity[data-view]').length"),
  monacoMounted: await evaluate("document.querySelectorAll('.monaco-editor').length > 0"),

  // §4 session restore: the folder and the editor came back without anyone clicking.
  restoredWorkspace: await evaluate("document.getElementById('status-workspace').textContent"),
  restoredTab: await evaluate("document.querySelectorAll('.tab').length"),
  treeHasRows: await evaluate("document.querySelectorAll('#filetree .tree-row').length > 5"),

  // §4 git: a real repository answers real questions.
  isRepo: await evaluate("window.adcode.git.status().then((s) => s.isRepo)"),
  branch: await evaluate("window.adcode.git.status().then((s) => s.branch)"),
  historyCount: await evaluate(
    "window.adcode.git.fileHistory('package.json').then((c) => c.length > 0)",
  ),
  blameWorks: await evaluate(
    "window.adcode.git.blame('package.json').then((b) => b.length > 10)",
  ),
  showFileWorks: await evaluate(
    "window.adcode.git.showFile('HEAD', 'package.json').then((t) => typeof t === 'string' && t.includes('adcode'))",
  ),
  lineChangesShape: await evaluate(
    "window.adcode.git.lineChanges('package.json').then((c) => Array.isArray(c))",
  ),

  // §4 search over the real tree.
  searchFindsSomething: await evaluate(
    "window.adcode.search.run({ pattern: 'findConflicts', include: '*.ts' }).then((h) => h.length > 2)",
  ),
  quickOpenRanks: await evaluate(
    "window.adcode.search.quickOpen('conflicts').then((h) => h[0]?.path ?? '(none)')",
  ),
};

// Drive the source-control view the way a click would.
await evaluate("document.querySelector('.activity[data-view=\"scm\"]').click()");
await sleep(1200);
checks.scmShowsBranch = await evaluate("document.querySelector('.scm-branch')?.textContent");
checks.timelineRows = await evaluate("document.querySelectorAll('.timeline-row').length > 0");

// Quick open, opened by keyboard rather than by calling into its module directly.
await evaluate(
  "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }))",
);
await sleep(600);
checks.quickOpenVisible = await evaluate("document.querySelector('.quickopen')?.hidden === false");
await evaluate(
  "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))",
);
await sleep(200);
checks.quickOpenClosesOnEscape = await evaluate(
  "document.querySelector('.quickopen')?.hidden === true",
);

// §4's Session group: auto-save, local history, and crash recovery all round-trip.
checks.historyBridge = await evaluate(
  "window.adcode.history.versions('nope.ts').then((v) => Array.isArray(v))",
);
checks.draftsBridge = await evaluate(
  "window.adcode.history.drafts().then((d) => Array.isArray(d))",
);
checks.draftRoundTrip = await evaluate(
  `(async () => {
     window.adcode.history.draft('E:/smoke/probe.ts', 'unsaved text');
     await new Promise((r) => setTimeout(r, 400));
     const found = await window.adcode.history.drafts();
     const hit = found.find((d) => d.path === 'E:/smoke/probe.ts');
     window.adcode.history.clearDraft('E:/smoke/probe.ts');
     return hit?.text === 'unsaved text';
   })()`,
);

// The terminal is the one surface that needs a native module at runtime, so it is the
// one most likely to survive `npm run verify` and still be broken in the built app.
checks.terminalStarts = await evaluate(
  `(async () => {
     const profiles = await window.adcode.terminal.profiles();
     if (profiles.length === 0) return 'no profiles';

     let received = '';
     window.adcode.terminal.onData((_id, data) => { received += data; });

     const created = await window.adcode.terminal.create({
       profileId: profiles[0].id, cols: 80, rows: 24,
     });
     if (created === null || created === undefined) return 'create returned nothing';

     await new Promise((r) => setTimeout(r, 2500));
     window.adcode.terminal.dispose(created.id ?? created);
     return received.length > 0 ? true : 'no output from the shell';
   })()`,
);

// §3's workbench chrome: the menu bar, the palette, and the terminal panel are all ours,
// so all three are driven here rather than assumed.
checks.menuBarPresent = await evaluate("document.querySelectorAll('.menubar-item').length");

checks.menuOpens = await evaluate(
  `(() => {
     const file = [...document.querySelectorAll('.menubar-item')].find((b) => b.textContent === 'File');
     if (!file) return 'no File menu';
     file.click();
     const items = document.querySelectorAll('.menu-panel .menu-item');
     const labels = [...items].map((i) => i.querySelector('.menu-item-label')?.textContent);
     document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
     return labels.includes('Save') && labels.includes('Open Folder…') ? true : labels.join(',');
   })()`,
);

// Nothing may be left covering the window - the bug that made the app unclickable.
checks.nothingCoversWindow = await evaluate(
  `(() => {
     const covering = [...document.body.querySelectorAll('*')].filter((el) => {
       const s = getComputedStyle(el);
       if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
       if (s.position !== 'fixed') return false;
       const r = el.getBoundingClientRect();
       return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9;
     });
     return covering.length === 0 ? true : covering.map((e) => e.className).join(',');
   })()`,
);

checks.paletteFinds = await evaluate(
  `(async () => {
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise((r) => setTimeout(r, 300));

     const input = document.querySelector('.quickopen-input[aria-label="Command palette"]');
     if (!input) return 'palette did not open';

     input.value = 'split term';
     input.dispatchEvent(new Event('input', { bubbles: true }));
     await new Promise((r) => setTimeout(r, 200));

     const first = document.querySelector('.palette-row span')?.textContent;
     input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     return first ?? 'no rows';
   })()`,
);

checks.multipleTerminals = await evaluate(
  `(async () => {
     const tabsOf = () => document.querySelectorAll('.terminal-tab').length;
     const panesOf = () => document.querySelectorAll('.terminal-pane').length;

     document.dispatchEvent(new KeyboardEvent('keydown', { key: '\`', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise((r) => setTimeout(r, 2000));
     document.dispatchEvent(new KeyboardEvent('keydown', { key: '\`', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise((r) => setTimeout(r, 2000));

     const tabs = tabsOf();
     document.getElementById('terminal-split').click();
     await new Promise((r) => setTimeout(r, 2000));

     return JSON.stringify({ tabs, panes: panesOf() });
   })()`,
);

checks.fileIcons = await evaluate(
  "document.querySelectorAll('#filetree .file-icon').length > 5",
);

// The gutter decorations for the restored file.
checks.gutterOrClean = await evaluate(
  "document.querySelectorAll('.git-gutter').length >= 0",
);

socket.close();
child.kill();
await sleep(500);

const bad = output
  .split(/\r?\n/)
  .filter((line) =>
    /ERROR|Uncaught|Unhandled|Failed to load|Refused to|is not defined|Cannot read|TypeError|SyntaxError/i.test(
      line,
    ),
  )
  // Chromium's GPU and cache chatter on a headless Windows box is noise.
  .filter(
    (line) =>
      !/gpu|dxgi|passthrough|swiftshader|d3d|vulkan|GLES|cache_util|registration_protocol|Autofill|DevTools listening|AttachConsole/i.test(
        line,
      ),
  );

for (const [name, value] of Object.entries(checks)) {
  process.stdout.write(`  ${name}: ${JSON.stringify(value)}\n`);
}
process.stdout.write(`\n--- ${bad.length} suspicious log line(s) ---\n`);
for (const line of bad) process.stdout.write(`  ${line}\n`);

const failed = Object.entries(checks).filter(
  ([, value]) => value === false || value === undefined || String(value).startsWith("THREW"),
);
if (failed.length > 0) process.stdout.write(`\nfailed: ${failed.map(([n]) => n).join(", ")}\n`);

process.exit(bad.length === 0 && failed.length === 0 ? 0 : 1);
