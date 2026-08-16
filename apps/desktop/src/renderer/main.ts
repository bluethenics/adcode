/**
 * Workbench bootstrap: layout, file tree, tabs, editor, terminal, status bar.
 *
 * Everything except the text-editing surface itself is ours (brief §2).
 */
import "./styles/tokens.css";
import "./styles/workbench.css";
import "./styles/notifications.css";
import "./styles/settings.css";
import "./styles/ai.css";
import "./styles/panels.css";
import "./styles/menubar.css";
import "./styles/dialogs.css";
import { createSourceControlPanel } from "./panels/sourceControl.ts";
import { createCommandRegistry } from "./workbench/commands.ts";
import { createMenuBar } from "./workbench/menuBar.ts";
import { createPalette } from "./workbench/palette.ts";
import { fileIcon, folderIcon } from "./workbench/fileIcons.ts";
import { MENU_BAR, formatAccelerator } from "../shared/menuModel.ts";
import { createQuickOpen, createSearchPanel } from "./panels/searchPanel.ts";
import { createChatWidget } from "./ai/chatWidget.ts";
import { createSettingsView } from "./settings/settingsView.ts";
import { createEditorHost, languageForFilename, type EditorHost } from "./editor/editorHost.ts";
import { createTerminalPanel, type TerminalPanel } from "./terminal/terminalPanel.ts";
import { createNotificationCentre } from "./notifications/notifications.ts";
import { createResultDialog } from "./dialogs/resultDialog.ts";
import type { AdcodeApi, DirEntry, TerminalProfile } from "../shared/api.ts";

