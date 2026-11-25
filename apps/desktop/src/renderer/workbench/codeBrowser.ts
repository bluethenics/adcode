/**
 * Code: the project's files and the code in them, in the column beside the chat.
 *
 * Vibe keeps the conversation in the middle and the preview and browser in the column beside
 * it. People asked to see the code there as well, without switching to the IDE: what the
 * assistant wrote, where it put it, and how the project is laid out. This is that view - a
 * file tree and a read-only reader with line numbers and colour - as a tab of the project
 * panel in the same column. Editing stays in the IDE; "Open in editor" goes there.
 *
 * The tree loads a folder when it is opened, keeps what was open across refreshes, and
 * follows the files as the assistant changes them: an open file redraws in place.
 */
import type { DirEntry } from "../../shared/api.ts";
import { createIcon, ICON } from "./icons.ts";
import {
  ancestorsOf,
  filterTree,
  isHeavyFolder,
  isImageFile,
  relativeTo,
  sortTree,
  viewPlan,
} from "./codeBrowserModel.ts";

export interface CodeBrowserDeps {
  readonly root: () => string | null;
  readonly list: (dir: string) => Promise<readonly DirEntry[]>;
  /** The file's text, or null when it could not be read. */
  readonly read: (path: string) => Promise<string | null>;
  /** An image as a data: URL, or null. */
  readonly readImage: (path: string) => Promise<string | null>;
  /** Highlighted HTML for the text; must HTML-escape the source (Monaco's colorize does). */
  readonly colorize: (text: string, path: string) => Promise<string>;
  readonly openInEditor: (path: string) => void;
  readonly ask: (prompt: string) => void;
  readonly activeFile: () => string | null;
}

export interface CodeBrowser {
  readonly element: HTMLElement;
  /** Reload the open folders and the file on screen, keeping where the reader was. */
  refresh(): void;
  /** Open the folders down to `path` and show it. */
  reveal(path: string): void;
}

const FOLDER_CLOSED = "M2 4.5h4l1.5 2H14v7H2z";
const FOLDER_OPEN = "M2 4.5h4l1.5 2H14v1.5H4.5L2.5 13.5zM2.5 13.5h10l1.5-6";

function button(label: string, className: string, run: () => void, title?: string): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  if (title !== undefined) node.title = title;
  node.addEventListener("click", run);
  return node;
}

