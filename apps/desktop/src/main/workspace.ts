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
import { isInsideWorkspace } from "./pathSafety.ts";
import type { DirEntry, FileContent, OpenedWorkspace, SaveResult } from "../shared/api.ts";

/** Directories never worth walking, and expensive enough to matter on a large repo. */
const SKIP = new Set([".git", "node_modules", ".DS_Store", "dist", "out", ".next", "target"]);

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

  workspaceRoot = picked;
  return currentWorkspace();
}

/** Used by tests and by session restore, which supplies a previously opened root. */
export function setWorkspaceRoot(root: string | null): void {
  workspaceRoot = root;
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
