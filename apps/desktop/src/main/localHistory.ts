/**
 * Local file history and crash recovery.
 *
 * Brief §4's Session group: "local file history `on`" and "crash recovery of unsaved
 * buffers `on`". Both are the same idea from opposite ends - a copy of a file's text kept
 * outside the file. History keeps what was saved; recovery keeps what was not.
 *
 * No Electron import, so the disk behaviour is testable the way the settings and session
 * stores are. Every operation fails soft: losing a snapshot is a small loss, and an editor
 * that will not save because its history directory is unwritable is a large one.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Enough to walk back through an afternoon's work without filling a disk. */
const MAX_VERSIONS = 50;
/** Past this, it is a build artefact or a blob, not something worth versioning. */
const MAX_SNAPSHOT_BYTES = 2_000_000;

export interface HistoryEntry {
  /** Opaque, and safe to put in a filename - it is one. */
  readonly id: string;
  readonly savedAt: string;
  readonly bytes: number;
}

export interface RecoveredDraft {
  readonly path: string;
  readonly text: string;
  readonly savedAt: string;
}

export interface LocalHistory {
  /** Keep a copy of a file that was just saved. */
  record(path: string, text: string): Promise<void>;
  versions(path: string): Promise<HistoryEntry[]>;
  read(path: string, id: string): Promise<string | null>;

  /** Keep a copy of a buffer that has *not* been saved. */
  draft(path: string, text: string): Promise<void>;
  clearDraft(path: string): Promise<void>;
  drafts(): Promise<RecoveredDraft[]>;
}

/**
 * A filesystem-safe directory name for an arbitrary path.
 *
 * Hashing rather than escaping, because the paths that break escaping schemes - drive
 * letters, `..`, `*`, `?`, trailing dots - are ordinary on Windows.
 */
const keyFor = (path: string): string =>
  createHash("sha256").update(path).digest("hex").slice(0, 32);

/** A version id is a filename we wrote; anything else is refused before it is joined. */
const isSafeId = (id: string): boolean => /^[0-9]{13}-[0-9a-f]{8}$/.test(id);

export function createLocalHistory(directory: string): LocalHistory {
  const historyRoot = join(directory, "history");
  const draftsRoot = join(directory, "drafts");

  async function writeAtomic(target: string, contents: string): Promise<void> {
    const temporary = `${target}.tmp`;
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, target);
  }

  /** Snapshot filenames only - the origin note is deliberately not a `.txt`. */
  const snapshots = (names: string[]): string[] => names.filter((name) => name.endsWith(".txt")).sort();

  async function newest(folder: string): Promise<string | null> {
    try {
      const entries = snapshots(await readdir(folder));
      const last = entries.at(-1);
      return last === undefined ? null : await readFile(join(folder, last), "utf8");
    } catch {
      return null;
    }
  }

  return {
    async record(path: string, text: string): Promise<void> {
      if (Buffer.byteLength(text, "utf8") > MAX_SNAPSHOT_BYTES) return;

      const folder = join(historyRoot, keyFor(path));

      try {
        await mkdir(folder, { recursive: true });

        // Saving a file that did not change is common - format-on-save, a reflexive
        // Ctrl+S - and a history full of identical copies is a history of nothing.
        if ((await newest(folder)) === text) return;

        const id = `${String(Date.now()).padStart(13, "0")}-${createHash("sha256")
          .update(text)
          .digest("hex")
          .slice(0, 8)}`;

        await writeAtomic(join(folder, `${id}.txt`), text);
        // The original path, so a person looking in this directory can tell what it is.
        // Not a `.txt`, so it never reads as a snapshot of the file it names.
        await writeAtomic(join(folder, "origin.json"), JSON.stringify({ path }, null, 2));

        const kept = snapshots(await readdir(folder));
        for (const stale of kept.slice(0, Math.max(0, kept.length - MAX_VERSIONS))) {
          await rm(join(folder, stale), { force: true });
        }
      } catch {
        // A history that cannot be written must not stop a file from being saved.
      }
    },

    async versions(path: string): Promise<HistoryEntry[]> {
      const folder = join(historyRoot, keyFor(path));

      try {
        const names = snapshots(await readdir(folder)).reverse();

        const entries: HistoryEntry[] = [];
        for (const name of names) {
          const id = name.slice(0, -4);
          if (!isSafeId(id)) continue;

          const info = await stat(join(folder, name));
          entries.push({
            id,
            savedAt: new Date(Number(id.slice(0, 13))).toISOString(),
            bytes: info.size,
          });
        }

        return entries;
      } catch {
        return [];
      }
    },

    async read(path: string, id: string): Promise<string | null> {
      // The id comes from the renderer, so it is treated as hostile: only ids of the
      // shape this module writes are ever joined onto a path.
      if (!isSafeId(id)) return null;

      try {
        return await readFile(join(historyRoot, keyFor(path), `${id}.txt`), "utf8");
      } catch {
        return null;
      }
    },

    async draft(path: string, text: string): Promise<void> {
      if (Buffer.byteLength(text, "utf8") > MAX_SNAPSHOT_BYTES) return;

      try {
        await mkdir(draftsRoot, { recursive: true });
        await writeAtomic(
          join(draftsRoot, `${keyFor(path)}.json`),
          JSON.stringify({ path, text, savedAt: new Date().toISOString() }),
        );
      } catch {
        // Same reasoning as `record`: this protects work, it must not obstruct it.
      }
    },

    async clearDraft(path: string): Promise<void> {
      try {
        await rm(join(draftsRoot, `${keyFor(path)}.json`), { force: true });
      } catch {
        // Nothing to clear is the common case, not an error.
      }
    },

    async drafts(): Promise<RecoveredDraft[]> {
      try {
        const names = (await readdir(draftsRoot)).filter((name) => name.endsWith(".json"));
        const found: RecoveredDraft[] = [];

        for (const name of names) {
          try {
            const parsed: unknown = JSON.parse(await readFile(join(draftsRoot, name), "utf8"));
            if (typeof parsed !== "object" || parsed === null) continue;

            const raw = parsed as { path?: unknown; text?: unknown; savedAt?: unknown };
            if (typeof raw.path !== "string" || typeof raw.text !== "string") continue;

            found.push({
              path: raw.path,
              text: raw.text,
              savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
            });
          } catch {
            // One unreadable draft must not cost the user the others.
          }
        }

        return found;
      } catch {
        return [];
      }
    },
  };
}
