/**
 * The folders this editor has opened before.
 *
 * No Electron import, so the disk behaviour and the ordering rules are testable the same way
 * the settings and session stores are.
 *
 * Every failure path yields an empty list rather than an error, for the same reason session
 * restore does: losing the recents is a small annoyance, and refusing to start because of a
 * stale JSON file is not.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * How many to keep.
 *
 * Long enough to cover the projects someone actually moves between, short enough that the list
 * stays scannable - past about a dozen, finding the right row costs more than the folder picker
 * it was meant to replace.
 */
export const MAX_RECENTS = 12;

export interface RecentFolder {
  readonly path: string;
  /** The folder's own name, stored rather than derived so the list renders without touching disk. */
  readonly name: string;
  /** Epoch milliseconds. Sorting key, and the only reason the order survives a restart. */
  readonly openedAt: number;
}

export interface RecentsStore {
  load(): Promise<readonly RecentFolder[]>;
  /** Record a folder as most recently opened, returning the new list. */
  remember(path: string, name: string, now: number): Promise<readonly RecentFolder[]>;
  /** Drop one entry - for a folder that has been moved or deleted. */
  forget(path: string): Promise<readonly RecentFolder[]>;
  clear(): Promise<void>;
}

/**
 * The key a path is deduplicated by.
 *
 * Case-folded and separator-normalised, because Windows is the platform this ships on first and
 * `E:\Work\Project`, `E:/Work/Project` and `e:\work\project` are one folder there. Comparing the
 * raw strings would put the same project in the list three times, each of which opens the same
 * place - which looks like a bug and costs the list its usefulness.
 *
 * This deliberately over-merges on a case-sensitive filesystem, where two folders differing only
 * in case really are different. That is the right trade: the cost is one stale row on Linux, and
 * the cost the other way is a duplicated list on the majority platform.
 */
export function recentKey(path: string): string {
  return path.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Put a folder at the top of the list.
 *
 * Pure, and separate from the disk because this is the part with rules: the newest entry wins,
 * an existing entry for the same folder is replaced rather than duplicated, and the list is
 * capped. Re-opening the folder you already have open must move it to the top without growing
 * the list, which is the case a naive `[entry, ...list].slice(0, N)` gets wrong.
 */
export function mergeRecent(
  existing: readonly RecentFolder[],
  entry: RecentFolder,
  limit = MAX_RECENTS,
): readonly RecentFolder[] {
  const key = recentKey(entry.path);
  const rest = existing.filter((item) => recentKey(item.path) !== key);

  return [entry, ...rest].slice(0, Math.max(0, limit));
}

/** Newest first. Applied on load, so a hand-edited file still renders in a sensible order. */
export function sortRecents(list: readonly RecentFolder[]): readonly RecentFolder[] {
  return [...list].sort((a, b) => b.openedAt - a.openedAt);
}

/**
 * Read one entry back out of stored JSON, or `null`.
 *
 * The file survives upgrades and can be hand-edited, so nothing about its shape is assumed.
 * An entry missing a path is dropped rather than repaired: a recent folder with no path is a
 * row that cannot be clicked.
 */
export function parseRecent(value: unknown): RecentFolder | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const path = record["path"];
  const name = record["name"];
  const openedAt = record["openedAt"];

  if (typeof path !== "string" || path.length === 0) return null;

  return {
    path,
    // A missing name is recoverable - the last path segment is what it would have been anyway.
    name: typeof name === "string" && name.length > 0 ? name : (path.split(/[\\/]/).at(-1) ?? path),
    // A missing or nonsensical timestamp sorts last rather than poisoning the comparison with NaN.
    openedAt: typeof openedAt === "number" && Number.isFinite(openedAt) ? openedAt : 0,
  };
}

export function parseRecents(value: unknown): readonly RecentFolder[] {
  if (!Array.isArray(value)) return [];

  const out: RecentFolder[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const parsed = parseRecent(item);
    if (parsed === null) continue;

    // Deduplicated on the way in as well as on the way out, so a file written by an older build
    // - or by hand - cannot produce a list with the same folder twice.
    const key = recentKey(parsed.path);
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(parsed);
  }

  return sortRecents(out).slice(0, MAX_RECENTS);
}

export function createRecentsStore(directory: string): RecentsStore {
  const file = join(directory, "recents.json");

  async function read(): Promise<readonly RecentFolder[]> {
    try {
      return parseRecents(JSON.parse(await readFile(file, "utf8")));
    } catch {
      return [];
    }
  }

  async function write(list: readonly RecentFolder[]): Promise<void> {
    try {
      await mkdir(directory, { recursive: true });

      // Written to a sibling and renamed, so a crash mid-write cannot leave a truncated file
      // that the next launch reads as an empty list. The same shape as the session store.
      const temporary = `${file}.tmp`;
      await writeFile(temporary, JSON.stringify(list, null, 2), "utf8");
      await rename(temporary, file);
    } catch {
      // A recents list that fails to save costs the list, never the launch.
    }
  }

  return {
    load: read,

    async remember(path, name, now) {
      const next = mergeRecent(await read(), { path, name, openedAt: now });
      await write(next);
      return next;
    },

    async forget(path) {
      const key = recentKey(path);
      const next = (await read()).filter((item) => recentKey(item.path) !== key);
      await write(next);
      return next;
    },

    async clear() {
      await write([]);
    },
  };
}