declare global {
  interface Window {
    readonly adcode: AdcodeApi;
  }
}

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element: ${id}`);
  return found as T;
};

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/* ── State ────────────────────────────────────────────────────────────── */

interface OpenTab {
  readonly path: string;
  readonly name: string;
  dirty: boolean;
}

const tabs: OpenTab[] = [];
let activePath: string | null = null;
let workspaceRoot: string | null = null;
let terminal: TerminalPanel | null = null;
let theme: "light" | "dark" = "dark";

const editorHost: EditorHost = createEditorHost(el("editor-host"));

/* ── Settings ─────────────────────────────────────────────────────────── */

let settingsValues: Record<string, boolean | string> = {};
let serverProjections: Record<string, string> | null = null;

/** Everything a settings change has to reach. */
function applySettings(values: Record<string, boolean | string>): void {
  settingsValues = values;

  // §3: "Density is a setting, not a decision."
  const density = values["adcode.appearance.density"];
  document.documentElement.dataset["density"] = density === "compact" ? "compact" : "comfortable";

  editorHost.applySettings(values);
  sourceControl.setTimelineEnabled(values["adcode.git.fileTimeline"] !== false);
  void refreshGitOverlay();
  syncTheme();
}

/* ── Theme ────────────────────────────────────────────────────────────── */

function syncTheme(): void {
  const preference = settingsValues["adcode.appearance.theme"];
  theme =
    preference === "light" || preference === "dark"
      ? preference
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

  document.documentElement.dataset["theme"] = theme;
  editorHost.applyTheme(theme);
  terminal?.applyTheme(theme);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

/* ── Tabs ─────────────────────────────────────────────────────────────── */

function renderTabs(): void {
  const host = el("tabs");
  host.replaceChildren();

  for (const tab of tabs) {
    const button = document.createElement("button");
    button.className = "tab";
    button.role = "tab";
    button.dataset["path"] = tab.path;
    button.dataset["dirty"] = String(tab.dirty);
    button.ariaSelected = String(tab.path === activePath);
    button.title = tab.path;

    const dot = document.createElement("span");
    dot.className = "tab-dirty";

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.name;

    // The tab name may carry a revision suffix, so the icon is chosen from the file the
    // tab is *of* rather than from its label.
    const icon = fileIcon(basename(tab.path.split(":").at(-1) ?? tab.name));

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.ariaLabel = `Close ${tab.name}`;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    button.append(dot, icon, label, close);
    button.addEventListener("click", () => activateTab(tab.path));
    host.append(button);
  }

  revealActiveTab();
}

/**
 * Keep the selected tab on screen.
 *
 * Opening the twentieth file used to put its tab past the right edge with no way to reach
 * it: the strip scrolled, but the scrollbar was hidden and nothing ever scrolled it. The
 * tab you just opened is the one you are about to type in, so it has to be the one in view.
 */
function revealActiveTab(): void {
  const host = el("tabs");
  const selected = host.querySelector<HTMLElement>('.tab[aria-selected="true"]');
  if (selected === null) return;

  // `scrollIntoView` on a fresh element is a no-op until layout has run.
  requestAnimationFrame(() => {
    selected.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

/*
 * A wheel over the tab strip scrolls it sideways.
 *
 * A plain mouse only reports vertical deltas, and the strip only scrolls horizontally, so
 * without this the wheel does nothing at all over the one row that most needs it. Trackpad
 * users already send `deltaX`; that is honoured as-is rather than doubled.
 */
el("tabs").addEventListener(
  "wheel",
  (event) => {
    const strip = el("tabs");
    if (strip.scrollWidth <= strip.clientWidth) return;

    const delta = event.deltaX !== 0 ? event.deltaX : event.deltaY;
    if (delta === 0) return;

    event.preventDefault();
    strip.scrollLeft += delta;
  },
  { passive: false },
);

function activateTab(path: string): void {
  activePath = path;
  editorHost.activate(path);
  el("editor-placeholder").dataset["visible"] = "false";

  const tab = tabs.find((t) => t.path === path);
  el("status-language").textContent = tab === undefined ? "" : languageForFilename(tab.name);

  renderTabs();
  void refreshGitOverlay();
  rememberSession();
}

function closeTab(path: string): void {
  const index = tabs.findIndex((t) => t.path === path);
  if (index === -1) return;

  tabs.splice(index, 1);
  editorHost.close(path);

  if (activePath === path) {
    const next = tabs[index] ?? tabs[index - 1];
    if (next === undefined) {
      activePath = null;
      el("editor-placeholder").dataset["visible"] = "true";
      el("status-language").textContent = "";
      el("status-position").textContent = "Ln 1, Col 1";
      editorHost.git.clear();
    } else {
      activateTab(next.path);
      return;
    }
  }

  renderTabs();
  rememberSession();
}

async function openFile(path: string): Promise<void> {
  const existing = tabs.find((t) => t.path === path);
  if (existing !== undefined) {
    activateTab(path);
    return;
  }

  try {
    const file = await window.adcode.files.read(path);
    const name = basename(path);

    editorHost.open(path, file.text, languageForFilename(name));
    tabs.push({ path, name, dirty: false });
    activateTab(path);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "could not open file");
  }
}

async function saveActive(): Promise<void> {
  if (activePath === null) return;

  if (editorHost.isReadOnly(activePath)) {
    setStatus("This is a past revision - open the working copy to edit it.", 3000);
    return;
  }

  await savePath(activePath);
}

/**
 * Save one buffer.
 *
 * Separate from `saveActive` because auto-save fires for whichever file stopped being
 * typed in, which is not necessarily the one the user is now looking at.
 */
async function savePath(path: string): Promise<void> {
  if (editorHost.isReadOnly(path)) return;

  const text = editorHost.text(path);
  if (text === null || !editorHost.isDirty(path)) return;

  const result = await window.adcode.files.write(path, text);
  if (result.ok) {
    editorHost.markSaved(path);
    if (path === activePath) {
      setStatus("Saved", 1200);
      void refreshGitOverlay();
    }
    void sourceControl.refresh();
  } else {
    setStatus(result.reason ?? "save failed", 3000);
  }
}

/* ── File tree ────────────────────────────────────────────────────────── */

function makeRow(entry: DirEntry, depth: number): HTMLElement {
  const wrapper = document.createElement("div");

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset["path"] = entry.path;
  row.style.paddingLeft = `${8 + depth * 10}px`;

  const twisty = document.createElement("span");
  twisty.className = "tree-twisty";
  twisty.textContent = entry.isDirectory ? "▶" : "";

  const icon = entry.isDirectory ? folderIcon(false) : fileIcon(entry.name);

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  row.append(twisty, icon, name);
  wrapper.append(row);

  if (entry.isDirectory) {
    const children = document.createElement("div");
    children.className = "tree-children";
    children.hidden = true;
    wrapper.append(children);

    // The icon is swapped rather than mutated, so the reference has to move with it.
    let currentIcon = icon;
    const setFolderIcon = (open: boolean): void => {
      const next = folderIcon(open);
      currentIcon.replaceWith(next);
      currentIcon = next;
    };

    row.addEventListener("click", async () => {
      const open = row.dataset["open"] === "true";

      if (open) {
        row.dataset["open"] = "false";
        children.hidden = true;
        setFolderIcon(false);
        return;
      }

      if (children.childElementCount === 0) {
        try {
          const entries = await window.adcode.workspace.list(entry.path);
          for (const child of entries) children.append(makeRow(child, depth + 1));
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "could not read folder");
          return;
        }
      }

      row.dataset["open"] = "true";
      children.hidden = false;
      setFolderIcon(true);
    });
  } else {
    row.addEventListener("click", () => {
      for (const selected of document.querySelectorAll<HTMLElement>('.tree-row[aria-selected="true"]')) {
        selected.ariaSelected = "false";
      }
      row.ariaSelected = "true";
      void openFile(entry.path);
    });
  }

  return wrapper;
}

async function renderTree(root: string): Promise<void> {
  const host = el("filetree");
  host.replaceChildren();

  try {
    const entries = await window.adcode.workspace.list(root);
    for (const entry of entries) host.append(makeRow(entry, 0));
  } catch (error) {
    const message = document.createElement("p");
    message.className = "empty-hint";
    message.textContent = error instanceof Error ? error.message : "could not read folder";
    host.append(message);
  }
}

async function openFolder(): Promise<void> {
  const opened = await window.adcode.workspace.open();
  if (opened === null) return;

  workspaceRoot = opened.root;
  chat.setWorkspace(opened.root);
  el("sidebar-title").textContent = opened.name;
  el("status-workspace").textContent = opened.name;
  el("titlebar-title").textContent = `${opened.name} — ADCode`;

  await renderTree(opened.root);
  rememberSession();
  void sourceControl.refresh();
  void refreshGitOverlay();
}

/* ── Terminal ─────────────────────────────────────────────────────────── */

/**
 * The terminal panel, created on first use.
 *
 * Built lazily because §7 budgets cold start, and xterm plus a pty is real work that
 * most launches never need.
 */
function terminalPanel(): TerminalPanel {
  terminal ??= createTerminalPanel({
    panel: el("panel"),
    tabStrip: el("terminal-tabs"),
    surface: el("terminal-surface"),
    profileId: () => el<HTMLSelectElement>("profile-select").value,
    cwd: () => workspaceRoot,
    theme: () => theme,
    notify: (message) => setStatus(message, 4000),
    onLayoutChange: () => {
      editorHost.layout();
      if (el("panel").hidden) editorHost.focus();
    },
  });

  return terminal;
}

const toggleTerminal = (): Promise<void> => terminalPanel().toggle();

/* ── Status ───────────────────────────────────────────────────────────── */

let statusTimer: number | undefined;

function setStatus(message: string, clearAfterMs?: number): void {
  const node = el("status-dirty");
  node.textContent = message;

  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  if (clearAfterMs !== undefined) {
    statusTimer = window.setTimeout(() => {
      node.textContent = "";
    }, clearAfterMs);
  }
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

editorHost.onCursorChange((line, column) => {
  el("status-position").textContent = `Ln ${line}, Col ${column}`;
});

editorHost.onDirtyChange((path, dirty) => {
  const tab = tabs.find((t) => t.path === path);
  if (tab === undefined) return;

  tab.dirty = dirty;
  renderTabs();

  if (dirty) scheduleAutoSave(path);
  else cancelPending(path);
});

editorHost.onSaveRequested(() => void saveActive());

el("open-folder").addEventListener("click", () => void openFolder());
el("open-settings").addEventListener("click", () => settingsView.toggle());
el("panel-close").addEventListener("click", () => terminalPanel().close());
el("terminal-new").addEventListener("click", () => void terminalPanel().create());
el("terminal-split").addEventListener("click", () => void terminalPanel().split());
el("terminal-kill").addEventListener("click", () => terminalPanel().killActive());

for (const activity of document.querySelectorAll<HTMLElement>(".activity")) {
  const view = activity.dataset["view"];
  if (view === undefined) continue;
  activity.addEventListener("click", () => showView(view));
}

showView("explorer");

/* Shortcuts and the menu bar are registered together, near the foot of this file. */

/* ── Sponsored notifications ──────────────────────────────────────────── */

const settingsView = createSettingsView({
  host: document.body,
  read: () => window.adcode.settings.read(),
  write: (id, value) => window.adcode.settings.write(id, value),
  reset: () => window.adcode.settings.reset(),
  projections: () => serverProjections,
  mcpConnection: () => window.adcode.memory.connection(),
});

window.adcode.settings.onChanged((values) => applySettings(values));

/* ── Auto-save and crash recovery (§4) ────────────────────────────────── */

/** Long enough that it fires in a pause, short enough to be worth having. */
const AUTO_SAVE_MS = 1200;
/** A draft is a safety net, so it is written sooner and more often than a save. */
const DRAFT_MS = 800;

const pendingSaves = new Map<string, number>();
const pendingDrafts = new Map<string, number>();

function cancelPending(path: string): void {
  const save = pendingSaves.get(path);
  if (save !== undefined) window.clearTimeout(save);
  pendingSaves.delete(path);

  const draft = pendingDrafts.get(path);
  if (draft !== undefined) window.clearTimeout(draft);
  pendingDrafts.delete(path);
}

/**
 * Save shortly after typing stops, and keep a draft in the meantime.
 *
 * The draft is written whether or not auto-save is on, because §4 lists the two as
 * separate settings: someone who saves by hand still wants their work back after a crash.
 */
function scheduleAutoSave(path: string): void {
  cancelPending(path);

  if (editorHost.isReadOnly(path)) return;

  pendingDrafts.set(
    path,
    window.setTimeout(() => {
      pendingDrafts.delete(path);
      const text = editorHost.text(path);
      if (text !== null && editorHost.isDirty(path)) window.adcode.history.draft(path, text);
    }, DRAFT_MS),
  );

  if (settingsValues["adcode.session.autoSave"] === false) return;

  pendingSaves.set(
    path,
    window.setTimeout(() => {
      pendingSaves.delete(path);
      void savePath(path);
    }, AUTO_SAVE_MS),
  );
}

/**
 * Offer back anything that was unsaved when the editor last stopped.
 *
 * Nothing is written without asking. A draft that matches what is on disk is dropped
 * silently - it was saved before the exit, and prompting about it would be noise.
 */
async function offerRecovery(): Promise<void> {
  const drafts = await window.adcode.history.drafts();
  if (drafts.length === 0) return;

  for (const draft of drafts) {
    let onDisk: string | null = null;
    try {
      onDisk = (await window.adcode.files.read(draft.path)).text;
    } catch {
      // The file may have been deleted; the draft is then the only copy there is.
    }

    if (onDisk === draft.text) {
      window.adcode.history.clearDraft(draft.path);
      continue;
    }

    notifications.show({
      title: "Unsaved work recovered",
      body: `${basename(draft.path)} had unsaved changes when ADCode last closed.`,
      actions: [
        {
          label: "Restore",
          run: () => {
            void openFile(draft.path).then(() => {
              editorHost.replaceText(draft.path, draft.text, { keepDirty: true });
              setStatus("Restored - save to keep it.", 4000);
            });
          },
        },
        {
          label: "Discard",
          run: () => window.adcode.history.clearDraft(draft.path),
        },
      ],
    });
  }
}

/* ── Session (§4) ─────────────────────────────────────────────────────── */

let sessionReady = false;

/** Record the folder and the open editors, so the next launch can reopen them. */
function rememberSession(): void {
  if (!sessionReady) return;

  window.adcode.session.save({
    root: workspaceRoot,
    // Historical revisions are views, not files; reopening one on launch would show a
    // tab whose content came from a commit the user has probably forgotten opening.
    openFiles: tabs.filter((tab) => !editorHost.isReadOnly(tab.path)).map((tab) => tab.path),
    activeFile: activePath !== null && !editorHost.isReadOnly(activePath) ? activePath : null,
  });
}

/* ── Source control and search (§4) ───────────────────────────────────── */

const absolutePath = (relativePath: string): string => {
  if (workspaceRoot === null) return relativePath;
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${workspaceRoot}${separator}${relativePath.split("/").join(separator)}`;
};

