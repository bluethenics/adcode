import type { Provider } from "./types.ts";
import { isRequestTooLarge } from "./requestSize.ts";

/** How providers say the model produced a tool call they could not parse. */
const TOOL_CALL_GARBLED = /tool_use_failed|failed to call a function|invalid tool call|failed_generation/i;
/**
 * Waits in a row at a usage limit before the turn gives up. A relay that keeps saying "later"
 * past its own reset time is broken, and waiting on it forever would look like a hang.
 */
const MAX_LIMIT_WAITS = 5;

/** Options for one wrapped provider. */
export interface WrapOptions {
  /**
   * Wait out a usage limit and continue, rather than fail. For chat turns, team nodes and
   * automations - a person asked for the work and it should finish. Never for inline
   * completion: ghost text that arrives five hours late is a bug.
   */
  readonly waitForUsageLimit?: boolean;
}

/** Resolves at `at` (epoch ms); rejects at once when the turn is stopped. */
function sleepUntil(at: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    // In steps of a minute at most, looking at the clock each time: a computer asleep through
    // the reset runs no timers, and one long timer would fire hours after the reset instead.
    const step = (): void => {
      const left = at - Date.now();
      if (left <= 0) {
        signal.removeEventListener("abort", stop);
        resolve();
        return;
      }
      timer = setTimeout(step, Math.min(left, CLOCK_CHECK_MS));
    };
    function stop(): void {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    }
    signal.addEventListener("abort", stop, { once: true });
    step();
  });
}

/** How often a long wait looks at the clock. */
const CLOCK_CHECK_MS = 60_000;

/**
 * How long to wait out a usage limit, in milliseconds from now on this computer's clock.
 *
 * The relay's `retry-after` counts from the server's clock, so it holds whatever this clock
 * says; the absolute `resetsAt` is only the fallback. A wait that comes out at nothing - a
 * reset this clock thinks has passed, with no retry-after - backs off instead, so a relay
 * that keeps saying "limited" cannot burn every wait in a burst.
 */
function limitWaitMs(retryAfter: string | null | undefined, resetsAt: number, waitsSoFar: number): number {
  const seconds = retryAfter === undefined || retryAfter === null ? Number.NaN : Number(retryAfter);
  const relative = Number.isFinite(seconds)
    ? seconds * 1000
    : typeof retryAfter === "string" && Number.isFinite(Date.parse(retryAfter))
      ? Date.parse(retryAfter) - Date.now()
      : resetsAt - Date.now();
  return relative > 0 ? relative : Math.min(60_000, 5_000 * 2 ** waitsSoFar);
}

