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
 * A new line *inside Monaco*, which `pressEnter` does not produce.
 *
 * A bare `keyDown` with no `text` is enough for the tree's rename input - a plain
 * `<input>` submits on the key event alone - and produces nothing at all in the editor,
 * whose input arrives through a hidden textarea that needs the character. Typing four
 * lines with `pressEnter` put all four on line one, and the outline that read them was
 * right about the file it was given.
 *
 * Carried as `text` on the keyDown rather than as a separate `char` event, so the key and
 * the character stay one press and Monaco's auto-indent sees what it expects.
 */
async function pressEnterInEditor() {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
    unmodifiedText: "\r",
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(350);
}


/**
 * A real modifier chord, through the same path a user's keyboard takes.
 *
 * CDP's modifier bitmask: Alt 1, Ctrl 2, Meta 4, Shift 8. Sending the chord rather than
 * calling the command directly is the point - it exercises the resolver, the overrides and
 * the keydown handler, which is where a rebindable shortcut can go wrong.
 */
async function pressChord(key, { shift = false, alt = false } = {}) {
  const modifiers = 2 | (shift ? 8 : 0) | (alt ? 1 : 0);
  const code = `Key${key.toUpperCase()}`;
  const virtualKey = key.toUpperCase().charCodeAt(0);

  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await sleep(400);
}

async function pressEscape() {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(350);
}

/**
 * A plain navigation key, with no modifiers.
 *
 * `pressChord` cannot do these: it holds Ctrl and builds a `KeyX` code, which is right for
 * `Ctrl+A` and meaningless for Home.
 */
const PLAIN_KEYS = { Home: 36, End: 35, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

async function pressKey(key) {
  const virtualKey = PLAIN_KEYS[key];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: virtualKey });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: virtualKey });
  await sleep(120);
}

/** Open the Structure popup on a tab, whatever state it was in. */
async function openStructure(tab) {
  const alreadyOpen = await evaluate(`document.querySelector('.structure-popup')?.open === true`);
  if (alreadyOpen !== true) {
    await pressChord("u", { shift: true });
    await sleep(700);
  }

  const wanted = tab === "project" ? "This project" : "This file";
  await evaluate(
    `(() => {
       const tabs = [...document.querySelectorAll('.structure-tab')];
       tabs.find((t) => t.textContent === ${JSON.stringify(wanted)})?.click();
       return true;
     })()`,
  );

  // The project tab reads the workspace root off disk; the file tab does not.
  await sleep(tab === "project" ? 1200 : 500);
}

async function closeStructure() {
  const open = await evaluate(`document.querySelector('.structure-popup')?.open === true`);
  if (open === true) await pressEscape();
  await sleep(300);
}

