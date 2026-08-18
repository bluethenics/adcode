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
import { shortenPath } from "./workbench/pathLabel.ts";
import { createAltMenuActivation } from "./workbench/altMenuActivation.ts";
import { createCommandCentre } from "./workbench/commandCentre.ts";
import { createPalette } from "./workbench/palette.ts";
import { fileIcon, folderIcon } from "./workbench/fileIcons.ts";
import { createWelcomeView } from "./workbench/welcomeView.ts";
import { createSplitter } from "./workbench/splitter.ts";
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  clampPanelHeight,
  clampSidebarWidth,
} from "./workbench/layoutSizes.ts";
import { buildMenuBar, formatAccelerator, stripMnemonic, type MenuEntry } from "../shared/menuModel.ts";
import { createQuickOpen, createSearchPanel } from "./panels/searchPanel.ts";
import { createProblemsPanel } from "./panels/problemsPanel.ts";
import { createEarningsPopover } from "./panels/earningsPopover.ts";
import { createCollabPanel } from "./collab/collabPanel.ts";
import { createCollabSession } from "./collab/collabSession.ts";
import { createPreviewPane } from "./preview/previewPane.ts";
import { createRunButton } from "./run/runButton.ts";
import { createDiagnosticsHost } from "./diagnostics/diagnosticsHost.ts";
import { createLanguageBridge } from "./diagnostics/languageBridge.ts";
import { badgeFor, countBySeverity, summarise } from "@adcode/diagnostics";
import { createChatWidget } from "./ai/chatWidget.ts";
import { ICON, createIcon, iconButton } from "./workbench/icons.ts";
import { createSettingsView } from "./settings/settingsView.ts";
import { createEditorHost, languageForFilename, type EditorHost } from "./editor/editorHost.ts";
import { createTerminalPanel, type TerminalPanel } from "./terminal/terminalPanel.ts";
import { createNotificationCentre } from "./notifications/notifications.ts";
import { createResultDialog } from "./dialogs/resultDialog.ts";
import { createConfirmDialog } from "./dialogs/confirmDialog.ts";
import { createPromptDialog } from "./dialogs/promptDialog.ts";
import { createReportDialog } from "./dialogs/reportDialog.ts";
import { createContextMenu, attachContextMenuDismissal, type ContextMenuNode } from "./workbench/contextMenu.ts";
import { createInlineEditor } from "./workbench/inlineEdit.ts";
import type {
  AdcodeApi,
  DirEntry,
  GitOutcome,
  GitStatusView,
  OpenedWorkspace,
  TerminalProfile,
} from "../shared/api.ts";

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
  // The panel caches nothing, but it only redraws on a marker change - so switching the
  // rewrites off would otherwise leave the old wording on screen until the next keystroke.
  problemsPanel.render(diagnosticsHost.current());
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

    const close = iconButton(`Close ${tab.name}`, ICON.close, "tab-close");
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
  runButton.refresh();
  void refreshGitOverlay();
  // Remote carets are per-file: switching tabs has to redraw them, or the previous file's
  // cursors stay on screen pointing at unrelated lines.
  collabSession.refreshCursors();
  rememberSession();
}

