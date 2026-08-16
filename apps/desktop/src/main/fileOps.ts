/**
 * Structural file operations: create, rename, delete, reveal.
 *
 * Reading and writing a file's *contents* lives in `workspace.ts`. Changing what files
 * exist is a different kind of act - it is not undone by pressing Ctrl+Z, and getting it
 * wrong destroys work rather than corrupting a buffer - so it is kept apart and guarded
 * separately.
 *
 * Four guards run on every call, in this order:
 *
 *   1. the name is a single storable segment              (`validateFileName`)
 *   2. the resulting path is inside the open workspace    (`isInsideWorkspace`)
 *   3. the target is not the workspace root itself
 *   4. the target is not inside `.git`
 *
 * (3) and (4) are not implied by (2). The root passes `isInsideWorkspace` by design - it
 * is the workspace - so without an explicit check "delete this folder" would delete the
 * project. And `.git` is inside the workspace but hidden from the tree, so a request to
 * remove it cannot have come from a user clicking a row; honouring one would discard the
 * entire history for something nobody asked for.
 *
 * Nothing here throws across the IPC bridge. Every operation returns an outcome, because
 * the renderer has to be able to tell the user what happened either way - a `.then` with
 * no `.catch` losing a failure is the exact bug that made the git panel feel dead.
 */
import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { shell } from "electron";
import { isInsideWorkspace, normalizeForCompare } from "./pathSafety.ts";
import { suffixedName, validateFileName } from "./fileNames.ts";
import { currentWorkspace } from "./workspace.ts";
import type { FileOpResult } from "../shared/api.ts";

const fail = (message: string): FileOpResult => ({ ok: false, message });
const done = (message: string, path: string): FileOpResult => ({ ok: true, message, path });

function root(): string | null {
  return currentWorkspace()?.root ?? null;
}

/** Guards 2-4, which every path argument goes through whatever the operation. */
function checkTarget(target: string, what: string): string | null {
  const workspace = root();
  if (workspace === null) return "No folder is open.";
  if (!isInsideWorkspace(workspace, target)) return `That ${what} is outside the opened folder.`;

  if (normalizeForCompare(target) === normalizeForCompare(workspace)) {
    return "That is the workspace folder itself.";
  }

  // `relative` rather than a substring test, for the same reason `isInsideWorkspace` uses
  // it: `.gitignore` and `.github/` both begin with `.git`.
  const rel = relative(normalizeForCompare(workspace), normalizeForCompare(target));
  const segments = rel.split(sep);
  if (segments[0] === ".git") return "Files inside .git are managed by git.";

  return null;
}

