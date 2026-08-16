/**
 * The memory store: plain markdown files, one fact each.
 *
 * Brief §5.1's design rules govern this file:
 *
 * - Markdown is the source of truth. Nothing here caches state across calls, so a second
 *   process reading the same directory sees the same store - which is what makes the
 *   standalone MCP binary possible at all.
 * - The store is git-diffable and human-readable, so anything unparseable found on disk
 *   is skipped rather than repaired. A hand-edited file is a normal occurrence.
 * - `AGENTS.md` and `CLAUDE.md` are generated mirrors, rewritten on every write.
 * - Nothing syncs anywhere. There is no network in this package.
 */
import { parseMemory, serializeMemory } from "./frontmatter.ts";
import { MEMORY_KINDS, directoryFor, isValidName, normalizeName, relativePathFor } from "./names.ts";
import { renderMirror, renderProjectContext } from "./mirrors.ts";
import type { Clock, MemoryFileSystem, MemoryKind, MemoryRecord, MemorySummary } from "./types.ts";

export interface MemoryWriteInput {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryKind;
  readonly body: string;
  readonly agent?: string | undefined;
}

export interface MemoryStore {
  write(input: MemoryWriteInput): Promise<MemoryRecord | null>;
  read(name: string): Promise<MemoryRecord | null>;
  list(kind?: MemoryKind): Promise<MemorySummary[]>;
  delete(name: string): Promise<boolean>;
  all(): Promise<MemoryRecord[]>;
  appendSession(agent: string, summary: string): Promise<MemoryRecord | null>;
  projectContext(): Promise<string>;
}

export interface MemoryStoreDeps {
  readonly fs: MemoryFileSystem;
  readonly clock: Clock;
}

const MIRRORS = ["AGENTS.md", "CLAUDE.md"] as const;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `2026-08-16t14-22`: filesystem-safe, sorts chronologically, still readable. */
function sessionStamp(date: Date): string {
  return `${isoDate(date)}t${date.toISOString().slice(11, 16).replace(":", "-")}`;
}

export function createMemoryStore(deps: MemoryStoreDeps): MemoryStore {
  async function readAt(path: string): Promise<MemoryRecord | null> {
    const raw = await deps.fs.readFile(path);
    return raw === null ? null : parseMemory(raw);
  }

  /** Find a memory by name across every kind directory. Names are unique store-wide. */
  async function locate(name: string): Promise<{ path: string; record: MemoryRecord } | null> {
    const normalized = normalizeName(name);
    if (!isValidName(normalized)) return null;

    for (const kind of MEMORY_KINDS) {
      const path = relativePathFor(kind, normalized);
      if (path === null) continue;

      const record = await readAt(path);
      if (record !== null) return { path, record };
    }

    return null;
  }

  async function all(): Promise<MemoryRecord[]> {
    const paths = await deps.fs.listFiles();
    const records: MemoryRecord[] = [];

    for (const path of paths) {
      if (!path.endsWith(".md")) continue;

      const directory = path.includes("/") ? path.slice(0, path.indexOf("/")) : "";
      if (!MEMORY_KINDS.some((kind) => directoryFor(kind) === directory)) continue;

      const record = await readAt(path);
      if (record !== null) records.push(record);
    }

    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** §5.1: rewritten on every memory write, so an agent that reads only files is current. */
  async function refreshMirrors(): Promise<void> {
    const contents = renderMirror(await all());
    for (const mirror of MIRRORS) await deps.fs.writeFile(mirror, contents);
  }

  async function writeRecord(record: MemoryRecord, previousPath: string | null): Promise<MemoryRecord | null> {
    const path = relativePathFor(record.type, record.name);
    if (path === null) return null;

    await deps.fs.ensureDirectory(directoryFor(record.type));
    await deps.fs.writeFile(path, serializeMemory(record));

    // A change of kind moves the file. Leaving the old one behind would produce two
    // memories with the same name, and `locate` would return whichever kind it checked
    // first - a difference the user never asked for.
    if (previousPath !== null && previousPath !== path) {
      await deps.fs.deleteFile(previousPath);
    }

    await refreshMirrors();
    return record;
  }

  return {
    async write(input: MemoryWriteInput): Promise<MemoryRecord | null> {
      const name = normalizeName(input.name);
      if (!isValidName(name)) return null;
      if (typeof input.description !== "string" || input.description.trim().length === 0) return null;
      if (!MEMORY_KINDS.includes(input.type)) return null;

      const existing = await locate(name);

      const agents = new Set(existing?.record.agents ?? []);
      if (typeof input.agent === "string" && input.agent.trim().length > 0) {
        agents.add(input.agent.trim());
      }

      const record: MemoryRecord = {
        name,
        description: input.description.trim(),
        type: input.type,
        // Creation date survives updates: it is when the fact was first learned, which is
        // the useful thing about it.
        created: existing?.record.created ?? isoDate(deps.clock.now()),
        agents: [...agents].sort(),
        body: typeof input.body === "string" ? input.body.trim() : "",
      };

      return writeRecord(record, existing?.path ?? null);
    },

    async read(name: string): Promise<MemoryRecord | null> {
      return (await locate(name))?.record ?? null;
    },

    async list(kind?: MemoryKind): Promise<MemorySummary[]> {
      const records = await all();
      const filtered = kind === undefined ? records : records.filter((r) => r.type === kind);

      return filtered.map(({ name, description, type, created }) => ({
        name,
        description,
        type,
        created,
      }));
    },

    async delete(name: string): Promise<boolean> {
      const found = await locate(name);
      if (found === null) return false;

      await deps.fs.deleteFile(found.path);
      await refreshMirrors();
      return true;
    },

    all,

    async appendSession(agent: string, summary: string): Promise<MemoryRecord | null> {
      const normalizedAgent = normalizeName(agent);
      if (!isValidName(normalizedAgent)) return null;
      if (typeof summary !== "string" || summary.trim().length === 0) return null;

      const now = deps.clock.now();
      const name = `${sessionStamp(now)}-${normalizedAgent}`;
      if (!isValidName(name)) return null;

      const existing = await locate(name);
      const time = now.toISOString().slice(11, 19);
      const entry = `- ${time} ${summary.trim()}`;

      // Appending rather than replacing: §5.1 wants "a summarized record of what each
      // agent did and why", and two calls in the same minute are two things it did.
      const body = existing === null ? entry : `${existing.record.body}\n${entry}`;

      const record: MemoryRecord = {
        name,
        description: `Session log for ${normalizedAgent}`,
        type: "session",
        created: existing?.record.created ?? isoDate(now),
        agents: [...new Set([...(existing?.record.agents ?? []), normalizedAgent])].sort(),
        body,
      };

      return writeRecord(record, existing?.path ?? null);
    },

    async projectContext(): Promise<string> {
      return renderProjectContext(await all());
    },
  };
}
