/**
 * Conversations on disk, per project.
 *
 * One JSON file per conversation under `userData/ai-sessions/<workspace>/`, written when a
 * turn finishes rather than on every token - a file rewritten per streamed word would be
 * thousands of writes for one answer.
 *
 * **Per workspace, and never uploaded.** A conversation about one project has no business
 * appearing in another, and the folder name is a hash of the workspace path rather than the
 * path itself, so the directory listing does not spell out what somebody is working on.
 *
 * §9's rule holds: nothing here may throw into the window. A history that cannot be read is
 * an empty history, which is a worse experience and not a broken one.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { app } from "electron";
import {
  pruneSessions,
  sortSessions,
  validateSession,
  type ChatSession,
} from "@adcode/ai";

/** Enough to find a conversation from last month, few enough to load quickly. */
const MAX_SESSIONS = 200;

/**
 * A short, stable name for a workspace directory.
 *
 * A hash rather than the path: `userData` is not secret, and a folder listing that reads
 * `C--work-acme-secret-merger` tells anybody with the disk what this person is working on.
 */
const hash = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);
const SEPARATORS = /(?<=[^\\/:])[\\/]+$/;

/**
 * One spelling per folder. `E:\proj`, `e:\proj` and `E:\proj\` are one project on Windows, but
 * history used to be filed under the raw string, so opening a project another way (recents, a
 * picker, `adcode open`) showed an empty history while its chats sat in a sibling folder.
 */
export function workspaceKey(workspace: string | null, platform: NodeJS.Platform = process.platform): string {
  if (workspace === null) return "no-workspace";
  if (platform !== "win32") return posix.resolve(workspace).replace(SEPARATORS, "");
  return win32.resolve(workspace).replace(SEPARATORS, "").toLowerCase();
}

/** Keys written before normalisation: the raw spellings this folder is likely to have arrived as. */
export function legacyKeys(workspace: string | null, platform: NodeJS.Platform = process.platform): string[] {
  if (workspace === null) return [];
  const resolved = (platform === "win32" ? win32 : posix).resolve(workspace).replace(SEPARATORS, "");
  const spellings = new Set([workspace, resolved, `${resolved}\\`, `${resolved}/`]);
  if (platform === "win32") {
    for (const one of [...spellings]) {
      spellings.add(one.replaceAll("\\", "/"));
      spellings.add(one.replaceAll("/", "\\"));
    }
    for (const one of [...spellings]) {
      if (/^[a-z]:/i.test(one)) {
        spellings.add(one[0]!.toUpperCase() + one.slice(1));
        spellings.add(one[0]!.toLowerCase() + one.slice(1));
      }
    }
  }
  const current = workspaceKey(workspace, platform);
  return [...spellings].filter((one) => one !== current);
}

const sessionsRoot = (): string => join(app.getPath("userData"), "ai-sessions");
const directory = (workspace: string | null): string => join(sessionsRoot(), hash(workspaceKey(workspace)));
/** The current folder first, then the folder of every older spelling. */
function directories(workspace: string | null): string[] {
  return [...new Set([directory(workspace), ...legacyKeys(workspace).map((key) => join(sessionsRoot(), hash(key)))])];
}

/**
 * Parsed conversations, by file, with the size and time they were read at.
 *
 * The list is asked for after every turn - the History panel, fork chats, the phone link -
 * and it used to read and parse every file each time. With one chat open all day (13 MB) and
 * 199 older ones, that was a third of a second per ask, growing with every reply. A file is
 * now parsed once and again only when its size or modification time changes; saves through
 * `writeSession` put what they wrote straight in, so the next list does not read it back.
 */
interface CachedFile {
  readonly size: number;
  readonly mtimeMs: number;
  readonly session: ChatSession | null;
  /**
   * Whether size and time are enough to know the file is unchanged. Not for a file another
   * program wrote in the last few seconds: FAT32 keeps times to two seconds, so a quick
   * rewrite of the same length would look untouched.
   */
  readonly trusted: boolean;
}
const cache = new Map<string, CachedFile>();
/** Older than this, a file's time is precise enough on any disk. */
const SETTLED_MS = 3_000;

async function readCached(path: string): Promise<ChatSession | null> {
  let info;
  try {
    info = await stat(path);
  } catch {
    cache.delete(path);
    return null;
  }
  const held = cache.get(path);
  if (held !== undefined && held.trusted && held.size === info.size && held.mtimeMs === info.mtimeMs) return held.session;
  let session: ChatSession | null = null;
  try {
    session = validateSession(JSON.parse(await readFile(path, "utf8")));
  } catch {
    // One unreadable file costs one conversation, never the list.
  }
  cache.set(path, { size: info.size, mtimeMs: info.mtimeMs, session, trusted: Date.now() - info.mtimeMs > SETTLED_MS });
  return session;
}

