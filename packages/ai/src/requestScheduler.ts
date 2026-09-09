import type { Provider } from "./types.ts";
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
  wrap(provider: Provider, id: string, rpm: () => number): Provider {
    const scheduler = this;
    return {
      ...provider,
      async *stream(request, signal) {
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
            };
            if (e.status !== 429 || signal.aborted) throw error;
            const raw = e.retryAfter ?? e.headers?.get("retry-after");
            const seconds =
              raw === undefined || raw === null ? NaN : Number(raw);
            const ms = Number.isFinite(seconds)
              ? seconds * 1000
              : raw
                ? Date.parse(raw) - Date.now()
                : NaN;
            scheduler.cooldown(
              id,
              Number.isFinite(ms)
                ? Math.max(0, ms)
                : Math.min(60000, 1000 * 2 ** attempt),
            );
            // Never replay a partial response (including tool calls).
            if (emitted || attempt >= 2) throw error;
          }
        }
      },
    };
  }
}