/** A workspace-relative path, which is the only shape the git bridge accepts. */
const relativePath = (absolute: string): string | null => {
  if (workspaceRoot === null) return null;

  const root = workspaceRoot.replace(/[\/]+$/, "");
  const normalise = (value: string): string => value.split("\\").join("/");

  const normalisedRoot = normalise(root);
  const normalisedPath = normalise(absolute);

  if (!normalisedPath.startsWith(`${normalisedRoot}/`)) return null;
  return normalisedPath.slice(normalisedRoot.length + 1);
};

/* Git's heavyweight actions report here rather than into the status bar's corner. */
const gitResultDialog = createResultDialog(document.body);

const sourceControl = createSourceControlPanel({
  openFile: (path) => void openFile(absolutePath(path)),
  workspaceRoot: () => workspaceRoot,
  notify: (text) => setStatus(text, 4000),
  reportResult: (result) => gitResultDialog.show(result),
  openRevision: (path, ref, shortHash) => void openRevision(path, ref, shortHash),
  openLocalVersion: (path, id, savedAt) => void openLocalVersion(path, id, savedAt),
  absolutePath,
});

/** Open a locally kept version of a file, read-only. §4's local file history. */
async function openLocalVersion(path: string, id: string, savedAt: string): Promise<void> {
  const text = await window.adcode.history.read(path, id);
  if (text === null) {
    setStatus("That local version is no longer on disk.", 3000);
    return;
  }

  const when = new Date(savedAt);
  const label = Number.isNaN(when.getTime())
    ? savedAt
    : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const key = `adcode-local:${id}:${path}`;
  const name = `${basename(path)} @ ${label}`;

  if (tabs.some((tab) => tab.path === key)) {
    activateTab(key);
    return;
  }

  editorHost.open(key, text, languageForFilename(path));
  editorHost.setReadOnly(key, true);
  tabs.push({ path: key, name, dirty: false });
  activateTab(key);
}

