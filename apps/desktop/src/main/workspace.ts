/**
 * Workspace and file operations.
 *
 * Every path arriving from the renderer is confined by `isInsideWorkspace` before it
 * reaches the disk. The renderer is hostile by assumption (brief §1), and the AI layer
 * makes that concrete rather than theoretical: model output reaches these handlers.
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { dialog } from "electron";
import { HIDDEN_DIRECTORIES } from "@adcode/structure";
import { isInsideWorkspace } from "./pathSafety.ts";
import type { DirEntry, FileContent, OpenedWorkspace, SaveResult } from "../shared/api.ts";

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

let workspaceRoot: string | null = null;

export function currentWorkspace(): OpenedWorkspace | null {
  return workspaceRoot === null ? null : { root: workspaceRoot, name: basename(workspaceRoot) };
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
 * documents backed by a folder the host had moved away from. The README records the mirror
 * image of this bug, where session restore was the route that got missed; the lesson was
 * supposed to be that one function owns the change, and one caller had quietly opted out.
 */
export function openWorkspaceAt(root: string): OpenedWorkspace | null {
  if (typeof root !== "string" || root.length === 0) return null;

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
    defaultPath: workspaceRoot === null ? suggestedName : join(workspaceRoot, suggestedName),
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
const rootListeners: ((root: string | null) => void)[] = [];

export function onWorkspaceRootChanged(listener: (root: string | null) => void): void {
  rootListeners.push(listener);
}

/** Used by tests and by session restore, which supplies a previously opened root. */
export function setWorkspaceRoot(root: string | null): void {
  if (workspaceRoot === root) return;

  workspaceRoot = root;
  for (const listener of rootListeners) listener(root);
}

export async function listDirectory(dirPath: string): Promise<DirEntry[]> {
  if (!isInsideWorkspace(workspaceRoot, dirPath)) {
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
  if (!isInsideWorkspace(workspaceRoot, filePath)) {
    throw new Error("path is outside the opened workspace");
  }

  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > MAX_READ_BYTES) throw new Error("file is larger than 100MB");

  return { path: filePath, text: await readFile(filePath, "utf8"), mtimeMs: info.mtimeMs };
}

export async function writeTextFile(filePath: string, text: string): Promise<SaveResult> {
  if (!isInsideWorkspace(workspaceRoot, filePath)) {
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
