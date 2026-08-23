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
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
function folderFor(workspace: string | null): string {
  const key = workspace ?? "no-workspace";
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function directory(workspace: string | null): string {
  return join(app.getPath("userData"), "ai-sessions", folderFor(workspace));
}

export async function readSessions(workspace: string | null): Promise<ChatSession[]> {
  const where = directory(workspace);

  let names: string[];
  try {
    names = await readdir(where);
  } catch {
    // No folder yet is the normal state on a first run, not a failure.
    return [];
  }

  const sessions: ChatSession[] = [];

  for (const name of names) {
    if (!name.endsWith(".json")) continue;

    try {
      const raw = await readFile(join(where, name), "utf8");
      const session = validateSession(JSON.parse(raw));
      if (session !== null) sessions.push(session);
    } catch {
      // One unreadable file costs one conversation, never the list.
    }
  }

  return sortSessions(sessions);
}

export async function writeSession(
  workspace: string | null,
  session: ChatSession,
): Promise<void> {
  const where = directory(workspace);

  try {
    await mkdir(where, { recursive: true });
    await writeFile(join(where, `${session.id}.json`), JSON.stringify(session), "utf8");
  } catch {
    // A conversation that cannot be saved is still a conversation on screen.
    return;
  }

  await enforceLimit(workspace);
}

export async function deleteSession(workspace: string | null, id: string): Promise<void> {
  // The id becomes a filename, so anything that is not a plain id is refused rather than
  // joined into a path - the renderer is treated as hostile (§1).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;

  try {
    await rm(join(directory(workspace), `${id}.json`), { force: true });
  } catch {
    // Already gone is the outcome the caller wanted.
  }
}

export async function clearSessions(workspace: string | null): Promise<void> {
  try {
    await rm(directory(workspace), { recursive: true, force: true });
  } catch {
    // Nothing to clear.
  }
}

/** Drop the oldest once there are too many, so history never grows without bound. */
async function enforceLimit(workspace: string | null): Promise<void> {
  const sessions = await readSessions(workspace);
  if (sessions.length <= MAX_SESSIONS) return;

  const keep = new Set(pruneSessions(sessions, MAX_SESSIONS).map((session) => session.id));

  for (const session of sessions) {
    if (!keep.has(session.id)) await deleteSession(workspace, session.id);
  }
}