/**
 * Open a file as it was at a commit, read-only.
 *
 * §4's file timeline is only useful if a row leads somewhere. Historical revisions are
 * kept in their own tabs, keyed by hash, so opening one never shadows the working copy.
 */
async function openRevision(path: string, ref: string, shortHash: string): Promise<void> {
  const text = await window.adcode.git.showFile(ref, path);
  if (text === null) {
    setStatus("That revision has no copy of this file.", 3000);
    return;
  }

  const name = `${basename(path)} @ ${shortHash}`;
  const key = `adcode-revision:${shortHash}:${path}`;

  if (tabs.some((tab) => tab.path === key)) {
    activateTab(key);
    return;
  }

  editorHost.open(key, text, languageForFilename(path));
  editorHost.setReadOnly(key, true);
  tabs.push({ path: key, name, dirty: false });
  activateTab(key);
}

const searchPanel = createSearchPanel({
  openAt: (path, line) => {
    void openFile(absolutePath(path)).then(() => editorHost.revealLine(line));
  },
  // A replace-all rewrites files that may be open. Reloading them from disk is the only
  // honest answer: the buffer the user is looking at is no longer what is on disk.
  afterReplace: () => void reloadOpenFiles(),
  notify: (text) => setStatus(text, 4000),
});

/**
 * Re-read every open file that is not dirty.
 *
 * A file with unsaved edits is left alone and flagged instead - silently discarding
 * someone's typing to pick up a replace is worse than telling them the two disagree.
 */
