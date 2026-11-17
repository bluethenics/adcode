import type { LimitPause, Provider } from "./types.ts";

/** `limit` names the credit window that ran out; older relays send a daily allowance without it. */
type LimitError = { status?: number; code?: string; retryAfter?: string | null; retryable?: boolean; resetsAt?: number; message?: string; limit?: "session" | "weekly" | "paid"; buyUrl?: string };

/**
 * How often a task paused on the paid-token limit asks again. Buying tokens ends that wait at
 * once, so the task does not sit until the free week refills days later.
 */
export const PAID_RECHECK_MS = 120_000;
/** Pick up an administrator's reset or allowance change while a task is paused. */
export const ALLOWANCE_RECHECK_MS = 120_000;
const RATE_RECHECK_MS = 60_000;

/** Re-check wall time every minute so a sleeping computer resumes after the reset. */
async function waitUntil(at: number, signal: AbortSignal): Promise<void> {
  while (Date.now() < at) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const cancel = (): void => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(signal.reason ?? new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, Math.min(60_000, at - Date.now()));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  signal.throwIfAborted();
}

function resetTime(error: LimitError, daily: boolean): number {
  const now = Date.now();
  // A weekly credit window or the free paid-token week can refill days away; anything else is within a day.
  const longest = error.limit === "weekly" || error.limit === "paid" ? 8 * 86_400_000 : 86_400_000;
  if (daily && Number.isSafeInteger(error.resetsAt) && error.resetsAt! > now) return Math.min(error.resetsAt!, now + longest);
  const raw = error.retryAfter;
  const seconds = raw == null || raw.trim() === "" ? NaN : Number(raw);
  const at = Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(at)) return Math.min(Math.max(now + 1000, at), now + 86_400_000);
  return daily ? (Math.floor(now / 86_400_000) + 1) * 86_400_000 : now + 60_000;
}

/**
 * Pauses between retries after the connection to the relay fails, about two minutes in all.
 *
 * Reported on 2026-10-13: a one-second network blip ("fetch failed", and the relay never saw
 * the request) ended an eleven-minute, 33-tool task. A request that failed before any reply
 * came back is safe to send again inside the same turn, so a blip now costs a pause.
 */
export const NETWORK_RETRY_SECONDS = [2, 5, 10, 20, 40, 60] as const;
export const SERVER_RETRY_SECONDS = [2, 5, 10] as const;
const NETWORK_CODES = /^(?:ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE|UND_ERR_[A-Z_]+)$/;

/** The network error behind a failure, or null when the relay or provider answered. */
export function networkFailure(caught: unknown): string | null {
  if (!(caught instanceof Error)) return null;
  const codeOf = (value: unknown): string | null =>
    typeof value === "object" && value !== null && typeof (value as { code?: unknown }).code === "string" ? (value as { code: string }).code : null;
  const code = codeOf((caught as { cause?: unknown }).cause) ?? codeOf(caught);
  if (code !== null && NETWORK_CODES.test(code)) return code;
  return /^fetch failed$|^terminated$|socket hang up|network (?:error|changed)/i.test(caught.message) ? code ?? "network" : null;
}

export interface IncludedRecoveryOptions {
  /**
   * Another included model to answer with when `failed` keeps dying before its first token, or
   * null when there is none worth switching to. `tried` holds every model this provider has
   * already given up on.
   */
  readonly fallback?: (failed: string, tried: ReadonlySet<string>) => { readonly id: string; readonly name: string } | null;
}

/**
 * Same-model retries before switching to a fallback. Measured 30 October 2026: the busiest
 * included model failed one turn in three while another failed one in eighteen, and 43% of all
 * in-app reports were a turn that died this way and was retried on the same model three times
 * (~17 s of "retrying") before giving up. One short retry, then another model.
 */
const RETRIES_BEFORE_FAILOVER = 1;
const MAX_FAILOVERS = 2;