/** Does anything exist at this path? Absence is the only non-error answer. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function prepare(parentDir: unknown, name: unknown): Promise<{ path: string } | FileOpResult> {
  if (typeof parentDir !== "string") return fail("Expected a folder.");

  const check = validateFileName(name);
  if (!check.ok) return fail(check.reason);

  const workspace = root();
  if (workspace === null) return fail("No folder is open.");
  if (!isInsideWorkspace(workspace, parentDir)) return fail("That folder is outside the opened folder.");

  const info = await stat(parentDir).catch(() => null);
  if (info === null) return fail("That folder no longer exists.");
  if (!info.isDirectory()) return fail("That is not a folder.");

  const path = join(parentDir, name as string);

  // Re-checked after joining: validation proves the name cannot traverse, and this proves
  // the result landed where it was supposed to. Cheap, and the two are independent.
  if (!isInsideWorkspace(workspace, path)) return fail("That name would land outside the opened folder.");

  const problem = checkTarget(path, "location");
  if (problem !== null) return fail(problem);

  return { path };
}

export async function createFile(parentDir: unknown, name: unknown): Promise<FileOpResult> {
  const prepared = await prepare(parentDir, name);
  if ("ok" in prepared) return prepared;

  try {
    // `wx` fails if the path exists. Checking first and then writing would leave a window
    // in which the file appeared, and losing someone's file to a new empty one is not a
    // race worth running.
    await writeFile(prepared.path, "", { encoding: "utf8", flag: "wx" });
    return done(`Created ${name as string}`, prepared.path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return fail(`${name as string} already exists.`);
    return fail(error instanceof Error ? error.message : "Could not create the file.");
  }
}

export async function createFolder(parentDir: unknown, name: unknown): Promise<FileOpResult> {
  const prepared = await prepare(parentDir, name);
  if ("ok" in prepared) return prepared;

  try {
    // Deliberately not recursive: the parent is known to exist, and a recursive mkdir
    // would quietly succeed on a name that had somehow kept a separator.
    await mkdir(prepared.path);
    return done(`Created ${name as string}`, prepared.path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return fail(`${name as string} already exists.`);
    return fail(error instanceof Error ? error.message : "Could not create the folder.");
  }
}

export async function renameEntry(target: unknown, name: unknown): Promise<FileOpResult> {
  if (typeof target !== "string") return fail("Expected a path.");

  const problem = checkTarget(target, "item");
  if (problem !== null) return fail(problem);

  const prepared = await prepare(dirname(target), name);
  if ("ok" in prepared) return prepared;

  if (normalizeForCompare(prepared.path) === normalizeForCompare(target)) {
    return done("The name is unchanged.", target);
  }

  // A plain `rename` overwrites its destination on POSIX, silently destroying whatever was
  // there. There is no atomic no-clobber rename in Node, so this is checked first and the
  // remaining race is accepted: the alternative is losing a file to a name collision.
  if (await exists(prepared.path)) return fail(`${name as string} already exists.`);

  try {
    await rename(target, prepared.path);
    return done(`Renamed to ${name as string}`, prepared.path);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not rename.");
  }
}

export async function trashEntry(target: unknown): Promise<FileOpResult> {
  if (typeof target !== "string") return fail("Expected a path.");

  const problem = checkTarget(target, "item");
  if (problem !== null) return fail(problem);

  if (!(await exists(target))) return fail("That item no longer exists.");

  try {
    // The Recycle Bin rather than `rm`. Deleting the wrong row is a mistake people make,
    // and it should stay a recoverable one.
    await shell.trashItem(target);
    return done("Moved to the Recycle Bin", target);
  } catch (error) {
    /*
     * Windows implements the Recycle Bin on NTFS only. This repository lives on a FAT32
     * volume, where there is nowhere for a trashed file to go and `trashItem` fails
     * instead - which is the right way round, but it means nothing can be deleted at all
     * until someone decides to delete it for good.
     *
     * That decision is not taken here. The code goes back to the caller so it can ask.
     */
    return {
      ok: false,
      code: "trash-failed",
      message: error instanceof Error ? error.message : "Could not move it to the Recycle Bin.",
    };
  }
}

/**
 * Remove something for good.
 *
 * Separate from `trashEntry` on purpose: an irreversible delete should be a different call
 * that a caller has to choose, not a branch the recoverable one silently falls into.
 */
export async function deleteEntry(target: unknown): Promise<FileOpResult> {
  if (typeof target !== "string") return fail("Expected a path.");

  const problem = checkTarget(target, "item");
  if (problem !== null) return fail(problem);

  if (!(await exists(target))) return fail("That item no longer exists.");

  try {
    await rm(target, { recursive: true, force: false });
    return done("Deleted", target);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not delete.");
  }
}

/**
 * A name in `dir` that nothing is using yet.
 *
 * Copying onto an existing file is the one outcome nobody wants from a paste, and
 * refusing outright makes "duplicate this" a two-step chore. Suffixing is what every file
 * manager does, and `suffixedName` keeps the extension so the copy stays the same kind of
 * file. The ceiling is there because a directory that somehow defeats a hundred attempts
 * is a bug, not a case to keep grinding at.
 */
async function freeNameIn(dir: string, name: string): Promise<string | null> {
  if (!(await exists(join(dir, name)))) return name;

  for (let index = 1; index < 100; index++) {
    const candidate = suffixedName(name, index);
    if (!(await exists(join(dir, candidate)))) return candidate;
  }

  return null;
}

/** Shared checks for copy, move and import: a real destination directory inside the tree. */
async function prepareInto(
  targetDir: unknown,
  name: string,
): Promise<{ dir: string } | FileOpResult> {
  if (typeof targetDir !== "string") return fail("Expected a folder.");

  const workspace = root();
  if (workspace === null) return fail("No folder is open.");
  if (!isInsideWorkspace(workspace, targetDir)) return fail("That folder is outside the opened folder.");

  const check = validateFileName(name);
  if (!check.ok) return fail(`Cannot bring in “${name}”: ${check.reason}`);

  const info = await stat(targetDir).catch(() => null);
  if (info === null || !info.isDirectory()) return fail("That is not a folder.");

  const problem = targetDir === workspace ? null : checkTarget(targetDir, "folder");
  if (problem !== null) return fail(problem);

  return { dir: targetDir };
}

export async function duplicateEntry(target: unknown): Promise<FileOpResult> {
  if (typeof target !== "string") return fail("Expected a path.");

  const problem = checkTarget(target, "item");
  if (problem !== null) return fail(problem);
  if (!(await exists(target))) return fail("That item no longer exists.");

  const dir = dirname(target);
  const name = await freeNameIn(dir, basename(target));
  if (name === null) return fail("Could not find a free name for the copy.");

  try {
    await cp(target, join(dir, name), { recursive: true, errorOnExist: true, force: false });
    return done(`Duplicated as ${name}`, join(dir, name));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not duplicate.");
  }
}

