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
import { setWorkspaceRoot } from "./workspace.ts";

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

export function saveSession(state: SessionState): Promise<void> {
  return get().save(state);
}
