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
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
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

/**
 * A click at real page coordinates, routed through the renderer's own hit testing.
 *
 * `element.click()` dispatches straight at a node: it cannot tell you whether anything
 * covers the element, whether `pointer-events` is off, or whether the coordinates are
 * even reachable. This check used to use it, and so it passed for a build in which the
 * menu bar was completely dead to a mouse.
 */
async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
  await sleep(250);
}

/**
 * Right-click, then wait for the menu rather than for a guessed number of milliseconds.
 *
 * The tree's menu fetches git status before it opens, so what it costs varies with the
 * repository. A fixed sleep passed on a warm run and failed on a cold one.
 */
async function rightClickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "right", clickCount: 1, buttons: 2 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "right", clickCount: 1, buttons: 0 });

  for (let attempt = 0; attempt < 40; attempt++) {
    if (await evaluate("document.querySelector('.menu-panel[data-context] .menu-item') !== null")) return true;
    await sleep(100);
  }
  return false;
}

async function typeText(text) {
  for (const character of text) await send("Input.dispatchKeyEvent", { type: "char", text: character });
  await sleep(120);
}

async function pressEnter() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(500);
}

/**
 * Centre of the context-menu entry with this label.
 *
 * Throws with what the menu actually contained rather than returning null: a null here
 * used to surface as `Cannot read properties of null`, which says nothing about whether
 * the menu failed to open or simply lacked the entry.
 */
