/**
 * The Electron half of session restore.
 *
 * `sessionStore.ts` holds the disk behaviour and imports no Electron; this picks the
 * directory, decides whether restoring is switched on, and refuses to restore a folder
 * that is no longer there.
 */
import { stat } from "node:fs/promises";
import { app } from "electron";
import { createSessionStore, type SessionState, type SessionStore } from "./sessionStore.ts";
import { launchSessionFromArguments } from "./launchIntent.ts";
import { currentSettings } from "./settings.ts";
import { currentWorkspace, setWorkspaceRoot } from "./workspace.ts";

let store: SessionStore | null = null;

function get(): SessionStore {
  store ??= createSessionStore(app.getPath("userData"));
  return store;
}

/**
 * Reopen the last folder, if the setting allows it and the folder still exists.
 *
 * Returns what the renderer should reopen, so a moved or deleted project yields an empty
 * window rather than a tree full of paths that no longer resolve.
 */
export async function restoreSession(): Promise<SessionState> {
  const empty: SessionState = { root: null, openFiles: [], activeFile: null };

  // A second window joins the workspace already open in this process. Reading an older
  // session must never replace the live project when the IDE is launched from Vibe.
  const liveRoot = currentWorkspace()?.root;
  if (liveRoot !== undefined) {
    const saved = await get().load();
    return saved.root === liveRoot
      ? saved
      : { root: liveRoot, openFiles: [], activeFile: null, ...(saved.layout === undefined ? {} : { layout: saved.layout }) };
  }

  // An explicit `adcode open <path>` is a user action, so it wins over both the previous
  // session and the restore preference. It still returns the ordinary session shape: the
  // renderer follows exactly the same secure startup path and initializes every service.
  const launched = await launchSessionFromArguments(process.argv, process.cwd());
  if (launched !== null) {
    setWorkspaceRoot(launched.root);
    return launched;
  }

  // §4: "Restore workspace `on`" - a default, not a decision made for the user.
  if (currentSettings()["adcode.session.workspaceRestore"] === false) return empty;

  const state = await get().load();
  if (state.root === null) return empty;

  try {
    const info = await stat(state.root);
    if (!info.isDirectory()) return empty;
  } catch {
    return empty;
  }

  setWorkspaceRoot(state.root);
  return state;
}

let saveQueue: Promise<void> = Promise.resolve();

export function saveSession(state: SessionState): Promise<void> {
  // Two windows may save in the same frame. Serialize the temp-file/rename pair so
  // neither writer can collide with the other's temporary file.
  saveQueue = saveQueue.then(() => get().save(state));
  return saveQueue;
}
