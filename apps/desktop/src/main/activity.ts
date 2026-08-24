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
import { join } from "node:path";
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

function enqueue(delta: ActivityDelta): void {
  const existing = queue.get(delta.day);
  queue.set(delta.day, existing === undefined ? delta : mergeDeltas(existing, delta));

  while (queue.size > MAX_QUEUED_DAYS) {
    const oldest = [...queue.keys()].sort()[0];
    if (oldest === undefined) break;
    queue.delete(oldest);
  }
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
  }
}

/**
 * A change the AI agent made, counted where it actually happens.
 *
 * `aiApplyHunks` is the single point at which a model-authored change reaches disk, which
 * makes it the only place this number can be taken honestly. Counting it in the renderer
 * would mean counting a `replaceText` that could equally have come from a git restore.
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
  });

  timer = setInterval(() => void flushActivity(), FLUSH_MS);
  // Never the reason a machine stays awake, and never the reason a quit hangs.
  timer.unref?.();

  app.on("before-quit", () => {
    if (timer !== null) clearInterval(timer);
    void flushActivity();
  });
}
