/**
 * The usage page's rows, kept in one small file beside the settings.
 *
 * Every request the chat or an agent makes is added here (`recordAiUsage`), and the page
 * reads a summary for the range it shows (`readAiUsage`). Local only: nothing in this file
 * leaves the machine, and Clear removes it.
 *
 * Writes are batched: a busy agent makes a request every few seconds, and the file does not
 * need to know about each one the moment it happens. A crash loses at most the last couple
 * of seconds of counts, which is the right trade for a number that was always approximate.
 */
import { BrowserWindow, app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CHANNELS } from "../shared/api.ts";
import {
  addUsage,
  parseUsageRows,
  pruneUsage,
  summarizeUsage,
  type AiUsageView,
  type UsageEntry,
  type UsageRange,
  type UsageRow,
} from "../shared/aiUsage.ts";
import { atomicReplace } from "./atomicReplace.ts";

const WRITE_AFTER_MS = 2_000;
const ANNOUNCE_AFTER_MS = 750;

let rows: UsageRow[] = [];
let loaded: Promise<void> | null = null;
let writeTimer: NodeJS.Timeout | null = null;
let announceTimer: NodeJS.Timeout | null = null;

function file(): string {
  return join(app.getPath("userData"), "ai-usage.json");
}

function load(): Promise<void> {
  loaded ??= readFile(file(), "utf8")
    .then((text) => {
      // Counts recorded before the file was read join the ones on disk rather than replacing them.
      const before = rows;
      rows = parseUsageRows(JSON.parse(text));
      for (const row of before) rows = mergeRow(rows, row);
    })
    .catch(() => {
      // No file yet, or one this build cannot read: start counting from here.
    });
  return loaded;
}

function mergeRow(into: UsageRow[], row: UsageRow): UsageRow[] {
  const index = into.findIndex((other) => other.day === row.day && other.provider === row.provider && other.model === row.model && other.source === row.source);
  if (index === -1) return [...into, row];
  const base = into[index]!;
  const copy = [...into];
  copy[index] = {
    ...base,
    requests: base.requests + row.requests,
    inputTokens: base.inputTokens + row.inputTokens,
    outputTokens: base.outputTokens + row.outputTokens,
    estimatedRequests: base.estimatedRequests + row.estimatedRequests,
    pricedRequests: base.pricedRequests + row.pricedRequests,
    costMicros: base.costMicros + row.costMicros,
  };
  return copy;
}

async function write(): Promise<void> {
  await load();
  rows = pruneUsage(rows, Date.now());
  const target = file();
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(`${target}.tmp`, JSON.stringify({ version: 1, rows }), "utf8");
    await atomicReplace(`${target}.tmp`, target);
  } catch {
    // A full disk costs the usage page some counts, never a turn.
  }
}

function scheduleWrite(): void {
  if (writeTimer !== null) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void write();
  }, WRITE_AFTER_MS);
  writeTimer.unref?.();
}

/** Tell open windows the numbers moved, at most a few times a second. */
function announce(): void {
  if (announceTimer !== null) return;
  announceTimer = setTimeout(() => {
    announceTimer = null;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.aiUsageChanged);
    }
  }, ANNOUNCE_AFTER_MS);
  announceTimer.unref?.();
}

/** Add one request's count. Fire-and-forget: usage is never on a turn's critical path. */
export function recordAiUsage(entry: UsageEntry): void {
  if (entry.inputTokens <= 0 && entry.outputTokens <= 0) return;
  rows = addUsage(rows, entry);
  void load().then(() => {
    scheduleWrite();
    announce();
  });
}

export async function readAiUsage(range: unknown): Promise<AiUsageView> {
  await load();
  const chosen: UsageRange = range === "today" || range === "7d" || range === "30d" || range === "all" ? range : "7d";
  return summarizeUsage(rows, chosen, Date.now());
}

export async function clearAiUsage(): Promise<void> {
  await load();
  rows = [];
  await write();
  announce();
}

/** Called as the app quits, so the last batch is not lost. */
export async function flushAiUsage(): Promise<void> {
  if (writeTimer === null) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  await write();
}
