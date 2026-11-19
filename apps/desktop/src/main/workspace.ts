/**
 * Workspace and file operations.
 *
 * Every path arriving from the renderer is confined by `isInsideWorkspace` before it
 * reaches the disk. The renderer is hostile by assumption (brief §1), and the AI layer
 * makes that concrete rather than theoretical: model output reaches these handlers.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { dialog } from "electron";
import { HIDDEN_DIRECTORIES } from "@adcode/structure";
import { isInsideWorkspace } from "./pathSafety.ts";
import type { DirEntry, FileContent, FileImageContent, OpenedWorkspace, SaveResult } from "../shared/api.ts";

/**
 * Directories never worth walking, and expensive enough to matter on a large repo.
 *
 * The list lives in `@adcode/structure` because the Structure popup's project map has to
 * name the same set - it explains what is in a project, and a folder skipped here would
 * otherwise be silently missing from the explanation with nothing saying why.
 */
const SKIP = new Set(HIDDEN_DIRECTORIES);

/** §7 budgets a 100MB file as "no freeze; degrade features, never the frame rate". */
const MAX_READ_BYTES = 100 * 1024 * 1024;

/*
 * One project per window group.
 *
 * A group is a Vibe window and the IDE window opened from it: the same project in two views.
 * "Open Folder in New Window" starts another group with a project of its own, so two projects
 * can be open side by side in one ADCode process - one ad runtime, one set of settings - with
 * nothing shared between them that belongs to a project.
 *
 * Which group a piece of main-process code is working for is carried with the call, not passed
 * through every function: each IPC handler runs inside `runInGroup` for the window that sent it
 * (windowScope.ts), and Node's AsyncLocalStorage keeps that through every await, timer and
 * callback the handler starts. So `currentWorkspace()` - read in some sixty places - answers
 * for the window that asked. Code that no window called (the tool bridge, Phone link, a timer
 * started at launch) gets the group of the window that was focused last.
 */
export const MAIN_GROUP = "main";

const roots = new Map<string, string | null>();
const groupOfContents = new Map<number, string>();
const scope = new AsyncLocalStorage<string>();
let focusedGroup = MAIN_GROUP;

/** Run `work` as the given window group: everything it starts sees that group's project. */
export function runInGroup<T>(group: string, work: () => T): T {
  return scope.run(group, work);
}

/** The group a call is working for: the calling window's, else the window focused last. */
export function currentGroup(): string {
  return scope.getStore() ?? focusedGroup;
}

/** The group a window (by its webContents id) belongs to; unknown contents count as the focused one. */
export function groupOfWindow(contentsId: number): string {
  return groupOfContents.get(contentsId) ?? focusedGroup;
}

export function assignWindowToGroup(contentsId: number, group: string): void {
  groupOfContents.set(contentsId, group);
}

/** A window closed. A group with no windows left lets its project go. */
export function releaseWindow(contentsId: number): void {
  const group = groupOfContents.get(contentsId);
  groupOfContents.delete(contentsId);
  if (group === undefined || group === MAIN_GROUP || [...groupOfContents.values()].includes(group)) return;
  runInGroup(group, () => setWorkspaceRoot(null));
  roots.delete(group);
  if (focusedGroup === group) focusedGroup = MAIN_GROUP;
}

/** The project a window group has open. */
export function workspaceRootOfGroup(group: string): string | null {
  return roots.get(group) ?? null;
}

export function groupHasWindows(group: string): boolean {
  return [...groupOfContents.values()].includes(group);
}

export function noteFocusedGroup(group: string): void {
  focusedGroup = group;
}

/** Every project open in some window, each once. */
export function openWorkspaceRoots(): string[] {
  return [...new Set([...roots.values()].filter((root): root is string => root !== null))];
}

/** The group whose window has this project open, if any. */
export function groupShowing(root: string): string | null {
  const wanted = root.replace(/[\\/]+$/, "").toLowerCase();
  for (const [group, open] of roots) if (open !== null && open.replace(/[\\/]+$/, "").toLowerCase() === wanted && [...groupOfContents.values()].includes(group)) return group;
  return null;
}

const rootNow = (): string | null => roots.get(currentGroup()) ?? null;

export function currentWorkspace(): OpenedWorkspace | null {
  const root = rootNow();
  return root === null ? null : { root, name: basename(root) };
}

export async function openWorkspace(): Promise<OpenedWorkspace | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Open Folder",
  });

  const picked = result.filePaths[0];
  if (result.canceled || picked === undefined) return null;

  return openWorkspaceAt(picked);
}

/**
 * Open a folder by path, without a dialog.
 *
 * The recents list and the welcome screen both need this - they already know the folder, and
 * making the user confirm it in a picker they just bypassed defeats the point of the list.
 *
 * **Through `setWorkspaceRoot`, not by assigning the variable.** That assignment is what this
 * function used to do, and it meant the notification never fired on the commonest route of all:
 * opening a folder by hand. Language servers are per-workspace and subscribe to that
 * notification, so they kept indexing the previous project - and a live session kept sharing
 * documents backed by a folder the host had moved away from. docs/STATUS.md records the mirror
 * image of this bug, where session restore was the route that got missed; the lesson was
 * supposed to be that one function owns the change, and one caller had quietly opted out.
 */
