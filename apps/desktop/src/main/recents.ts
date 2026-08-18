/**
 * The Electron half of the recent-folders list.
 *
 * `recentsStore.ts` holds the disk behaviour and the ordering rules and imports no Electron;
 * this picks the directory and prunes folders that are no longer there.
 */
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { app } from "electron";
import { createRecentsStore, type RecentFolder, type RecentsStore } from "./recentsStore.ts";

let store: RecentsStore | null = null;

function get(): RecentsStore {
  store ??= createRecentsStore(app.getPath("userData"));
  return store;
}

/**
 * The list, with folders that have gone away removed.
 *
 * Checked on read rather than trusted, because a recents list is precisely where stale paths
 * accumulate - projects get renamed, moved, and deleted, and the list is the last thing anybody
 * updates. A row that opens nothing is worse than no row, so a missing folder is dropped from
 * the stored list as well as from what is returned.
 */
export async function recentFolders(): Promise<readonly RecentFolder[]> {
  const stored = await get().load();
  const alive: RecentFolder[] = [];
  let pruned = false;

  for (const folder of stored) {
    try {
      const info = await stat(folder.path);
      if (info.isDirectory()) alive.push(folder);
      else pruned = true;
    } catch {
      pruned = true;
    }
  }

  // Only written back when something actually changed, so opening the File menu is not a disk
  // write every time.
  if (pruned) {
    for (const folder of stored) {
      if (!alive.includes(folder)) await get().forget(folder.path);
    }
  }

  return alive;
}

export async function rememberRecent(root: string): Promise<void> {
  if (typeof root !== "string" || root.length === 0) return;
  await get().remember(root, basename(root) || root, Date.now());
}

export async function forgetRecent(root: string): Promise<readonly RecentFolder[]> {
  return get().forget(root);
}

export async function clearRecents(): Promise<void> {
  await get().clear();
}
