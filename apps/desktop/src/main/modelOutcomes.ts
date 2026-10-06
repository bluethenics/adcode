/**
 * Reporting how assistant turns end, per model - so "which models fail" has an answer.
 *
 * Each finished turn adds its provider, model, one fixed word (`shared/modelOutcomes.ts`) and
 * how long it took to a batch, sent once a minute and as the app quits. The server keeps only
 * daily counts per model and outcome, with no account attached; the admin panel's Models page
 * turns them into "works N% of the time" beside each model, and that is the evidence for
 * hiding one.
 *
 * Memory only: a crash loses at most a minute of counts, which is cheaper than another file.
 * §9 governs every failure - the worst outcome is that a turn is not counted.
 */
import { app } from "electron";
import { join } from "node:path";
import { isModelOutcome, type ModelOutcome } from "../shared/modelOutcomes.ts";
import { DiskFileStore, FetchHttpTransport, SystemClock } from "./adPorts.ts";
import { apiBaseUrl, createBackendTokens } from "./backend.ts";

const FLUSH_EVERY_MS = 60_000;
const MAX_PENDING = 200;
const MAX_BATCH = 50;
const TIMEOUT_MS = 10_000;

interface OutcomeItem {
  provider: string;
  model: string;
  outcome: ModelOutcome;
  ms: number;
}

let pending: OutcomeItem[] = [];
let timer: NodeJS.Timeout | null = null;
let flushing = false;

/** Note how one turn ended. Fire-and-forget. */
export function recordModelOutcome(provider: string, model: string, outcome: ModelOutcome, ms: number): void {
  if (!/^[a-z0-9._-]{1,40}$/.test(provider) || model.length === 0 || model.length > 200 || !isModelOutcome(outcome)) return;
  if (pending.length >= MAX_PENDING) return;
  pending.push({ provider, model, outcome, ms: Math.max(0, Math.min(Math.round(ms), 3_600_000)) });
  if (timer === null) {
    timer = setTimeout(() => {
      timer = null;
      void flushModelOutcomes();
    }, FLUSH_EVERY_MS);
    timer.unref?.();
  }
}

/** Send what has been counted. Called on the timer and as the app quits. */
export async function flushModelOutcomes(): Promise<void> {
  if (flushing || pending.length === 0) return;
  flushing = true;
  const batch = pending.slice(0, MAX_BATCH);
  try {
    const tokens = createBackendTokens({
      http: new FetchHttpTransport([]),
      clock: new SystemClock(),
      store: new DiskFileStore(join(app.getPath("userData"), "ads")),
    });
    const token = await tokens.getToken();
    if (!token.ok) return;
    const response = await fetch(`${apiBaseUrl()}/model-outcomes`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
      body: JSON.stringify({ outcomes: batch }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // A 400 will never be accepted (an older service, a word it does not know): drop it
    // rather than block every count behind it. Anything else waits for the next minute.
    if (response.ok || response.status === 400 || response.status === 404) pending = pending.slice(batch.length);
  } catch {
    // Offline: the counts wait for the next flush.
  } finally {
    flushing = false;
    if (pending.length > 0 && timer === null) {
      timer = setTimeout(() => {
        timer = null;
        void flushModelOutcomes();
      }, FLUSH_EVERY_MS);
      timer.unref?.();
    }
  }
}