/** One FIFO lane per connection; only request starts are serialized, not streams. */
interface State {
  nextStartAt: number;
  cooldownUntil: number;
  queue: Array<{
    rpm: number;
    signal: AbortSignal;
    resolve: () => void;
    reject: (reason: unknown) => void;
    abort: () => void;
  }>;
  timer: ReturnType<typeof setTimeout> | undefined;
}
export class RequestScheduler {
  private states = new Map<string, State>();
  private state(id: string): State {
    let s = this.states.get(id);
    if (!s) {
      s = { nextStartAt: 0, cooldownUntil: 0, queue: [], timer: undefined };
      this.states.set(id, s);
    }
    return s;
  }
  status(id: string) {
    const s = this.state(id);
    return {
      queued: s.queue.length,
      nextStartAt: s.nextStartAt,
      cooldownUntil: s.cooldownUntil,
    };
  }
  cooldown(id: string, ms: number) {
    const s = this.state(id);
    s.cooldownUntil = Math.max(s.cooldownUntil, Date.now() + ms);
    this.pump(s);
  }
  acquire(id: string, rpm: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted)
      return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const s = this.state(id);
    return new Promise((resolve, reject) => {
      const entry = {
        rpm,
        signal,
        resolve,
        reject,
        abort: () => {
          s.queue = s.queue.filter((e) => e !== entry);
          reject(new DOMException("Cancelled", "AbortError"));
          this.pump(s);
        },
      };
      signal.addEventListener("abort", entry.abort, { once: true });
      s.queue.push(entry);
      this.pump(s);
    });
  }
  private pump(s: State): void {
    if (s.timer !== undefined) clearTimeout(s.timer);
    s.timer = undefined;
    if (!s.queue.length) return;
    const delay = Math.max(s.nextStartAt, s.cooldownUntil) - Date.now();
    if (delay > 0) {
      s.timer = setTimeout(() => this.pump(s), Math.min(delay, 2147483647));
      return;
    }
    const entry = s.queue.shift()!;
    entry.signal.removeEventListener("abort", entry.abort);
    s.nextStartAt = Date.now() + 60000 / entry.rpm;
    entry.resolve();
    this.pump(s);
  }
  wrap(provider: Provider, id: string, rpm: () => number, options: WrapOptions = {}): Provider {
    const scheduler = this;
    return {
      ...provider,
      async *stream(request, signal) {
        let limitWaits = 0;
        for (let attempt = 0; ; attempt++) {
          await scheduler.acquire(id, rpm(), signal);
          signal.throwIfAborted();
          let emitted = false;
          try {
            for await (const event of provider.stream(request, signal)) {
              emitted = true;
              yield event;
            }
            return;
          } catch (error) {
            if (typeof error !== "object" || error === null) throw error;
            const e = error as {
              status?: number;
              retryAfter?: string | null;
              headers?: Headers;
              message?: string;
              usageLimit?: { resetsAt: number; autoContinue: boolean };
            };
            if (signal.aborted) throw error;
            // A usage limit is hours, not seconds. It never becomes a cooldown on the lane -
            // that would hold an inline completion behind it - and only a caller that can
            // wait, waits: it says until when, sleeps, and sends the same request again.
            if (e.usageLimit !== undefined) {
              if (emitted || options.waitForUsageLimit !== true || !e.usageLimit.autoContinue || limitWaits >= MAX_LIMIT_WAITS) throw error;
              // On this computer's clock, so the countdown the chat shows ends when the wait does.
              const until = Date.now() + limitWaitMs(e.retryAfter ?? e.headers?.get("retry-after"), e.usageLimit.resetsAt, limitWaits);
              limitWaits += 1;
              attempt -= 1;
              yield { kind: "limit-wait", provider: provider.displayName, resetsAt: until };
              await sleepUntil(until, signal);
              continue;
            }
            // A garbled tool call (Groq's `tool_use_failed`) is a coin the model flipped
            // badly, not a limit: the provider's own advice is to ask again. Once, at
            // once, and only before anything streamed - replaying text would repeat it.
            if (e.status !== 429) {
              if (!emitted && attempt === 0 && TOOL_CALL_GARBLED.test(e.message ?? "")) continue;
              throw error;
            }
            // "Requested 9120, limit 6000 per minute" never fits, however long we wait:
            // fail at once so the agent can resend a leaner request instead.
            if (isRequestTooLarge(e.message ?? "")) throw error;
            const raw = e.retryAfter ?? e.headers?.get("retry-after");
            const seconds =
              raw === undefined || raw === null ? NaN : Number(raw);
            const ms = Number.isFinite(seconds)
              ? seconds * 1000
              : raw
                ? Date.parse(raw) - Date.now()
                : NaN;
            const wait = Number.isFinite(ms)
              ? Math.max(0, ms)
              : Math.min(60000, 1000 * 2 ** attempt);
            scheduler.cooldown(id, wait);
            // Never replay a partial response (including tool calls).
            if (emitted || attempt >= 2) throw error;
            // Say so: a silent half-minute wait reads as the assistant having hung.
            yield {
              kind: "status",
              text: `Waiting ${Math.max(1, Math.ceil(wait / 1000))}s for ${provider.displayName}'s rate limit`,
            };
          }
        }
      },
    };
  }
}
