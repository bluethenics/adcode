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
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

export async function readSessions(workspace: string | null): Promise<ChatSession[]> {
  const found = new Map<string, ChatSession>();

  for (const where of directories(workspace)) {
    let names: string[];
    try {
      names = await readdir(where);
    } catch {
      // No folder yet is the normal state on a first run, not a failure.
      continue;
    }

    for (const name of names) {
      if (!name.endsWith(".json")) continue;

      try {
        const raw = await readFile(join(where, name), "utf8");
        const session = validateSession(JSON.parse(raw));
        const seen = session === null ? undefined : found.get(session.id);
        if (session !== null && (seen === undefined || session.updatedAt > seen.updatedAt)) found.set(session.id, session);
      } catch {
        // One unreadable file costs one conversation, never the list.
      }
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

export async function deleteSession(workspace: string | null, id: string): Promise<void> {
  // The id becomes a filename, so anything that is not a plain id is refused rather than
  // joined into a path - the renderer is treated as hostile (§1).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;

  for (const where of directories(workspace)) {
    // Already gone is the outcome the caller wanted.
    await rm(join(where, `${id}.json`), { force: true }).catch(() => undefined);
  }
}

export async function clearSessions(workspace: string | null): Promise<void> {
  for (const where of directories(workspace)) {
    await rm(where, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Whether two workspace roots are the same project, by the same rule history is filed under. */
export const sameWorkspace = (a: string | null, b: string | null): boolean => workspaceKey(a) === workspaceKey(b);

/** Drop the oldest once there are too many, so history never grows without bound. */
async function enforceLimit(workspace: string | null): Promise<void> {
  const sessions = await readSessions(workspace);
  if (sessions.length <= MAX_SESSIONS) return;

  const keep = new Set(pruneSessions(sessions, MAX_SESSIONS).map((session) => session.id));

  for (const session of sessions) {
    if (!keep.has(session.id)) await deleteSession(workspace, session.id);
  }
}
