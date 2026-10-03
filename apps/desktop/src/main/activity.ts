/**
 * Sending a day of editing to the backend.
 *
 * Runs in the main process for the same reason the ad client and the bug reporter do:
 * `connect-src 'self'` is part of the CSP, so a renderer cannot reach the backend at all.
 * The renderer counts; this file makes the round trip.
 *
 * What leaves the machine is seven integers and a date. Not a file name, not a path, not
 * a language, not a prompt, not a line of code - see `shared/activity.ts`, where the type
 * has no field that could carry any of it.
 *
 * §9 governs the failure mode: the worst permitted outcome of the backend being
 * unreachable is that a feature quietly does nothing. An undelivered flush is merged back
 * into the queue and retried on the next tick; nothing here ever surfaces an error, and
 * nothing here ever blocks the editor.
 */
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, ipcMain } from "electron";
import { CHANNELS } from "../shared/api.ts";
import { mergeDeltas, utcDay, type ActivityDelta } from "../shared/activity.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";

const FLUSH_MS = 300_000;
const TIMEOUT_MS = 15_000;

/**
 * How many days may sit undelivered before the oldest is dropped.
 *
 * A month offline is a month of retries; without a bound the queue is a memory leak that
 * only shows up on the machines least able to report it.
 */
const MAX_QUEUED_DAYS = 45;

/** Undelivered flushes, keyed by day. Merged rather than appended, so a retry cannot double-count. */
const queue = new Map<string, ActivityDelta>();

let timer: NodeJS.Timeout | null = null;
let sending = false;

/**
 * The first flush of a launch goes out this soon after there is something to say.
 *
 * Only the five-minute timer and a fire-and-forget flush at quit used to send anything,
 * and the app exits before that last request completes - so of the first 419 installs,
 * the 394 that were gone within five minutes reported nothing at all. Half a minute in,
 * a short first session has already said that it happened.
 */
const FIRST_FLUSH_MS = 30_000;
let firstFlush: NodeJS.Timeout | null = null;

/** Undelivered days, on disk, so a quit or a crash sends them next launch instead of losing them. */
const queueFile = (): string => join(app.getPath("userData"), "activity-queue.json");
let persistTimer: NodeJS.Timeout | null = null;

function persistSoon(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 1_000);
  persistTimer.unref?.();
}

async function persistNow(): Promise<void> {
  try {
    await mkdir(dirname(queueFile()), { recursive: true });
    await writeFile(queueFile(), JSON.stringify([...queue.values()]), "utf8");
  } catch {
    // Unsaved means unsent after a crash, nothing worse.
  }
}

async function restoreQueue(): Promise<void> {
  try {
    const saved: unknown = JSON.parse(await readFile(queueFile(), "utf8"));
    if (!Array.isArray(saved)) return;
    for (const delta of saved as ActivityDelta[]) if (typeof delta?.day === "string") enqueue(delta);
  } catch {
    // Nothing saved, which is the usual case.
  }
}

function enqueue(delta: ActivityDelta): void {
  const existing = queue.get(delta.day);
  queue.set(delta.day, existing === undefined ? delta : mergeDeltas(existing, delta));

  while (queue.size > MAX_QUEUED_DAYS) {
    const oldest = [...queue.keys()].sort()[0];
    if (oldest === undefined) break;
    queue.delete(oldest);
  }
  persistSoon();
}

function flushSoon(): void {
  if (firstFlush !== null) return;
  firstFlush = setTimeout(() => void flushActivity(), FIRST_FLUSH_MS);
  firstFlush.unref?.();
}

async function send(delta: ActivityDelta): Promise<boolean> {
  const clock = new SystemClock();
  const store = new DiskFileStore(join(app.getPath("userData"), "ads"));
  const http = new FetchHttpTransport([]);
  const tokens = createBackendTokens({ http, clock, store });

  const token = await tokens.getToken();
  if (!token.ok) return false;

  const response = await fetch(`${apiBaseUrl()}/activity`, {
    method: "POST",
    headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
    body: JSON.stringify(delta),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  // A 400 means this flush will never be accepted - a clock skew, a client bug. Retrying
  // it forever would block every day behind it, so it is treated as delivered and lost.
  // Anything else is worth another go.
  return response.ok || response.status === 400;
}

/**
 * Delivers what is queued.
 *
 * Serialised by `sending` rather than allowed to overlap: the timer and a quit can fire
 * together, and two concurrent flushes of the same day would each read the queue before
 * the other cleared it.
 */
export async function flushActivity(): Promise<void> {
  if (sending || queue.size === 0) return;
  sending = true;

  try {
    for (const [day, delta] of [...queue.entries()]) {
      // Removed before the request and merged back on failure. The alternative - delete
      // on success - loses whatever the renderer reports mid-flight.
      queue.delete(day);
      try {
        if (!(await send(delta))) enqueue(delta);
      } catch {
        enqueue(delta);
      }
    }
  } finally {
    sending = false;
    persistSoon();
  }
}

/**
 * A change the AI agent made, counted where it actually happens.
 *
 * Counted in the main process, where a model-authored change is applied to disk - the only
 * place this number can be taken honestly. Counting it in the renderer would mean counting
 * a `replaceText` that could equally have come from a git restore.
 */
export function recordAgentEdit(input: {
  chars: number;
  acceptedEdits: number;
  rejectedEdits: number;
}): void {
  enqueue({
    day: utcDay(Date.now()),
    manualChars: 0,
    agentChars: Math.max(0, Math.round(input.chars)),
    acceptedEdits: Math.max(0, input.acceptedEdits),
    rejectedEdits: Math.max(0, input.rejectedEdits),
    filesTouched: 0,
    activeMs: 0,
    sessions: 0,
  });
}

/** Accepts the renderer's flushes and keeps the timer running. */
export function registerActivityIpc(): void {
  ipcMain.on(CHANNELS.activityReport, (_event, deltas: readonly ActivityDelta[]) => {
    if (!Array.isArray(deltas)) return;
    for (const delta of deltas) {
      if (typeof delta?.day === "string") enqueue(delta);
    }
    flushSoon();
  });

  // What a previous launch could not deliver goes out early in this one.
  void restoreQueue().then(() => {
    if (queue.size > 0) flushSoon();
  });

  timer = setInterval(() => void flushActivity(), FLUSH_MS);
  // Never the reason a machine stays awake, and never the reason a quit hangs.
  timer.unref?.();

  app.on("before-quit", () => {
    if (timer !== null) clearInterval(timer);
    // Written synchronously: the request below rarely finishes before the process exits,
    // and what it does not deliver is sent from this file next launch.
    try {
      writeFileSync(queueFile(), JSON.stringify([...queue.values()]), "utf8");
    } catch {
      // §9.
    }
    void flushActivity();
  });
}