async function reloadOpenFiles(): Promise<void> {
  let stale = 0;

  for (const tab of [...tabs]) {
    if (editorHost.isReadOnly(tab.path)) continue;

    if (editorHost.isDirty(tab.path)) {
      stale += 1;
      continue;
    }

    try {
      const file = await window.adcode.files.read(tab.path);
      editorHost.replaceText(tab.path, file.text);
    } catch {
      // The replace may have been part of a rename or a delete; the tab can stay.
    }
  }

  if (stale > 0) {
    setStatus(`${stale} unsaved file${stale === 1 ? "" : "s"} left as they are.`, 5000);
  }

  void sourceControl.refresh();
  void refreshGitOverlay();
}

const quickOpen = createQuickOpen({
  openFile: (path) => void openFile(absolutePath(path)),
});

el("view-scm").append(sourceControl.element);
el("view-search").append(searchPanel.element);

/** Switch which sidebar view is showing. */
function showView(view: string): void {
  const views: Record<string, HTMLElement> = {
    explorer: el("filetree"),
    search: el("view-search"),
    scm: el("view-scm"),
  };

  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;

  for (const activity of document.querySelectorAll<HTMLElement>(".activity")) {
    if (activity.dataset["view"] !== undefined) {
      activity.ariaSelected = String(activity.dataset["view"] === view);
    }
  }

  if (view === "scm") void sourceControl.refresh();
  if (view === "search") searchPanel.focus();
}

/**
 * Redraw the git layer for whatever is open.
 *
 * Called on activation and after every save, because both are moments where the file on
 * disk and the file in the editor can disagree about what has changed. It is deliberately
 * quiet when there is nothing to say: no workspace, no repository, or a tab that is not a
 * file at all just clears the decorations.
 */
async function refreshGitOverlay(): Promise<void> {
  const overlay = editorHost.git;

  if (activePath === null) {
    overlay.clear();
    sourceControl.setActiveFile(null);
    return;
  }

  const relative = editorHost.isReadOnly(activePath) ? null : relativePath(activePath);
  if (relative === null) {
    overlay.setLineChanges([]);
    overlay.setBlame(null);
    sourceControl.setActiveFile(null);
    return;
  }

  sourceControl.setActiveFile(relative);

  // §4: "gutter diff decorations `on`" and "blame `off`" - both are settings, so both ask
  // before doing any work. Blame in particular costs a `git blame` per file.
  const wantsGutter = settingsValues["adcode.git.gutterDiff"] !== false;
  const wantsBlame =
    settingsValues["adcode.git.blame"] === true ||
    settingsValues["adcode.editing.inlineGitBlame"] === true;

  overlay.setLineChanges(wantsGutter ? await window.adcode.git.lineChanges(relative) : []);
  overlay.setBlame(wantsBlame ? await window.adcode.git.blame(relative) : null);

  if (settingsValues["adcode.git.mergeConflict"] !== false) overlay.refreshConflicts();
}

// Accepting a side leaves the file dirty on purpose: the user sees the result before it
// is written, the same as any other edit.
editorHost.git.onResolved(() => {
  setStatus("Conflict resolved - save to keep it.", 3000);
});

/* ── Assistant (§5.3) ─────────────────────────────────────────────────── */

const chat = createChatWidget({
  host: document.body,
  // Applying a proposal reopens the file so the user sees the result in the editor.
  openExternalPath: (path) => void openFile(path),
});

const notifications = createNotificationCentre(el("toast-layer"));

window.adcode.ads.onShow((toast) => notifications.showSponsored(toast));

window.adcode.ads.onEarnings((earnings) => {
  // A cached mirror of a server value (§1). The renderer never computes money.
  el("status-earnings").textContent = earnings.hasServerBalance
    ? `${earnings.availableLabel} earned`
    : "";
});

document.addEventListener("keydown", (event) => {
  // Escape dismisses a sponsored toast, matching every other transient surface.
  if (event.key === "Escape") notifications.dismissAll();
});

const resizeObserver = new ResizeObserver(() => {
  editorHost.layout();
  terminal?.fit();
});
resizeObserver.observe(el("editor-host"));
resizeObserver.observe(el("terminal-surface"));

/* ── Boot ─────────────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  applySettings(await window.adcode.settings.read());

  // §1: reduce-motion follows the OS. Chromium's media query is the single source of
  // truth for it; the attribute just lets JS-driven animations read the same value.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const syncMotion = (): void => {
    document.documentElement.dataset["reducedMotion"] = String(reduceMotion.matches);
  };
  reduceMotion.addEventListener("change", syncMotion);
  syncMotion();

  const profiles: TerminalProfile[] = await window.adcode.terminal.profiles();
  const select = el<HTMLSelectElement>("profile-select");
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.label;
    select.append(option);
  }

  // §4: "Restore workspace" reopens the folder in the main process, so the workspace is
  // already set by the time this asks for it.
  const restored = await window.adcode.session.restore();

  const existing = await window.adcode.workspace.current();
  if (existing !== null) {
    workspaceRoot = existing.root;
    chat.setWorkspace(existing.root);
    el("sidebar-title").textContent = existing.name;
    el("status-workspace").textContent = existing.name;
    await renderTree(existing.root);
  }

  for (const file of restored.openFiles) await openFile(file);
  if (restored.activeFile !== null && tabs.some((tab) => tab.path === restored.activeFile)) {
    activateTab(restored.activeFile);
  }

  // Only start recording once the restore is done, so a failed reopen cannot save an
  // empty session over a good one.
  sessionReady = true;
  rememberSession();

  await offerRecovery();
}


/* ── Commands, shortcuts, and the menu bar (§3) ───────────────────────── */