export function createCodeBrowser(deps: CodeBrowserDeps): CodeBrowser {
  const element = document.createElement("div");
  element.className = "code-browser";

  // ── The tree ──────────────────────────────────────────────────────────────────────────
  const treePane = document.createElement("div");
  treePane.className = "code-browser-files";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "ad-input code-browser-filter";
  filter.placeholder = "Filter files";
  filter.setAttribute("aria-label", "Filter files by name");
  const tree = document.createElement("ul");
  tree.className = "code-browser-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Project files");
  treePane.append(filter, tree);

  // ── The reader ────────────────────────────────────────────────────────────────────────
  const reader = document.createElement("div");
  reader.className = "code-browser-reader";
  const readerHead = document.createElement("div");
  readerHead.className = "code-browser-head";
  const pathLabel = document.createElement("span");
  pathLabel.className = "code-browser-path";
  const actions = document.createElement("div");
  actions.className = "code-browser-actions";
  const copyButton = button("Copy", "ghost-button code-browser-action", () => void copy(), "Copy this file's text");
  const askButton = button("Ask", "ghost-button code-browser-action", () => askAbout(), "Ask the assistant about this file");
  const openButton = button("Open in editor", "ghost-button code-browser-action", () => { if (current !== null) deps.openInEditor(current); }, "Edit it in the IDE");
  actions.append(copyButton, askButton, openButton);
  readerHead.append(pathLabel, actions);
  const body = document.createElement("div");
  body.className = "code-browser-body";
  body.tabIndex = 0;
  body.setAttribute("aria-label", "File contents");
  reader.append(readerHead, body);
  element.append(treePane, reader);

  const children = new Map<string, readonly DirEntry[]>();
  const expanded = new Set<string>();
  let shownRoot: string | null = null;
  let current: string | null = null;
  let currentText: string | null = null;
  let drawGeneration = 0;
  let readGeneration = 0;

  function paintReaderHead(): void {
    const root = deps.root();
    pathLabel.textContent = current === null ? "No file open" : relativeTo(root, current);
    pathLabel.title = current ?? "";
    for (const action of [copyButton, askButton, openButton]) action.disabled = current === null;
    copyButton.disabled = currentText === null;
  }

  function emptyReader(text: string): void {
    const note = document.createElement("p");
    note.className = "code-browser-note";
    note.textContent = text;
    body.replaceChildren(note);
  }

  async function copy(): Promise<void> {
    if (currentText === null) return;
    try {
      await navigator.clipboard.writeText(currentText);
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy failed";
    }
    window.setTimeout(() => { copyButton.textContent = "Copy"; }, 1_400);
  }

  function askAbout(): void {
    if (current === null) return;
    deps.ask(`Explain ${relativeTo(deps.root(), current)}: what it does, how it fits into the project, and anything that looks wrong.`);
  }

  async function load(dir: string): Promise<readonly DirEntry[]> {
    try {
      const entries = sortTree(await deps.list(dir));
      children.set(dir, entries);
      return entries;
    } catch {
      children.set(dir, []);
      return [];
    }
  }

  /** Draw the tree from what is loaded; folders open on demand. */
  function drawTree(): void {
    const root = deps.root();
    const generation = ++drawGeneration;
    if (root === null) {
      tree.replaceChildren();
      return;
    }
    const keep = filterTree(children, root, filter.value);
    const filtering = filter.value.trim().length > 0;
    const focusedPath = (document.activeElement as HTMLElement | null)?.dataset?.["path"];
    const rows = document.createDocumentFragment();
    const draw = (dir: string, depth: number): void => {
      for (const entry of children.get(dir) ?? []) {
        if (filtering && !keep.has(entry.path)) continue;
        const open = entry.isDirectory && (expanded.has(entry.path) || (filtering && keep.has(entry.path)));
        const item = document.createElement("li");
        item.setAttribute("role", "none");
        const row = document.createElement("button");
        row.type = "button";
        row.className = "code-browser-row";
        row.setAttribute("role", "treeitem");
        row.dataset["path"] = entry.path;
        row.dataset["kind"] = entry.isDirectory ? "folder" : "file";
        row.style.setProperty("--depth", String(depth));
        row.title = relativeTo(root, entry.path);
        if (entry.isDirectory) row.setAttribute("aria-expanded", String(open));
        if (entry.path === current) row.setAttribute("aria-selected", "true");
        if (entry.isDirectory && isHeavyFolder(entry.name)) row.dataset["heavy"] = "true";
        row.tabIndex = -1;
        const label = document.createElement("span");
        label.className = "code-browser-name";
        label.textContent = entry.name;
        row.append(createIcon(entry.isDirectory ? (open ? FOLDER_OPEN : FOLDER_CLOSED) : ICON.file), label);
        row.addEventListener("click", () => activate(entry));
        item.append(row);
        rows.append(item);
        if (open) draw(entry.path, depth + 1);
      }
    };
    draw(root, 0);
    if (generation !== drawGeneration) return;
    tree.replaceChildren(rows);
    const all = [...tree.querySelectorAll<HTMLButtonElement>(".code-browser-row")];
    const focusTarget = all.find((row) => row.dataset["path"] === focusedPath) ?? all.find((row) => row.getAttribute("aria-selected") === "true") ?? all[0];
    if (focusTarget !== undefined) focusTarget.tabIndex = 0;
    if (focusedPath !== undefined && focusTarget?.dataset["path"] === focusedPath) focusTarget.focus({ preventScroll: true });
    if (all.length === 0) {
      const note = document.createElement("li");
      note.className = "code-browser-note";
      note.textContent = filtering ? "No loaded file matches. Open a folder to search inside it." : "This folder is empty.";
      tree.append(note);
    }
  }

  async function activate(entry: DirEntry): Promise<void> {
    if (entry.isDirectory) {
      if (expanded.has(entry.path)) expanded.delete(entry.path);
      else {
        expanded.add(entry.path);
        if (!children.has(entry.path)) await load(entry.path);
      }
      drawTree();
      return;
    }
    await show(entry.path);
  }

  /** Read and draw one file in the reader. `keepScroll` redraws in place after a change. */
  async function show(path: string, keepScroll = false): Promise<void> {
    const generation = ++readGeneration;
    const changedFile = path !== current;
    current = path;
    if (changedFile) currentText = null;
    paintReaderHead();
    drawTree();
    const scrollTop = body.scrollTop;
    const scrollLeft = body.scrollLeft;
    if (isImageFile(path) && !path.toLowerCase().endsWith(".svg")) {
      const url = await deps.readImage(path).catch(() => null);
      if (generation !== readGeneration) return;
      currentText = null;
      paintReaderHead();
      if (url === null) { emptyReader("This image could not be read."); return; }
      const image = document.createElement("img");
      image.className = "code-browser-image";
      image.alt = relativeTo(deps.root(), path);
      image.src = url;
      body.replaceChildren(image);
      return;
    }
    if (changedFile) emptyReader("Reading…");
    const text = await deps.read(path).catch(() => null);
    if (generation !== readGeneration) return;
    if (text === null) {
      currentText = null;
      paintReaderHead();
      emptyReader("This file could not be read. It may have been moved or deleted.");
      return;
    }
    if (!changedFile && text === currentText) return;
    currentText = text;
    paintReaderHead();
    const plan = viewPlan(text);
    if (plan.kind === "binary") { emptyReader("This is a binary file, so there is no text to show. Open it in the editor to see what it holds."); return; }
    if (plan.kind === "too-large") {
      emptyReader(`This file is too large to show here (${plan.lines.toLocaleString()} lines). Open it in the editor to read it.`);
      return;
    }
    const gutter = document.createElement("div");
    gutter.className = "code-browser-gutter";
    gutter.setAttribute("aria-hidden", "true");
    gutter.textContent = Array.from({ length: plan.lines }, (_, index) => String(index + 1)).join("\n");
    const code = document.createElement("div");
    code.className = "code-browser-code";
    // Plain text at once, colour when the tokenizer answers: a big file never waits blank.
    code.textContent = text;
    const sheet = document.createElement("div");
    sheet.className = "code-browser-sheet";
    sheet.append(gutter, code);
    body.replaceChildren(sheet);
    if (keepScroll && !changedFile) {
      body.scrollTop = scrollTop;
      body.scrollLeft = scrollLeft;
    } else {
      body.scrollTop = 0;
      body.scrollLeft = 0;
    }
    try {
      const html = await deps.colorize(text, path);
      // Safety: `text` is untrusted file content. innerHTML is safe here only because the
      // colorizer HTML-escapes the source before wrapping tokens (Monaco's colorize does).
      if (generation === readGeneration && code.isConnected) code.innerHTML = html;
    } catch {
      // The plain text stays.
    }
  }

  async function refreshNow(): Promise<void> {
    const root = deps.root();
    if (root === null) {
      shownRoot = null;
      children.clear();
      expanded.clear();
      current = null;
      currentText = null;
      tree.replaceChildren();
      paintReaderHead();
      emptyReader("Open a project folder to see its files here.");
      return;
    }
    if (root !== shownRoot) {
      // Another project: nothing from the last one applies.
      shownRoot = root;
      children.clear();
      expanded.clear();
      current = null;
      currentText = null;
      filter.value = "";
      await load(root);
      paintReaderHead();
      const active = deps.activeFile();
      if (active !== null && !active.startsWith("adcode-") && relativeTo(root, active) !== active.replace(/\\/g, "/")) {
        await revealNow(active);
        return;
      }
      emptyReader("Pick a file on the left to read it here. Open in editor takes you to the IDE to change it.");
      drawTree();
      return;
    }
    // The same project: reload the open folders, then the file on screen.
    const open = [root, ...[...expanded].filter((dir) => children.has(dir))];
    await Promise.all(open.map((dir) => load(dir)));
    for (const dir of [...expanded]) if (!children.has(dir)) expanded.delete(dir);
    drawTree();
    if (current !== null) await show(current, true);
  }

  async function revealNow(path: string): Promise<void> {
    const root = deps.root();
    if (root === null) return;
    for (const dir of ancestorsOf(root, path)) {
      expanded.add(dir);
      if (!children.has(dir)) await load(dir);
    }
    await show(path);
    tree.querySelector<HTMLElement>('.code-browser-row[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }

  filter.addEventListener("input", () => drawTree());
  filter.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      tree.querySelector<HTMLButtonElement>(".code-browser-row")?.focus();
    }
  });
  // Arrow keys walk the visible rows; Right opens a folder, Left closes it or goes to its parent.
  tree.addEventListener("keydown", (event) => {
    const rows = [...tree.querySelectorAll<HTMLButtonElement>(".code-browser-row")];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const row = rows[index]!;
    const path = row.dataset["path"] ?? "";
    const entry = [...children.values()].flat().find((candidate) => candidate.path === path);
    const move = (to: number): void => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (target === undefined) return;
      for (const other of rows) other.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    if (event.key === "ArrowDown") { event.preventDefault(); move(index + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(rows.length - 1); }
    else if (event.key === "ArrowRight" && entry?.isDirectory === true && !expanded.has(path)) { event.preventDefault(); void activate(entry); }
    else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (entry?.isDirectory === true && expanded.has(path)) { void activate(entry); return; }
      const parent = [...children.entries()].find(([, list]) => list.some((candidate) => candidate.path === path))?.[0];
      const parentRow = rows.find((candidate) => candidate.dataset["path"] === parent);
      if (parentRow !== undefined) move(rows.indexOf(parentRow));
    }
  });

  paintReaderHead();
  emptyReader("Open a project folder to see its files here.");
  return {
    element,
    refresh: () => { void refreshNow(); },
    reveal: (path) => { void revealNow(path); },
  };
}
