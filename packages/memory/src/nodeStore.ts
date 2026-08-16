/**
 * The Node filesystem behind the memory store.
 *
 * Brief §5.1 puts the store at `<workspace>/.adcode/memory/`, as plain markdown that is
 * git-diffable and human-readable. Nothing here syncs anywhere: this package has no
 * network access at all, by construction.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createMemoryStore, type MemoryStore } from "./store.ts";
import { createSearchIndex, type SearchIndex } from "./searchIndex.ts";
import type { Clock, MemoryFileSystem } from "./types.ts";

export const MEMORY_DIRECTORY = join(".adcode", "memory");
export const INDEX_FILENAME = "index.sqlite";

/** Directories never worth walking inside a memory store. */
const SKIP = new Set([".git", "node_modules"]);

export function createNodeMemoryFileSystem(root: string): MemoryFileSystem {
  const resolve = (path: string): string | null => {
    // Paths come from `names.ts`, which already refuses anything that could climb out.
    // This is the second check, at the point of actual disk contact.
    if (path.includes("..") || path.includes("\u0000")) return null;
    return join(root, path);
  };

  return {
    async readFile(path: string): Promise<string | null> {
      const full = resolve(path);
      if (full === null) return null;

      try {
        return await readFile(full, "utf8");
      } catch {
        return null;
      }
    },

    async writeFile(path: string, contents: string): Promise<void> {
      const full = resolve(path);
      if (full === null) return;

      await mkdir(dirname(full), { recursive: true });

      // Write-then-rename. §11 requires concurrent writes from two MCP clients to be
      // safe: with whole-file atomic replacement, a reader sees either the old memory or
      // the new one, never a half-written file.
      const temporary = `${full}.${process.pid}.tmp`;
      await writeFile(temporary, contents, "utf8");
      await rename(temporary, full);
    },

    async deleteFile(path: string): Promise<void> {
      const full = resolve(path);
      if (full === null) return;

      try {
        await unlink(full);
      } catch {
        // Already gone.
      }
    },

    async listFiles(): Promise<string[]> {
      const found: string[] = [];

      async function walk(directory: string): Promise<void> {
        let entries;
        try {
          entries = await readdir(directory, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (SKIP.has(entry.name)) continue;

          const full = join(directory, entry.name);
          if (entry.isDirectory()) await walk(full);
          else found.push(relative(root, full).split(sep).join("/"));
        }
      }

      await walk(root);
      return found;
    },

    async ensureDirectory(path: string): Promise<void> {
      const full = resolve(path);
      if (full === null) return;
      await mkdir(full, { recursive: true });
    },
  };
}

export interface NodeMemory {
  readonly store: MemoryStore;
  readonly index: SearchIndex;
  readonly root: string;
  /** Rebuild the index from the markdown files, which are the source of truth. */
  reindex(): Promise<void>;
  close(): void;
}

const systemClock: Clock = { now: () => new Date() };

/**
 * Open the memory store for a workspace.
 *
 * `workspaceRoot` is the folder the user opened; the store lives under
 * `.adcode/memory` inside it.
 */
export function openNodeMemory(workspaceRoot: string, clock: Clock = systemClock): NodeMemory {
  const root = join(workspaceRoot, MEMORY_DIRECTORY);
  const fs = createNodeMemoryFileSystem(root);
  const store = createMemoryStore({ fs, clock });
  const index = createSearchIndex(join(root, INDEX_FILENAME));

  return {
    store,
    index,
    root,

    async reindex(): Promise<void> {
      await mkdir(root, { recursive: true });
      index.rebuild(await store.all());
    },

    close(): void {
      index.close();
    },
  };
}