const platform = navigator.userAgent.includes("Mac") ? "darwin" : "win32";

let untitledCount = 0;

const commands = createCommandRegistry({
  runEditorAction: (actionId) => editorHost.runAction(actionId),
  onUnknown: (id) => setStatus(`Nothing is bound to ${id} yet.`, 3000),
});

/** The shell command that runs a file, by extension. */
function runnerFor(relative: string): string | null {
  const quoted = `"${relative}"`;
  const extension = relative.toLowerCase().split(".").pop() ?? "";

  const runners: Readonly<Record<string, string>> = {
    ts: `node ${quoted}`,
    mts: `node ${quoted}`,
    js: `node ${quoted}`,
    mjs: `node ${quoted}`,
    cjs: `node ${quoted}`,
    py: `python ${quoted}`,
    sh: `bash ${quoted}`,
    ps1: `powershell -File ${quoted}`,
    rb: `ruby ${quoted}`,
    go: `go run ${quoted}`,
    rs: "cargo run",
  };

  return runners[extension] ?? null;
}

/** The grey line the sidebar shows when there is nothing to list. */
function hint(text: string): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "empty-hint";
  paragraph.textContent = text;
  return paragraph;
}

/**
 * Save the active buffer under a new name.
 *
 * The old tab is replaced rather than duplicated: "save as" moves where you are working,
 * it does not leave you editing the file you just copied from.
 */
async function saveActiveAs(): Promise<void> {
  if (activePath === null) return;

  const text = editorHost.text(activePath);
  if (text === null) return;

  const target = await window.adcode.files.saveAs(text, basename(activePath));
  if (target === null) return;

  closeTab(activePath);
  await openFile(target);
  setStatus("Saved.", 1500);
  void sourceControl.refresh();
}

/** Move to the next or previous open editor, wrapping at the ends. */
function stepEditor(step: number): void {
  if (tabs.length < 2 || activePath === null) return;

  const at = tabs.findIndex((tab) => tab.path === activePath);
  activateTab(tabs[(at + step + tabs.length) % tabs.length]!.path);
}

function showShortcuts(): void {
  const lines = MENU_BAR.flatMap((top) =>
    top.items.flatMap((entry) =>
      "kind" in entry && entry.kind !== undefined && entry.kind !== "item"
        ? []
        : "accelerator" in entry && entry.accelerator !== undefined
          ? [`${formatAccelerator(entry.accelerator, platform)}   ${entry.label}`]
          : [],
    ),
  );

  notifications.show({
    title: "Keyboard shortcuts",
    body: lines.join("\n"),
    autoDismissMs: 15_000,
  });
}

