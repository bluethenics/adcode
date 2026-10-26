/**
 * What keeps a slow database from becoming a dead one.
 *
 * On 2026-10-19 the Postgres instance slowed, every /v1 request waited ~20 s on it, clients
 * retried, and the Worker sent ~900,000 requests in a day - almost all of them a read of the
 * one-row `tagflow_config` - until the database stopped answering at all. Two guards:
 *
 * - `guardedFetch`: the Supabase client's fetch, with a deadline per request and a circuit
 *   breaker. After a run of timeouts or gateway errors it stops calling for a cool-down and
 *   fails at once, then lets a single probe through. A database that is struggling gets room
 *   to recover instead of a queue.
 * - `cached`: a read-through cache for rows that change only when an administrator saves them
 *   (the AI catalogue, serving config, the admin list). Fresh for `ttlMs`; after that a failed
 *   refresh keeps serving the last good value, so a database blip never takes the model list
 *   or the admin page down with it.
 *
 * Both live per isolate (module scope), which is the unit a Worker reuses between requests.
 */

export interface BreakerOptions {
  /** Abort a request after this long. */
  readonly timeoutMs: number;
  /** Consecutive failures that open the circuit. */
  readonly threshold: number;
  /** How long the circuit stays open before one probe is allowed. */
  readonly coolDownMs: number;
  readonly now?: () => number;
}

export const DEFAULT_BREAKER: BreakerOptions = { timeoutMs: 8_000, threshold: 4, coolDownMs: 15_000 };

/** Gateway answers that mean "the database is not there", not "your query was wrong". */
const UNAVAILABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

export class DatabaseUnavailableError extends Error {
  constructor(message = "The database is temporarily unavailable") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export interface Breaker {
  fetch: typeof fetch;
  state(): { open: boolean; failures: number; openUntil: number };
}

export function createBreaker(inner: typeof fetch, options: BreakerOptions = DEFAULT_BREAKER): Breaker {
  const now = options.now ?? Date.now;
  let failures = 0;
  let openUntil = 0;
  // When the probe in flight runs out of time. A deadline, not a flag cleared by the probe: on
  // Cloudflare a probe's own timeout dies with the request that sent it, so a probe from a
  // cancelled request may never settle - and a flag would then keep the circuit shut for good.
  let probeUntil = 0;
  const fail = (): void => {
    failures += 1;
    if (failures >= options.threshold) openUntil = now() + options.coolDownMs;
  };
  const guarded = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const open = now() < openUntil;
    // Open: refuse at once. Half-open (cool-down over, failures not reset): one probe at a time.
    if (open || (failures >= options.threshold && now() < probeUntil)) throw new DatabaseUnavailableError();
    const halfOpen = failures >= options.threshold;
    if (halfOpen) probeUntil = now() + options.timeoutMs;
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await inner(input, { ...init, signal });
      if (UNAVAILABLE.has(response.status)) fail();
      else { failures = 0; openUntil = 0; }
      return response;
    } catch (error) {
      // A caller's own abort is not the database's fault.
      if (!(init?.signal?.aborted ?? false)) fail();
      throw error;
    } finally {
      if (halfOpen) probeUntil = 0;
    }
  }) as typeof fetch;
  return { fetch: guarded, state: () => ({ open: now() < openUntil, failures, openUntil }) };
}

export interface CacheOptions {
  readonly ttlMs: number;
  /** How long a stale value may stand in for a failed refresh. */
  readonly staleMs: number;
  readonly now?: () => number;
}

/**
 * A read-through cache of one async value, with serve-stale-on-error.
 *
 * Requests share finished values, never a load in flight. On Cloudflare a promise belongs to
 * the request that made it: when that request is cancelled its fetch never settles, and every
 * other request awaiting the same promise hung with it - for 100 minutes, on 2026-10-21.
 */
export function cached<T>(load: () => Promise<T>, options: CacheOptions): { get(): Promise<T>; clear(): void } {
  const now = options.now ?? Date.now;
  let value: { readonly at: number; readonly data: T } | null = null;
  return {
    async get(): Promise<T> {
      if (value !== null && now() - value.at < options.ttlMs) return value.data;
      try {
        const data = await load();
        value = { at: now(), data };
        return data;
      } catch (error) {
        if (value !== null && now() - value.at < options.staleMs) return value.data;
        throw error;
      }
    },
    clear(): void { value = null; },
  };
}

/** A small keyed version of `cached`, for per-email admin checks. */
export function cachedBy<T>(load: (key: string) => Promise<T>, options: CacheOptions & { readonly max: number }): { get(key: string): Promise<T>; forget(key: string): void; clear(): void } {
  const entries = new Map<string, ReturnType<typeof cached<T>>>();
  return {
    get(key) {
      let entry = entries.get(key);
      if (entry === undefined) {
        if (entries.size >= options.max) entries.delete(entries.keys().next().value!);
        entry = cached(() => load(key), options);
        entries.set(key, entry);
      }
      return entry.get();
    },
    forget(key) { entries.delete(key); },
    clear() { entries.clear(); },
  };
}