/** Keep the pending request inside its existing agent turn; completed tools are not replayed. */
export function recoverIncludedLimits(provider: Provider, options: IncludedRecoveryOptions = {}): Provider {
  // A model given up on stays given up on for the rest of this provider's life: every later step
  // of the same task asks the replacement instead of failing on the same model again.
  const replaced = new Map<string, string>();
  const tried = new Set<string>();
  return {
    ...provider,
    async *stream(original, signal) {
      let networkRetries = 0;
      let serverRetries = 0;
      let failovers = 0;
      const swap = replaced.get(original.model);
      let request = swap === undefined ? original : { ...original, model: swap };
      for (;;) {
        signal.throwIfAborted();
        let producedOutput = false;
        try {
          for await (const event of provider.stream(request, signal)) {
            if (event.kind === "text" || event.kind === "tool-call" || event.kind === "tool-input") producedOutput = true;
            yield event;
          }
          return;
        } catch (caught) {
          if (signal.aborted || producedOutput || typeof caught !== "object" || caught === null) throw caught;
          const network = networkFailure(caught);
          if (network !== null) {
            if (networkRetries >= NETWORK_RETRY_SECONDS.length) {
              // Name the network error, so the chat card and the log say more than "fetch failed".
              throw new Error(`fetch failed (${network}) - still unreachable after ${NETWORK_RETRY_SECONDS.length} retries`, { cause: caught });
            }
            const seconds = NETWORK_RETRY_SECONDS[networkRetries++]!;
            yield { kind: "status", text: `The connection to included AI dropped (${network}). Retrying in ${seconds}s - this task carries on where it was. Press Stop to cancel.` };
            await waitUntil(Date.now() + seconds * 1000, signal);
            continue;
          }
          const error = caught as LimitError;
          const serverFailure = error.retryable !== false && [500, 502, 503, 504].includes(error.status ?? 0);
          if (serverFailure && serverRetries >= RETRIES_BEFORE_FAILOVER && failovers < MAX_FAILOVERS && options.fallback !== undefined) {
            tried.add(request.model);
            const next = options.fallback(request.model, tried);
            if (next !== null && !tried.has(next.id)) {
              failovers++;
              serverRetries = 0;
              replaced.set(original.model, next.id);
              request = { ...original, model: next.id };
              yield { kind: "status", text: `That model is not answering right now - switched to ${next.name} for this task so you still get a reply.` };
              continue;
            }
          }
          if (serverFailure && serverRetries < SERVER_RETRY_SECONDS.length) {
            const seconds = SERVER_RETRY_SECONDS[serverRetries++]!;
            yield { kind: "status", text: `Included AI is temporarily unavailable. Retrying in ${seconds}s without repeating completed tools. Press Stop to cancel.` };
            await waitUntil(Date.now() + seconds * 1000, signal);
            continue;
          }
          const code = error.code ?? /\(code (daily-limit|rate-limit|upstream-rate-limit)\)/.exec(error.message ?? "")?.[1];
          if (error.status !== 429 || error.retryable === false || !["daily-limit", "rate-limit", "upstream-rate-limit"].includes(code ?? "")) throw caught;
          const daily = code === "daily-limit";
          if (error.limit === "paid") {
            const buyUrl = error.buyUrl ?? "https://adcode.bluethenics.com/ai-tokens";
            const recheckAt = Math.min(resetTime(error, daily), Date.now() + PAID_RECHECK_MS);
            const limit: LimitPause = { reason: "paid", resumeAt: resetTime(error, daily), recheckAt, buyUrl };
            yield { kind: "status", limit, text: `Today's shared included AI tokens are used up. Buy tokens or a plan at ${buyUrl}, or use your own connected model. This task checks again every two minutes and carries on by itself once you have tokens. Press Stop to cancel.` };
            await waitUntil(recheckAt, signal);
            continue;
          }
          // A stale/overlong provider Retry-After must not put an unlimited account
          // to sleep for a day. Account limits are also rechecked for admin resets.
          const at = Math.min(resetTime(error, daily), Date.now() + (daily ? ALLOWANCE_RECHECK_MS : RATE_RECHECK_MS));
          const when = new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
          const reason: LimitPause["reason"] = error.limit === "weekly" || error.limit === "session" ? error.limit : daily ? "daily" : code === "upstream-rate-limit" ? "upstream" : "rate";
          // The card names when the limit lifts, not the sooner re-check that may end it early.
          const limit: LimitPause = { reason, resumeAt: daily ? resetTime(error, daily) : at, recheckAt: at };
          yield { kind: "status", limit, text: error.limit === "weekly"
            ? `This week's free AI credits are used up. Checking again after ${when}, including any administrator reset or allowance change. This task resumes automatically once credits are available. Press Stop to cancel.`
            : error.limit === "session"
            ? `This session's free AI credits are used up. Checking again after ${when}, including any administrator reset or allowance change. This task resumes automatically once credits are available. Press Stop to cancel.`
            : daily
            ? `Free AI allowance reached. Checking again after ${when}, including any administrator reset or allowance change. This task will resume automatically once usage is available. Press Stop to cancel.`
            : code === "upstream-rate-limit"
            ? `This model's provider is temporarily rate limited, even with unlimited ADCode usage. This task will retry after ${when}; you can also choose another model. Press Stop to cancel.`
            : `AI requests are temporarily rate limited. This task will retry after ${when}. Unlimited usage still has a request-rate ceiling. Press Stop to cancel.` };
          await waitUntil(at, signal);
          yield { kind: "status", text: "Checking the limit and resuming this task automatically…" };
        }
      }
    },
  };
}