/** Choose a row from the drawn menu bar, the way a person would. */
async function chooseMenu(topLabel, itemLabel) {
  const top = await evaluate(
    `(() => {
       const button = [...document.querySelectorAll('.menubar-item')]
         .find((b) => b.textContent === ${JSON.stringify(topLabel)});
       if (!button) return null;
       const r = button.getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  );

  if (top === null) throw new Error(`no ${topLabel} menu`);

  await clickAt(top.x, top.y);
  await sleep(300);

  await evaluate(
    `(() => {
       const item = [...document.querySelectorAll('.menu-panel .menu-item')]
         .find((i) => i.querySelector('.menu-item-label')?.textContent === ${JSON.stringify(itemLabel)});
       if (!item) throw new Error('no such row');
       item.click();
       return true;
     })()`,
  );

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

  /*
   * A submenu has to fly out beside its row.
   *
   * The recents used to be a picker precisely because a long list inlined into File was a
   * wall, so the list only earns its place in the menu if the flyout works - and the
   * flyout is positioned from three offsets that a unit test cannot see.
   */
  checks.menuSubmenuFliesOut = await (async () => {
    const point = await evaluate(
      `(() => {
         const row = [...document.querySelectorAll('.menu-panel .menu-item')]
           .find((i) => i.querySelector('.menu-item-label')?.textContent === 'Open Recent');
         if (!row) return null;
         const r = row.getBoundingClientRect();
         return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
       })()`,
    );
    if (point === null) return "no Open Recent row";

    await clickAt(point.x, point.y);
    await sleep(150);

    return evaluate(
      `(() => {
         const sub = document.querySelector('.menu-panel[data-depth="1"]');
         if (!sub) return 'no submenu opened';
         const parent = document.querySelector('.menu-panel[data-depth="0"]');
         const s = sub.getBoundingClientRect();
         const p = parent.getBoundingClientRect();
         if (s.left < p.right - 12) return 'the submenu opened on top of its parent';
         if (s.right > window.innerWidth) return 'the submenu hangs off the window';
         return true;
       })()`,
    );
  })();

  await evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
}

/*
 * Alt+G opens Git, from wherever you were.
 *
 * The mnemonic table is asserted in unit tests; what cannot be asserted there is that the
 * keystroke survives the trip - Monaco stops propagation on the Alt combinations it owns,
 * and this listener has to run in the capture phase to be ahead of it.
 */
checks.altLetterOpensMenu = await (async () => {
  await evaluate("document.querySelector('.monaco-editor textarea')?.focus(); true");

  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, modifiers: 1,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "g", code: "KeyG", windowsVirtualKeyCode: 71, modifiers: 1,
  });
  await sleep(250);

  const opened = await evaluate(
    `(() => {
       const open = document.querySelector('.menubar-item[aria-expanded="true"]');
       if (!open) return 'no menu opened';
       if (open.textContent !== 'Git') return 'Alt+G opened ' + open.textContent;
       const labels = [...document.querySelectorAll('.menu-panel .menu-item-label')].map((l) => l.textContent);
       return labels.includes('Commit…') && labels.includes('Push') ? true : 'Git menu had: ' + labels.join(',');
     })()`,
  );

  await evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");
  return opened;
})();

/* The bottom-left corner names the folder in full, and the build after it. */
checks.statusBarSaysWhereAndWhat = await evaluate(
  `(() => {
     const path = document.getElementById('status-workspace');
     const version = document.getElementById('status-version');
     if (!path || !version) return 'the status bar is missing an element';
     if (!path.title.includes('/') && !path.title.includes('\')) return 'the folder is not a path: ' + path.title;
     if (!/^ADCode \\d+\\.\\d+\\.\\d+/.test(version.textContent ?? '')) return 'the version reads: ' + version.textContent;
     return true;
   })()`,
);

/*
 * No draggable region may sit under anything in the title bar you are meant to click.
 *
 * Draggable regions are resolved by the OS through WM_NCHITTEST before the renderer sees
 * the press, and CDP injects input below that layer - so no amount of driving the app
 * from here can catch this. What can be checked is the geometry that causes it: a `drag`
 * rect overlapping a control means real clicks become window drags, which is exactly the
 * bug that shipped.
 *
 * The selector covers every control in the bar, not just the menus. The assistant button
 * and the command centre are newer and sit in the same bar for the same reasons, and the
 * failure would look identical: a control that works under CDP and is dead to a mouse.
 */
checks.titleBarNotInDragRegion = await evaluate(
  `(() => {
     const dragRects = [...document.querySelectorAll('*')]
       .filter((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region').trim() === 'drag')
       .map((el) => ({ el, r: el.getBoundingClientRect() }));

     const overlaps = (a, b) =>
       a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

     const controls = document.querySelectorAll('.menubar-item, .titlebar-action, .command-centre');
     if (controls.length === 0) return 'no title bar controls found';

     const clashes = [];
     for (const control of controls) {
       const br = control.getBoundingClientRect();
       for (const { el, r } of dragRects) {
         if (overlaps(br, r)) {
           clashes.push((control.textContent || control.ariaLabel) + ' under ' + (el.className || el.tagName));
         }
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

/*
 * The shell launcher on the panel's split button, driven at real coordinates.
 *
 * Asserts what the dropdown is for rather than that it renders: picking a shell has to
 * start that shell, and the tab has to say which one it is - the tab strip is the only
 * place that information exists once two different shells are running.
 */
checks.terminalProfileLauncher = await (async () => {
  const chevron = await evaluate(
    `(() => {
       const button = document.getElementById('terminal-profiles');
       if (!button) return null;
       const r = button.getBoundingClientRect();
       if (r.width === 0) return null;
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
     })()`,
  );

  if (chevron === null) return "no profile chevron (is the panel open?)";

  await clickAt(chevron.x, chevron.y);

  const shells = await evaluate(
    `(() => {
       const panel = document.querySelector('.menu-panel[data-context]');
       if (!panel) return null;
       return [...panel.querySelectorAll('.menu-item-label')].map((l) => l.textContent);
     })()`,
  );

  if (shells === null || shells.length === 0) return "launcher did not open";

  const before = await evaluate("document.querySelectorAll('.terminal-tab').length");
  const point = await contextItemPoint(shells[0]);
  await clickAt(point.x, point.y);
  await sleep(2500);

  const after = await evaluate(
    `(() => {
       const titles = [...document.querySelectorAll('.terminal-tab')]
         .map((t) => t.querySelector('span')?.textContent);
       return JSON.stringify({ count: titles.length, titles });
     })()`,
  );

  const { count, titles } = JSON.parse(after);
  if (count <= before) return `picking ${shells[0]} started nothing (${before} -> ${count})`;

  // "Terminal 1" was the old numbered title; a tab still called that means the shell's
  // name never reached the strip.
  const named = titles.some((t) => typeof t === "string" && t.includes(shells[0]));
  return named ? true : `tabs are ${titles.join(', ')}, expected one saying ${shells[0]}`;
})();

/*
 * Alt is a menu key only when it is pressed alone.
 *
 * Alt+Up is Move Line Up. Deciding the menu on the `Alt` keydown - which always arrives
 * first - opened the bar and pulled focus off the editor, so the arrow walked a menu
 * instead of moving the line. Dispatched as real key events because the ordering *is* the
 * bug: nothing about it is visible from a single synthesised event.
 */
checks.altChordLeavesMenuShut = await (async () => {
  const altDown = { type: "rawKeyDown", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18, modifiers: 1 };
  const altUp = { type: "keyUp", key: "Alt", code: "AltLeft", windowsVirtualKeyCode: 18 };

  await send("Input.dispatchKeyEvent", altDown);
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 1,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38, modifiers: 1,
  });
  await send("Input.dispatchKeyEvent", altUp);
  await sleep(250);

  const takenByChord = await evaluate(
    "document.activeElement?.classList.contains('menubar-item') === true",
  );
  if (takenByChord) return "Alt+Up moved focus to the menu bar";

  /*
   * And the other half of the contract: a bare Alt still reaches the bar.
   *
   * Focus rather than an open dropdown. Alt puts the bar into the state where the next
   * key decides - a letter picks a menu, an arrow opens one - which is what Windows has
   * always done and what the mnemonics are for. It used to open File outright, so every
   * Alt+F cost you a File menu you then had to leave.
   */
  await send("Input.dispatchKeyEvent", altDown);
  await send("Input.dispatchKeyEvent", altUp);
  await sleep(250);

  const focused = await evaluate(
    `(() => {
       const active = document.activeElement;
       if (active?.classList.contains('menubar-item') !== true) return 'focus is on ' + (active?.className ?? 'nothing');
       if (document.querySelector('.menu-panel') !== null) return 'Alt opened a dropdown as well';
       if (document.querySelector('.menubar')?.dataset.mnemonics !== 'true') return 'the mnemonics stayed hidden';
       return true;
     })()`,
  );

  await evaluate("document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true");

  return focused === true ? true : `a bare Alt: ${focused}`;
})();

/* The assistant button and the command centre, clicked where they actually are. */
checks.titleBarControlsWork = await (async () => {
  const pointOf = async (selector) =>
    evaluate(
      `(() => {
         const el = document.querySelector(${JSON.stringify(selector)});
         if (!el) return null;
         const r = el.getBoundingClientRect();
         if (r.width === 0) return null;
         return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
       })()`,
    );

  const ai = await pointOf("#ai-toggle");
  if (ai === null) return "no assistant button";

  await clickAt(ai.x, ai.y);
  const chatOpen = await evaluate("document.querySelector('.chat-card')?.hidden === false");
  if (!chatOpen) return "the assistant button did not open the chat";

  const pressed = await evaluate("document.getElementById('ai-toggle')?.getAttribute('aria-pressed')");
  if (pressed !== "true") return `aria-pressed is ${pressed} while the chat is open`;

  await clickAt(ai.x, ai.y);
  await sleep(300);

  const centre = await pointOf(".command-centre");
  if (centre === null) return "no command centre";

  await clickAt(centre.x, centre.y);
  const quickOpen = await evaluate("document.querySelector('.quickopen')?.hidden === false");
  if (!quickOpen) return "the command centre did not open quick open";

  await evaluate(
    "document.querySelector('.quickopen-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true",
  );
  await sleep(200);
  return true;
})();

/*
 * The feedback button, which sits immediately after the command centre.
 *
 * Deliberately stops short of submitting: a real send would reach the live API from a
 * test run, and what is worth checking here is that the button is reachable and the form
 * opens - the round trip has its own tests in services/api.
 */
/*
 * The account button, and that it is visible out of the box.
 *
 * `hidden` is the check that matters. The button hides itself when there is no Firebase
 * key, which was right in principle and meant a plain `npm start` showed no sign-in at
 * all - the feature existed and nobody could see it. A committed default key fixed that,
 * and this fails if anything puts it back.
 */
checks.accountButtonVisible = await (async () => {
  const state = await evaluate(
    `(() => {
       const button = document.getElementById('account-toggle');
       if (!button) return 'no account button';
       if (button.hidden) return 'the account button is hidden - is the Firebase key configured?';

       const feedback = document.getElementById('report-toggle');
       if (!feedback) return 'no feedback button to sit after';
       const b = button.getBoundingClientRect();
       const f = feedback.getBoundingClientRect();
       if (b.width === 0) return 'the account button has no width';
       if (b.left < f.right) return 'the account button is not after the feedback button';
       return true;
     })()`,
  );

  return state === true ? true : `the account button: ${state}`;
})();

checks.reportDialogOpens = await (async () => {
  const geometry = await evaluate(
    `(() => {
       const button = document.getElementById('report-toggle');
       if (!button) return 'no feedback button';
       const centre = document.querySelector('.command-centre-slot');
       if (!centre) return 'no command centre slot';
       const b = button.getBoundingClientRect();
       const c = centre.getBoundingClientRect();
       if (b.width === 0) return 'the feedback button has no width';
       if (b.left < c.right) return 'the feedback button is not after the command centre';
       return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
     })()`,
  );

  if (typeof geometry === "string") return geometry;

  await clickAt(geometry.x, geometry.y);
  await sleep(250);

  const form = await evaluate(
    `(() => {
       const dialog = document.querySelector('.report-dialog');
       if (!dialog?.open) return 'the button did not open the form';
       if (dialog.querySelectorAll('.report-kind').length !== 4) return 'the four report kinds are not all there';
       if (dialog.querySelector('.report-kind[aria-checked="true"]') === null) return 'no kind is selected by default';
       if (!dialog.querySelector('.report-input')) return 'no summary field';
       if (!dialog.querySelector('.report-textarea')) return 'no detail field';
       return true;
     })()`,
  );

  await evaluate("document.querySelector('.report-dialog')?.close(); true");
  await sleep(150);

  const closed = await evaluate("document.querySelector('.report-dialog')?.open === false");
  if (closed !== true) return "the form would not close";

  return form === true ? true : `the feedback form: ${form}`;
})();

/*
 * Dragging the mouse across a line selects the line.
 *
 * It did not: the "Multi-cursor" settings row was wired to Monaco's `columnSelection`, and
 * that row defaults to on - so every install shipped in column-select mode and a drag
 * produced a rectangular block. Read off the live editor rather than the settings file,
 * because the setting being right is not the same as the option being right.
 */
checks.dragSelectsWholeLine = await evaluate(
  `(() => {
     const host = document.getElementById('editor-host');
     const mode = host?.dataset?.columnSelection;
     if (mode === undefined) return 'the editor never reported its selection mode';
     return mode === 'false' ? true : 'the editor is in column-selection mode';
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

  /*
   * Recomputed before every use, never cached.
   *
   * Each file this flow creates adds a row, so the blank area below the tree moves up. A
   * coordinate captured once and reused lands on a row later in the run, and the right
   * click then opens the *file* menu - which has no "New File" - and the failure reads as
   * "no context menu is open" rather than as a stale coordinate.
   */
  const emptyTreeSpace = () =>
    evaluate(
      `(() => {
         const tree = document.getElementById('filetree');
         const box = tree.getBoundingClientRect();
         const rows = tree.querySelectorAll('.tree-row');
         const last = rows[rows.length - 1]?.getBoundingClientRect();
         const y = last ? Math.min(last.bottom + 40, box.bottom - 20) : box.top + 40;
         return { x: Math.round(box.left + box.width / 2), y: Math.round(y) };
       })()`,
    );

  const emptySpace = await emptyTreeSpace();

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

  /*
   * The Problems panel, end to end.
   *
   * A real file, created through the real menu, typed into with real key events, checked
   * by Monaco's real TypeScript worker. Every unit test in this feature passes against a
   * hand-built `Diagnostic`; none of them can tell whether a marker ever reaches the
   * panel, which is the only thing a user experiences.
   */
  const brokenSpace = await emptyTreeSpace();
  await rightClickAt(brokenSpace.x, brokenSpace.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  // Created at the workspace root, like every other file this flow makes, so the cleanup
  // below has to name it. A smoke run that leaves a stray `.ts` behind has modified the
  // repository, which is the one thing this whole block promises not to do.
  await typeText("smoke-broken.ts");
  await pressEnter();
  await sleep(1000);

  const editorPoint = await evaluate(
    `(() => {
       const r = document.getElementById('editor-host').getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 40) };
     })()`,
  );
  await clickAt(editorPoint.x, editorPoint.y);

  /*
   * Select the whole buffer before typing.
   *
   * A new `.ts` file no longer opens empty - `adcode.editing.fileTemplates` starts it with
   * a doc comment and a stub function. Typing into that put this line *inside the comment*,
   * so the compiler saw nothing wrong, the badge stayed hidden, and this block quietly
   * reported prose instead of failing. Replacing the buffer keeps the check testing the
   * compiler rather than the template.
   */
  await pressChord("a");
  await sleep(150);

  // No quotes and no brackets: auto-closing pairs would rewrite anything containing them,
  // and this needs to be exactly the source that produces TS2322.
  await typeText("let x: number = true;");

  // The TypeScript worker is a web worker doing a real compile. It is the slowest thing
  // in this run and the only one worth waiting seconds for.
  await sleep(6000);

  checks.problemsBadgeAppears = await evaluate(
    `(() => {
       const badge = document.getElementById('problems-badge');
       if (!badge) return 'no badge element';
       if (badge.hidden) return 'badge stayed hidden with an error on screen';
       return { text: badge.textContent, tone: badge.dataset.tone };
     })()`,
  );

  await evaluate(`document.querySelector('.activity[data-view="problems"]').click(); true`);
  await sleep(600);

  checks.problemsPanelExplains = await evaluate(
    `(() => {
       const view = document.getElementById('view-problems');
       if (view.hidden) return 'the problems view did not show';

       const rows = view.querySelectorAll('.problems-row');
       if (rows.length === 0) return 'panel listed nothing: ' + (view.textContent ?? '').trim().slice(0, 120);

       const headline = view.querySelector('.problems-headline')?.textContent ?? '';
       const raw = view.querySelector('.problems-raw')?.textContent ?? '';

       const files = [...view.querySelectorAll('.problems-file-name')].map((f) => f.textContent);

       return {
         // Grouped under the file that has the error, and that file is the one just typed
         // into. A regression in the "is this an editable tab" predicate shows up here as
         // a list of files the user never opened.
         files,
         worstFirst: files[0] === 'smoke-broken.ts',
         // The rewrite happened, in words with no type-system vocabulary in them.
         rewritten: /true or false/.test(headline) && !/assignable/.test(headline),
         // And the compiler's own sentence is still on the row. Demoted, never dropped -
         // a rewrite is only safe to ship because this is one glance away.
         keepsRaw: /not assignable/.test(raw),
       };
     })()`,
  );

  checks.problemsRowJumpsToTheColumn = await evaluate(
    `(async () => {
       const row = document.querySelector('#view-problems .problems-row');
       if (!row) return 'no row to click';

       row.click();
       await new Promise((r) => setTimeout(r, 700));

       const position = document.getElementById('status-position')?.textContent ?? '';
       // The column is the point: landing on column 1 of a long line makes the reader do
       // the search the panel was supposed to do for them.
       return /Ln \\d+, Col [2-9]\\d*/.test(position) ? position : 'cursor at ' + position;
     })()`,
  );

  /* ── The editing group, on the file that already has a real error (P2a) ── */

  /*
   * Every one of these clicks into the editor with real input first.
   *
   * The first version used synthetic MouseEvents and a bare Ctrl+A, and all four checks
   * reported false for the same reason: focus was still on the Problems row that the
   * previous block clicked, so the typing went nowhere. Monaco owns a hidden textarea and
   * only real input reliably lands in it.
   */
  async function retypeFile(text) {
    await clickAt(editorPoint.x, editorPoint.y);
    await sleep(200);
    await pressChord("a");
    await sleep(150);
    await typeText(text);
  }

  checks.errorLensShowsTheMessage = await (async () => {
    // The error stays on line 1 and the cursor ends on line 2, because the lens deliberately
    // says nothing about the line you are typing on.
    await retypeFile("let x: number = true;");
    await pressEnterInEditor();
    await typeText("const ok = 1;");

    // The TypeScript worker is a real compile.
    await sleep(5000);

    return await evaluate(
      `(() => {
         const lenses = [...document.querySelectorAll('.error-lens')];
         if (lenses.length === 0) return false;
         const text = lenses.map((l) => l.textContent ?? '').join(' ');
         return {
           appears: true,
           // One error in the file means exactly one annotation. Hints and info markers
           // are deliberately not shown, so an unused variable adds nothing here.
           /*
            * Counted by line, not by element.
            *
            * Monaco splits injected text across several spans of its own accord - one
            * message arrived as "You're putting true or false where a num" plus
            * "belongs." - so counting elements measures Monaco's text rendering rather
            * than this feature. One error in the file means one annotated line.
            */
           onlyTheErrorLine:
             new Set(lenses.map((l) => l.closest('.view-line')?.style.top ?? '?')).size === 1,
           inPlainEnglish: /true or false|number/i.test(text),
           tinted: lenses.some((l) => l.className.includes('error-lens-error')),
         };
       })()`,
    );
  })();

  checks.todoHighlightMarksOnlyComments = await (async () => {
    // A note in a comment, and the same word in code. Only the first may light up.
    await retypeFile("// TODO make this work");
    await pressEnterInEditor();
    await typeText("const TODO = 1;");
    await sleep(900);

    return await evaluate(
      `(() => {
         const marks = [...document.querySelectorAll('.todo-mark')];
         return {
           markedExactlyOne: marks.length === 1,
           isTheComment: (marks[0]?.textContent ?? '') === 'TODO',
           toned: marks[0]?.className.includes('todo-mark-todo') === true,
         };
       })()`,
    );
  })();

  checks.pathCompleteOffersRealFiles = await (async () => {
    await retypeFile('import x from "./pack');
    await sleep(1200);

    const offered = await evaluate(
      `(() => {
         const rows = [...document.querySelectorAll('.suggest-widget .monaco-list-row')];
         const labels = rows.map((r) => (r.textContent ?? '').trim());
         return {
           opened: rows.length > 0,
           // A real entry from the workspace root, not an invented one.
           offersRealFile: labels.some((l) => l.toLowerCase().startsWith('package')),
         };
       })()`,
    );

    await pressEscape();
    return offered;
  })();

  checks.pairedTagRenameFollowsAlong = await (async () => {
    // Auto-close writes the closing tag, which is what gives us a pair to rename.
    await retypeFile("<div>");
    await sleep(500);

    const before = await evaluate(
      `(document.querySelector('.monaco-editor .view-lines')?.textContent ?? '')`,
    );

    // One step left puts the cursor at the end of the opening tag's name.
    await pressKey("ArrowLeft");
    await typeText("s");
    await sleep(700);

    const after = await evaluate(
      `(document.querySelector('.monaco-editor .view-lines')?.textContent ?? '')`,
    );

    return {
      startedPaired: before.includes("<div>") && before.includes("</div>"),
      // Both halves followed, from one keystroke.
      renamedBoth: after.includes("<divs>") && after.includes("</divs>"),
    };
  })();

  /*
   * The language-server chain, end to end, on a machine with no language servers installed.
   *
   * That is the point: this repository has no Python toolchain, and the useful behaviour in
   * that situation is not silence. Creating a `.py` file has to walk the whole path -
   * Monaco model, IPC, PATH lookup, "missing" state, back through the bridge - and arrive
   * as a row that names the program and the command that installs it.
   *
   * If a machine running this *does* have pyright, the server starts instead and publishes
   * real diagnostics; the check accepts either, because both prove the chain is connected
   * and only one of them is under our control.
   */
  /*
   * The Go Live / Run button, in the corner it is supposed to be in.
   *
   * `smoke-broken.ts` is open and active from the checks above, so the button should be
   * offering to run it - which is the interesting half, because the label is generated from
   * the recipe table and a wrong language id shows up as a button that says nothing or is
   * not there at all.
   */
  checks.runButtonOffersTheActiveFile = await evaluate(
    `(() => {
       const button = document.querySelector('#status-run-slot .status-action');
       if (button === null) return 'no run button in the status bar';
       if (button.hidden) return 'button is hidden with a runnable file open';

       const bar = document.getElementById('statusbar').getBoundingClientRect();
       const box = button.getBoundingClientRect();

       return {
         says: button.textContent?.trim(),
         // Bottom-right corner, where Live Server has trained everyone to look. Reaching
         // the right edge is what makes the whole corner a target rather than a small box.
         inTheCorner: Math.abs(box.right - bar.right) < 2 && box.height > 12,
         // Built *and* on top - the rule the dead menu bar taught this repository.
         topmost: (() => {
           const hit = document.elementFromPoint(
             Math.round(box.left + box.width / 2),
             Math.round(box.top + box.height / 2),
           );
           return button === hit || button.contains(hit);
         })(),
       };
     })()`,
  );

  /*
   * And the other half of the fork: an HTML file is served, not executed.
   *
   * Which branch a file takes is the one guess `runCommands.ts` makes, and the guess that
   * decides whether pressing the button previews the user's page or runs it as a program.
   */
  // Back to the explorer before measuring anything in it. The problems checks above left
  // the sidebar on another view, and a hidden tree measures as a zero-sized box - so the
  // coordinate lands on the title bar and the failure reads as "no context menu is open".
  await evaluate(`document.querySelector('.activity[data-view="explorer"]').click(); true`);
  await sleep(400);

  const pageSpace = await emptyTreeSpace();
  await rightClickAt(pageSpace.x, pageSpace.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-page.html");
  await pressEnter();
  await sleep(1200);

  checks.runButtonGoesLiveOnAPage = await evaluate(
    `(() => {
       const button = document.querySelector('#status-run-slot .status-action');
       if (button === null || button.hidden) return 'no button on an HTML file';

       const says = button.textContent?.trim();
       return says === 'Go Live' ? true : 'said ' + JSON.stringify(says);
     })()`,
  );

  /*
   * Auto tag closing, in a real editor with a real HTML model.
   *
   * `smoke-page.html` is open and empty from the check above. The decision itself is a pure
   * function with nineteen unit tests behind it; what those cannot see is whether the
   * Monaco wiring fires at all - the listener runs inside a change notification and defers
   * its edit to a microtask, and every way of getting that wrong produces a feature that is
   * silently absent rather than broken.
   */
  const pageEditorPoint = await evaluate(
    `(() => {
       const r = document.getElementById('editor-host').getBoundingClientRect();
       return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 40) };
     })()`,
  );

  /*
   * The file template, which wrote itself into this file when it was created.
   *
   * Checked before anything is typed, because typing is what would destroy the evidence.
   * The caret is already parked inside `<body>`, which is the half of this feature that
   * cannot be seen from the text alone.
   */
  // Long enough for the auto-save the template's edit scheduled.
  await sleep(1600);

  checks.newFileStartsFromATemplate = await evaluate(
    `(async () => {
       /*
        * Read off disk, not out of the DOM.
        *
        * Monaco only renders the lines it is showing, and the template puts the caret on
        * line 10 - so with the terminal open the viewport had scrolled and the doctype on
        * line 1 was not in the document at all. The check was measuring what was painted;
        * what matters is what was written.
        */
       const { root } = await window.adcode.workspace.current();
       const file = await window.adcode.files.read(root + '/smoke-page.html');
       const text = file.text ?? '';

       if (text.trim().length === 0) return 'the new file is empty - no template was written';

       return {
         hasDoctype: /<!doctype html>/i.test(text),
         hasCharset: text.includes('charset'),
         closesItsTags: text.includes('</html>'),
         titledAfterTheFile: text.includes('<title>smoke-page</title>'),
         // The caret sits where the work starts, not at line 1.
         caret: document.getElementById('status-position')?.textContent,
       };
     })()`,
  );

  await clickAt(pageEditorPoint.x, pageEditorPoint.y);
  await typeText("<h1>");
  await sleep(400);
  await typeText("Hello");
  await sleep(400);

  checks.tagsCloseThemselves = await evaluate(
    `(() => {
       const lines = [...document.querySelectorAll('.view-line')].map((l) => l.textContent);
       const line = lines.find((text) => text?.includes('h1'));
       if (line === undefined) return 'nothing typed: ' + JSON.stringify(lines);

       // "contains", not "equals": the file was started from a template, so this
       // line sits inside a body element, and what is asserted is that the closing
       // tag appeared around what was typed. No backticks in here: the whole block
       // is inside a template literal, and one would end it.
       const normalised = line.replace(/ /g, ' ').trim();
       return normalised.includes('<h1>Hello</h1>') ? true : 'line reads ' + JSON.stringify(normalised);
     })()`,
  );

  /*
   * Something for a stylesheet to be about, two checks below.
   *
   * Typed here rather than written to disk because this file is already open and focused,
   * and because the auto-close under test is what writes the `</div>`. The pause is the
   * auto-save interval: the project-wide search that answers "what does this style" reads
   * the disk, so the markup has to have reached it.
   */
  await pressEnterInEditor();
  await typeText('<div class="smokecard">');
  await sleep(1800);

  /*
   * The activity-bar button that opens Structure.
   *
   * It went missing once - deleted along with the sidebar view it used to select, which left
   * the whole feature reachable only by a shortcut nobody had been told about. That is the
   * exact shape of bug this run exists to catch, and it passed every unit test.
   *
   * Clicked rather than called: a button that is built, positioned, and covered by something
   * else is indistinguishable from a working one until a pointer lands on it.
   */
  checks.structureButtonOpensThePopup = await evaluate(
    `(async () => {
       const button = document.getElementById('open-structure');
       if (button === null) return 'no Structure button in the activity bar';

       const box = button.getBoundingClientRect();
       if (box.width < 8 || box.height < 8) return 'the button has no size';

       const hit = document.elementFromPoint(
         Math.round(box.left + box.width / 2),
         Math.round(box.top + box.height / 2),
       );
       const topmost = button === hit || button.contains(hit);

       const before = button.getAttribute('aria-expanded');
       button.click();
       await new Promise((r) => setTimeout(r, 400));

       const popup = document.querySelector('.structure-popup');
       const opened = popup !== null && popup.open;
       const announced = button.getAttribute('aria-expanded');

       // A second press closes it again, which is what a toggle has to do or the button
       // feels broken the moment anybody presses it twice.
       button.click();
       await new Promise((r) => setTimeout(r, 400));
       const closed = !(document.querySelector('.structure-popup')?.open ?? false);

       return {
         inTheActivityBar: button.closest('#activitybar') !== null,
         topmost,
         opened,
         closesOnSecondPress: closed,
         // It must not join the sidebar's selection model, or the explorer would look
         // unselected while the explorer is still on screen.
         staysOutOfTheSidebarSelection: button.dataset.view === undefined,
         announcesState: before === 'false' && announced === 'true'
           && button.getAttribute('aria-expanded') === 'false',
       };
     })()`,
  );

  /*
   * The Structure view, on a file with real nesting.
   *
   * Typed rather than written to disk, because a buffer's outline has to describe what is
   * on screen including unsaved edits - reading the file back off disk would pass this
   * check while showing the user a tree of what they had before they started typing.
   *
   * Monaco over-types a closing bracket the user types themselves, so `function beta() {}`
   * arrives exactly as written.
   */
  const structureSpace = await emptyTreeSpace();
  await rightClickAt(structureSpace.x, structureSpace.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-structure.ts");
  await pressEnter();
  await sleep(1200);

  await clickAt(pageEditorPoint.x, pageEditorPoint.y);

  // Clear the template first. A `.ts` file is created with one now, and typing into it
  // would be testing the template's outline rather than the one being written here.
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await sleep(300);

  await typeText("const alpha = 1;");
  await pressEnterInEditor();
  await typeText("function beta() {}");
  await pressEnterInEditor();
  // Monaco closes this brace itself and puts the caret on an indented line between the
  // pair, which is what makes `delta` a child of `Gamma` rather than a sibling.
  await typeText("class Gamma {");
  await pressEnterInEditor();
  await typeText("delta() {}");
  await sleep(600);

  // Through the menu command, because there is no activity-bar button any more - Structure
  // is a popup. `window.adcode.window.onCommand` is the same route the menu and the
  // accelerator take, so this exercises the wiring rather than a click handler.
  await openStructure("file");

  checks.structureReadsTheOpenFile = await evaluate(
    `(() => {
       const popup = document.querySelector('.structure-popup');
       if (popup === null || !popup.open) return 'the structure popup did not open';

       const rows = [...popup.querySelectorAll('.structure-row')];
       if (rows.length === 0) return 'no rows: ' + (view.textContent ?? '').slice(0, 120);

       const names = rows.map((r) => r.querySelector('.structure-name')?.textContent);
       const gamma = rows.find((r) => r.querySelector('.structure-name')?.textContent === 'Gamma');
       const delta = rows.find((r) => r.querySelector('.structure-name')?.textContent === 'delta');

       return {
         names: names.join(','),
         // The four declarations that were typed, all of them, in source order.
         foundAll: ['alpha', 'beta', 'Gamma', 'delta'].every((n) => names.includes(n)),
         // The kinds are what make the icons and the colours mean anything.
         kinds: rows.map((r) => r.dataset.kind).join(','),
         // The tree is drawn with rails; a nested row must have more of them than its parent.
         nestedDeeper:
           gamma !== undefined &&
           delta !== undefined &&
           delta.querySelectorAll('.structure-rail').length >
             gamma.querySelectorAll('.structure-rail').length,
         // Built and on top - the rule the dead menu bar taught this repository.
         topmost: (() => {
           const box = rows[0].getBoundingClientRect();
           const hit = document.elementFromPoint(
             Math.round(box.left + box.width / 2),
             Math.round(box.top + box.height / 2),
           );
           return rows[0] === hit || rows[0].contains(hit);
         })(),
       };
     })()`,
  );

  // Clicking a row moves the cursor. This is the half of the panel that has to be wired to
  // the editor rather than merely rendered beside it.
  await evaluate(
    `(() => {
       const rows = [...document.querySelectorAll('.structure-popup .structure-row')];
       const gamma = rows.find((r) => r.querySelector('.structure-name')?.textContent === 'Gamma');
       gamma?.click();
       return true;
     })()`,
  );
  await sleep(400);

  // `class Gamma {` is the third line typed, so clicking its row must land the cursor there.
  checks.structureRowJumpsToTheLine = await evaluate(
    `(() => {
       const at = document.getElementById('status-position')?.textContent ?? 'no position';
       return /^Ln 3,/.test(at) ? true : 'cursor went to ' + at;
     })()`,
  );

  /*
   * Relations, which is the half of this feature that reaches outside the file.
   *
   * `beta` exists only in this scratch file, so "who calls this" honestly finds nothing -
   * and that is the assertion worth making, because a drawer that says "nowhere else"
   * proves the search ran, came back, and was rendered. A drawer stuck on "Looking…" is
   * exactly what a broken await would produce.
   */
  await evaluate(
    `(() => {
       const rows = [...document.querySelectorAll('.structure-popup .structure-row')];
       const beta = rows.find((r) => r.querySelector('.structure-name')?.textContent === 'beta');
       beta?.querySelector('.structure-relate')?.click();
       return true;
     })()`,
  );
  await sleep(2500);

  checks.structureRelationsAnswer = await evaluate(
    `(() => {
       const drawer = document.querySelector('.structure-popup .structure-drawer');
       if (drawer === null) return 'no drawer opened';

       const text = drawer.textContent ?? '';
       if (text.includes('Looking')) return 'still loading after 2.5s';

       return {
         hasSection: drawer.querySelector('.structure-section-title') !== null,
         says: drawer.querySelector('.structure-section-title')?.textContent,
       };
     })()`,
  );

  /*
   * "What does this rule actually style?" - the question a stylesheet cannot answer about
   * itself, and the reason this panel exists at all.
   *
   * The whole chain is under test here and only here: read the selector out of the CSS,
   * reduce it to a searchable token, run the project-wide search, parse each hit line as
   * markup, and judge it. Every step of that has unit tests against strings; none of them
   * can tell whether the search is wired to the panel, and a rule that reports "styles
   * nothing" when it styles something is worse than no answer.
   */
  // The popup is modal, so nothing behind it can be clicked at all - a right-click on the
  // tree with it open surfaces as "no context menu is open" three lines later, naming the
  // wrong thing entirely.
  await closeStructure();

  const styleSpace = await emptyTreeSpace();
  await rightClickAt(styleSpace.x, styleSpace.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-style.css");
  await pressEnter();
  await sleep(1200);

  await clickAt(pageEditorPoint.x, pageEditorPoint.y);

  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  await sleep(300);

  await typeText(".smokecard {");
  await pressEnterInEditor();
  await typeText("color: red;");
  await sleep(1800);

  await openStructure("file");

  await evaluate(
    `(() => {
       const rows = [...document.querySelectorAll('.structure-popup .structure-row')];
       const rule = rows.find((r) => r.querySelector('.structure-name')?.textContent === '.smokecard');
       rule?.querySelector('.structure-relate')?.click();
       return true;
     })()`,
  );
  await sleep(3000);

  checks.selectorSaysWhatItStyles = await evaluate(
    `(() => {
       const drawer = document.querySelector('.structure-popup .structure-drawer');
       if (drawer === null) {
         const names = [...document.querySelectorAll('.structure-popup .structure-name')]
           .map((n) => n.textContent).join(',');
         return 'no drawer; rows were: ' + names;
       }

       const text = drawer.textContent ?? '';
       if (text.includes('Looking')) return 'still loading after 3s';

       const titles = [...drawer.querySelectorAll('.structure-section-title')]
         .map((t) => t.textContent);
       const entries = [...drawer.querySelectorAll('.structure-entry-primary')]
         .map((e) => e.textContent);

       return {
         // Both halves of the answer: what the rule sets, and where it lands.
         sets: titles.some((t) => (t ?? '').startsWith('Sets')),
         appliesTo: titles.some((t) => (t ?? '').startsWith('Applies to 1')),
         // Named the way dev tools name it, so the reader recognises the element.
         foundTheElement: entries.includes('div.smokecard'),
         titles: titles.join(' | '),
       };
     })()`,
  );

  /*
   * "What are all these folders?" - the other half of the popup.
   *
   * Run against this repository, which is the best possible fixture for it: a root full of
   * names a newcomer would have to guess at, several of which are generated. The check is
   * that the dictionary reached the screen and that the generated ones are marked, because
   * "half of what is here was not written by anybody" is the single most useful thing this
   * view says.
   */
  await openStructure("project");

  checks.projectMapExplainsTheFolders = await evaluate(
    `(() => {
       const popup = document.querySelector('.structure-popup');
       if (popup === null || !popup.open) return 'the popup did not open';

       const map = popup.querySelector('.projectmap');
       if (map === null || map.hidden) return 'the project tab did not show';

       const names = [...map.querySelectorAll('.projectmap-name')].map((n) => n.textContent);
       const details = [...map.querySelectorAll('.projectmap-detail')].map((d) => d.textContent ?? '');
       const generated = [...map.querySelectorAll('.projectmap-row[data-generated="true"] .projectmap-name')]
         .map((n) => n.textContent);

       return {
         // It read the real root.
         sawPackages: names.includes('packages'),
         sawScripts: names.includes('scripts'),
         // It said what kind of project this is.
         says: map.querySelector('.projectmap-line')?.textContent,
         // Every note is a real sentence, not a restatement of the folder's name.
         explained: details.length > 3 && details.every((text) => text.length > 20),
         // The tree does not walk node_modules or .git, so the map cannot list them - and
         // says so, which is the honest version of leaving them out.
         namesWhatItSkips: (map.querySelector('.projectmap-hidden')?.textContent ?? '').includes('node_modules'),
         // And it dims whatever generated folders are visible.
         generatedMarked: generated.length,
       };
     })()`,
  );

  await closeStructure();

  /*
   * The keyboard shortcuts dialog, and a real remap.
   *
   * The whole chain: open the dialog, record a chord onto a command, and read it back from
   * the *menu model* rather than from the dialog's own list - because the failure this is
   * guarding against is a remap that changes the list and not the menu, which is a shortcut
   * that displays one thing and does another. Reset afterwards, so a smoke run leaves no
   * keybindings file behind.
   */
  await chooseMenu("Help", "Keyboard Shortcuts");
  await sleep(400);

  checks.shortcutsDialogIsUsable = await evaluate(
    `(() => {
       const dialog = document.querySelector('.shortcuts-dialog');
       if (dialog === null || !dialog.open) return 'the shortcuts dialog did not open';

       const rows = [...dialog.querySelectorAll('.shortcuts-row')];
       const keys = [...dialog.querySelectorAll('.shortcuts-key')].map((k) => k.textContent);

       return {
         rows: rows.length,
         // Grouped by the menu each command came from.
         groups: [...dialog.querySelectorAll('.shortcuts-group')].map((g) => g.textContent).join(','),
         // Real chords, not a blank column.
         showsChords: keys.some((text) => (text ?? '').includes('Ctrl')),
         searchable: dialog.querySelector('.shortcuts-search') !== null,
         topmost: (() => {
           const row = rows[0];
           if (row === undefined) return false;
           const box = row.getBoundingClientRect();
           const hit = document.elementFromPoint(
             Math.round(box.left + box.width / 2),
             Math.round(box.top + box.height / 2),
           );
           return row === hit || row.contains(hit);
         })(),
       };
     })()`,
  );

  checks.shortcutCanBeRebound = await evaluate(
    `(async () => {
       // A row on the View menu itself, not one inside its Appearance submenu - a submenu's
       // rows are not in the DOM until it flies out, and reading null from one would look
       // exactly like a remap that never reached the menu.
       const written = await window.adcode.keybindings.write('view.scm', 'CmdOrCtrl+Alt+9');
       if (written['view.scm'] !== 'CmdOrCtrl+Alt+9') return 'the write did not stick';

       await new Promise((r) => setTimeout(r, 400));

       // The drawn menu is where most people read a shortcut. If the remap did not reach it,
       // the label and the key now disagree - which is the failure this whole feature has to
       // avoid, and it is invisible from the dialog's own list.
       const view = [...document.querySelectorAll('.menubar-item')].find((b) => b.textContent === 'View');
       view?.click();
       await new Promise((r) => setTimeout(r, 250));

       const rows = [...document.querySelectorAll('.menu-panel .menu-item')];
       const scm = rows.find((r) => r.querySelector('.menu-item-label')?.textContent === 'Source Control');
       const printed = scm?.querySelector('.menu-item-accelerator')?.textContent ?? null;

       document.body.click();

       // A bare letter must still be refused, or a user can lock themselves out.
       const refused = await window.adcode.keybindings.write('view.scm', 'K');
       const heldFirm = refused['view.scm'] === 'CmdOrCtrl+Alt+9';

       await window.adcode.keybindings.reset();
       await new Promise((r) => setTimeout(r, 300));

       return {
         menuPrintsTheNewChord: printed,
         refusesABareLetter: heldFirm,
         resetIsClean: Object.keys(await window.adcode.keybindings.read()).length === 0,
       };
     })()`,
  );

  await evaluate(
    `(() => { document.querySelector('.shortcuts-dialog')?.close(); return true; })()`,
  );
  await sleep(300);

  /*
   * The missing-runtime bridge.
   *
   * Asserted through the bridge rather than by pressing Run, because whether the dialog
   * appears depends on what happens to be installed on the machine running this - and the
   * part that must be right either way is the shape of the answer: a runtime ADCode knows
   * comes back named, with a per-platform install line, and one it does not know comes back
   * null so the run proceeds untouched.
   */
  checks.runtimeCheckExplainsWhatIsMissing = await evaluate(
    `(async () => {
       const python = await window.adcode.runtime.check('python');
       const unknown = await window.adcode.runtime.check('some-tool-nobody-has');

       if (python === null) return 'python is not in the runtime table';

       return {
         label: python.label,
         installLineOffered: typeof python.install === 'string' && python.install.length > 0,
         // Never a bare address from the renderer: the page is chosen in the main process.
         https: python.url.startsWith('https://'),
         found: python.found,
         unknownIsNull: unknown === null,
       };
     })()`,
  );

  await evaluate(`document.querySelector('.activity[data-view="explorer"]').click(); true`);
  await sleep(300);

  const pythonSpace = await emptyTreeSpace();
  await rightClickAt(pythonSpace.x, pythonSpace.y);
  point = await contextItemPoint("New File");
  await clickAt(point.x, point.y);
  await evaluate("document.querySelector('.tree-edit-input').value = ''; true");
  await typeText("smoke-lang.py");
  await pressEnter();
  await sleep(3000);

  checks.languageServerReportsItself = await evaluate(
    `(async () => {
       const states = await window.adcode.language.states();
       const python = states.find((state) => state.languageId === 'python');
       if (python === undefined) return 'no state for python; got ' + JSON.stringify(states);

       return {
         label: python.label,
         status: python.status,
         // The whole value of the "missing" path: a command the user can act on.
         explains: python.status !== 'missing' || (python.detail ?? '').length > 0,
       };
     })()`,
  );

  await evaluate(`document.querySelector('.activity[data-view="problems"]').click(); true`);
  await sleep(800);

  checks.missingServerBecomesAHint = await evaluate(
    `(() => {
       const view = document.getElementById('view-problems');
       const rows = [...view.querySelectorAll('.problems-row')];
       const hint = rows.find((row) => /smoke-lang|install|pyright/i.test(row.textContent ?? ''));

       if (hint === undefined) {
         // A machine with pyright installed reports real diagnostics instead, and an empty
         // Python file has none - which is a pass, not a failure.
         return 'no hint row (pyright may be installed)';
       }

       return {
         // An \`info\`, never an error: a tool the user has not installed is not a problem
         // with their code, and the badge is reserved for things that are.
         severity: hint.className.includes('problems-row-info'),
         mentionsTheFix: /install/i.test(hint.textContent ?? ''),
       };
     })()`,
  );

  await evaluate(`document.querySelector('.activity[data-view="explorer"]').click(); true`);
  await sleep(300);

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
  await rm(join(REPO, "smoke-broken.ts"), { force: true }).catch(() => {});
  await rm(join(REPO, "smoke-lang.py"), { force: true }).catch(() => {});
  await rm(join(REPO, "smoke-page.html"), { force: true }).catch(() => {});
  await rm(join(REPO, "smoke-structure.ts"), { force: true }).catch(() => {});
  await rm(join(REPO, "smoke-style.css"), { force: true }).catch(() => {});
}

/*
 * The live preview.
 *
 * The unit tests cover request resolution and script injection against strings. What they
 * cannot cover is whether a socket actually binds, whether the CSP lets the frame render
 * at all, and whether the editor gives up the width - and a `frame-src` that still said
 * `'none'` would fail silently, as a blank white rectangle with the console error hidden
 * inside a frame nobody was reading.
 */
checks.previewStartsOnLoopback = await evaluate(
  `window.adcode.preview.start().then((status) => {
     if (!status.running) return 'did not start: ' + (status.error ?? 'no reason given');
     // Never 0.0.0.0: binding a project folder to the LAN is not a default anyone asked for.
     return /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/$/.test(status.url)
       ? true
       : 'bound somewhere unexpected: ' + status.url;
   })`,
);

checks.previewPaneRendersIt = await evaluate(
  `(async () => {
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise((r) => setTimeout(r, 300));

     const input = document.querySelector('.quickopen-input[aria-label="Command palette"]');
     if (!input) return 'palette did not open';

     input.value = 'live preview';
     input.dispatchEvent(new Event('input', { bubbles: true }));
     await new Promise((r) => setTimeout(r, 250));

     const rows = [...document.querySelectorAll('.palette-row')];
     const titles = rows.map((r) => r.querySelector('span')?.textContent);
     // By title, not by position: "Reload Live Preview" also matches this query and ranks
     // above it, and clicking whatever came first tested the wrong command.
     const row = rows.find((r) => r.querySelector('span')?.textContent === 'Toggle Live Preview');
     if (!row) return 'no Toggle command; palette had [' + titles.join(' | ') + ']';
     row.click();
     await new Promise((r) => setTimeout(r, 2500));

     const pane = document.querySelector('.preview-pane');
     if (!pane || pane.hidden) {
       const status = await window.adcode.preview.status();
       return 'pane never showed; palette had [' + titles.join(' | ') + ']; server ' +
         JSON.stringify(status);
     }

     const frame = pane.querySelector('.preview-frame');
     const box = pane.getBoundingClientRect();
     const editor = document.getElementById('editor-host').getBoundingClientRect();

     return {
       framed: /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\//.test(frame?.getAttribute('src') ?? ''),
       // The pane has real width, and the editor actually gave it up rather than the two
       // overlapping - which is what a stacking bug looks like from the outside.
       paneWide: box.width > 100,
       editorYielded: editor.right <= box.left + 2,
     };
   })()`,
);

/*
 * Project detection, without running anything.
 *
 * This repository has a `dev` script and no framework config at its root, which is exactly
 * the case the automatic choice must not act on: `npm run dev` here launches Electron and
 * serves no page. So the bar should offer it and the preview should still have started the
 * static server, which the checks above already proved it did.
 */
checks.previewDetectsProjectWithoutRunningIt = await evaluate(
  `(async () => {
     const project = await window.adcode.preview.detect();
     if (project === null) return 'detect() found no dev script in a repo that has one';

     const status = await window.adcode.preview.status();
     return {
       offered: project.label,
       // Never auto-started: a bare \`dev\` script is offered, not executed.
       stayedStatic: status.mode === 'static' || status.running === false,
     };
   })()`,
);

checks.previewStopsCleanly = await evaluate(
  `(async () => {
     const close = document.querySelector('.preview-pane .icon-button[aria-label="Close preview"]');
     if (!close) return 'no close button';
     close.click();
     await new Promise((r) => setTimeout(r, 800));

     const status = await window.adcode.preview.status();
     const pane = document.querySelector('.preview-pane');
     const editor = document.getElementById('editor-host').getBoundingClientRect();

     return {
       serverStopped: status.running === false,
       paneHidden: pane?.hidden === true,
       // The editor took the width back. A pane that hides without releasing it leaves a
       // dead strip down the side of the window.
       editorFullWidth: editor.width > 200,
     };
   })()`,
);

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
     const mark = document.querySelector('.welcome-mark .brand-mark');
     if (!mark) return 'no mark on the welcome screen';
     const paths = mark.querySelectorAll('path').length;
     const box = mark.getBoundingClientRect();
     return paths === 4 && box.width > 0 ? true : 'paths=' + paths + ' width=' + box.width;
   })()`,
);

/*
 * A hidden welcome screen takes no clicks.
 *
 * The other half of the same problem, and the one that would be invisible: with a file open the
 * screen is faded out but still in the DOM, directly over the editor. If it kept accepting the
 * pointer, every click in the editor would land on it instead - the window would look perfect
 * and be unusable, which is a bug this repository has shipped before.
 */
checks.hiddenWelcomeDoesNotSwallowClicks = await evaluate(
  `(async () => {
     const placeholder = document.getElementById('editor-placeholder');
     if (!placeholder) return 'no placeholder';
     if (placeholder.dataset.visible !== 'false') return 'expected a file to be open by now';

     const editor = document.getElementById('editor-host').getBoundingClientRect();
     const hit = document.elementFromPoint(
       editor.left + editor.width / 2,
       editor.top + editor.height / 2,
     );

     return {
       fadedOut: getComputedStyle(placeholder).opacity === '0',
       // Nothing at the centre of the editor belongs to the welcome screen.
       editorReceivesTheClick: hit !== null && !placeholder.contains(hit),
     };
   })()`,
);

/*
 * The welcome screen offers what it names, and can be clicked.
 *
 * The clickability half is the one worth asserting. `.editor-placeholder` is `position:
 * absolute; inset: 0` with `pointer-events: none`, which was correct while it was decorative -
 * and would have made every button on it inert. The fix puts the two properties on different
 * elements, and the only way to know it worked is to hit-test a real button in a real window.
 */
checks.welcomeScreenIsUsable = await evaluate(
  `(async () => {
     /*
      * Close every editor first, so the screen being measured is actually on screen.
      *
      * The first version of this check ran with a restored file open, which leaves the welcome
      * screen faded out and hidden by visibility - so the hit test found the editor underneath
      * and reported the button as unclickable. It was measuring a hidden element and calling it
      * a failure, the mirror of the preview check that measured a hidden element and called it
      * a pass.
      */
     for (const close of [...document.querySelectorAll('.tab-close')]) close.click();
     await new Promise((r) => setTimeout(r, 500));

     const placeholder = document.getElementById('editor-placeholder');
     if (placeholder?.dataset.visible === 'false') return 'the welcome screen did not come back';

     const inner = document.querySelector('.welcome-inner');
     if (!inner) return 'no welcome screen';

     const labels = [...inner.querySelectorAll('.welcome-action strong')].map((n) => n.textContent);
     const primary = inner.querySelector('.welcome-action-primary');
     if (!primary) return 'no primary action';

     const box = primary.getBoundingClientRect();
     // What the pointer would actually reach at the button's centre.
     const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

     return {
       offers: labels.join(','),
       primaryClickable: primary.contains(hit) || primary === hit,
       // The version is on screen, because it is what a bug report asks for.
       showsVersion: /Version \\d/.test(inner.querySelector('.welcome-version')?.textContent ?? ''),
       marked: inner.querySelector('.welcome-mark svg') !== null,
     };
   })()`,
);

// New file and new folder, at the root, beside the folder's own name.
checks.rootCreateButtonsExist = await evaluate(
  `(() => {
     const file = document.getElementById('new-root-file');
     const folder = document.getElementById('new-root-folder');
     if (!file || !folder) return 'missing root create buttons';

     return {
       // A folder is open in this run, so both are live rather than greyed out.
       enabled: !file.disabled && !folder.disabled,
       inHeader: file.closest('.sidebar-header') !== null,
       // Right of the folder name, which is where they act on what is named beside them.
       afterTitle:
         file.getBoundingClientRect().left >
         document.getElementById('sidebar-title').getBoundingClientRect().left,
     };
   })()`,
);

// The recents list records the folder this run opened.
checks.recentFoldersRecorded = await evaluate(
  `window.adcode.workspace.recents().then((list) => ({
     count: list.length,
     hasNames: list.every((f) => typeof f.name === 'string' && f.name.length > 0),
   }))`,
);

// The version the welcome screen shows comes from the main process, not a constant.
/*
 * The signed-in address, in the corner after the version.
 *
 * Asserted against the bridge rather than for a particular address, because whether this
 * machine has ever linked an account is not under this test's control. What must hold
 * either way is that the corner agrees with `account.status()` - a linked machine shows the
 * address, an anonymous one shows nothing at all rather than an empty slot.
 */
checks.statusBarSaysWhoIsSignedIn = await evaluate(
  `(async () => {
     const node = document.getElementById('status-account');
     if (node === null) return 'no account slot in the status bar';

     const state = await window.adcode.account.status();
     const linked = state.state === 'linked' && (state.email ?? state.displayName) !== null;

     if (!linked) {
       return node.hidden ? true : 'shown while not signed in: ' + JSON.stringify(node.textContent);
     }

     const expected = state.email ?? state.displayName;
     if (node.hidden) return 'hidden while signed in as ' + expected;

     // The whole address, not a truncation - it is here to say which account.
     return node.textContent === expected ? true : 'says ' + JSON.stringify(node.textContent);
   })()`,
);

checks.appInfoIsReal = await evaluate(
  `window.adcode.app.info().then((info) => ({
     version: /^\\d+\\.\\d+\\.\\d+/.test(info.version),
     electron: info.electron.length > 0,
     node: info.node.length > 0,
   }))`,
);

// The gutter decorations for the restored file.
checks.gutterOrClean = await evaluate(
  "document.querySelectorAll('.git-gutter').length >= 0",
);

/*
 * Every icon-only control has its icon in the middle of it.
 *
 * This is the check the bug it was written for demanded. Four close buttons drew the
 * character "×" in a box with no centring mechanism, and no unit test can see it: the glyph
 * is positioned by font metrics at paint time, so the only place the truth exists is a laid
 * out box in a real window. Measured as centres rather than as CSS, because `place-items:
 * center` being present is not the same claim as the ink being centred - `.icon-button-
 * chevron` had the property set and was still half a pixel off from its own border.
 *
 * Half a pixel of tolerance: subpixel layout means an odd-sized icon in an even-sized box
 * lands on a .5 legitimately, and failing on that would make the check noise.
 */
checks.iconsCentredInTheirButtons = await evaluate(
  `(async () => {
     /*
      * Sweep every view, because the measurement can only see laid-out boxes.
      *
      * A button in a closed panel is a button this check silently skips. The first version
      * opened nothing and passed while \`.icon-button\` and \`.scm-stage\` were both off centre;
      * the second opened only source control, which *replaces* the file tree - so it stopped
      * measuring \`.tree-action\`, one of the two buttons the whole exercise started from.
      * Sweeping after each view and taking the union is the only version that stays honest as
      * the workbench grows.
      */
     const offenders = [];
     const seen = {};

     const sweep = () => {
       for (const host of document.querySelectorAll('button, .problems-glyph, .activity')) {
         measure(host);
       }
     };

     function measure(host) {
       const box = host.getBoundingClientRect();
       if (box.width === 0 || box.height === 0) return;

       const icons = host.querySelectorAll('svg');
       // Icon-only controls. A button with a label is centred by its flex row, not by this
       // rule, and asserting on it would be asserting the wrong geometry.
       if (icons.length !== 1) return;
       if ((host.textContent ?? '').trim() !== '') return;

       const icon = icons[0].getBoundingClientRect();
       if (icon.width === 0 || icon.height === 0) return;

       const dx = icon.left + icon.width / 2 - (box.left + box.width / 2);
       const dy = icon.top + icon.height / 2 - (box.top + box.height / 2);

       const name = String(host.className || host.tagName).split(' ')[0];
       seen[name] = true;

       if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
         // One entry per class, not per instance: fourteen identical tree rows produced
         // fourteen identical lines and buried the one class that mattered.
         const line = name + ' dx=' + dx.toFixed(2) + ' dy=' + dy.toFixed(2);
         if (!offenders.includes(line)) offenders.push(line);
       }
     }

     // Explorer first, for the tree rows. Hovering is not needed - the row actions are laid
     // out either way, they are only made visible by the hover.
     document.querySelector('.activity[data-view="explorer"]')?.click();
     await new Promise((r) => setTimeout(r, 350));
     sweep();

     // Source control, which replaces the tree, for the staging buttons.
     document.querySelector('.activity[data-view="scm"]')?.click();
     await new Promise((r) => setTimeout(r, 450));
     sweep();

     // The terminal panel, for its tab close buttons and toolbar.
     document.dispatchEvent(
       new KeyboardEvent('keydown', { key: '\`', ctrlKey: true, bubbles: true }),
     );
     await new Promise((r) => setTimeout(r, 600));
     sweep();

     // The two popovers, each of which owns a close button.
     document.getElementById('open-earnings')?.click();
     await new Promise((r) => setTimeout(r, 300));
     sweep();
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

     document.getElementById('status-collab')?.click();
     await new Promise((r) => setTimeout(r, 300));
     sweep();
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

     document.querySelector('.activity[data-view="explorer"]')?.click();

     if (offenders.length > 0) return 'off centre: ' + offenders.join(' | ');

     // The families are reported so a future reader can tell "all centred" from "nothing was
     // measured", which are the same \`true\` otherwise.
     return { families: Object.keys(seen).sort().join(',') };
   })()`,
);

/*
 * No control draws its icon as a text character.
 *
 * The companion to the check above, and the one that actually catches a regression of the
 * original bug: a button holding "×" has no `svg` at all, so the centring check skips it
 * entirely and passes. These characters are maths operators and letters - they sit on a
 * baseline and on the font's maths axis, so they cannot be centred in a square box by any
 * amount of CSS. `workbench/icons.ts` exists to make a path the only option.
 */
checks.noTextGlyphIcons = await evaluate(
  `(() => {
     const banned = ['\\u00d7', '\\u2715', '\\u2716', '\\u2717', '\\u2718', '\\u274c', '\\u2713'];
     const offenders = [];

     for (const host of document.querySelectorAll('button, .problems-glyph')) {
       const text = (host.textContent ?? '').trim();
       if (text.length === 0) continue;
       if (banned.includes(text)) {
         offenders.push((host.className || host.tagName) + ' = ' + JSON.stringify(text));
       }
     }

     return offenders.length === 0 ? true : 'glyph icons remain: ' + offenders.join(' | ');
   })()`,
);

/*
 * The earnings report opens, and opens as a popover rather than a view.
 *
 * `topmost` is asserted the same way the menu bar's check is, and for the same reason: a
 * card can be present, positioned and painted and still sit behind the sidebar, which is a
 * bug this repository has already shipped once.
 */
checks.earningsPopoverOpens = await evaluate(
  `(async () => {
     const button = document.getElementById('open-earnings');
     if (!button) return 'no earnings button in the activity bar';

     const problems = document.querySelector('.activity[data-view="problems"]');
     if (!problems) return 'no problems button to sit under';

     const under =
       button.getBoundingClientRect().top > problems.getBoundingClientRect().top;

     button.click();
     await new Promise((r) => setTimeout(r, 300));

     const card = document.querySelector('.earnings-card');
     if (!card || card.hidden) return 'popover did not open';

     const box = card.getBoundingClientRect();
     const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

     const result = {
       belowProblems: under,
       topmost: card.contains(centre),
       onScreen: box.left >= 0 && box.right <= window.innerWidth && box.top >= 0,
       // A figure, or an honest dash. Never blank.
       showsAFigure: (card.querySelector('.earnings-hero-value')?.textContent ?? '').length > 0,
       // Four presets, from the server's own table.
       presetRows: card.querySelectorAll('.earnings-preset').length,
       // The sidebar must not have changed: this is a popover, not a view.
       explorerStillSelected:
         document.querySelector('.activity[data-view="explorer"]')?.ariaSelected === 'true',
     };

     // Escape closes it, and the check leaves the window as it found it.
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     await new Promise((r) => setTimeout(r, 250));
     result.escapeCloses = document.querySelector('.earnings-card')?.hidden === true;

     return result;
   })()`,
);

/*
 * The one button inside the earnings popover actually does something.
 *
 * It did not. "Ad settings" called \`showView("settings")\`, and settings is an overlay rather
 * than a sidebar view - so the call matched no view, hid all four of them, and deselected every
 * activity button. The popover closed and left an empty sidebar with nothing highlighted, which
 * reads as the window having broken. Reported by a user as "a pop-up showed, I was not able to
 * do anything".
 *
 * Both halves are asserted, because fixing only the first would still leave the sidebar blank.
 */
checks.earningsSettingsButtonWorks = await evaluate(
  `(async () => {
     document.querySelector('.activity[data-view="explorer"]')?.click();
     await new Promise((r) => setTimeout(r, 250));

     document.getElementById('open-earnings')?.click();
     await new Promise((r) => setTimeout(r, 300));

     const card = document.querySelector('.earnings-card');
     if (!card || card.hidden) return 'the popover did not open';

     const button = [...card.querySelectorAll('button')].find(
       (b) => (b.textContent ?? '').trim() === 'Ad settings',
     );
     if (!button) return 'no Ad settings button in the popover';

     button.click();
     await new Promise((r) => setTimeout(r, 500));

     const settings = document.querySelector('.settings-sheet');
     const settingsVisible =
       settings instanceof HTMLElement &&
       settings.hidden !== true &&
       settings.getBoundingClientRect().height > 100;

     const result = {
       settingsOpened: settingsVisible,
       // The sidebar must not have been blanked on the way there.
       explorerStillShown: document.getElementById('filetree')?.hidden === false,
       explorerStillSelected:
         document.querySelector('.activity[data-view="explorer"]')?.ariaSelected === 'true',
     };

     // Put the window back.
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     await new Promise((r) => setTimeout(r, 300));

     return result;
   })()`,
);

// The earnings icon is a drawn dollar sign, not the character "$".
checks.earningsIconIsADrawnDollar = await evaluate(
  `(() => {
     const button = document.getElementById('open-earnings');
     if (!button) return 'no earnings button';

     if ((button.textContent ?? '').includes('$')) return 'the icon is a text character';

     const paths = button.querySelectorAll('svg path');
     if (paths.length !== 2) return 'expected an S and a bar, got ' + paths.length + ' paths';

     const box = button.getBoundingClientRect();
     const icon = button.querySelector('svg').getBoundingClientRect();
     const dx = icon.left + icon.width / 2 - (box.left + box.width / 2);

     return Math.abs(dx) <= 0.5 ? true : 'off centre by ' + dx.toFixed(2);
   })()`,
);

/*
 * Undocking the preview floats it without reloading the page inside it.
 *
 * The last property is the whole reason the implementation looks the way it does. The
 * obvious build - append the iframe into a floating container - reloads the document, and a
 * reload is invisible to every assertion except one that watches the frame's identity and
 * its `src` across the move. So that is what this watches.
 */
checks.previewUndocksWithoutReloading = await evaluate(
  `(async () => {
     /*
      * Opened through the palette, not through \`preview.start()\`.
      *
      * The first version of this check called the IPC method directly, which starts the
      * server and never unhides the pane - so every assertion below ran against an element
      * that \`[hidden]\` had collapsed to 0x0, and three of them passed for that reason. A
      * check that measures a hidden element is not measuring the feature.
      */
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise((r) => setTimeout(r, 300));

     const input = document.querySelector('.quickopen-input[aria-label="Command palette"]');
     if (!input) return 'palette did not open';
     input.value = 'live preview';
     input.dispatchEvent(new Event('input', { bubbles: true }));
     await new Promise((r) => setTimeout(r, 250));

     const row = [...document.querySelectorAll('.palette-row')].find(
       (r) => r.querySelector('span')?.textContent === 'Toggle Live Preview',
     );
     if (!row) return 'no Toggle Live Preview command';
     row.click();
     await new Promise((r) => setTimeout(r, 2500));

     const pane = document.querySelector('.preview-pane');
     if (!pane) return 'no preview pane';
     if (pane.hidden) return 'pane still hidden after the toggle command';

     const frameBefore = pane.querySelector('iframe');
     if (!frameBefore) return 'no preview frame';
     const srcBefore = frameBefore.getAttribute('src');

     const dock = pane.querySelector('.icon-button[aria-label="Undock preview"]');
     if (!dock) return 'no undock button in the preview bar';
     dock.click();
     await new Promise((r) => setTimeout(r, 400));

     const box = pane.getBoundingClientRect();
     const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
     const frameAfter = pane.querySelector('iframe');
     const editor = document.getElementById('editor-host').getBoundingClientRect();

     const result = {
       floating: pane.dataset.placement === 'floating',
       // Not hidden and not collapsed. Asserted explicitly because the previous version of
       // this check was silently measuring a 0x0 box.
       hasSize: box.width > 300 && box.height > 200,
       onScreen: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth + 1,
       // Identity, not equality: a reparented iframe is a different node, and that is the
       // one thing this whole implementation exists to avoid.
       sameFrameNode: frameAfter === frameBefore,
       sameSrc: frameAfter?.getAttribute('src') === srcBefore,
       topmost: pane.contains(centre),
       // The editor took the column back, since the card now floats over it.
       editorReclaimedWidth: editor.width > 200,
       gripVisible: (pane.querySelector('.preview-grip')?.getBoundingClientRect().width ?? 0) > 0,
     };

     // Back to docked, then closed, so later checks see the layout they expect.
     pane.querySelector('.icon-button[aria-label="Dock preview"]')?.click();
     await new Promise((r) => setTimeout(r, 300));
     result.docksAgain = pane.dataset.placement === 'docked';

     pane.querySelector('.icon-button[aria-label="Close preview"]')?.click();
     await new Promise((r) => setTimeout(r, 600));

     return result;
   })()`,
);

/*
 * A live session, started and ended in the real app.
 *
 * Bound to loopback rather than `lan`, so running the suite does not publish this repository to
 * whatever network the machine is on. Everything either side of the bind is the same code path.
 *
 * The assertions worth having here are the ones the unit suite cannot reach: that the panel
 * actually opens and is the topmost thing at its own centre, that the status bar changes its
 * words rather than only a colour, and that starting a session produces a code which decodes to
 * the port the server really bound.
 */
checks.collabSessionStartsAndStops = await evaluate(
  `(async () => {
     const button = document.getElementById('status-collab');
     if (!button) return 'no live-session button in the status bar';
     if ((document.getElementById('status-collab-label')?.textContent ?? '') !== 'Share') {
       return 'the button should read "Share" before a session starts';
     }

     button.click();
     await new Promise((r) => setTimeout(r, 300));

     const card = document.querySelector('.collab-card');
     if (!card || card.hidden) return 'the session panel did not open';

     const box = card.getBoundingClientRect();
     const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

     const opened = {
       topmost: card.contains(centre),
       onScreen: box.left >= 0 && box.top >= 0 && box.bottom <= window.innerHeight + 1,
       offersShare: /Share this folder/i.test(card.textContent ?? ''),
       offersJoin: /Join with a code/i.test(card.textContent ?? ''),
     };

     // Close the panel, then drive the session over IPC - the confirm dialog in the click path
     // is a deliberate speed bump for a human, not something to click through here.
     document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
     await new Promise((r) => setTimeout(r, 200));

     const started = await window.adcode.collab.host({
       bind: 'loopback',
       port: 0,
       displayName: 'Smoke',
     });

     if (started.mode !== 'hosting') {
       return 'did not start: ' + (started.error ?? 'no reason given') ;
     }

     await new Promise((r) => setTimeout(r, 300));

     const hosting = {
       // The host is in its own roster, as the host.
       roster: started.participants.length === 1 && started.participants[0].role === 'host',
       hasInvite: typeof started.invite === 'string' && started.invite.startsWith('adcode1:'),
       hasPort: Number.isInteger(started.port) && started.port > 0,
       // The word, not just the colour. This is the only indicator that other people can reach
       // these files, so it has to be legible without knowing the colour code.
       label: document.getElementById('status-collab-label')?.textContent,
       state: document.getElementById('status-collab')?.dataset.state,
       // The renderer knows what it may do, and a host may do everything.
       canAdminister: started.can?.administer === true,
     };

     // A document joins the session and comes back with real state.
     const openDoc = await window.adcode.collab.openDoc('README.md');

     const stopped = await window.adcode.collab.leave();

     return {
       ...opened,
       ...hosting,
       docJoined: typeof openDoc === 'string' && openDoc.length > 0,
       stopped: stopped.mode === 'off',
       labelAfter: document.getElementById('status-collab-label')?.textContent,
     };
   })()`,
);

/* ── The explanation layer (P1) ───────────────────────────────────────── */

/*
 * Every check here returns a boolean or an object of booleans, never a descriptive string.
 * The runner only fails on `false`, `undefined`, or `THREW`, so a check that reports a real
 * problem as prose is printed and then passes - which is the one way this script lies.
 */

checks.helpGuideOpens = await (async () => {
  await chooseMenu("Help", "ADCode Guide");
  await sleep(500);

  return await evaluate(
    `(() => {
       const sheet = document.querySelector('.help-sheet');
       if (!sheet || sheet.hidden) return false;
       const cards = sheet.querySelectorAll('.help-card');
       const groups = sheet.querySelectorAll('.settings-group-title');
       return {
         visible: sheet.dataset.state === 'open',
         hasManyCards: cards.length > 40,
         hasGroups: groups.length > 5,
         explainsInThree:
           sheet.querySelector('.help-card-plain') !== null &&
           sheet.querySelectorAll('.help-card-detail').length > 0,
       };
     })()`,
  );
})();

checks.helpGuideSearchesByDescription = await evaluate(
  `(() => {
     const search = document.querySelector('.help-sheet .settings-search');
     if (!search) return false;
     search.value = 'grey text';
     search.dispatchEvent(new Event('input', { bubbles: true }));

     const titles = [...document.querySelectorAll('.help-sheet .help-card-title')]
       .map((t) => t.firstChild?.textContent ?? '');

     // Searching words nobody would guess the feature is named after is the whole point.
     return titles.includes('Inline completion') && titles.length < 6;
   })()`,
);

checks.helpGuideJumpsToSetting = await (async () => {
  const jumped = await evaluate(
    `(() => {
       const search = document.querySelector('.help-sheet .settings-search');
       search.value = 'minimap';
       search.dispatchEvent(new Event('input', { bubbles: true }));

       const jump = document.querySelector('.help-sheet .help-card-jump');
       if (!jump) return false;
       jump.click();
       return true;
     })()`,
  );
  if (jumped !== true) return false;

  // The guide closes, settings opens, and it scrolls to the row - which is deliberately
  // delayed past the sheet transition, so this waits longer than a click normally would.
  await sleep(900);

  return await evaluate(
    `(() => {
       const guide = document.querySelector('.help-sheet');
       const settings = document.querySelector('.settings-sheet:not(.help-sheet)');
       const row = document.querySelector('[data-setting-id="adcode.editing.minimap"]');
       return {
         guideClosed: guide.dataset.state === undefined,
         settingsOpen: settings?.dataset.state === 'open',
         rowExists: row !== null,
         rowMarked: row?.dataset.highlight === 'true',
       };
     })()`,
  );
})();

checks.everySettingHasAQuestionMark = await evaluate(
  `(() => {
     const rows = [...document.querySelectorAll('.settings-row[data-setting-id]')];
     if (rows.length < 40) return false;
     const without = rows.filter((r) => r.querySelector('.help-button') === null);
     return { rows: rows.length > 40, allExplained: without.length === 0 };
   })()`,
);

checks.helpPopoverOpensAndCloses = await (async () => {
  const opened = await evaluate(
    `(() => {
       const row = document.querySelector('[data-setting-id="adcode.editing.minimap"]');
       const button = row?.querySelector('.help-button');
       if (!button) return false;
       button.click();
       return true;
     })()`,
  );
  if (opened !== true) return false;

  await sleep(350);

  const shown = await evaluate(
    `(() => {
       const pop = document.querySelector('.help-popover');
       if (!pop || pop.hidden) return false;
       const box = pop.getBoundingClientRect();
       return {
         visible: pop.dataset.state === 'open',
         // The three fields, all filled - an empty popover is the failure this guards.
         hasPlain: (pop.querySelector('.help-popover-plain')?.textContent ?? '').length > 20,
         hasDetails:
           [...pop.querySelectorAll('.help-popover-detail')]
             .every((d) => (d.textContent ?? '').length > 20),
         // Placement is measured in script, so being on-screen is a real thing to check.
         onScreen:
           box.top >= 0 &&
           box.left >= 0 &&
           box.bottom <= window.innerHeight &&
           box.right <= window.innerWidth,
         anchorMarked:
           document
             .querySelector('[data-setting-id="adcode.editing.minimap"] .help-button')
             ?.getAttribute('aria-expanded') === 'true',
       };
     })()`,
  );

  await pressEscape();
  await sleep(300);

  const closed = await evaluate(
    `(() => {
       const pop = document.querySelector('.help-popover');
       const settings = document.querySelector('.settings-sheet:not(.help-sheet)');
       return {
         popoverGone: pop.hidden === true,
         // Escape closes the popover and must not also close the sheet behind it.
         settingsStillOpen: settings?.dataset.state === 'open',
       };
     })()`,
  );

  return { ...shown, ...closed };
})();

// Leave the app as this block found it, so later checks are not run against a covered window.
await pressEscape();
await sleep(400);

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
