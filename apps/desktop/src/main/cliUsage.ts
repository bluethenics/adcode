/**
 * Coding CLI usage: reading the history Claude Code and Codex keep on this computer.
 *
 * Only these places are read, never the disk at large:
 *   - Claude Code: <CLAUDE_CONFIG_DIR or ~/.claude>/projects/**.jsonl, and ~/.config/claude/projects
 *   - Codex:       <CODEX_HOME or ~/.codex>/sessions/**.jsonl and archived_sessions/**.jsonl
 *
 * Nothing leaves the computer and the files are only ever read. Heavy users keep gigabytes
 * of history, so a scan is incremental: each file's committed byte offset, a hash of the 64
 * bytes before it, and (for Codex) the parser's state are kept in memory. A file that grew is
 * read from where the last read stopped; one that was rewritten (the hash no longer matches)
 * is read again from the start. Lines are tested for a usage marker as raw bytes before any
 * text is decoded, so tool output - most of every file - is skipped without parsing.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLED_CATALOGUE } from "@adcode/ai";
import type { CliUsageProvider, CliUsageSource, CliUsageView } from "../shared/cliUsage.ts";
import {
  CLAUDE_USAGE_MARKERS,
  CODEX_USAGE_MARKERS,
  cliPriceLookup,
  cloneCodexState,
  initialCodexState,
  parseClaudeLine,
  parseCodexLine,
  summarizeCliUsage,
  type CliLimitObservation,
  type CliUsageRecord,
  type CodexScanState,
} from "./cliUsageModel.ts";

/** History older than this is never read; the view's longest range. */
const KEEP_DAYS = 90;
const CHUNK_BYTES = 256 * 1024;
/** A single line larger than this is tool output, never usage: skipped without decoding. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;
const GUARD_BYTES = 64;
const WALK_CONCURRENCY = 8;
/** A second open of the view within this reuses the last scan. */
const FRESH_MS = 30_000;
const NEWLINE = 0x0a;

interface FileState {
  size: number;
  mtimeMs: number;
  /** Bytes up to the end of the last complete line read. */
  offset: number;
  guardHash: number;
  guardLength: number;
  /** Codex parser state at `offset`; null for Claude, whose lines stand alone. */
  codex: CodexScanState | null;
  /** Requests from complete lines. */
  records: CliUsageRecord[];
  /** Requests from an unterminated last line: re-read next time, never committed. */
  tail: CliUsageRecord[];
  limits: CliLimitObservation | null;
}

interface Root {
  readonly provider: CliUsageProvider;
  readonly dir: string;
  readonly location: string;
}

interface ScanResult {
  readonly at: number;
  readonly records: CliUsageRecord[];
  readonly limits: CliLimitObservation[];
  readonly sources: CliUsageSource[];
}

const files = new Map<string, FileState>();
let lastScan: ScanResult | null = null;
let scanning: Promise<ScanResult> | null = null;
let priceOf: ReturnType<typeof cliPriceLookup> | null = null;

function fnv1a(buffer: Buffer): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < buffer.length; index += 1) {
    hash ^= buffer[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tilde(path: string, home: string): string {
  const slashed = path.replace(/\\/g, "/");
  const base = home.replace(/\\/g, "/").replace(/\/$/, "");
  return base.length > 0 && slashed.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? `~${slashed.slice(base.length)}` : slashed;
}

/** Where each CLI keeps its history, honouring the same environment variables the CLIs do. */
export function cliUsageRoots(env: NodeJS.ProcessEnv = process.env, home = homedir()): Root[] {
  const roots: Root[] = [];
  const claudeHomes = (env["CLAUDE_CONFIG_DIR"] ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const claude = claudeHomes.length > 0 ? claudeHomes : [join(home, ".claude"), join(home, ".config", "claude")];
  for (const base of claude) {
    const dir = join(base, "projects");
    roots.push({ provider: "claude-code", dir, location: tilde(dir, home) });
  }
  const codexHome = env["CODEX_HOME"]?.trim() || join(home, ".codex");
  for (const sub of ["sessions", "archived_sessions"]) {
    const dir = join(codexHome, sub);
    roots.push({ provider: "codex", dir, location: tilde(dir, home) });
  }
  return roots;
}

/** Every history file under `dir` modified since `since`; missing folders give none. */
async function listFiles(dir: string, since: number): Promise<{ found: boolean; paths: { path: string; size: number; mtimeMs: number }[]; failed: number }> {
  let failed = 0;
  const out: { path: string; size: number; mtimeMs: number }[] = [];
  try {
    if (!(await stat(dir)).isDirectory()) return { found: false, paths: [], failed: 0 };
  } catch {
    return { found: false, paths: [], failed: 0 };
  }
  const queue: string[] = [dir];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      let entries;
      try {
        entries = await readdir(next, { withFileTypes: true });
      } catch {
        failed += 1;
        continue;
      }
      for (const entry of entries) {
        const path = join(next, entry.name);
        if (entry.isDirectory()) { queue.push(path); continue; }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        try {
          const info = await stat(path);
          if (info.mtimeMs >= since) out.push({ path, size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          // Gone since it was listed.
        }
      }
    }
  };
  // Workers take directories as earlier ones reveal them; one pass that finds none ends.
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < WALK_CONCURRENCY && queue.length > 0) {
        active += 1;
        void worker().finally(() => {
          active -= 1;
          if (queue.length > 0) launch();
          else if (active === 0) resolve();
        });
      }
      if (active === 0 && queue.length === 0) resolve();
    };
    launch();
  });
  return { found: true, paths: out, failed };
}