export function openWorkspaceAt(root: string): OpenedWorkspace | null {
  if (typeof root !== "string" || root.trim().length === 0) return null;
  if (root.includes("\0")) return null;

  setWorkspaceRoot(root);
  return currentWorkspace();
}

/**
 * Ask for a single file to open.
 *
 * Deliberately does **not** widen the workspace. The renderer reads files through
 * `isInsideWorkspace`, so a file picked from outside the open folder is returned here and then
 * refused by the read - which is the same boundary `saveTextFileAs` documents below, and the
 * reason the welcome screen offers "Open Folder" first and this second.
 *
 * The caller opens the file's own folder when there is no workspace yet, which is the case this
 * mostly exists for: a person who wants to look at one file and has not opened anything.
 */
export async function pickFileToOpen(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    title: "Open File",
  });

  const picked = result.filePaths[0];
  return result.canceled || picked === undefined ? null : picked;
}

/**
 * Ask where to save, then write there.
 *
 * The chosen path becomes part of the workspace only if it is already inside it - "save
 * as" must not silently widen what the renderer is allowed to reach, so a file saved
 * outside the open folder is written once and then not readable through the file bridge.
 */
export async function saveTextFileAs(text: string, suggestedName: string): Promise<string | null> {
  if (typeof text !== "string") return null;

  const result = await dialog.showSaveDialog({
    title: "Save As",
    defaultPath: rootNow() === null ? suggestedName : join(rootNow()!, suggestedName),
  });

  const picked = result.filePath;
  if (result.canceled || picked === undefined || picked === "") return null;

  try {
    await writeFile(picked, text, "utf8");
    return picked;
  } catch {
    return null;
  }
}

/**
 * Told when the open folder changes, whichever route changed it.
 *
 * There are three: the open dialog, closing the folder, and session restore on launch.
 * Anything that has to react was previously wired at each call site, and session restore -
 * the one route nobody thinks about, because no user action triggers it - was missed. The
 * language servers then never started on a restored workspace, which is every launch after
 * the first.
 */
/**
 * Listeners hear which group changed and what it had before, so per-project work (language
 * servers, the assistant's dev servers) stops only when no other window still has that project.
 * They run inside the changed group's scope.
 */
const rootListeners: ((root: string | null, change: { readonly group: string; readonly previous: string | null }) => void)[] = [];

export function onWorkspaceRootChanged(listener: (root: string | null, change: { readonly group: string; readonly previous: string | null }) => void): void {
  rootListeners.push(listener);
}

/** Used by tests and by session restore, which supplies a previously opened root. Sets the current group's project. */
export function setWorkspaceRoot(root: string | null): void {
  const group = currentGroup();
  const previous = roots.get(group) ?? null;
  if (previous === root) return;

  roots.set(group, root);
  for (const listener of rootListeners) listener(root, { group, previous });
}

export async function listDirectory(dirPath: string): Promise<DirEntry[]> {
  if (!isInsideWorkspace(rootNow(), dirPath)) {
    throw new Error("path is outside the opened workspace");
  }

  const entries = await readdir(dirPath, { withFileTypes: true });

  const visible = entries
    .filter((entry) => !SKIP.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      path: join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));

  // Directories first, then case-insensitive by name - the ordering every file tree
  // uses, and the one a developer's muscle memory expects.
  return visible.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export async function readTextFile(filePath: string): Promise<FileContent> {
  if (!isInsideWorkspace(rootNow(), filePath)) {
    throw new Error("path is outside the opened workspace");
  }

  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > MAX_READ_BYTES) throw new Error("file is larger than 100MB");

  return { path: filePath, text: await readFile(filePath, "utf8"), mtimeMs: info.mtimeMs };
}

/**
 * Read an image file for preview, as a `data:` URL.
 *
 * Text and bytes cannot share a channel: `readTextFile` decodes as UTF-8, which turns a
 * PNG into replacement characters and can throw on lone surrogates. Images are read raw,
 * capped lower (20MB - a preview must not hold a whole photo library in IPC), and named
 * by extension from a closed list so a renamed executable never arrives as viewable bytes.
 */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function imageMediaTypeFor(filePath: string): string | null {
  return IMAGE_MEDIA_TYPES[extname(filePath).toLowerCase()] ?? null;
}

export async function readImageFile(filePath: string): Promise<FileImageContent> {
  if (!isInsideWorkspace(rootNow(), filePath)) {
    throw new Error("path is outside the opened workspace");
  }

  const mediaType = imageMediaTypeFor(filePath);
  if (mediaType === null) throw new Error("not a supported image file");

  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > MAX_IMAGE_BYTES) throw new Error("image is larger than 20MB");

  const bytes = await readFile(filePath);
  return {
    path: filePath,
    dataUrl: `data:${mediaType};base64,${bytes.toString("base64")}`,
    mediaType,
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs,
  };
}

export async function writeTextFile(filePath: string, text: string): Promise<SaveResult> {
  if (!isInsideWorkspace(rootNow(), filePath)) {
    return { ok: false, mtimeMs: 0, reason: "path is outside the opened workspace" };
  }
  if (typeof text !== "string") {
    return { ok: false, mtimeMs: 0, reason: "expected text" };
  }

  try {
    await writeFile(filePath, text, "utf8");
    const info = await stat(filePath);
    return { ok: true, mtimeMs: info.mtimeMs };
  } catch (error) {
    return { ok: false, mtimeMs: 0, reason: error instanceof Error ? error.message : "write failed" };
  }
}
