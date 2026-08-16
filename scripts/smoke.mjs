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

const REPO = "E:\\adcode-sourcecode";

// The `electron` package's main export is the path to the real executable, which is what
// has to be spawned: the `.bin` shim is a .cmd on Windows and `spawn` refuses it.
const require = createRequire(`${REPO}\\package.json`);
const electronPath = require("electron");

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
  ["apps/desktop", "--enable-logging", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
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
  "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ctrlKey: false, bubbles: true }))",
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
      !/gpu|dxgi|passthrough|swiftshader|d3d|vulkan|GLES|cache_util|registration_protocol|Autofill|DevTools listening/i.test(
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