function markers(provider: CliUsageProvider): readonly Buffer[] {
  return (provider === "claude-code" ? CLAUDE_USAGE_MARKERS : CODEX_USAGE_MARKERS).map((marker) => Buffer.from(marker));
}

/**
 * Read one file from `state`'s offset (or the start), returning its new state. Null when the
 * file could not be read: the old state stays, rather than an empty one hiding real usage.
 */
async function readFile(path: string, provider: CliUsageProvider, size: number, mtimeMs: number, previous: FileState | undefined): Promise<FileState | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return null;
  }
  try {
    let start = 0;
    let records: CliUsageRecord[] = [];
    let codex: CodexScanState | null = provider === "codex" ? initialCodexState() : null;
    if (previous !== undefined && previous.offset > 0 && size >= previous.offset && previous.guardLength > 0) {
      const guard = Buffer.alloc(previous.guardLength);
      const { bytesRead } = await handle.read(guard, 0, previous.guardLength, previous.offset - previous.guardLength);
      if (bytesRead === previous.guardLength && fnv1a(guard) === previous.guardHash) {
        start = previous.offset;
        records = previous.records.slice();
        codex = previous.codex === null ? codex : cloneCodexState(previous.codex);
      }
    }
    const needles = markers(provider);
    const committedState = codex;
    const parse = (line: Buffer, into: CliUsageRecord[], state: CodexScanState | null): void => {
      if (!needles.some((needle) => line.includes(needle))) return;
      const text = line.toString("utf8");
      const found = provider === "claude-code" ? parseClaudeLine(text) : parseCodexLine(text, state!);
      for (const entry of found) into.push(entry);
    };

    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    let skippingLongLine = false;
    let position = start;
    let offset = start;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      let lineStart = 0;
      while (lineStart < chunk.length) {
        const newline = chunk.indexOf(NEWLINE, lineStart);
        if (newline === -1) {
          if (!skippingLongLine) {
            pending.push(Buffer.from(chunk.subarray(lineStart)));
            pendingBytes += chunk.length - lineStart;
            if (pendingBytes > MAX_LINE_BYTES) { pending = []; pendingBytes = 0; skippingLongLine = true; }
          }
          break;
        }
        if (!skippingLongLine) {
          const piece = chunk.subarray(lineStart, newline);
          const line = pending.length === 0 ? piece : Buffer.concat([...pending, piece]);
          parse(line, records, committedState);
        }
        pending = [];
        pendingBytes = 0;
        skippingLongLine = false;
        lineStart = newline + 1;
        offset = position + lineStart;
      }
      position += bytesRead;
    }
    // An unterminated last line is parsed against a copy, so the next read can replay it.
    const tail: CliUsageRecord[] = [];
    if (pending.length > 0 && !skippingLongLine) parse(Buffer.concat(pending), tail, committedState === null ? null : cloneCodexState(committedState));

    const guardLength = Math.min(GUARD_BYTES, offset);
    let guardHash = 0;
    if (guardLength > 0) {
      const guard = Buffer.alloc(guardLength);
      await handle.read(guard, 0, guardLength, offset - guardLength);
      guardHash = fnv1a(guard);
    }
    const limits = committedState?.limits ?? null;
    return { size, mtimeMs, offset, guardHash, guardLength, codex: committedState, records, tail, limits };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function scan(now: number): Promise<ScanResult> {
  const since = now - KEEP_DAYS * 86_400_000;
  const seen = new Set<string>();
  const sources: CliUsageSource[] = [];
  const records: CliUsageRecord[] = [];
  const limits: CliLimitObservation[] = [];
  for (const root of cliUsageRoots()) {
    const listed = await listFiles(root.dir, since);
    let failed = listed.failed;
    // Oldest first, so the first copy of a request (Claude resumes copy history forward) is the original.
    listed.paths.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of listed.paths) {
      seen.add(file.path);
      const previous = files.get(file.path);
      let state: FileState | null | undefined = previous;
      if (previous === undefined || previous.size !== file.size || previous.mtimeMs !== file.mtimeMs) {
        state = await readFile(file.path, root.provider, file.size, file.mtimeMs, previous);
        if (state === null) { failed += 1; state = previous; }
        else files.set(file.path, state);
      }
      if (state === undefined || state === null) continue;
      for (const entry of state.records) records.push(entry);
      for (const entry of state.tail) records.push(entry);
      if (state.limits !== null) limits.push(state.limits);
    }
    sources.push({ provider: root.provider, location: root.location, found: listed.found, files: listed.paths.length, failed });
  }
  // Files that aged out or were deleted free their memory.
  for (const path of [...files.keys()]) if (!seen.has(path)) files.delete(path);
  return { at: now, records, limits, sources };
}

function clampDays(days: unknown): number {
  return typeof days === "number" && Number.isFinite(days) ? Math.max(1, Math.min(KEEP_DAYS, Math.floor(days))) : 7;
}

/** The view for the last `days` days. `refresh` rescans even when the last scan is recent. */
export async function readCliUsage(days: unknown, refresh?: unknown): Promise<CliUsageView> {
  const now = Date.now();
  let reading = lastScan;
  if (reading === null || refresh === true || now - reading.at > FRESH_MS) {
    scanning ??= scan(now).finally(() => { scanning = null; });
    reading = await scanning;
    lastScan = reading;
  }
  priceOf ??= cliPriceLookup(BUNDLED_CATALOGUE);
  return summarizeCliUsage({ records: reading.records, limits: reading.limits, sources: reading.sources, days: clampDays(days), now, price: priceOf });
}