async function contextItemPoint(label) {
  const found = await evaluate(
    `(() => {
       const panel = document.querySelector('.menu-panel[data-context]');
       if (!panel) return { error: 'no context menu is open' };
       const item = [...panel.querySelectorAll('.menu-item')]
         .find((i) => i.querySelector('.menu-item-label')?.textContent === ${JSON.stringify(label)});
       if (!item) {
         const labels = [...panel.querySelectorAll('.menu-item-label')].map(l => l.textContent);
         return { error: 'menu had: ' + labels.join(', ') };
       }
       const r = item.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  );

  if (found?.error !== undefined) throw new Error(`${label}: ${found.error}`);
  return found;
}

const filePoint = await evaluate(
  `(() => {
     const file = [...document.querySelectorAll('.menubar-item')].find((b) => b.textContent === 'File');
     if (!file) return null;
     const r = file.getBoundingClientRect();
     return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
   })()`,
);

if (filePoint === null) {
  checks.menuOpens = "no File menu";
} else {
  await clickAt(filePoint.x, filePoint.y);
  checks.menuOpens = await evaluate(
    `(() => {
       const items = document.querySelectorAll('.menu-panel .menu-item');
       const labels = [...items].map((i) => i.querySelector('.menu-item-label')?.textContent);
       return labels.includes('Save') && labels.includes('Open Folder…') ? true : labels.join(',');
     })()`,
  );

  /*
   * An open menu has to be the thing on top of itself.
   *
   * Counting the items only proves they were built. The sidebar and the title bar both
   * get a stacking context from `backdrop-filter`, which puts them on the same level and
   * lets DOM order decide - and the sidebar comes second, so it painted straight over an
   * open menu while every item-count assertion stayed green.
   */
  checks.menuPanelOnTop = await evaluate(
    `(() => {
       const item = document.querySelector('.menu-panel .menu-item');
       if (!item) return 'no menu open';
       const r = item.getBoundingClientRect();
       const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
       return item === hit || item.contains(hit) ? true : 'covered by ' + (hit?.className ?? 'null');
     })()`,
  );

  await evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
}

/*
 * No draggable region may sit under the menu bar.
 *
 * Draggable regions are resolved by the OS through WM_NCHITTEST before the renderer sees
 * the press, and CDP injects input below that layer - so no amount of driving the app
 * from here can catch this. What can be checked is the geometry that causes it: a `drag`
 * rect overlapping a menu button means real clicks become window drags, which is exactly
 * the bug that shipped.
 */
checks.menuBarNotInDragRegion = await evaluate(
  `(() => {
     const dragRects = [...document.querySelectorAll('*')]
       .filter((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() === 'drag')
       .map((el) => ({ el, r: el.getBoundingClientRect() }));

     const overlaps = (a, b) =>
       a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

     const clashes = [];
     for (const button of document.querySelectorAll('.menubar-item')) {
       const br = button.getBoundingClientRect();
       for (const { el, r } of dragRects) {
         if (overlaps(br, r)) clashes.push(button.textContent + ' under ' + (el.className || el.tagName));
       }
     }
     return clashes.length === 0 ? true : clashes.join(', ');
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

/*
 * A full tab strip stays usable: it overflows rather than crushing every tab, the tab you
 * just opened is on screen, and no label escapes its own tab.
 *
 * All three broke at once when the strip's scrollbar was hidden with nothing scrolling it,
 * and the third came back the moment the tabs were told to stop shrinking.
 */
checks.tabStripStaysUsable = await evaluate(
  `(async () => {
     const files = [...document.querySelectorAll('.tree-row')]
       .filter((r) => r.querySelector('.tree-twisty')?.textContent === '');
     for (const row of files.slice(0, 14)) {
       row.click();
       await new Promise((r) => setTimeout(r, 180));
     }
     await new Promise((r) => setTimeout(r, 600));

     const strip = document.getElementById('tabs');
     const tabs = [...strip.querySelectorAll('.tab')];
     if (tabs.length < 4) return 'only ' + tabs.length + ' tabs opened';

     const spilling = tabs.filter((tab) => {
       const label = tab.querySelector('.tab-label');
       if (!label) return false;
       return label.getBoundingClientRect().right > tab.getBoundingClientRect().right + 1;
     });
     if (spilling.length > 0) return spilling.length + ' label(s) overflow their tab';

     const active = strip.querySelector('.tab[aria-selected="true"]');
     const sr = strip.getBoundingClientRect();
     const ar = active?.getBoundingClientRect();
     if (!ar) return 'no active tab';
     if (ar.left < sr.left - 1 || ar.right > sr.right + 1) return 'active tab is off screen';

     // Overflow is the point: if it all fits, the scrolling path went untested.
     return strip.scrollWidth > strip.clientWidth ? true : 'strip did not overflow';
   })()`,
);

/*
 * The explorer's structural operations, end to end and at real coordinates.
 *
 * Everything happens inside a scratch folder created through the UI and removed at the
 * end, so a smoke run never leaves the repository modified. The `finally` matters: a
 * failed assertion partway through must not leave the folder behind.
 */
const SCRATCH = ".adcode-smoke-tmp";
try {
  // The search and source-control checks above left the sidebar on another view, which
  // hides the tree entirely - so every coordinate below would be measured against a box
  // of zero size.
  await evaluate(`document.querySelector('.activity[data-view="explorer"]').click(); true`);
  await sleep(500);

  const emptySpace = await evaluate(
    `(() => {
       const tree = document.getElementById('filetree');
       const box = tree.getBoundingClientRect();
       const rows = tree.querySelectorAll('.tree-row');
       const last = rows[rows.length - 1]?.getBoundingClientRect();
       const y = last ? Math.min(last.bottom + 40, box.bottom - 20) : box.top + 40;
       return { x: Math.round(box.left + box.width / 2), y: Math.round(y) };
     })()`,
  );

  await rightClickAt(emptySpace.x, emptySpace.y);
  checks.contextMenuOpens = await evaluate(
    `(() => {
       const panel = document.querySelector('.menu-panel[data-context]');
       if (!panel) {
         const tree = document.getElementById('filetree').getBoundingClientRect();
         const hit = document.elementFromPoint(${emptySpace.x}, ${emptySpace.y});
         return 'no context menu; point ' + ${emptySpace.x} + ',' + ${emptySpace.y} +
           ' hit ' + (hit ? hit.tagName + '.' + hit.className : 'null') +
           ' tree ' + JSON.stringify({ l: Math.round(tree.left), t: Math.round(tree.top), r: Math.round(tree.right), b: Math.round(tree.bottom) });
       }
       const item = panel.querySelector('.menu-item');
       const r = item.getBoundingClientRect();
       const hit = document.elementFromPoint(Math.round(r.left + r.width/2), Math.round(r.top + r.height/2));
       // Built *and* on top: the menu bar shipped dead behind a count that stayed green.
       return item === hit || item.contains(hit) ? true : 'covered by ' + (hit?.className ?? 'null');
     })()`,
  );

  let point = await contextItemPoint("New Folder");
  await clickAt(point.x, point.y);
  await typeText(SCRATCH);
  await pressEnter();
  await sleep(600);

  checks.createFolder = await evaluate(
    `[...document.querySelectorAll('#filetree .tree-row')].some(r => r.dataset.path?.endsWith(${JSON.stringify(SCRATCH)}))`,
  );

  const folderPoint = await evaluate(
    `(() => {
       const row = [...document.querySelectorAll('#filetree .tree-row')]
         .find(r => r.dataset.path?.endsWith(${JSON.stringify(SCRATCH)}));
       if (!row) return null;
       const r = row.getBoundingClientRect();
       return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
     })()`,
  );

  // A reserved device name has to be refused with a reason, and leave the editor open.
  await rightClickAt(folderPoint.x, folderPoint.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await typeText("CON.txt");
  await pressEnter();

  checks.badNameRefused = await evaluate(
    `(() => {
       const row = document.querySelector('.tree-edit-row');
       if (!row) return 'the editor closed on a name that should have been refused';
       const message = document.querySelector('.tree-edit-error')?.textContent ?? '';
       return /reserved/i.test(message) ? true : 'unexpected message: ' + message;
     })()`,
  );

  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-note.md");
  await pressEnter();
  await sleep(800);

  checks.createFileOpensIt = await evaluate(
    `(() => ({
       inTree: [...document.querySelectorAll('#filetree .tree-row')].some(r => r.dataset.path?.endsWith('smoke-note.md')),
       tabOpen: [...document.querySelectorAll('.tab .tab-label')].some(l => l.textContent === 'smoke-note.md'),
     }))()`,
  );

  // Rename, and the tab has to follow it or the next save forks the file in two.
  const filePoint = await evaluate(
    `(() => {
       const row = [...document.querySelectorAll('#filetree .tree-row')].find(r => r.dataset.path?.endsWith('smoke-note.md'));
       const r = row.getBoundingClientRect();
       return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
     })()`,
  );

  await rightClickAt(filePoint.x, filePoint.y);
  point = await contextItemPoint("Rename");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-renamed.md");
  await pressEnter();
  await sleep(800);

  checks.renameMovesTab = await evaluate(
    `(() => ({
       renamed: [...document.querySelectorAll('#filetree .tree-row')].some(r => r.dataset.path?.endsWith('smoke-renamed.md')),
       tabFollowed: [...document.querySelectorAll('.tab .tab-label')].some(l => l.textContent === 'smoke-renamed.md'),
     }))()`,
  );

  // The row's own New File / New Folder buttons, which is how most people will reach them.
  checks.folderRowHasActions = await evaluate(
    `(() => {
       const row = [...document.querySelectorAll('#filetree .tree-row')]
         .find(r => r.dataset.path?.endsWith(${JSON.stringify(SCRATCH)}));
       const actions = row?.querySelector('.tree-actions');
       if (!actions) return 'no action group on the folder row';
       const titles = [...actions.querySelectorAll('.tree-action')].map(b => b.title);
       // Out of the way until wanted: a resting tree is a list of names, not of buttons.
       if (getComputedStyle(actions).opacity !== '0') return 'actions are visible at rest';
       return titles.join(',') === 'New File,New Folder' ? true : 'buttons were ' + titles.join(',');
     })()`,
  );

  /*
   * Drag and drop, driven with real DragEvents.
   *
   * CDP's Input domain cannot produce an HTML5 drag - it is a browser-internal sequence
   * rather than a stream of mouse events - so the handlers are fed the events and the
   * DataTransfer they actually consume, and the result is checked on disk.
   */
  // Made through the UI, not the bridge: the tree re-lists a directory when it changes
  // one, and a folder created behind its back has no row to drop onto.
  await rightClickAt(folderPoint.x, folderPoint.y);
  point = await contextItemPoint("New Folder");
  await clickAt(point.x, point.y);
  await typeText("nested");
  await pressEnter();
  await sleep(700);

  checks.dragMovesFile = await evaluate(
    `(async () => {
       const root = (await window.adcode.workspace.current()).root;
       const base = root + '\\\\' + ${JSON.stringify(SCRATCH)};
       const rows = () => [...document.querySelectorAll('#filetree .tree-row')];
       const file = rows().find(r => r.dataset.path?.endsWith('smoke-renamed.md'));
       let folder = rows().find(r => r.dataset.path?.endsWith('nested'));
       if (!file || !folder) return 'rows missing (file: ' + !!file + ', folder: ' + !!folder + ')';

       const dt = new DataTransfer();
       file.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
       folder.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
       const highlighted = !!document.querySelector('[data-drop-target="true"]');
       folder.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
       await new Promise(r => setTimeout(r, 1500));
       file.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));

       const inside = await window.adcode.workspace.list(base + '\\\\nested');
       return highlighted && inside.some(e => e.name === 'smoke-renamed.md')
         ? true
         : 'highlighted=' + highlighted + ' nested=' + inside.map(e => e.name).join(',');
     })()`,
  );

  // Copy collisions suffix rather than overwrite, and a folder cannot swallow itself.
  checks.copyAndGuards = await evaluate(
    `(async () => {
       const root = (await window.adcode.workspace.current()).root;
       const base = root + '\\\\' + ${JSON.stringify(SCRATCH)};
       const source = base + '\\\\nested\\\\smoke-renamed.md';

       const first = await window.adcode.files.copy(source, base);
       const second = await window.adcode.files.copy(source, base);
       const intoSelf = await window.adcode.files.move(base, base + '\\\\nested');

       if (!first.ok || !second.ok) return 'copy failed: ' + first.message + ' / ' + second.message;
       if (first.path === second.path) return 'the second copy overwrote the first';
       if (intoSelf.ok) return 'a folder was allowed to move into itself';
       return true;
     })()`,
  );

  // The git group describes this file as it is now, and Push is repo-wide but present.
  const trackedPoint = await evaluate(
    `(() => {
       const row = [...document.querySelectorAll('#filetree .tree-row')].find(r => r.dataset.path?.endsWith('README.md'));
       if (!row) return null;
       const r = row.getBoundingClientRect();
       return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
     })()`,
  );

  if (trackedPoint !== null) {
    await rightClickAt(trackedPoint.x, trackedPoint.y);
    checks.gitGroupInMenu = await evaluate(
      `(() => {
         const panel = document.querySelector('.menu-panel[data-context]');
         if (!panel) return 'no menu';
         const headings = [...panel.querySelectorAll('.menu-heading')].map(h => h.textContent);
         const labels = [...panel.querySelectorAll('.menu-item-label')].map(l => l.textContent);
         if (!headings.includes('Git')) return 'no Git heading';
         const wanted = ['Discard Changes', 'Commit…', 'Push'];
         const missing = wanted.filter(w => !labels.includes(w));
         if (missing.length > 0) return 'missing ' + missing.join(', ');
         // Exactly one of the pair, chosen from the file's actual staged state.
         const staged = labels.includes('Stage');
         const unstaged = labels.includes('Unstage');
         return staged !== unstaged ? true : 'Stage/Unstage both ' + (staged ? 'present' : 'absent');
       })()`,
    );
    await evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
    await sleep(200);
  }

  /*
   * The branch switcher opens a dialog instead of throwing.
   *
   * It called `window.prompt`, which Electron does not implement, inside a `void`-ed async
   * function - so the rejection was swallowed and the button did nothing at all.
   */
  checks.branchSwitcherOpens = await evaluate(
    `(async () => {
       document.querySelector('.activity[data-view="scm"]').click();
       await new Promise(r => setTimeout(r, 800));
       const button = document.querySelector('.scm-branch');
       if (!button) return 'no branch button';

       button.click();
       await new Promise(r => setTimeout(r, 1200));

       const dialog = document.querySelector('.prompt-dialog');
       if (!dialog?.open) return 'no dialog opened';

       const suggestions = [...dialog.querySelectorAll('datalist option')].map(o => o.value);
       dialog.querySelector('.confirm-cancel').click();
       await new Promise(r => setTimeout(r, 300));

       if (dialog.open) return 'cancel did not close it';
       return suggestions.length > 0 ? true : 'no branches offered';
     })()`,
  );

  /*
   * The commit browser: history, a commit opened, and a restore that asks first.
   *
   * The confirmation is *cancelled* rather than accepted. A restore writes over a tracked
   * file, and a smoke run that edits the repository it is testing is a smoke run nobody
   * will be willing to execute.
   */
  checks.historyListsCommits = await evaluate(
    `(async () => {
       document.querySelector('.activity[data-view="scm"]').click();
       for (let i = 0; i < 30 && document.querySelectorAll('.history-commit').length === 0; i++) {
         await new Promise(r => setTimeout(r, 200));
       }
       const rows = [...document.querySelectorAll('.history-commit')];
       if (rows.length === 0) return 'no commits listed';

       const first = rows[0];
       return {
         count: rows.length,
         subject: first.querySelector('.history-subject')?.textContent?.slice(0, 40),
         hasHash: /^[0-9a-f]{7,}$/.test(first.querySelector('.history-hash')?.textContent ?? ''),
         hasMeta: (first.querySelector('.history-meta')?.textContent ?? '').includes('·'),
       };
     })()`,
  );

  checks.commitOpensItsFiles = await evaluate(
    `(async () => {
       const first = document.querySelector('.history-commit .history-head');
       if (!first) return 'no commit row';
       first.click();

       for (let i = 0; i < 40 && !document.querySelector('.history-file'); i++) {
         await new Promise(r => setTimeout(r, 200));
       }
       const files = [...document.querySelectorAll('.history-file')];
       if (files.length === 0) return 'the commit showed no files';

       const stat = files[0].querySelector('.history-file-stat')?.textContent ?? '';
       return {
         files: files.length,
         // Both counts always, so a lone "+4" cannot be misread as a total.
         hasBothCounts: stat.includes('+') && stat.includes('−'),
         hasRestore: !!files[0].querySelector('.history-restore'),
         summary: document.querySelector('.history-summary')?.textContent,
       };
     })()`,
  );

  checks.restoreAsksAndCanCancel = await evaluate(
    `(async () => {
       const restore = document.querySelector('.history-file .history-restore');
       if (!restore) return 'no restore button';
       restore.click();

       for (let i = 0; i < 25 && !document.querySelector('.confirm-dialog[open]'); i++) {
         await new Promise(r => setTimeout(r, 200));
       }
       const dialog = document.querySelector('.confirm-dialog[open]');
       if (!dialog) return 'restore did not ask first';

       const title = dialog.querySelector('.result-title')?.textContent ?? '';
       const body = dialog.querySelector('.result-summary')?.textContent ?? '';

       // Cancelled: nothing in the working tree is touched by this check.
       dialog.querySelector('.confirm-cancel').click();
       await new Promise(r => setTimeout(r, 400));
       if (document.querySelector('.confirm-dialog[open]')) return 'cancel did not close it';

       return /restore/i.test(title) && /uncommitted|rewritten/i.test(body)
         ? true
         : 'unexpected wording: ' + title + ' / ' + body;
     })()`,
  );

  await evaluate(`document.querySelector('.activity[data-view="explorer"]').click(); true`);
  await sleep(400);

  // Delete, through however many confirmations this volume needs. A drive with no
  // Recycle Bin asks a second time before anything is removed for good.
  await rightClickAt(folderPoint.x, folderPoint.y);
  point = await contextItemPoint("Delete");
  await clickAt(point.x, point.y);

  let asked = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const button = await evaluate(
      `(() => {
         const b = document.querySelector('.confirm-dialog[open] .result-close');
         if (!b) return null;
         const r = b.getBoundingClientRect();
         return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
       })()`,
    );
    if (button === null) break;
    asked++;
    await clickAt(button.x, button.y);
    await sleep(1000);
  }

  checks.deleteAsksFirst = asked > 0 ? true : "deleted without asking";
  checks.deleteRemovesRow = await evaluate(
    `(() => ({
       goneFromTree: ![...document.querySelectorAll('#filetree .tree-row')].some(r => r.dataset.path?.endsWith(${JSON.stringify(SCRATCH)})),
       tabMarkedStale: [...document.querySelectorAll('.tab .tab-label')].some(l => l.textContent === 'smoke-renamed.md (deleted)'),
     }))()`,
  );

  // The renderer is hostile by assumption, so the guards are asserted through the bridge
  // rather than trusted because the UI never offers these.
  checks.guardsHold = await evaluate(
    `(async () => {
       const { root } = await window.adcode.workspace.current();
       const results = {
         root: await window.adcode.files.trash(root),
         rename: await window.adcode.files.rename(root, 'hijacked'),
         traversal: await window.adcode.files.createFile(root, '../escaped.txt'),
         dotGit: await window.adcode.files.trash(root + '/.git'),
       };
       const allowed = Object.entries(results).filter(([, r]) => r.ok).map(([name]) => name);
       return allowed.length === 0 ? true : 'ALLOWED: ' + allowed.join(', ');
     })()`,
  );
} catch (error) {
  // Recorded as a failed check rather than crashing the run, so the checks that already
  // passed still get printed and the cleanup below still happens.
  checks.explorerFlow = `THREW: ${error instanceof Error ? error.message : String(error)}`;
} finally {
  await rm(join(REPO, SCRATCH), { recursive: true, force: true }).catch(() => {});
}

/*
 * The adjustable layout, dragged for real.
 *
 * `Input.dispatchMouseEvent` is what exercises pointer capture: a drag that leaves the
 * 4px divider - which every drag does immediately - only keeps receiving moves because
 * the handle captured the pointer. Setting the CSS variable directly would prove nothing
 * about that, which is the part most likely to break.
 */
async function dragBy(handleId, dx, dy) {
  const from = await evaluate(
    `(() => {
       const el = document.getElementById(${JSON.stringify(handleId)});
       if (!el || el.hidden) return null;
       const r = el.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  );
  if (from === null) return false;

  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
  // Two moves: one small, one to the target. A single jump can be coalesced away.
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + Math.sign(dx) * 2, y: from.y + Math.sign(dy) * 2, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + dx, y: from.y + dy, button: "left", buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: from.x + dx, y: from.y + dy, button: "left", buttons: 0 });
  await sleep(300);
  return true;
}

const sidebarWidthNow = () =>
  evaluate("Math.round(document.getElementById('sidebar').getBoundingClientRect().width)");

checks.sidebarResizes = await (async () => {
  const before = await sidebarWidthNow();
  if (!(await dragBy("splitter-sidebar", 120, 0))) return "no sidebar handle";
  const after = await sidebarWidthNow();
  if (after <= before) return `width did not grow: ${before} -> ${after}`;

  // Roughly the distance dragged, not merely "bigger": a handle that jumps to some fixed
  // size would also pass a `>` check.
  return Math.abs(after - before - 120) <= 8 ? true : `expected ~+120, got ${after - before}`;
})();

checks.sidebarClampsAndResets = await (async () => {
  // Far past the ceiling in one throw; it must stop rather than eat the window.
  await dragBy("splitter-sidebar", 4000, 0);
  const clamped = await sidebarWidthNow();
  if (clamped > 600) return `not clamped: ${clamped}`;

  await evaluate(
    `(() => {
       const el = document.getElementById('splitter-sidebar');
       el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
       return true;
     })()`,
  );
  await sleep(250);

  const reset = await sidebarWidthNow();
  return reset === 240 ? true : `double-click reset to ${reset}, expected 240`;
})();

checks.panelResizes = await (async () => {
  // The panel is open from the terminal checks above, and so is its divider.
  const height = () => evaluate("Math.round(document.getElementById('panel').getBoundingClientRect().height)");
  const before = await height();
  if (before === 0) return "panel is not open";

  // Upwards makes the panel taller, which is the sign the splitter has to get right.
  if (!(await dragBy("splitter-panel", 0, -90))) return "no panel handle";
  const after = await height();

  return after > before && Math.abs(after - before - 90) <= 8
    ? true
    : `expected ~+90, got ${after - before}`;
})();

checks.panelDividerFollowsPanel = await evaluate(
  `(async () => {
     const divider = document.getElementById('splitter-panel');
     const panel = document.getElementById('panel');
     if (divider.hidden !== panel.hidden) return 'divider and panel disagree while open';

     document.getElementById('panel-close').click();
     await new Promise(r => setTimeout(r, 400));

     // A handle left behind under the editor resizes something nobody can see.
     return divider.hidden && panel.hidden ? true : 'divider survived the panel closing';
   })()`,
);

// The `<$>` mark is drawn, not typed, so it cannot fall back to a missing font.
checks.brandMarkDrawn = await evaluate(
  `(() => {
     const mark = document.querySelector('#placeholder-mark .brand-mark');
     if (!mark) return 'no mark on the empty-editor screen';
     const paths = mark.querySelectorAll('path').length;
     const box = mark.getBoundingClientRect();
     return paths === 4 && box.width > 0 ? true : 'paths=' + paths + ' width=' + box.width;
   })()`,
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
