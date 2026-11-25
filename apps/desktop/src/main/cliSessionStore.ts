/**
 * Which Claude Code, Codex or ACP session each ADCode chat continues - kept across restarts.
 *
 * A CLI chat resumes the CLI's own session (`createCliProvider`'s `sessions`), so the CLI keeps
 * its tool results, files read and reasoning instead of being handed a transcript. That map
 * lived in memory, so every restart - an update, a crash, closing the laptop lid on Windows -
 * silently started a day-long conversation over in a fresh CLI session fed a shortened
 * transcript. People who keep one chat going for hours noticed at once.
 *
 * The map is a `Map` the CLI providers already write to; this subclass saves it whenever it
 * changes, a moment later, and loads it when ADCode starts. The newest entries per CLI are
 * kept, so the file stays small however many chats there have been. I/O is injected.
 */

export interface CliSessionRecord {
  readonly id: string;
  readonly messages: number;
}

/** Chats remembered per CLI; older ones start a fresh CLI session with the conversation so far. */
export const MAX_SESSIONS_PER_CLI = 400;
const SAVE_DELAY_MS = 500;

interface StoredRecord extends CliSessionRecord {
  readonly at: number;
}

interface StoredFile {
  readonly version: 1;
  readonly clis: Record<string, Record<string, StoredRecord>>;
}

export interface CliSessionIo {
  read(): string | null;
  write(text: string): void;
}

/** A session map that reports every change, so its owner can save it. */
export class ReportingSessionMap extends Map<string, CliSessionRecord> {
  changed: ((key: string, value: CliSessionRecord | undefined) => void) | undefined;

  override set(key: string, value: CliSessionRecord): this {
    super.set(key, value);
    this.changed?.(key, value);
    return this;
  }

  override delete(key: string): boolean {
    const had = super.delete(key);
    if (had) this.changed?.(key, undefined);
    return had;
  }
}

export interface CliSessionStore {
  /** The live map for one CLI; the same object every time, so providers share it. */
  forCli(cliId: string): Map<string, CliSessionRecord>;
  /** Write now, rather than after the short delay. */
  flush(): void;
}

function isRecord(value: unknown): value is StoredRecord {
  const item = value as Partial<StoredRecord> | null;
  return item !== null && typeof item === "object" && typeof item.id === "string" && item.id.length > 0 && typeof item.messages === "number" && typeof item.at === "number";
}

function parse(text: string | null): Record<string, Record<string, StoredRecord>> {
  if (text === null) return {};
  try {
    const raw = JSON.parse(text) as Partial<StoredFile> | null;
    if (raw === null || typeof raw !== "object" || raw.version !== 1 || typeof raw.clis !== "object" || raw.clis === null) return {};
    const out: Record<string, Record<string, StoredRecord>> = {};
    for (const [cli, entries] of Object.entries(raw.clis)) {
      if (typeof entries !== "object" || entries === null) continue;
      out[cli] = Object.fromEntries(Object.entries(entries).filter(([, record]) => isRecord(record)));
    }
    return out;
  } catch {
    // A damaged file costs only resumes, never a chat: start empty.
    return {};
  }
}

export function createCliSessionStore(
  io: CliSessionIo,
  options: { readonly now?: () => number; readonly later?: (run: () => void, ms: number) => void; readonly max?: number } = {},
): CliSessionStore {
  const now = options.now ?? Date.now;
  const later = options.later ?? ((run: () => void, ms: number) => { setTimeout(run, ms).unref?.(); });
  const max = options.max ?? MAX_SESSIONS_PER_CLI;
  const stored = parse(io.read());
  const maps = new Map<string, ReportingSessionMap>();
  let pending = false;

  function save(): void {
    pending = false;
    const clis: Record<string, Record<string, StoredRecord>> = {};
    for (const [cli, records] of Object.entries(stored)) {
      const newest = Object.entries(records).sort((a, b) => b[1].at - a[1].at).slice(0, max);
      if (newest.length > 0) clis[cli] = Object.fromEntries(newest);
    }
    try {
      io.write(JSON.stringify({ version: 1, clis } satisfies StoredFile));
    } catch {
      // Disk full or read-only: the chats still resume until ADCode restarts.
    }
  }

  function schedule(): void {
    if (pending) return;
    pending = true;
    later(save, SAVE_DELAY_MS);
  }

  return {
    forCli(cliId) {
      const existing = maps.get(cliId);
      if (existing !== undefined) return existing;
      const records = stored[cliId] ?? {};
      stored[cliId] = records;
      const map = new ReportingSessionMap(Object.entries(records).map(([key, record]) => [key, { id: record.id, messages: record.messages }] as const));
      map.changed = (key, value) => {
        if (value === undefined) delete records[key];
        else records[key] = { id: value.id, messages: value.messages, at: now() };
        schedule();
      };
      maps.set(cliId, map);
      return map;
    },
    flush() {
      if (pending) save();
    },
  };
}