/** Everything the menu bar, the keyboard, and the palette can ask for. */
function registerCommands(): void {
  const add = (id: string, title: string, run: () => void | Promise<void>): void =>
    commands.register({ id, title, run });

  /* File */
  add("file.new", "New File", () => {
    // An untitled buffer has no path until it is saved, so it lives under a key that
    // cannot collide with one.
    const key = `adcode-untitled:${++untitledCount}`;

    editorHost.open(key, "", "plaintext");
    tabs.push({ path: key, name: `Untitled-${untitledCount}`, dirty: false });
    activateTab(key);
  });
  add("workspace.open", "Open Folder", () => openFolder());
  add("workspace.close", "Close Folder", async () => {
    await window.adcode.workspace.close();

    for (const tab of [...tabs]) closeTab(tab.path);

    workspaceRoot = null;
    chat.setWorkspace(null);
    el("sidebar-title").textContent = "No Folder Opened";
    el("status-workspace").textContent = "No folder";
    el("titlebar-title").textContent = "ADCode";
    el("filetree").replaceChildren(hint("Open a folder to get started."));

    editorHost.git.clear();
    rememberSession();
    void sourceControl.refresh();
  });
  add("file.saveAs", "Save As", () => saveActiveAs());
  add("file.save", "Save", () => saveActive());
  add("file.saveAll", "Save All", async () => {
    for (const tab of [...tabs]) await savePath(tab.path);
    setStatus("Saved all.", 1500);
  });
  add("file.revert", "Revert File", async () => {
    if (activePath === null || editorHost.isReadOnly(activePath)) return;

    try {
      const file = await window.adcode.files.read(activePath);
      editorHost.replaceText(activePath, file.text);
      setStatus("Reverted.", 1500);
    } catch {
      setStatus("Could not re-read that file.", 3000);
    }
  });
  add("editor.close", "Close Editor", () => {
    if (activePath !== null) closeTab(activePath);
  });
  add("editor.closeAll", "Close All Editors", () => {
    for (const tab of [...tabs]) closeTab(tab.path);
  });
  add("settings.open", "Preferences", () => settingsView.toggle());

  /* Edit - Monaco owns these, so they are triggered rather than reimplemented (§2). */
  commands.registerEditorAction("edit.undo", "Undo", "undo");
  commands.registerEditorAction("edit.redo", "Redo", "redo");
  commands.registerEditorAction("edit.find", "Find", "actions.find");
  commands.registerEditorAction("edit.replace", "Replace", "editor.action.startFindReplaceAction");
  commands.registerEditorAction("edit.toggleLineComment", "Toggle Line Comment", "editor.action.commentLine");
  commands.registerEditorAction("edit.toggleBlockComment", "Toggle Block Comment", "editor.action.blockComment");
  commands.registerEditorAction("edit.format", "Format Document", "editor.action.formatDocument");

  // Clipboard reaches the focused control through Electron's native menu roles. From the
  // keyboard Chromium already handles it; these exist so the ids resolve.
  add("edit.cut", "Cut", () => {
    document.execCommand("cut");
  });
  add("edit.copy", "Copy", () => {
    document.execCommand("copy");
  });
  add("edit.paste", "Paste", () => setStatus("Press Ctrl+V - paste needs the real keystroke.", 3000));

  /* Selection */
  commands.registerEditorAction("selection.all", "Select All", "editor.action.selectAll");
  commands.registerEditorAction("selection.expand", "Expand Selection", "editor.action.smartSelect.expand");
  commands.registerEditorAction("selection.shrink", "Shrink Selection", "editor.action.smartSelect.shrink");
  commands.registerEditorAction("selection.copyLineUp", "Copy Line Up", "editor.action.copyLinesUpAction");
  commands.registerEditorAction("selection.copyLineDown", "Copy Line Down", "editor.action.copyLinesDownAction");
  commands.registerEditorAction("selection.moveLineUp", "Move Line Up", "editor.action.moveLinesUpAction");
  commands.registerEditorAction("selection.moveLineDown", "Move Line Down", "editor.action.moveLinesDownAction");
  commands.registerEditorAction("selection.duplicate", "Duplicate Selection", "editor.action.duplicateSelection");
  commands.registerEditorAction("selection.cursorAbove", "Add Cursor Above", "editor.action.insertCursorAbove");
  commands.registerEditorAction("selection.cursorBelow", "Add Cursor Below", "editor.action.insertCursorBelow");
  commands.registerEditorAction("selection.addNextOccurrence", "Add Next Occurrence", "editor.action.addSelectionToNextFindMatch");
  commands.registerEditorAction("selection.selectAllOccurrences", "Select All Occurrences", "editor.action.selectHighlights");

  /* View */
  add("palette.open", "Command Palette", () => palette.toggle());
  add("view.fullScreen", "Toggle Full Screen", () => window.adcode.window.toggleFullScreen());
  add("view.toggleSidebar", "Toggle Side Bar", () => {
    const sidebar = el("sidebar");
    sidebar.hidden = !sidebar.hidden;
    el("workbench").dataset["sidebar"] = sidebar.hidden ? "hidden" : "shown";
    editorHost.layout();
  });
  add("view.togglePanel", "Toggle Panel", () => toggleTerminal());
  add("view.zoomIn", "Zoom In", () => window.adcode.window.zoom(1));
  add("view.zoomOut", "Zoom Out", () => window.adcode.window.zoom(-1));
  add("view.zoomReset", "Reset Zoom", () => window.adcode.window.zoom(0));
  add("view.explorer", "Explorer", () => showView("explorer"));
  add("view.search", "Search", () => showView("search"));
  add("view.scm", "Source Control", () => showView("scm"));
  add("search.open", "Find in Files", () => showView("search"));
  add("ai.toggle", "Assistant", () => chat.toggle());
  add("view.toggleWordWrap", "Toggle Word Wrap", () => editorHost.toggleWordWrap());

  /* Go */
  add("go.file", "Go to File", () => quickOpen.toggle());
  add("go.line", "Go to Line/Column", () => editorHost.runAction("editor.action.gotoLine"));
  add("go.nextEditor", "Next Editor", () => stepEditor(1));
  add("go.previousEditor", "Previous Editor", () => stepEditor(-1));
  commands.registerEditorAction("go.nextChange", "Next Change", "editor.action.dirtydiff.next");
  commands.registerEditorAction("go.previousChange", "Previous Change", "editor.action.dirtydiff.previous");

  /* Terminal */
  add("terminal.toggle", "Toggle Terminal", () => toggleTerminal());
  add("terminal.new", "New Terminal", () => terminalPanel().create());
  add("terminal.split", "Split Terminal", () => terminalPanel().split());
  add("terminal.next", "Next Terminal", () => terminalPanel().next());
  add("terminal.previous", "Previous Terminal", () => terminalPanel().previous());
  add("terminal.clear", "Clear Terminal", () => terminalPanel().clear());
  add("terminal.kill", "Kill Terminal", () => terminalPanel().killActive());
  add("terminal.killAll", "Kill All Terminals", () => terminalPanel().killAll());
  add("terminal.runActiveFile", "Run Active File", async () => {
    if (activePath === null) {
      setStatus("Open a file first.", 3000);
      return;
    }

    const relative = relativePath(activePath);
    if (relative === null) {
      setStatus("That file is not inside the open folder.", 3000);
      return;
    }

    const runner = runnerFor(relative);
    if (runner === null) {
      setStatus("No runner is known for that file type.", 3000);
      return;
    }

    const panel = terminalPanel();
    if (panel.count() === 0) await panel.create();
    else if (!panel.isOpen()) await panel.toggle();

    panel.send(runner);
  });

  /* Help */
  add("help.shortcuts", "Keyboard Shortcuts", () => showShortcuts());
  add("help.devTools", "Toggle Developer Tools", () => window.adcode.window.toggleDevTools());
  add("help.about", "About ADCode", () => {
    notifications.show({
      title: "ADCode",
      body: "An ad-supported, AI-native IDE. Everything ships in the binary - there is no marketplace.",
      autoDismissMs: 8000,
    });
  });
  add("app.quit", "Exit", () => window.close());
}