export async function copyEntry(source: unknown, targetDir: unknown): Promise<FileOpResult> {
  if (typeof source !== "string") return fail("Expected a path.");

  const problem = checkTarget(source, "item");
  if (problem !== null) return fail(problem);
  if (!(await exists(source))) return fail("That item no longer exists.");

  const prepared = await prepareInto(targetDir, basename(source));
  if ("ok" in prepared) return prepared;

  // Copying a folder into itself would recurse until the disk gave out.
  if (prepared.dir === source || isWithin(source, prepared.dir)) {
    return fail("A folder cannot be copied into itself.");
  }

  const name = await freeNameIn(prepared.dir, basename(source));
  if (name === null) return fail("Could not find a free name in that folder.");

  try {
    await cp(source, join(prepared.dir, name), { recursive: true, errorOnExist: true, force: false });
    return done(`Copied ${name}`, join(prepared.dir, name));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not copy.");
  }
}

export async function moveEntry(source: unknown, targetDir: unknown): Promise<FileOpResult> {
  if (typeof source !== "string") return fail("Expected a path.");

  const problem = checkTarget(source, "item");
  if (problem !== null) return fail(problem);
  if (!(await exists(source))) return fail("That item no longer exists.");

  const prepared = await prepareInto(targetDir, basename(source));
  if ("ok" in prepared) return prepared;

  if (normalizeForCompare(dirname(source)) === normalizeForCompare(prepared.dir)) {
    return done("It is already there.", source);
  }

  // Moving a folder inside itself detaches it from the tree along with everything in it.
  if (isWithin(source, prepared.dir)) return fail("A folder cannot be moved into itself.");

  const destination = join(prepared.dir, basename(source));
  if (await exists(destination)) return fail(`${basename(source)} already exists there.`);

  try {
    await rename(source, destination);
    return done(`Moved ${basename(source)}`, destination);
  } catch (error) {
    // `rename` cannot cross a volume boundary, which a drag from another drive does
    // routinely. Copy-then-remove is the same operation the shell falls back to.
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      return fail(error instanceof Error ? error.message : "Could not move.");
    }

    try {
      await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
      await rm(source, { recursive: true, force: false });
      return done(`Moved ${basename(source)}`, destination);
    } catch (fallback) {
      return fail(fallback instanceof Error ? fallback.message : "Could not move across drives.");
    }
  }
}

/**
 * Copy something from outside the workspace in - what a drop from Explorer is.
 *
 * The source is deliberately *not* confined to the workspace; the whole point is that it
 * comes from elsewhere. Only the destination is checked, which is the direction that
 * matters: this reads a file the user just handed over and writes it where they dropped
 * it. Nothing leaves the workspace.
 */
export async function importEntry(source: unknown, targetDir: unknown): Promise<FileOpResult> {
  if (typeof source !== "string" || source.length === 0) return fail("Expected a path.");
  if (source.includes(" ")) return fail("That path is not usable.");

  if (!(await exists(source))) return fail(`${basename(source)} no longer exists.`);

  const prepared = await prepareInto(targetDir, basename(source));
  if ("ok" in prepared) return prepared;

  // Dropping a folder onto something inside it is the same recursion as an internal copy.
  if (isWithin(source, prepared.dir)) return fail("A folder cannot be copied into itself.");

  const name = await freeNameIn(prepared.dir, basename(source));
  if (name === null) return fail("Could not find a free name in that folder.");

  try {
    await cp(source, join(prepared.dir, name), { recursive: true, errorOnExist: true, force: false });
    return done(`Added ${name}`, join(prepared.dir, name));
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not add that file.");
  }
}

/** Is `candidate` inside `parent`? Compared on a separator boundary, not as a prefix. */
function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(normalizeForCompare(parent), normalizeForCompare(candidate));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

export async function revealEntry(target: unknown): Promise<FileOpResult> {
  if (typeof target !== "string") return fail("Expected a path.");

  const workspace = root();
  if (workspace === null) return fail("No folder is open.");
  // Revealing reads nothing and writes nothing, so the root is allowed here even though
  // it is refused everywhere else in this module.
  if (!isInsideWorkspace(workspace, target)) return fail("That item is outside the opened folder.");
  if (!(await exists(target))) return fail("That item no longer exists.");

  shell.showItemInFolder(target);
  return done("Revealed in File Explorer", target);
}
