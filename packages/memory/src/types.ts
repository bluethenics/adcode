/**
 * Shared types for the memory store. No logic.
 *
 * Brief §5.1: memories are "plain markdown with frontmatter, one fact per file", and
 * "markdown is the source of truth; SQLite is a cache. Deleting `index.sqlite` must be
 * a fully recoverable operation."
 */
import type { MemoryKind } from "./names.ts";

export type { MemoryKind } from "./names.ts";

export interface MemoryRecord {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryKind;
  /** ISO date, `YYYY-MM-DD`. */
  readonly created: string;
  /** Which agents have touched this memory (§5.1). */
  readonly agents: readonly string[];
  readonly body: string;
}

export interface MemorySummary {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryKind;
  readonly created: string;
}

export interface SearchHit extends MemorySummary {
  /** Lower is a better match, following SQLite's FTS5 rank convention. */
  readonly rank: number;
  readonly snippet: string;
}

/** The file-system seam, so the store is testable without touching a real disk. */
export interface MemoryFileSystem {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, contents: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  /** Paths relative to the root, recursive, `/`-separated. */
  listFiles(): Promise<string[]>;
  ensureDirectory(path: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}