registerCommands();

const palette = createPalette({
  commands: () => commands.all(),
  run: (id) => commands.run(id),
  restoreFocus: () => editorHost.focus(),
});

/* The menu bar owns the title bar's left edge on Windows and Linux; macOS uses the
   system menu the main process installs instead. */
const menuBar =
  platform === "darwin"
    ? null
    : createMenuBar({
        run: (command) => commands.run(command),
        platform,
        restoreFocus: () => editorHost.focus(),
      });

if (menuBar !== null) el("menubar-slot").append(menuBar.element);

window.adcode.window.onCommand((command) => commands.run(command));

/**
 * Keyboard shortcuts, resolved against the same command ids the menu uses.
 *
 * Only the ones the workbench owns are listed. Monaco binds its own editing keys while it
 * has focus, and duplicating them here would mean two handlers fighting over one press.
 */
const KEYBINDINGS: ReadonlyArray<{
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly command: string;
}> = [
  { key: "s", mod: true, command: "file.save" },
  { key: "s", mod: true, alt: true, command: "file.saveAll" },
  { key: "n", mod: true, command: "file.new" },
  { key: "o", mod: true, command: "workspace.open" },
  { key: "w", mod: true, command: "editor.close" },
  { key: ",", mod: true, command: "settings.open" },
  { key: "`", mod: true, command: "terminal.toggle" },
  { key: "`", mod: true, shift: true, command: "terminal.new" },
  { key: "5", mod: true, shift: true, command: "terminal.split" },
  { key: "j", mod: true, command: "view.togglePanel" },
  { key: "b", mod: true, command: "view.toggleSidebar" },
  { key: "i", mod: true, command: "ai.toggle" },
  { key: "p", mod: true, command: "go.file" },
  { key: "p", mod: true, shift: true, command: "palette.open" },
  { key: "e", mod: true, shift: true, command: "view.explorer" },
  { key: "f", mod: true, shift: true, command: "view.search" },
  { key: "g", mod: true, shift: true, command: "view.scm" },
  { key: "F11", command: "view.fullScreen" },
  { key: "=", mod: true, command: "view.zoomIn" },
  { key: "-", mod: true, command: "view.zoomOut" },
  { key: "0", mod: true, command: "view.zoomReset" },
];

window.addEventListener("keydown", (event) => {
  // A modal result owns the keyboard while it is up. Without this, Ctrl+S saved and Alt
  // opened the menu bar behind a dialog the user was still reading. Escape is deliberately
  // not handled here: `<dialog>` closes itself on cancel, and doing it twice would race.
  if (gitResultDialog.isOpen()) return;

  // Escape dismisses whatever transient surface is on top, wherever focus happens to be.
  // Leaving this to each surface's own input meant a palette opened by shortcut could not
  // be closed by keyboard once focus moved - and an overlay that will not close is an
  // application that will not respond.
  if (event.key === "Escape") {
    if (menuBar?.isOpen() === true) {
      menuBar.close();
      return;
    }
    if (palette.isOpen()) {
      palette.close();
      return;
    }
    if (quickOpen.isOpen()) {
      quickOpen.close();
      editorHost.focus();
      return;
    }
  }

  // Alt on its own focuses the menu bar, as it does in every Windows application.
  if (event.key === "Alt" && menuBar !== null && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    menuBar.focusFirst();
    return;
  }

  const mod = event.ctrlKey || event.metaKey;
  const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  for (const binding of KEYBINDINGS) {
    if (pressed !== binding.key.toLowerCase() && pressed !== binding.key) continue;
    if ((binding.mod === true) !== mod) continue;
    if ((binding.shift === true) !== event.shiftKey) continue;
    if ((binding.alt === true) !== event.altKey) continue;

    event.preventDefault();
    commands.run(binding.command);
    return;
  }
});

void boot();
