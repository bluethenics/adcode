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
import { createSourceControlPanel } from "./panels/sourceControl.ts";
import { createQuickOpen, createSearchPanel } from "./panels/searchPanel.ts";
import { createChatWidget } from "./ai/chatWidget.ts";
import { createSettingsView } from "./settings/settingsView.ts";
import { createEditorHost, languageForFilename, type EditorHost } from "./editor/editorHost.ts";
import { createTerminalHost, type TerminalHost } from "./terminal/terminalHost.ts";
import { createNotificationCentre } from "./notifications/notifications.ts";
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
let terminal: TerminalHost | null = null;
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
    label.textContent = tab.name;

    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.ariaLabel = `Close ${tab.name}`;
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });

    button.append(dot, label, close);
    button.addEventListener("click", () => activateTab(tab.path));
    host.append(button);
  }
}

function activateTab(path: string): void {
  activePath = path;
  editorHost.activate(path);
  el("editor-placeholder").hidden = true;

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
      el("editor-placeholder").hidden = false;
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

  const text = editorHost.text(activePath);
  if (text === null) return;

  const result = await window.adcode.files.write(activePath, text);
  if (result.ok) {
    editorHost.markSaved(activePath);
    setStatus("Saved", 1200);
    void sourceControl.refresh();
    void refreshGitOverlay();
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

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  row.append(twisty, name);
  wrapper.append(row);

  if (entry.isDirectory) {
    const children = document.createElement("div");
    children.className = "tree-children";
    children.hidden = true;
    wrapper.append(children);

    row.addEventListener("click", async () => {
      const open = row.dataset["open"] === "true";

      if (open) {
        row.dataset["open"] = "false";
        children.hidden = true;
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

async function toggleTerminal(): Promise<void> {
  const panel = el("panel");

  if (!panel.hidden) {
    panel.hidden = true;
    editorHost.layout();
    editorHost.focus();
    return;
  }

  panel.hidden = false;

  if (terminal === null) {
    const select = el<HTMLSelectElement>("profile-select");
    try {
      terminal = await createTerminalHost(el("terminal-host"), {
        ...(select.value === "" ? {} : { profileId: select.value }),
        ...(workspaceRoot === null ? {} : { cwd: workspaceRoot }),
        theme,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "could not start terminal", 4000);
      panel.hidden = true;
      return;
    }
  }

  editorHost.layout();
  terminal.fit();
  terminal.focus();
}

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
});

editorHost.onSaveRequested(() => void saveActive());

el("open-folder").addEventListener("click", () => void openFolder());
el("open-settings").addEventListener("click", () => settingsView.toggle());
el("panel-close").addEventListener("click", () => void toggleTerminal());

for (const activity of document.querySelectorAll<HTMLElement>(".activity")) {
  const view = activity.dataset["view"];
  if (view === undefined) continue;
  activity.addEventListener("click", () => showView(view));
}

showView("explorer");

window.addEventListener("keydown", (event) => {
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void saveActive();
    return;
  }

  if (mod && event.key === "`") {
    event.preventDefault();
    void toggleTerminal();
    return;
  }

  if (mod && event.key.toLowerCase() === "o") {
    event.preventDefault();
    void openFolder();
    return;
  }

  if (mod && event.key === ",") {
    event.preventDefault();
    settingsView.toggle();
    return;
  }

  // §5.3: the chat widget is "summoned by keyboard shortcut".
  if (mod && event.key.toLowerCase() === "i") {
    event.preventDefault();
    chat.toggle();
    return;
  }

  // §4's fuzzy file open.
  if (mod && !event.shiftKey && event.key.toLowerCase() === "p") {
    event.preventDefault();
    quickOpen.toggle();
    return;
  }

  if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    showView("search");
    return;
  }

  if (mod && event.shiftKey && event.key.toLowerCase() === "g") {
    event.preventDefault();
    showView("scm");
  }
});

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

const sourceControl = createSourceControlPanel({
  openFile: (path) => void openFile(absolutePath(path)),
  workspaceRoot: () => workspaceRoot,
  notify: (text) => setStatus(text, 4000),
  openRevision: (path, ref, shortHash) => void openRevision(path, ref, shortHash),
});

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
resizeObserver.observe(el("terminal-host"));

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
}

void boot();