/** Forget cached files under `where` that are no longer there. */
function forgetMissing(where: string, present: ReadonlySet<string>): void {
  for (const path of cache.keys()) {
    if (path.startsWith(`${where}\\`) || path.startsWith(`${where}/`)) {
      if (!present.has(path)) cache.delete(path);
    }
  }
}

export async function readSessions(workspace: string | null): Promise<ChatSession[]> {
  const found = new Map<string, ChatSession>();

  for (const where of directories(workspace)) {
    let names: string[];
    try {
      names = await readdir(where);
    } catch {
      // No folder yet is the normal state on a first run, not a failure.
      forgetMissing(where, new Set());
      continue;
    }

    const paths = names.filter((name) => name.endsWith(".json")).map((name) => join(where, name));
    forgetMissing(where, new Set(paths));
    const sessions = await Promise.all(paths.map((path) => readCached(path)));
    for (const session of sessions) {
      const seen = session === null ? undefined : found.get(session.id);
      if (session !== null && (seen === undefined || session.updatedAt > seen.updatedAt)) found.set(session.id, session);
    }
  }

  return sortSessions([...found.values()]);
}

export async function writeSession(
  workspace: string | null,
  session: ChatSession,
): Promise<void> {
  const where = directory(workspace);
  const target = join(where, `${session.id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;

  try {
    await mkdir(where, { recursive: true });
    // Write-then-rename, as sessionStore.ts does: a crash mid-save left a truncated (often empty)
    // file that the read path skips, so the conversation vanished with no trace.
    await writeFile(temporary, JSON.stringify(session), "utf8");
    await rename(temporary, target);
    // What was just written is what the next list would read back: keep it, unread.
    const info = await stat(target).catch(() => null);
    if (info === null) cache.delete(target);
    // Written here, so its content is known whatever the disk's time resolution.
    else cache.set(target, { size: info.size, mtimeMs: info.mtimeMs, session, trusted: true });
  } catch (error) {
    // A conversation that cannot be saved is still a conversation on screen - but it is logged.
    // Loaded on failure only: debugLog wraps ipcMain when imported, which this store has no need of.
    void import("./debugLog.ts").then(({ recordDebug }) => recordDebug("warn", "ai:sessions", `Could not save conversation ${session.id}: ${error instanceof Error ? error.message : String(error)}`)).catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    return;
  }

  // A conversation filed under an older spelling moves to the current folder on its next save.
  for (const old of directories(workspace).slice(1)) await rm(join(old, `${session.id}.json`), { force: true }).catch(() => undefined);

  await enforceLimit(workspace);
}

/** Whether a conversation with this id is saved for the workspace, under any spelling of it. */
export async function sessionExists(workspace: string | null, id: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return false;
  for (const where of directories(workspace)) {
    if (await stat(join(where, `${id}.json`)).then((info) => info.isFile(), () => false)) return true;
  }
  return false;
}

export async function deleteSession(workspace: string | null, id: string): Promise<void> {
  // The id becomes a filename, so anything that is not a plain id is refused rather than
  // joined into a path - the renderer is treated as hostile (§1).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;

  for (const where of directories(workspace)) {
    // Already gone is the outcome the caller wanted.
    const path = join(where, `${id}.json`);
    cache.delete(path);
    await rm(path, { force: true }).catch(() => undefined);
  }
}

export async function clearSessions(workspace: string | null): Promise<void> {
  for (const where of directories(workspace)) {
    forgetMissing(where, new Set());
    await rm(where, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Whether two workspace roots are the same project, by the same rule history is filed under. */
export const sameWorkspace = (a: string | null, b: string | null): boolean => workspaceKey(a) === workspaceKey(b);

/** Drop the oldest once there are too many, so history never grows without bound. */
async function enforceLimit(workspace: string | null): Promise<void> {
  // Counting files is enough to know nothing needs pruning - the usual case after every save.
  let files = 0;
  for (const where of directories(workspace)) {
    files += (await readdir(where).catch((): string[] => [])).filter((name) => name.endsWith(".json")).length;
  }
  if (files <= MAX_SESSIONS) return;
  const sessions = await readSessions(workspace);
  if (sessions.length <= MAX_SESSIONS) return;

  const keep = new Set(pruneSessions(sessions, MAX_SESSIONS).map((session) => session.id));

  for (const session of sessions) {
    if (!keep.has(session.id)) await deleteSession(workspace, session.id);
  }
}