function closeTab(path: string): void {
  const index = tabs.findIndex((t) => t.path === path);
  if (index === -1) return;

  tabs.splice(index, 1);
  // Before `editorHost.close`, which disposes the model the binding is listening to.
  collabSession.untrackFile(path);
  editorHost.close(path);

  if (activePath === path) {
    const next = tabs[index] ?? tabs[index - 1];
    if (next === undefined) {
      activePath = null;
      el("editor-placeholder").dataset["visible"] = "true";
      el("status-language").textContent = "";
      el("status-position").textContent = "Ln 1, Col 1";
      runButton.refresh();
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

    // Joins the file to a running session, if there is one. A no-op otherwise, so this costs
    // nothing when nobody is sharing.
    collabSession.trackFile(path);
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

const NEW_FILE_ICON = "M9 2.5H4.5v11h7V5M9 2.5 11.5 5M9 2.5V5h2.5";
const NEW_FOLDER_ICON = "M2 4.5A1 1 0 0 1 3 3.5h2.6l1 1.2H13a1 1 0 0 1 1 1v6.3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z";
const PLUS_ICON = "M8 6v4M6 8h4";

/** A small icon button that lives on a tree row. */
function rowActionButton(label: string, path: string, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "tree-action";
  button.type = "button";
  button.title = label;
  button.ariaLabel = label;

  button.append(createIcon([path, PLUS_ICON]));

  // The row's own click toggles the folder, which would fold away the thing being
  // created the instant the editor appeared inside it.
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    run();
  });

  return button;
}

function makeRow(entry: DirEntry, depth: number): HTMLElement {
  const wrapper = document.createElement("div");

  const row = document.createElement("div");
  row.className = "tree-row";
  row.dataset["path"] = entry.path;
  // Carried on the row so a refresh can rebuild children at the right indent without
  // re-deriving it from the padding it set.
  row.dataset["depth"] = String(depth);
  row.dataset["kind"] = entry.isDirectory ? "directory" : "file";
  row.style.paddingLeft = `${8 + depth * 10}px`;
  // Focusable, but not in the tab order: the tree is navigated by pointer, and F2 and
  // Delete have to land on a row rather than on whatever last had focus.
  row.tabIndex = -1;

  const twisty = document.createElement("span");
  twisty.className = "tree-twisty";
  twisty.textContent = entry.isDirectory ? "▶" : "";

  const icon = entry.isDirectory ? folderIcon(false) : fileIcon(entry.name);

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = entry.name;

  row.append(twisty, icon, name);

  // The two things people reach for most, on the row itself rather than four clicks away
  // through a menu. Hidden until the row is hovered or focused, so a still tree stays a
  // list of names rather than a wall of buttons.
  if (entry.isDirectory) {
    const actions = document.createElement("div");
    actions.className = "tree-actions";
    actions.append(
      rowActionButton("New File", NEW_FILE_ICON, () => void beginCreate(entry.path, "file")),
      rowActionButton("New Folder", NEW_FOLDER_ICON, () => void beginCreate(entry.path, "folder")),
    );
    row.append(actions);
  }

  attachRowDragAndDrop(row, entry);
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

/* ── Tree structure changes ───────────────────────────────────────────── */

/**
 * Follow a renamed file with its tab.
 *
 * A tab left pointing at the old path is not a cosmetic problem: the next save writes to
 * a name that no longer exists, recreating it and forking the file in two without saying
 * so. The editor model moves with it for the same reason.
 */
function retitleTab(oldPath: string, newPath: string): void {
  const tab = tabs.find((candidate) => candidate.path === oldPath);
  if (tab === undefined) return;

  const index = tabs.indexOf(tab);
  tabs[index] = { ...tab, path: newPath, name: baseName(newPath) };

  editorHost.rename(oldPath, newPath);
  if (activePath === oldPath) activePath = newPath;

  renderTabs();
  rememberSession();
}

/**
 * Mark a deleted file's tab rather than closing it.
 *
 * Closing would discard unsaved edits at the exact moment the file stopped existing on
 * disk, which is when the buffer is the only copy left.
 */
function markTabStale(path: string): void {
  const SUFFIX = " (deleted)";
  let changed = false;

  // A deleted folder takes every open file beneath it, so descendants are marked too.
  // Matching only the exact path left those tabs looking healthy while pointing at
  // files that no longer existed.
  for (const [index, tab] of tabs.entries()) {
    if (!samePath(tab.path, path) && !isUnder(path, tab.path)) continue;
    if (tab.name.endsWith(SUFFIX)) continue;

    tabs[index] = { ...tab, name: `${tab.name}${SUFFIX}` };
    changed = true;
  }

  if (changed) renderTabs();
}

/** The row for a path, or null if that part of the tree is not built. */
function rowFor(path: string): HTMLElement | null {
  // Iterated rather than selected: a path holds backslashes and may hold quotes, and
  // escaping it into an attribute selector correctly is more fragile than a scan of a
  // list that is only ever as long as what is expanded on screen.
  for (const row of document.querySelectorAll<HTMLElement>("#filetree .tree-row")) {
    if (row.dataset["path"] !== undefined && samePath(row.dataset["path"], path)) return row;
  }
  return null;
}

/**
 * Compare two paths the way the platform's filesystem does.
 *
 * `===` is not good enough. The workspace root arrives from a restored session or the
 * folder dialog, while tree paths are built by the main process with `join`, so the same
 * directory can legitimately show up as `E:/project` and `E:\project`. Comparing those as
 * strings made the root's own refresh silently do nothing - the box was never found, so
 * a deleted row simply stayed in the tree.
 *
 * Mirrors `pathSafety.normalizeForCompare` in main: case matters only where the platform
 * says it does, and the two separators are the same character only on Windows.
 */
function normalizePath(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  if (platform === "win32") return trimmed.replace(/\//g, "\\").toLowerCase();
  return platform === "darwin" ? trimmed.toLowerCase() : trimmed;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/** Is `candidate` inside `dir`? Compared on a separator boundary, not as a prefix. */
function isUnder(dir: string, candidate: string): boolean {
  const parent = normalizePath(dir);
  const child = normalizePath(candidate);
  // The separator matters: a plain `startsWith` would place `src-old/a.ts` inside `src`.
  return child.startsWith(parent + (platform === "win32" ? "\\" : "/"));
}

const isWorkspaceRoot = (dirPath: string): boolean =>
  workspaceRoot !== null && samePath(dirPath, workspaceRoot);

/** Where a directory's children live: the tree itself for the root, else its own box. */
function childrenBoxFor(dirPath: string): HTMLElement | null {
  if (isWorkspaceRoot(dirPath)) return el("filetree");

  const row = rowFor(dirPath);
  const box = row?.parentElement?.querySelector<HTMLElement>(":scope > .tree-children");
  return box ?? null;
}

function depthOf(dirPath: string): number {
  if (isWorkspaceRoot(dirPath)) return 0;
  const row = rowFor(dirPath);
  return row === null ? 0 : Number(row.dataset["depth"] ?? "0") + 1;
}

/**
 * Re-list one directory, keeping the rows that are still there.
 *
 * Rebuilding the box wholesale would be shorter and would collapse every expanded folder
 * inside it, so renaming one file would fold up the part of the tree the user had spent
 * the last minute opening. Matching on path keeps those subtrees and their state.
 */
async function refreshDirectory(dirPath: string): Promise<void> {
  // Before the box check, and deliberately: the root's children render straight into the
  // tree rather than into a disclosure box, so a guard placed after it would never run for
  // the one directory the run button needs to know about.
  if (workspaceRoot !== null && samePath(dirPath, workspaceRoot)) void refreshRootFiles();

  const box = childrenBoxFor(dirPath);
  if (box === null) return;

  let entries;
  try {
    entries = await window.adcode.workspace.list(dirPath);
  } catch {
    return;
  }

  const existing = new Map<string, Element>();
  for (const wrapper of box.children) {
    const path = wrapper.querySelector<HTMLElement>(":scope > .tree-row")?.dataset["path"];
    if (path !== undefined) existing.set(path, wrapper);
  }

  const depth = depthOf(dirPath);
  const next = entries.map((entry) => existing.get(entry.path) ?? makeRow(entry, depth));

  // Anything left in `existing` is gone from disk, and dropping it here is what removes it.
  box.replaceChildren(...next);
}

/** Expand a directory so something created inside it is actually visible. */
async function expandDirectory(dirPath: string): Promise<void> {
  if (isWorkspaceRoot(dirPath)) return;

  const row = rowFor(dirPath);
  if (row === null || row.dataset["open"] === "true") return;

  row.click();
  // The click handler lists the directory before revealing it, so the box is not
  // populated on the next tick.
  await new Promise((resolve) => setTimeout(resolve, 120));
}

/**
 * The directory that holds `path` - always its parent, never itself.
 *
 * This is the one to refresh after something is renamed or removed. Conflating it with
 * `createTargetFor` meant deleting a folder refreshed the folder that had just stopped
 * existing, which failed silently and left its row in the tree.
 */
function containingDirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? (workspaceRoot ?? path) : path.slice(0, cut);
}

/** Where a new item goes when `path` was right-clicked: inside a folder, beside a file. */
function createTargetFor(path: string): string {
  return rowFor(path)?.dataset["kind"] === "directory" ? path : containingDirOf(path);
}

const baseName = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;

/** Open the inline editor for a new file or folder inside `dirPath`. */
async function beginCreate(dirPath: string, kind: "file" | "folder"): Promise<void> {
  await expandDirectory(dirPath);

  const box = childrenBoxFor(dirPath);
  if (box === null) {
    setStatus("That folder is not open in the tree.", 3000);
    return;
  }

  const editor = createInlineEditor({
    depth: depthOf(dirPath),
    placeholder: kind === "file" ? "File name" : "Folder name",
    cancel: () => {},
    commit: async (value) => {
      const result =
        kind === "file"
          ? await window.adcode.files.createFile(dirPath, value)
          : await window.adcode.files.createFolder(dirPath, value);

      if (!result.ok) return result.message;

      await refreshDirectory(dirPath);
      setStatus(result.message, 3000);

      // A new file is opened; a new folder is not, because there is nothing in it yet.
      if (kind === "file" && result.path !== undefined) void openFile(result.path);
      void sourceControl.refresh();
      return null;
    },
  });

  box.prepend(editor);
}

/** Replace a row with an editor holding its current name. */
function beginRename(path: string): void {
  const row = rowFor(path);
  if (row === null) return;

  const wrapper = row.parentElement;
  if (wrapper === null) return;

  const editor = createInlineEditor({
    depth: Number(row.dataset["depth"] ?? "0"),
    value: baseName(path),
    cancel: () => {
      row.hidden = false;
    },
    commit: async (value) => {
      const result = await window.adcode.files.rename(path, value);
      if (!result.ok) return result.message;

      row.hidden = false;
      await refreshDirectory(containingDirOf(path));

      // The tab for a renamed file points at a path that no longer exists; left alone,
      // the next save would recreate the old name and quietly fork the file in two.
      if (result.path !== undefined) retitleTab(path, result.path);

      setStatus(result.message, 3000);
      void sourceControl.refresh();
      return null;
    },
  });

  row.hidden = true;
  wrapper.prepend(editor);
}

/**
 * Whether this workspace's drive turned out to have no Recycle Bin.
 *
 * Windows only implements one on NTFS, so on a FAT32 or removable volume - which this
 * repository is on - `trashItem` always fails. Once that is known, later deletes ask the
 * honest question first rather than promising a Recycle Bin that is not there.
 */
let recycleBinUnavailable = false;

async function afterRemoval(path: string, said: string): Promise<void> {
  await refreshDirectory(containingDirOf(path));
  markTabStale(path);
  setStatus(said, 4000);
  void sourceControl.refresh();
}

async function deleteForGood(path: string, name: string): Promise<void> {
  const result = await window.adcode.files.delete(path);
  if (!result.ok) {
    gitResultDialog.show({ action: "Delete", ok: false, message: result.message });
    return;
  }
  await afterRemoval(path, `${name} deleted`);
}

async function confirmAndTrash(path: string): Promise<void> {
  const name = baseName(path);

  // Already known to be a drive without a bin: ask the question that is actually true.
  if (recycleBinUnavailable) {
    const sure = await confirmDialog.ask({
      title: `Permanently delete ${name}?`,
      body: "This drive has no Recycle Bin, so this cannot be undone.",
      confirmLabel: "Delete permanently",
      danger: true,
    });
    if (sure) await deleteForGood(path, name);
    return;
  }

  const confirmed = await confirmDialog.ask({
    title: `Delete ${name}?`,
    body: "It goes to the Recycle Bin, so it can be restored from Windows.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  const result = await window.adcode.files.trash(path);
  if (result.ok) {
    await afterRemoval(path, `${name} moved to the Recycle Bin`);
    return;
  }

  if (result.code !== "trash-failed") {
    gitResultDialog.show({ action: "Delete", ok: false, message: result.message });
    return;
  }

  /*
   * The bin was not available. Ask again rather than deleting anyway.
   *
   * Falling through to a permanent delete here would turn the recoverable action the user
   * agreed to into an irreversible one they were never offered - and they would find out
   * by looking in a Recycle Bin that never received the file.
   */
  recycleBinUnavailable = true;

  const sure = await confirmDialog.ask({
    title: `Delete ${name} permanently?`,
    body: "Windows could not move it to the Recycle Bin: this drive does not have one. Deleting it now cannot be undone.",
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (sure) await deleteForGood(path, name);
}

/* ── Drag and drop ────────────────────────────────────────────────────── */

/**
 * Our own MIME type for an internal drag.
 *
 * `text/plain` would also work and would be worse: it makes every tree row draggable into
 * the editor as a path-shaped string, and it makes any dragged text look like a file move.
 */
const TREE_DRAG_TYPE = "application/x-adcode-path";

/** The dragged path, kept alongside the transfer because `getData` is empty during dragover. */
let draggingPath: string | null = null;

function clearDropHighlight(): void {
  for (const marked of document.querySelectorAll<HTMLElement>("[data-drop-target]")) {
    delete marked.dataset["dropTarget"];
  }
}

/** Where a drop on this row lands: into a folder, beside a file. */
function dropTargetFor(path: string): string {
  return createTargetFor(path);
}

/**
 * Run a drop: external files are copied in, an internal drag moves (or copies with Ctrl).
 *
 * External sources are deliberately not confined to the workspace - being from elsewhere
 * is the point of a drop - while the destination always is. That is the direction that
 * matters: files come in, nothing goes out.
 */
async function handleDrop(event: DragEvent, targetDir: string): Promise<void> {
  const transfer = event.dataTransfer;
  if (transfer === null) return;

  const external = [...transfer.files];
  if (external.length > 0) {
    const outcomes: string[] = [];
    for (const file of external) {
      const source = window.adcode.files.pathForDropped(file);
      if (source === "") {
        outcomes.push(`${file.name}: not a file on disk`);
        continue;
      }
      const result = await window.adcode.files.importFrom(source, targetDir);
      if (!result.ok) outcomes.push(`${file.name}: ${result.message}`);
    }

    await refreshDirectory(targetDir);
    void sourceControl.refresh();

    if (outcomes.length > 0) {
      gitResultDialog.show({ action: "Add files", ok: false, message: outcomes.join("\n") });
    } else {
      setStatus(`Added ${external.length} item${external.length === 1 ? "" : "s"}`, 3500);
    }
    return;
  }

  const source = transfer.getData(TREE_DRAG_TYPE) || draggingPath;
  if (source === null || source === "") return;

  // Ctrl turns a move into a copy, which is what every file manager does and what the
  // `copy` drop effect shown during the drag already promised.
  const copying = event.ctrlKey;
  const result = copying
    ? await window.adcode.files.copy(source, targetDir)
    : await window.adcode.files.move(source, targetDir);

  if (!result.ok) {
    gitResultDialog.show({ action: copying ? "Copy" : "Move", ok: false, message: result.message });
    return;
  }

  // Both ends change: the item left one folder and arrived in another.
  await refreshDirectory(containingDirOf(source));
  await refreshDirectory(targetDir);
  if (!copying && result.path !== undefined) retitleTab(source, result.path);

  setStatus(result.message, 3500);
  void sourceControl.refresh();
}

function attachRowDragAndDrop(row: HTMLElement, entry: DirEntry): void {
  row.draggable = true;

  row.addEventListener("dragstart", (event) => {
    draggingPath = entry.path;
    event.dataTransfer?.setData(TREE_DRAG_TYPE, entry.path);
    if (event.dataTransfer !== null) event.dataTransfer.effectAllowed = "copyMove";
    row.dataset["dragging"] = "true";
  });

  row.addEventListener("dragend", () => {
    draggingPath = null;
    delete row.dataset["dragging"];
    clearDropHighlight();
  });

  row.addEventListener("dragover", (event) => {
    const target = dropTargetFor(entry.path);
    // Dropping a folder into itself or its own descendant would detach the subtree; the
    // main process refuses it too, but refusing here keeps the cursor honest.
    if (draggingPath !== null && (samePath(draggingPath, target) || isUnder(draggingPath, target))) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";

    clearDropHighlight();
    // Highlight the folder that will receive it, which for a file row is its parent.
    const marked = entry.isDirectory ? row : (rowFor(target) ?? el("filetree"));
    marked.dataset["dropTarget"] = "true";
  });

  row.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDropHighlight();
    void handleDrop(event, dropTargetFor(entry.path));
  });
}

/**
 * Re-read a file from disk into its open buffer.
 *
 * Used by Revert and by discarding changes. Both leave the file on disk different from
 * the buffer, and a buffer that still holds the old text will write it straight back
 * over the restored file on the next save.
 */
async function reloadFile(path: string): Promise<boolean> {
  try {
    const file = await window.adcode.files.read(path);
    editorHost.replaceText(path, file.text);
    return true;
  } catch {
    setStatus("Could not re-read that file.", 3000);
    return false;
  }
}

async function copyText(text: string, said: string): Promise<void> {
  await window.adcode.clipboard.writeText(text);
  setStatus(said, 2500);
}

async function revealInExplorer(path: string): Promise<void> {
  const result = await window.adcode.files.reveal(path);
  if (!result.ok) setStatus(result.message, 4000);
}

/* ── The file clipboard ───────────────────────────────────────────────── */

/**
 * What Cut or Copy last put down.
 *
 * Deliberately not the system clipboard. A path in the OS clipboard is a string that
 * pasting into an editor would drop as text, and reading files *out* of the system
 * clipboard would mean honouring whatever any other application had put there.
 */
let fileClipboard: { readonly path: string; readonly mode: "cut" | "copy" } | null = null;

async function pasteInto(targetDir: string): Promise<void> {
  const held = fileClipboard;
  if (held === null) return;

  const result =
    held.mode === "copy"
      ? await window.adcode.files.copy(held.path, targetDir)
      : await window.adcode.files.move(held.path, targetDir);

  if (!result.ok) {
    gitResultDialog.show({ action: "Paste", ok: false, message: result.message });
    return;
  }

  // A cut is spent once pasted; leaving it armed would move the file again on the next
  // paste, from a location it no longer occupies.
  if (held.mode === "cut") {
    fileClipboard = null;
    await refreshDirectory(containingDirOf(held.path));
    if (result.path !== undefined) retitleTab(held.path, result.path);
  }

  await refreshDirectory(targetDir);
  setStatus(result.message, 3500);
  void sourceControl.refresh();
}

async function duplicate(path: string): Promise<void> {
  const result = await window.adcode.files.duplicate(path);
  if (!result.ok) {
    gitResultDialog.show({ action: "Duplicate", ok: false, message: result.message });
    return;
  }

  await refreshDirectory(containingDirOf(path));
  setStatus(result.message, 3500);
  void sourceControl.refresh();
}

/* ── Git actions on one file ──────────────────────────────────────────── */

/** The staged/worktree state of one file within a status snapshot. */
function gitEntryFor(status: GitStatusView | null, relative: string): { staged: string } | null {
  const entry = status?.entries.find((candidate) => samePath(candidate.path, relative));
  return entry === undefined ? null : { staged: entry.staged };
}

async function runGitOnFile(action: string, path: string, run: () => Promise<GitOutcome>): Promise<void> {
  const outcome = await run().catch(
    (error: unknown): GitOutcome => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

  gitResultDialog.show({
    action,
    ok: outcome.ok,
    message: outcome.message,
    details: [["File", baseName(path)]],
  });

  void sourceControl.refresh();
  void refreshGitOverlay();
}

/** The menu for a row, or - when `path` is null - for empty space, meaning the root. */
function treeMenuNodes(path: string | null, status: GitStatusView | null): ContextMenuNode[] {
  if (workspaceRoot === null) return [];

  // New items go inside a clicked folder and beside a clicked file, which is where
  // people expect them and saves a step in both cases.
  const createIn = path === null ? workspaceRoot : createTargetFor(path);

  const nodes: ContextMenuNode[] = [
    { label: "New File", run: () => void beginCreate(createIn, "file") },
    { label: "New Folder", run: () => void beginCreate(createIn, "folder") },
  ];

  if (path === null) {
    nodes.push(
      { kind: "separator" },
      {
        label: "Paste",
        accelerator: "Ctrl+V",
        disabled: fileClipboard === null,
        run: () => void pasteInto(workspaceRoot as string),
      },
    );
    return nodes;
  }

  nodes.push(
    { kind: "separator" },
    { label: "Cut", accelerator: "Ctrl+X", run: () => { fileClipboard = { path, mode: "cut" }; setStatus(`Cut ${baseName(path)}`, 3000); } },
    { label: "Copy", accelerator: "Ctrl+C", run: () => { fileClipboard = { path, mode: "copy" }; setStatus(`Copied ${baseName(path)}`, 3000); } },
    {
      label: "Paste",
      accelerator: "Ctrl+V",
      disabled: fileClipboard === null,
      run: () => void pasteInto(createIn),
    },
    { label: "Duplicate", run: () => void duplicate(path) },
    { kind: "separator" },
    { label: "Copy Path", run: () => void copyText(path, "Path copied") },
    {
      label: "Copy Relative Path",
      run: () => void copyText(relativePath(path) ?? path, "Relative path copied"),
    },
    { label: "Reveal in File Explorer", run: () => void revealInExplorer(path) },
  );

  /* The git group, only where there is a repository and only for tracked-able files. */
  const relative = relativePath(path);
  if (status?.isRepo === true && relative !== null) {
    const entry = gitEntryFor(status, relative);
    const isStaged = entry !== null && entry.staged !== "none";

    nodes.push({ kind: "heading", label: "Git" });

    nodes.push(
      isStaged
        ? { label: "Unstage", run: () => void runGitOnFile("Unstage", path, () => window.adcode.git.unstage([relative])) }
        : { label: "Stage", run: () => void runGitOnFile("Stage", path, () => window.adcode.git.stage([relative])) },
    );

    nodes.push({
      label: "Discard Changes",
      danger: true,
      disabled: entry === null,
      run: () => void discardFileChanges(path, relative),
    });

    nodes.push(
      { label: "Commit…", run: () => void commitFromTree(path, relative) },
      { label: "Push", run: () => void runGitOnFile("Push", path, () => window.adcode.git.push()) },
    );
  }

  nodes.push(
    { kind: "separator" },
    { label: "Rename", accelerator: "F2", run: () => beginRename(path) },
    { label: "Delete", accelerator: "Del", danger: true, run: () => void confirmAndTrash(path) },
  );

  return nodes;
}

/** Discarding throws away uncommitted work, so it asks first and says what it costs. */
async function discardFileChanges(path: string, relative: string): Promise<void> {
  const sure = await confirmDialog.ask({
    title: `Discard changes to ${baseName(path)}?`,
    body: "The file goes back to its last committed state. Uncommitted edits cannot be recovered from git.",
    confirmLabel: "Discard changes",
    danger: true,
  });
  if (!sure) return;

  await runGitOnFile("Discard", path, () => window.adcode.git.discard([relative]));

  // The buffer still holds the old text, so it is reloaded rather than left disagreeing
  // with the file the user just restored.
  if (tabs.some((tab) => samePath(tab.path, path))) await reloadFile(path);
}

/** Stage this one file, then hand over to the commit box with it ready to go. */
async function commitFromTree(path: string, relative: string): Promise<void> {
  const staged = await window.adcode.git.stage([relative]);
  if (!staged.ok) {
    gitResultDialog.show({ action: "Stage", ok: false, message: staged.message });
    return;
  }

  showView("scm");
  await sourceControl.refresh();
  sourceControl.focusCommitMessage();
  setStatus(`${baseName(path)} staged - write a message and commit`, 5000);
}

/**
 * The row the menu was opened on, so focus can go back to it.
 *
 * Returning focus to the editor instead would make the Rename and Delete accelerators the
 * menu advertises unusable in the one flow where anybody discovers them - right-click,
 * read the menu, press the key it just showed you.
 */
let menuRow: HTMLElement | null = null;

/*
 * A drop anywhere else must not navigate the window.
 *
 * Chromium's default for a dropped file is to open it as the document, which in a
 * packaged app replaces the entire workbench with the file's contents and offers no way
 * back. The tree's own handlers call `preventDefault` first; this covers everywhere else.
 */
for (const type of ["dragover", "drop"] as const) {
  window.addEventListener(type, (event) => {
    // `event.target` is not always an element - dragging over the page reports `document`,
    // which has no `closest` - and an exception here would abort the handler before the
    // `preventDefault` that stops the drop navigating the window away.
    const target = event.target;
    if (target instanceof Element && target.closest("#filetree") !== null) return;

    event.preventDefault();
    if (type === "drop") clearDropHighlight();
  });
}

/* Empty space below the rows drops into the workspace root. */
el("filetree").addEventListener("dragover", (event) => {
  if (workspaceRoot === null) return;
  if (event.target instanceof Element && event.target.closest(".tree-row") !== null) return;

  event.preventDefault();
  if (event.dataTransfer !== null) event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
  clearDropHighlight();
  el("filetree").dataset["dropTarget"] = "true";
});

el("filetree").addEventListener("dragleave", (event) => {
  if (event.target === el("filetree")) clearDropHighlight();
});

el("filetree").addEventListener("drop", (event) => {
  if (workspaceRoot === null) return;
  if (event.target instanceof Element && event.target.closest(".tree-row") !== null) return;

  event.preventDefault();
  clearDropHighlight();
  void handleDrop(event, workspaceRoot);
});

el("filetree").addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (workspaceRoot === null) return;

  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tree-row") ?? null;

  // Right-clicking selects, so the highlight and the menu cannot disagree about which
  // row the next action is going to act on.
  if (row !== null) {
    for (const selected of document.querySelectorAll<HTMLElement>('.tree-row[aria-selected="true"]')) {
      selected.ariaSelected = "false";
    }
    row.ariaSelected = "true";
    row.focus();
  }

  menuRow = row;
  const path = row?.dataset["path"] ?? null;
  const { clientX, clientY } = event;

  // Fetched per open rather than cached: the git group has to describe this file as it
  // is now, and a menu offering "Stage" for something already staged is worse than one
  // that took an extra moment to appear.
  void window.adcode.git
    .status()
    .catch(() => null)
    .then((status) => treeMenu.open(clientX, clientY, treeMenuNodes(path, status)));
});

el("filetree").addEventListener("keydown", (event) => {
  const path = (event.target as HTMLElement | null)?.closest<HTMLElement>(".tree-row")?.dataset["path"];
  if (path === undefined) return;

  if (event.key === "F2") {
    event.preventDefault();
    beginRename(path);
    return;
  }

  if (event.key === "Delete") {
    event.preventDefault();
    void confirmAndTrash(path);
    return;
  }

  // The clipboard keys the menu advertises. Only while focus is on a row, so Ctrl+C in
  // the editor still copies text rather than picking up a file.
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;

  const key = event.key.toLowerCase();
  if (key === "x" || key === "c") {
    event.preventDefault();
    fileClipboard = { path, mode: key === "x" ? "cut" : "copy" };
    setStatus(`${key === "x" ? "Cut" : "Copied"} ${baseName(path)}`, 3000);
    return;
  }

  if (key === "v" && fileClipboard !== null) {
    event.preventDefault();
    void pasteInto(createTargetFor(path));
  }
});

/**
 * Close every open editor, keeping anything unsaved.
 *
 * Called when the open folder changes. Tabs hold absolute paths into the folder that was open,
 * so leaving them behind after a switch gives you editors pointing at another project - saving
 * one writes to a file outside the folder on screen, and the tab strip describes a workspace
 * that is no longer loaded.
 *
 * Drafts are flushed first rather than trusted to their timer. Dirty buffers are already
 * recorded for recovery a few seconds after the last keystroke, but "a few seconds" is exactly
 * the window someone lands in when they type something and immediately switch projects - so the
 * draft is written now, and the text is recoverable from the same prompt that handles a crash.
 */
async function closeAllTabs(): Promise<void> {
  for (const tab of [...tabs]) {
    if (!editorHost.isReadOnly(tab.path) && editorHost.isDirty(tab.path)) {
      const text = editorHost.text(tab.path);
      if (text !== null) window.adcode.history.draft(tab.path, text);
    }
  }

  for (const tab of [...tabs]) closeTab(tab.path);
}

/**
 * The bottom-left corner: where you are, and what you are running.
 *
 * The full path rather than the folder name. A name alone is ambiguous the moment you
 * have two checkouts of the same project - which is the normal state of affairs - and the
 * status bar is the one place with room to say which one this window is looking at. The
 * whole path is always the tooltip, however much of it is drawn.
 */
function setStatusWorkspace(root: string | null): void {
  const label = el("status-workspace");
  label.textContent = root === null ? "No folder" : shortenPath(root);
  label.title = root ?? "No folder is open";
}

/**
 * Hand the menu bar the recent folders it names.
 *
 * The renderer's bar and the main process's native menu are refreshed independently from
 * the same list: main rebuilds its own when the list changes, this rebuilds ours.
 */
async function refreshMenuRecents(): Promise<void> {
  if (menuBar === null) return;

  const recents = await window.adcode.workspace.recents().catch(() => []);
  menuBar.setContext({ recents });
}

/** Point the whole workbench at a folder that has already been opened in the main process. */
async function adoptWorkspace(opened: OpenedWorkspace): Promise<void> {
  await closeAllTabs();

  workspaceRoot = opened.root;
  void refreshRootFiles();
  setRendererWorkspace(opened.root);
  el("sidebar-title").textContent = opened.name;
  setStatusWorkspace(opened.root);
  commandCentre.setWorkspace(opened.name);

  await renderTree(opened.root);
  rememberSession();
  void refreshMenuRecents();
  void sourceControl.refresh();
  void refreshGitOverlay();
  void welcome.refresh();
  syncRootCreateButtons();
}

async function openFolder(): Promise<void> {
  const opened = await window.adcode.workspace.open();
  if (opened === null) return;

  await adoptWorkspace(opened);
}

/** Open a folder the user picked from the recents list or the welcome screen. */
async function openFolderAt(root: string): Promise<void> {
  const opened = await window.adcode.workspace.openPath(root);

  if (opened === null) {
    // The folder has been moved or deleted since it was last opened. Saying so beats opening
    // an empty tree, which reads as the project being empty rather than gone.
    setStatus("That folder is no longer there. It has been removed from Recent.", 6000);
    void welcome.refresh();
    return;
  }

  await adoptWorkspace(opened);
}

/* ── Terminal ─────────────────────────────────────────────────────────── */

/**
 * The terminal panel, created on first use.
 *
 * Built lazily because §7 budgets cold start, and xterm plus a pty is real work that
 * most launches never need.
 */
/**
 * The detected shells, and which one the plain "+" opens.
 *
 * Filled at boot from the main process, which only reports shells that exist on this
 * machine. Picking a shell from the launcher makes it the default, so opening a second one
 * of the same kind is one click rather than two.
 */
let terminalProfiles: TerminalProfile[] = [];
let defaultProfileId = "";

const profileLabel = (id: string): string =>
  terminalProfiles.find((profile) => profile.id === id)?.label ?? "Terminal";

function terminalPanel(): TerminalPanel {
  terminal ??= createTerminalPanel({
    panel: el("panel"),
    tabStrip: el("terminal-tabs"),
    surface: el("terminal-surface"),
    profileId: () => defaultProfileId,
    profileLabel,
    cwd: () => workspaceRoot,
    theme: () => theme,
    notify: (message) => setStatus(message, 4000),
    onActiveTitle: (title) => {
      el("panel-title").textContent = title ?? "Terminal";
    },
    onLayoutChange: () => {
      // The divider belongs to the panel: hidden together, or it hangs under the editor
      // as a grabbable line that resizes something nobody can see.
      el("splitter-panel").hidden = el("panel").hidden;
      editorHost.layout();
      if (el("panel").hidden) editorHost.focus();
    },
  });

  return terminal;
}

const toggleTerminal = (): Promise<void> => terminalPanel().toggle();

/* ── Adjustable layout ────────────────────────────────────────────────── */

let sidebarWidth = DEFAULT_SIDEBAR_WIDTH;
let panelHeight = DEFAULT_PANEL_HEIGHT;

/**
 * Push both sizes into CSS, re-clamped against the window as it is now.
 *
 * Called on every drag frame and on every window resize. Shrinking the window would
 * otherwise leave a sidebar wider than the screen, with its own divider off the right
 * edge and no way to drag it back.
 */
function applyLayout(): void {
  sidebarWidth = clampSidebarWidth(sidebarWidth, window.innerWidth);
  panelHeight = clampPanelHeight(panelHeight, window.innerHeight);

  const workbench = el("workbench");
  workbench.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  workbench.style.setProperty("--panel-height", `${panelHeight}px`);

  // Monaco and xterm both measure their own container; neither notices a CSS variable.
  // xterm is the one that shows it: a pty left at the old column count wraps its output
  // in the wrong place until something else happens to refit it.
  editorHost.layout();
  terminal?.fit();
}

createSplitter({
  element: el("splitter-sidebar"),
  axis: "x",
  label: "Resize sidebar",
  sign: 1,
  reset: DEFAULT_SIDEBAR_WIDTH,
  current: () => sidebarWidth,
  apply: (size) => {
    sidebarWidth = size;
    applyLayout();
  },
  commit: () => rememberSession(),
});

createSplitter({
  element: el("splitter-panel"),
  axis: "y",
  label: "Resize terminal panel",
  // The panel sits below the editor, so it grows as the pointer moves up.
  sign: -1,
  reset: DEFAULT_PANEL_HEIGHT,
  current: () => panelHeight,
  apply: (size) => {
    panelHeight = size;
    applyLayout();
  },
  commit: () => rememberSession(),
});

window.addEventListener("resize", () => applyLayout());

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
  // Where everyone else's cursor comes from. Cheap, and a no-op when nothing is shared.
  collabSession.publishCursor(line, column);
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
/*
 * Opened on pointerdown, with the event kept off `document`.
 *
 * The menu's own outside-click dismissal also listens on `document` for pointerdown, so
 * letting this through meant a second click on the chevron closed the menu and then
 * immediately reopened it - the button appeared not to toggle at all.
 */
el("terminal-profiles").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  openProfileLauncher(el("terminal-profiles"));
});

// Keyboard activation fires a click with no pointer behind it, and no pointerdown at all.
el("terminal-profiles").addEventListener("click", (event) => {
  if (event.detail === 0) openProfileLauncher(el("terminal-profiles"));
});
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
    layout: { sidebarWidth, panelHeight },
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

/* Anything that destroys work asks first, through here. */
const confirmDialog = createConfirmDialog(document.body);

/* The replacement for `window.prompt`, which Electron does not implement. */
const promptDialog = createPromptDialog(document.body);

/**
 * Feedback, from the button beside the command centre.
 *
 * The dialog does the round trip itself so it can stay open and show why a send failed;
 * the toast here only fires on success, once there is a report id to point at.
 */
const reportDialog = createReportDialog(document.body, async (input) => {
  const result = await window.adcode.support.submitReport(input);
  if (result.ok) setStatus("Thanks - your report was sent.", 5000);
  return result;
});

el<HTMLButtonElement>("report-toggle").addEventListener("click", () => reportDialog.open());

const treeMenu = createContextMenu(document.body);
attachContextMenuDismissal(treeMenu, () => (menuRow ?? editorHost).focus());

/**
 * The shell launcher on the terminal panel's split button.
 *
 * Its own menu rather than the tree's, because dismissing it should return focus to the
 * terminal - the tree's dismissal aims at whichever row was last right-clicked, which in
 * the panel is a row nobody touched.
 */
const panelMenu = createContextMenu(document.body);
attachContextMenuDismissal(panelMenu, () => (terminal ?? editorHost).focus());

/**
 * Open the profile launcher under `anchor`.
 *
 * Anchored to the button rather than to the pointer, so it reads as that button's menu and
 * appears in the same place whether it was opened by mouse or by keyboard.
 */
function openProfileLauncher(anchor: HTMLElement): void {
  if (panelMenu.isOpen()) {
    panelMenu.close();
    return;
  }

  const nodes: ContextMenuNode[] =
    terminalProfiles.length === 0
      ? [{ label: "No shells detected", run: () => undefined, disabled: true }]
      : terminalProfiles.map((profile) => ({
          label: profile.label,
          run: () => {
            // Picking a shell also makes it what the plain "+" opens, so a second one of
            // the same kind is one click rather than two.
            defaultProfileId = profile.id;
            return terminalPanel().create({ profileId: profile.id });
          },
        }));

  const rect = anchor.getBoundingClientRect();
  anchor.setAttribute("aria-expanded", "true");
  panelMenu.open(rect.left, rect.bottom + 2, [{ kind: "heading", label: "New Terminal" }, ...nodes], () =>
    anchor.setAttribute("aria-expanded", "false"),
  );
}

/**
 * A palette command per detected shell.
 *
 * Registered here rather than declared in `menuModel.ts` because which shells exist is
 * decided by what is installed on the machine, and that model is also what macOS builds a
 * *native* menu from - a hardcoded row for a shell that is not there would be a menu item
 * that silently does nothing.
 */
function registerProfileCommands(): void {
  for (const profile of terminalProfiles) {
    // The id is derived from the profile's own id, so "git-bash" becomes a well-formed
    // dotted command rather than one carrying a dash into the registry.
    const suffix = profile.id.replace(/-(.)/g, (_, c: string) => c.toUpperCase());

    commands.register({
      id: `terminal.newProfile.${suffix}`,
      title: `New Terminal: ${profile.label}`,
      run: () => {
        defaultProfileId = profile.id;
        return terminalPanel().create({ profileId: profile.id });
      },
    });
  }
}

const sourceControl = createSourceControlPanel({
  openFile: (path) => void openFile(absolutePath(path)),
  workspaceRoot: () => workspaceRoot,
  notify: (text) => setStatus(text, 4000),
  reportResult: (result) => gitResultDialog.show(result),
  promptFor: (request) => promptDialog.ask(request),
  openCommitDiff: (ref, shortHash, path) => void openCommitDiff(ref, shortHash, path),
  restoreFile: (ref, shortHash, path) => restoreFileFromCommit(ref, shortHash, path),
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

/**
 * Show what one commit did to one file, as a diff.
 *
 * The diff rather than the resulting file: the question being asked from a commit row is
 * "what changed here", and answering it with the whole file makes the reader find the
 * change themselves. Read-only, in its own tab keyed by hash and path, so it can never
 * shadow the working copy or be saved over it.
 */
async function openCommitDiff(ref: string, shortHash: string, path: string): Promise<void> {
  const diff = await window.adcode.git.commitFileDiff(ref, path).catch(() => "");
  if (diff.trim().length === 0) {
    setStatus("No changes to show for that file.", 3000);
    return;
  }

  const key = `adcode-commit-diff:${shortHash}:${path}`;
  const name = `${basename(path)} @ ${shortHash}`;

  if (tabs.some((tab) => tab.path === key)) {
    activateTab(key);
    return;
  }

  editorHost.open(key, diff, "diff");
  editorHost.setReadOnly(key, true);
  tabs.push({ path: key, name, dirty: false });
  activateTab(key);
}

/**
 * Put a file back as it was at a commit.
 *
 * Confirmed first, because it overwrites whatever is in the working tree right now - the
 * one thing here that git cannot get back for you. What it produces is an uncommitted
 * change: history is untouched, so the restore itself is reviewed and then committed or
 * discarded like any other edit. That is why this offers no reset.
 */
async function restoreFileFromCommit(ref: string, shortHash: string, path: string): Promise<void> {
  const sure = await confirmDialog.ask({
    title: `Restore ${basename(path)} from ${shortHash}?`,
    body: "It is written over the current file as an uncommitted change. No commits are rewritten, so you can review it and then keep or discard it.",
    confirmLabel: "Restore",
    danger: true,
  });
  if (!sure) return;

  const result = await window.adcode.git.restoreFile(ref, path).catch(
    (error: unknown): GitOutcome => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

  gitResultDialog.show({
    action: "Restore",
    ok: result.ok,
    message: result.message,
    details: [
      ["File", basename(path)],
      ["From", shortHash],
    ],
  });
  if (!result.ok) return;

  // The buffer still holds what was there a moment ago, and would write it straight back
  // over the restored file on the next save.
  const absolute = absolutePath(path);
  if (tabs.some((tab) => samePath(tab.path, absolute))) await reloadFile(absolute);

  await refreshDirectory(containingDirOf(absolute));
  void sourceControl.refresh();
  void refreshGitOverlay();
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

/* ── Problems ─────────────────────────────────────────────────────────── */

/*
 * Monaco's language workers have been type-checking every open TypeScript, JSON, CSS and
 * HTML file since the day they were added; nothing had ever read what they found. The host
 * subscribes to those markers, the panel draws them, and `@adcode/diagnostics` turns the
 * compiler's sentence into one a beginner can act on.
 */
const plainEnglishErrors = (): boolean =>
  settingsValues["adcode.editing.plainEnglishErrors"] !== false;

const diagnosticsHost = createDiagnosticsHost({
  workspaceRoot: () => workspaceRoot,
  explanationsEnabled: plainEnglishErrors,
  // An editable tab, not merely a model inside the workspace. The commit browser opens
  // historical revisions as read-only models, and those get type-checked too - the panel
  // filled with errors in files the user had never opened until this predicate existed.
  includeFile: (fsPath) => editableTab(fsPath),
});

/*
 * Language servers report into the same panel, through the same seam the live preview uses.
 * That seam existing is the whole reason this slice is a hundred lines rather than a second
 * diagnostics surface.
 */
const editableTab = (fsPath: string): boolean =>
  tabs.some((tab) => samePath(tab.path, fsPath) && !editorHost.isReadOnly(tab.path));

createLanguageBridge({
  workspaceRoot: () => workspaceRoot,
  publish: (diagnostics) => diagnosticsHost.setExternal("lsp", diagnostics),
});

const problemsPanel = createProblemsPanel({
  openAt: (path, line, column) => {
    void openFile(absolutePath(path)).then(() => editorHost.revealPosition(line, column));
  },
  quickFixes: (diagnostic) => diagnosticsHost.quickFixes(diagnostic),
  explainWithAI: (diagnostic) => {
    // The file and line matter as much as the message: the assistant has tools to read the
    // workspace, and without a location it can only talk about the error in the abstract.
    chat.ask(
      `I'm getting this error in ${diagnostic.file} on line ${diagnostic.line}:\n\n` +
        `${diagnostic.message}\n\n` +
        `Explain what it means in simple terms, and show me how to fix it.`,
    );
  },
  explanationsEnabled: plainEnglishErrors,
  notify: (text) => setStatus(text, 4000),
});

diagnosticsHost.onChange((diagnostics) => {
  problemsPanel.render(diagnostics);

  const badge = badgeFor(countBySeverity(diagnostics));
  const element = el("problems-badge");

  element.hidden = badge === null;
  element.textContent = badge?.text ?? "";
  element.dataset["tone"] = badge?.tone ?? "error";

  const activity = document.querySelector<HTMLElement>('.activity[data-view="problems"]');
  if (activity !== null) {
    activity.title =
      badge === null ? "Problems (Ctrl+Shift+M)" : `${summarise(countBySeverity(diagnostics))} (Ctrl+Shift+M)`;
  }
});

/* ── Live preview ─────────────────────────────────────────────────────── */

/* ── Go Live / Run (the status bar's right-hand corner) ───────────────── */

/**
 * The names of the files at the workspace root.
 *
 * Two decisions read it: whether a `.css` file belongs to a page (is there an
 * `index.html`?) and whether a language should run its project rather than one file (is
 * there a `Cargo.toml`?). Cached because it is consulted on every tab switch and the answer
 * changes only when the root directory does.
 */
let rootFileNames: readonly string[] = [];

async function refreshRootFiles(): Promise<void> {
  if (workspaceRoot === null) {
    rootFileNames = [];
    runButton.refresh();
    return;
  }

  try {
    const entries = await window.adcode.workspace.list(workspaceRoot);
    rootFileNames = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  } catch {
    rootFileNames = [];
  }

  runButton.refresh();
}

const runButton = createRunButton({
  activeFile: () => {
    if (activePath === null) return null;

    // Read-only historical buffers have synthetic paths and are not files anyone can run.
    if (editorHost.isReadOnly(activePath)) return null;

    const relative = relativePath(activePath);
    if (relative === null) return null;

    const tab = tabs.find((entry) => entry.path === activePath);
    return { relativePath: relative, languageId: languageForFilename(tab?.name ?? relative) };
  },
  rootFiles: () => rootFileNames,
  platform: () => platform,
  togglePreview: () => previewPane.toggle(),
  isPreviewOpen: () => previewPane.isOpen(),

  /**
   * Into the terminal, not into a hidden process.
   *
   * The output *is* the feature. A beginner pressing Run needs to see the traceback, the
   * compiler error, and the exit code - and the terminal already resolves file paths in
   * that output into clickable links back to the editor.
   */
  runInTerminal: async (command) => {
    const panel = terminalPanel();
    if (!panel.isOpen()) await panel.toggle();
    if (panel.count() === 0) await panel.create();

    panel.send(command);
  },
});

el("status-run-slot").append(runButton.element);

const previewPane = createPreviewPane({
  host: el("editor-area"),
  // Fires on open and on close, which is exactly when the run button has to change from
  // "Go Live" to "Stop preview" and back.
  onLayoutChange: () => {
    editorHost.layout();
    runButton.refresh();
  },
  notify: (text) => setStatus(text, 5000),
  reportProblem: (message) => {
    // Slice 1 built the panel so slice 2 would have somewhere honest to report to instead
    // of growing a second error surface. This is that promise being collected on.
    diagnosticsHost.setExternal(
      "preview",
      message === null
        ? []
        : [
            {
              file: "Live preview",
              line: 1,
              column: 1,
              endLine: 1,
              endColumn: 1,
              severity: "error",
              source: "preview",
              code: "",
              message,
            },
          ],
    );
  },
});

el("view-scm").append(sourceControl.element);
el("view-search").append(searchPanel.element);
el("view-problems").append(problemsPanel.element);

/** Switch which sidebar view is showing. */
function showView(view: string): void {
  const views: Record<string, HTMLElement> = {
    explorer: el("filetree"),
    search: el("view-search"),
    scm: el("view-scm"),
    problems: el("view-problems"),
  };

  /*
   * An unknown name changes nothing, rather than hiding everything.
   *
   * Without this, `showView("settings")` - which is a reasonable-looking thing to write, and
   * was written - matched no entry, so the loop below hid all four views and the loop after it
   * deselected every activity button. The result was an empty sidebar with nothing highlighted
   * and no error anywhere, which reads to a user as the window having broken. Settings is an
   * overlay and has its own `open()`.
   */
  if (views[view] === undefined) return;

  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;

  for (const activity of document.querySelectorAll<HTMLElement>(".activity")) {
    if (activity.dataset["view"] !== undefined) {
      activity.ariaSelected = String(activity.dataset["view"] === view);
    }
  }

  if (view === "scm") void sourceControl.refresh();
  if (view === "search") searchPanel.focus();
  // Markers can have changed while another view was showing, and the panel only redraws on
  // a marker event - so a view that was hidden through a whole editing session would come
  // back holding whatever it last drew.
  if (view === "problems") diagnosticsHost.refresh();
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

/**
 * Everything in the renderer that remembers something per folder.
 *
 * One function rather than a call per widget at each of the three places the open folder
 * changes - opening one, restoring a session on launch, and closing one. The README already
 * records what happens when a notification like this lives at its call sites instead: the
 * route nobody thinks about is session restore, because no user action triggers it, so the
 * feature works perfectly when you open a folder by hand and is broken on every launch after
 * the first. Whoever adds the fourth consumer should only have to edit this function.
 */
function setRendererWorkspace(root: string | null): void {
  chat.setWorkspace(root);
  previewPane.setWorkspace(root);
}

const notifications = createNotificationCentre(el("toast-layer"));

window.adcode.ads.onShow((toast) => notifications.showSponsored(toast));

/* ── Live collaboration ───────────────────────────────────────────────────── */

const collabSession = createCollabSession({
  editorHost,
  workspaceRoot: () => workspaceRoot,
  openPaths: () => tabs.map((tab) => tab.path),
  activePath: () => activePath,
});

const collabPanel = createCollabPanel({
  host: document.body,
  anchor: el("status-collab"),
  notify: (message) => setStatus(message, 6000),
  confirm: (title, body, confirmLabel) => confirmDialog.ask({ title, body, confirmLabel }),
  prompt: (title, body, value) => promptDialog.ask({ title, body, value }),
});

el("status-collab").addEventListener("click", () => collabPanel.toggle());

window.adcode.collab.onStatus((status) => {
  collabPanel.update(status);
  collabSession.applyStatus(status);

  /*
   * The status bar says what is actually happening, in words.
   *
   * "Share" when nothing is running, a person count when it is. This is the only indicator in
   * the window for a state where other people can read and change these files, so it does not
   * get to be a subtle icon change.
   */
  const guests = Math.max(0, status.participants.length - 1);
  const label = el("status-collab-label");

  if (status.mode === "hosting") {
    label.textContent = guests === 0 ? "Sharing" : `Sharing · ${guests}`;
  } else if (status.mode === "joined") {
    label.textContent = "In session";
  } else if (status.mode === "connecting") {
    label.textContent = "Connecting…";
  } else {
    label.textContent = "Share";
  }

  el("status-collab").dataset["state"] = status.mode;
});

window.adcode.collab.onDocUpdate((path, update) => collabSession.applyDocUpdate(path, update));
window.adcode.collab.onPresence((presence) => collabSession.applyPresence(presence));
window.adcode.collab.onNotice((detail) => setStatus(detail, 6000));

window.adcode.collab.onCommitRequest((request) => {
  void (async () => {
    /*
     * A guest asked for a commit, and only the host can answer.
     *
     * Asked rather than applied. The commit runs under the host's git identity on the host's
     * machine, so it is the host's decision - and the message is shown as the guest wrote it,
     * because approving a commit whose message you have not read is not approval.
     */
    const approved = await confirmDialog.ask({
      title: `${request.participantName} wants to commit`,
      body: `Their message: "${request.message}"\n\nThis will commit the staged changes on this machine, under your git identity.`,
      confirmLabel: "Commit",
      cancelLabel: "Decline",
    });

    if (!approved) {
      await window.adcode.collab.decideCommit(request.id, false, "The host declined.");
      return;
    }

    // `Co-authored-by` so the guest's contribution is recorded in the history even though this
    // machine's identity signed it.
    const message = `${request.message}\n\nCo-authored-by: ${request.participantName} <collab@adcode.local>`;
    const outcome = await window.adcode.git.commit(message);

    await window.adcode.collab.decideCommit(
      request.id,
      outcome.ok,
      outcome.ok ? "committed" : outcome.message,
    );

    setStatus(
      outcome.ok ? `Committed for ${request.participantName}.` : `Commit failed: ${outcome.message}`,
      6000,
    );
    void sourceControl.refresh();
  })();
});

const earningsPopover = createEarningsPopover({
  host: document.body,
  anchor: el("open-earnings"),
  /*
   * `settingsView.open()`, not `showView("settings")`.
   *
   * Settings is an overlay, not a sidebar view - the gear in the activity bar calls
   * `settingsView.toggle()`. `showView` knows only explorer, search, scm and problems, so
   * asking it for "settings" did not merely fail to open anything: it hid all four views and
   * deselected every activity button, leaving an empty sidebar with nothing highlighted and no
   * settings on screen.
   */
  openSettings: () => settingsView.open(),
});

el("open-earnings").addEventListener("click", () => earningsPopover.toggle());

window.adcode.ads.onEarnings((earnings) => {
  // A cached mirror of a server value (§1). The renderer never computes money.
  el("status-earnings").textContent = earnings.hasServerBalance
    ? `${earnings.availableLabel} earned`
    : "";

  // The popover redraws whether or not it is open, so opening it never shows a stale figure
  // for the frame before the next tick arrives.
  earningsPopover.update(earnings);
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

  // Not awaited into the rest of the launch: the version is the least urgent thing on the
  // screen, and an IPC round trip for it should not hold up the window.
  void window.adcode.app.info().then(
    (info) => {
      el("status-version").textContent = `ADCode ${info.version}`;
    },
    () => {
      /* the corner simply says nothing about the version */
    },
  );

  void refreshMenuRecents();

  // §1: reduce-motion follows the OS. Chromium's media query is the single source of
  // truth for it; the attribute just lets JS-driven animations read the same value.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const syncMotion = (): void => {
    document.documentElement.dataset["reducedMotion"] = String(reduceMotion.matches);
  };
  reduceMotion.addEventListener("change", syncMotion);
  syncMotion();

  terminalProfiles = await window.adcode.terminal.profiles();
  defaultProfileId = terminalProfiles[0]?.id ?? "";
  registerProfileCommands();

  // §4: "Restore workspace" reopens the folder in the main process, so the workspace is
  // already set by the time this asks for it.
  const restored = await window.adcode.session.restore();

  // Before the tree and the editors, so nothing is laid out at the default width and then
  // moved - which shows up as a visible jump on every launch.
  if (restored.layout !== undefined) {
    sidebarWidth = restored.layout.sidebarWidth;
    panelHeight = restored.layout.panelHeight;
    applyLayout();
  }

  const existing = await window.adcode.workspace.current();
  if (existing !== null) {
    workspaceRoot = existing.root;
    void refreshRootFiles();
    setRendererWorkspace(existing.root);
    el("sidebar-title").textContent = existing.name;
    setStatusWorkspace(existing.root);
    commandCentre.setWorkspace(existing.name);
    await renderTree(existing.root);
  }

  for (const file of restored.openFiles) await openFile(file);
  if (restored.activeFile !== null && tabs.some((tab) => tab.path === restored.activeFile)) {
    activateTab(restored.activeFile);
  }

  /*
   * The same fan-out the open and close routes do.
   *
   * Session restore is the route that gets forgotten - no user action triggers it - so the
   * create buttons stayed greyed out and the welcome screen kept an empty recents list on every
   * launch after the first, which is the ordinary case. The README records this exact shape of
   * bug about language servers; it is the same one.
   */
  syncRootCreateButtons();
  void welcome.refresh();

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
  const lines: string[] = [];

  // Into the submenus as well. The zoom keys and the preview keys live in one, and a
  // shortcut sheet that omits them is a shortcut sheet you stop trusting.
  const walk = (entries: readonly MenuEntry[]): void => {
    for (const entry of entries) {
      if ("kind" in entry && entry.kind === "submenu") walk(entry.items);
      else if ("accelerator" in entry && entry.accelerator !== undefined) {
        lines.push(`${formatAccelerator(entry.accelerator, platform)}   ${stripMnemonic(entry.label)}`);
      }
    }
  };

  for (const top of buildMenuBar()) walk(top.items);

  notifications.show({
    title: "Keyboard shortcuts",
    body: lines.join("\n"),
    autoDismissMs: 15_000,
  });
}

/** Everything the menu bar, the keyboard, and the palette can ask for. */
function registerCommands(): void {
  const add = (id: string, title: string, run: (arg?: string) => void | Promise<void>): void =>
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

  add("file.open", "Open File", () => {
    void (async () => {
      const picked = await window.adcode.files.openDialog();
      if (picked !== null) await openPickedFile(picked);
    })();
  });

  add("workspace.openRecent", "Open Recent Folder", () => {
    void (async () => {
      const recents = await window.adcode.workspace.recents();

      if (recents.length === 0) {
        setStatus("No recent folders yet - the ones you open are remembered here.", 4000);
        return;
      }

      const picked = await promptDialog.ask({
        title: "Open Recent",
        body: "Start typing to filter, or pick from the list.",
        value: recents[0]?.path ?? "",
        suggestions: recents.map((folder) => folder.path),
        confirmLabel: "Open",
      });

      if (picked !== null) await openFolderAt(picked);
    })();
  });

  /*
   * The rows in File > Open Recent.
   *
   * One command taking a path, not one command per folder: the palette lists everything
   * registered, and a dozen `workspace.openRecent:E:/…` entries would push out the
   * commands people actually type. The path arrives from the menu model, which got it
   * from the same recents list this reads.
   */
  add("workspace.openRecentAt", "Open Recent Folder by Path", async (path) => {
    if (path === undefined) return;
    await openFolderAt(path);
  });

  add("workspace.clearRecents", "Clear Recently Opened", async () => {
    await window.adcode.workspace.clearRecents();
    await refreshMenuRecents();
    void welcome.refresh();
    setStatus("Recent folders cleared.", 2500);
  });

  add("workspace.clone", "Clone Repository", () => void cloneRepository());
  add("workspace.close", "Close Folder", async () => {
    await window.adcode.workspace.close();

    await closeAllTabs();

    workspaceRoot = null;
    void refreshRootFiles();
    setRendererWorkspace(null);
    el("sidebar-title").textContent = "No Folder Opened";
    setStatusWorkspace(null);
    commandCentre.setWorkspace(null);
    el("filetree").replaceChildren(hint("Open a folder to get started."));
    syncRootCreateButtons();
    void welcome.refresh();

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
    if (await reloadFile(activePath)) setStatus("Reverted.", 1500);
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
  add("view.problems", "Problems", () => showView("problems"));
  add("view.earnings", "Earnings", () => earningsPopover.toggle());
  add("collab.panel", "Live Session: Share or Join", () => collabPanel.toggle());
  add("collab.leave", "Live Session: Leave", () => void window.adcode.collab.leave());
  add("preview.toggle", "Toggle Live Preview", () => void previewPane.toggle());
  add("preview.reload", "Reload Live Preview", () => previewPane.reload());
  add("preview.undock", "Undock Live Preview Into a Floating Window", () =>
    previewPane.togglePlacement(),
  );
  add("preview.switchMode", "Switch Preview Between Project and Files", () =>
    void previewPane.switchMode(),
  );
  add("run.file", "Run Active File", () => runButton.activate());
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

  /*
   * Git.
   *
   * Every one of these drives the source control panel rather than calling the git bridge
   * directly, so an action taken from the menu reports its outcome in the same dialog,
   * refreshes the same list, and fails the same way as the button that has always done
   * it. The view is shown first because these commands change what it says, and a result
   * you have to go looking for is a result most people never see.
   */
  const withScm = (run: () => Promise<void>) => async (): Promise<void> => {
    if (workspaceRoot === null) {
      setStatus("Open a folder first.", 3000);
      return;
    }

    showView("scm");
    await run();
  };

  // The id stays on the same line as `add(` here as everywhere else: `menuModel.test.ts`
  // proves every menu entry resolves to a registered command by reading this file, and it
  // reads it one line at a time.
  add("git.commit", "Git: Commit", withScm(async () => {
    // The commit box is where the message lives, so this either sends what is already
    // typed or puts the cursor where it has to be typed. Inventing a second place to
    // write a commit message would mean two boxes that can disagree.
    if (sourceControl.commit()) return;

    sourceControl.focusCommitMessage();
    setStatus("Type a commit message, then press Ctrl+Enter.", 4000);
    await Promise.resolve();
  }));

  add("git.stageAll", "Git: Stage All Changes", withScm(() => sourceControl.stageAll()));
  add("git.unstageAll", "Git: Unstage All Changes", withScm(() => sourceControl.unstageAll()));
  add("git.push", "Git: Push", withScm(() => sourceControl.push()));
  add("git.pull", "Git: Pull", withScm(() => sourceControl.pull()));
  add("git.fetch", "Git: Fetch", withScm(() => sourceControl.fetch()));
  add("git.checkout", "Git: Checkout Branch", withScm(() => sourceControl.switchBranch()));
  add("git.createBranch", "Git: Create Branch", withScm(() => sourceControl.createBranch()));
  add("git.init", "Git: Initialise Repository", withScm(() => sourceControl.initRepository()));

  /* Terminal */
  add("terminal.toggle", "Toggle Terminal", () => toggleTerminal());
  add("terminal.new", "New Terminal", () => terminalPanel().create());
  add("terminal.newWithProfile", "New Terminal With Profile", async () => {
    // The launcher hangs off a button in the panel header, so the panel has to be open
    // before there is anything to hang it from.
    if (!terminalPanel().isOpen()) await terminalPanel().toggle();
    openProfileLauncher(el("terminal-profiles"));
  });
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
    gitResultDialog.showBrand({
      title: "ADCode",
      body: "An ad-supported, AI-native IDE. Everything ships in the binary - there is no marketplace.",
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
        run: (command, arg) => commands.run(command, arg),
        platform,
        restoreFocus: () => editorHost.focus(),
      });

/**
 * Clone a repository, then open it.
 *
 * Two questions rather than a form, because they are genuinely sequential: the folder name
 * offered second is derived from the URL given first, which is what makes the second question
 * a confirmation rather than a decision.
 *
 * The clone itself is `packages/git`'s, which refuses `ext::` transports and `--upload-pack=`
 * before anything reaches git - a URL pasted from a chat window is untrusted input, and cloning
 * is the one git operation that can be turned into arbitrary command execution by its argument.
 */
async function cloneRepository(): Promise<void> {
  const url = await promptDialog.ask({
    title: "Clone a repository",
    body: "Paste the repository URL. On GitHub this is the green Code button.",
    placeholder: "https://github.com/owner/repo.git",
    confirmLabel: "Continue",
  });
  if (url === null) return;

  // `owner/repo.git` → `repo`. A sensible default the user can overwrite, not a decision.
  const suggested = (url.split(/[\\/]/).at(-1) ?? "repo").replace(/\.git$/i, "") || "repo";

  const parent = await window.adcode.workspace.open();
  if (parent === null) return;

  const target = await promptDialog.ask({
    title: "Folder name",
    body: `The repository will be cloned into a new folder inside ${parent.name}.`,
    value: suggested,
    confirmLabel: "Clone",
  });
  if (target === null) return;

  setStatus(`Cloning ${url}…`);

  const outcome = await window.adcode.git.clone(url, `${parent.root}/${target}`);
  if (!outcome.ok) {
    gitResultDialog.show({ action: "Clone", ok: false, message: outcome.message, details: [["URL", url]] });
    return;
  }

  setStatus("Cloned.", 4000);
  await openFolderAt(`${parent.root}/${target}`);
}

/*
 * New file and new folder at the root of the open folder.
 *
 * `beginCreate` expects a directory to create inside and opens the tree's inline editor there,
 * which is the same path the row actions and the context menu take - so a name created here is
 * validated, refused, and undone exactly as one created deeper in the tree.
 */
for (const [id, kind] of [
  ["new-root-file", "file"],
  ["new-root-folder", "folder"],
] as const) {
  el(id).addEventListener("click", () => {
    if (workspaceRoot === null) return;
    void beginCreate(workspaceRoot, kind);
  });
}

/** Both are meaningless with no folder open, and a button that does nothing should say so. */
function syncRootCreateButtons(): void {
  const disabled = workspaceRoot === null;
  (el("new-root-file") as HTMLButtonElement).disabled = disabled;
  (el("new-root-folder") as HTMLButtonElement).disabled = disabled;
}

/**
 * Open a file the user picked from a dialog, opening its folder first when necessary.
 *
 * A file outside the open folder cannot be read through the file bridge, which checks
 * `isInsideWorkspace` on every path. So when the pick lands outside, the folder containing it is
 * opened first - which is what the user meant anyway, and the alternative is a picker that
 * succeeds and then an editor that refuses to show what was picked.
 */
async function openPickedFile(picked: string): Promise<void> {
  const root = workspaceRoot;
  const inside =
    root !== null && picked.replace(/\\/g, "/").startsWith(`${root.replace(/\\/g, "/")}/`);

  if (!inside) await openFolderAt(picked.replace(/[\\/][^\\/]*$/, ""));

  await openFile(picked);
}

const welcome = createWelcomeView({
  host: el("editor-placeholder"),
  openFolder: () => void openFolder(),
  openFile: () => {
    void (async () => {
      const picked = await window.adcode.files.openDialog();
      if (picked !== null) await openPickedFile(picked);
    })();
  },
  cloneRepository: () => void cloneRepository(),
  openRecent: (path) => void openFolderAt(path),
  forgetRecent: (path) => {
    void window.adcode.workspace.forgetRecent(path).then(() => welcome.refresh());
  },
});

void welcome.refresh();

if (menuBar !== null) el("menubar-slot").append(menuBar.element);

/* ── Title bar: the assistant on the left, the command centre in the middle ─ */

el("ai-toggle").addEventListener("click", () => commands.run("ai.toggle"));

const commandCentre = createCommandCentre({
  openFiles: (seed) => quickOpen.open(seed),
  openCommands: (seed) => palette.open(seed),
});

el("command-centre-slot").append(commandCentre.element);
commandCentre.setWorkspace(null);

chat.onVisibilityChange((open) => el("ai-toggle").setAttribute("aria-pressed", String(open)));

window.adcode.window.onCommand((command, arg) => commands.run(command, arg));

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

/**
 * Alt is decided on release, not on press - see `altMenuActivation.ts`.
 *
 * Every Alt chord the Selection menu owns sends an `Alt` keydown first, so opening the bar
 * there pulled focus out of Monaco and left the arrow key walking a menu.
 */
const altMenu = createAltMenuActivation();

/*
 * Tracked in the capture phase, which is not a detail - it is the fix.
 *
 * Monaco calls `stopPropagation()` on every key it handles, and Alt+Up is one of them. A
 * bubble-phase listener on `window` therefore never sees the `ArrowUp` that makes the
 * press a chord, so Alt stayed armed and the release opened the menu anyway. The state
 * machine was already right and its unit tests already passed; only driving the real app
 * showed it, which is what `altChordLeavesMenuShut` in the smoke run now holds in place.
 */
window.addEventListener(
  "keydown",
  (event) => {
    if (gitResultDialog.isOpen() || confirmDialog.isOpen() || promptDialog.isOpen()) altMenu.cancel();
    else altMenu.keydown(event);
  },
  true,
);

window.addEventListener(
  "keyup",
  (event) => {
    if (menuBar === null || !altMenu.keyup(event)) return;

    event.preventDefault();
    // Focus, not open. Windows has always put the bar into a waiting state on Alt and let
    // the next key decide; opening File immediately - which this used to do - cost you a
    // dropdown every time you reached for the bar to press a letter.
    menuBar.focusBar();
  },
  true,
);

/*
 * Alt+F, Alt+G, and the rest, from wherever you are.
 *
 * On keydown rather than keyup, because unlike a bare Alt there is nothing ambiguous
 * about it: the letter has arrived, so this is a menu request and not the start of a
 * chord. Taken in the capture phase for the same reason the Alt tracking is - Monaco
 * stops propagation on the Alt combinations it owns, and the menu letters are not among
 * them but the listener has to run before anything else decides otherwise.
 */
window.addEventListener(
  "keydown",
  (event) => {
    if (menuBar === null) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key.length !== 1) return;
    if (gitResultDialog.isOpen() || confirmDialog.isOpen() || promptDialog.isOpen()) return;

    if (menuBar.openByMnemonic(event.key)) event.preventDefault();
  },
  true,
);

// A chord that ends in a click, and a window that goes away mid-press, both leave an armed
// Alt that would otherwise open the bar on a release the user never meant as a menu press.
// Capture for the same reason: Monaco swallows pointer events over the editor.
document.addEventListener("pointerdown", () => altMenu.cancel(), true);
window.addEventListener("blur", () => altMenu.cancel());

window.addEventListener("keydown", (event) => {
  // A modal result owns the keyboard while it is up. Without this, Ctrl+S saved and Alt
  // opened the menu bar behind a dialog the user was still reading. Escape is deliberately
  // not handled here: `<dialog>` closes itself on cancel, and doing it twice would race.
  if (gitResultDialog.isOpen() || confirmDialog.isOpen() || promptDialog.isOpen()) return;

  // Escape dismisses whatever transient surface is on top, wherever focus happens to be.
  // Leaving this to each surface's own input meant a palette opened by shortcut could not
  // be closed by keyboard once focus moved - and an overlay that will not close is an
  // application that will not respond.
  if (event.key === "Escape") {
    // `isFocused` rather than `isOpen`: Alt leaves the bar focused with nothing open, and
    // an Escape there has to give the editor back rather than fall through to the palette.
    if (menuBar?.isFocused() === true) {
      menuBar.close();
      editorHost.focus();
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
