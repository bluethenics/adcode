/**
 * Ad integrity: server-side guards on partner-card claims, and a circuit breaker per network.
 *
 * Why this exists (2026-11-25). Zeekend suspended ADCode for ad fraud we caused: the app sent
 * questions ADCode had written, and re-sent the same question every 30 s with a rising turn
 * number, so cards were requested - and claimed here - on a timer instead of because a person
 * asked something. Clients were fixed, but a client is whatever version is installed. The server
 * is the one place that sees every claim, so it now refuses the shapes that class of bug makes,
 * and stops listing a whole network when the traffic to it looks wrong.
 *
 * Two layers, both pure of I/O except through the injected `AdIntegrityStore`.
 *
 * 1. Claim guards (`checkClaim`), per account and per conversation:
 *      - conversation-hourly-cap: more than CONVERSATION_CARDS_PER_HOUR cards in one conversation
 *        in an hour. One conversation is one person typing; a card per message at a human pace is
 *        a few dozen an hour at the very most.
 *      - timer-signature: BEAT_RUN_REFUSE claims in a row, each 25-35 s after the last, in the
 *        same conversation. People do not send messages on a 30 s metronome; a timer does.
 *      - account-daily-cap: more than ACCOUNT_CARDS_PER_DAY cards for one account in a UTC day.
 *        A ceiling above the administrator's per-network card cap (default 300), so raising that
 *        cap by accident cannot lift one account past it.
 *    A claim with no conversation id (an installed client from before this guard) is checked
 *    against the account-daily cap only: the beat and hourly rules need a conversation to mean
 *    anything, and the network-wide breaker is what watches that traffic.
 *
 * 2. Circuit breaker (`recordSignals` / `assessBreaker`): every claim and every refusal is
 *    counted per network in time buckets. When, over the last BREAKER_WINDOW_MS, the share of
 *    claims refused as repeats passes REPEAT_RATIO_OPEN, or per-conversation cap breaches pass
 *    BREACHES_OPEN, or one country sends COUNTRY_RPS_OPEN claims a second, the breaker for that
 *    network opens: `sponsoredNetworks` stops listing it, claims for it are refused
 *    ("network-paused"), and an alert row plus an audit_log row are written for the admin. An
 *    administrator closes it again by hand (POST /v1/admin/ad-integrity/:network/reset); it
 *    never closes on its own, because a partner that has just complained should not be
 *    re-fed by a timer.
 *
 * Failure policy (deliberate, and different for the two layers):
 *   - Claim guards FAIL OPEN on ordinary database errors, like earningReview.ts: a database
 *     blip must not stop honest people earning, and the existing per-minute pace and daily cap
 *     still bound the damage. The error is swallowed here; the caller logs nothing money-moving.
 *   - The breaker's own state NEVER fails open on a corrupted signal. A state row that cannot be
 *     parsed (wrong shape, unknown network, not an array) is read as OPEN: for a row naming a
 *     network, that network is hidden; for one that does not, every network is hidden. A thrown
 *     read error is not corruption but an ordinary outage and is treated like one (listing is
 *     not hidden; sponsoredNetworks itself already returns nothing when the database is down).
 */

export const CONVERSATION_CARDS_PER_HOUR = 30;
export const BEAT_MIN_MS = 25_000;
export const BEAT_MAX_MS = 35_000;
/** Consecutive 25-35 s gaps that make a timer: this many gaps = this + 1 claims. */
export const BEAT_RUN_REFUSE = 5;
export const ACCOUNT_CARDS_PER_DAY = 400;

export const BREAKER_WINDOW_MS = 5 * 60_000;
export const BREAKER_BUCKET_MS = 60_000;
/** Below this many claims in the window the repeat ratio is noise and is not judged. */
export const REPEAT_MIN_CLAIMS = 50;
export const REPEAT_RATIO_OPEN = 0.2;
export const BREACHES_OPEN = 10;
export const COUNTRY_BUCKET_MS = 10_000;
export const COUNTRY_RPS_OPEN = 10;

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export type RefusalReason = "conversation-hourly-cap" | "timer-signature" | "account-daily-cap" | "network-paused";
export const REFUSAL_MESSAGE: Record<RefusalReason, string> = {
  "conversation-hourly-cap": "This conversation has already earned the most cards it can in an hour.",
  "timer-signature": "Cards arriving on a fixed timer are not counted. A card counts when you send a message.",
  "account-daily-cap": "This account has reached the most cards it can earn in a day.",
  "network-paused": "This ad partner is paused while ADCode checks its traffic.",
};

export type ClaimDecision = { readonly allow: true } | { readonly allow: false; readonly reason: RefusalReason; readonly message: string };

/** What the database tracks for one conversation after a claim is recorded. */
export interface TouchResult {
  /** Claims in this conversation in the hour up to now, this one included. */
  readonly hourCount: number;
  /** Consecutive gaps of 25-35 s ending at this claim. */
  readonly beatRun: number;
}

export type BreakerReason = "repeat-ratio" | "conversation-breaches" | "country-spike";
export const BREAKER_REASONS: readonly BreakerReason[] = ["repeat-ratio", "conversation-breaches", "country-spike"];

export interface BreakerState { readonly network: string; readonly open: boolean; readonly reason: string | null; readonly openedAt: number | null }
export interface IntegrityAlert { readonly id: number; readonly network: string; readonly reason: string; readonly details: Record<string, unknown>; readonly at: number }

export interface AdIntegrityStore {
  /** Records a claim for (account, conversation) and returns its pace. Atomic per pair. */
  touch(input: { uid: string; conversation: string; now: number }): Promise<TouchResult>;
  /** Adds one to a counter bucket and returns the new count. Kinds: claim, repeat, breach, country:XX, acct. */
  bump(network: string, kind: string, bucket: number): Promise<number>;
  /** The sum of a counter's buckets from `fromBucket` to `toBucket`, both included. */
  sum(network: string, kind: string, fromBucket: number, toBucket: number): Promise<number>;
  /** Raw breaker rows, unparsed: parsing (and what a corrupt row means) is this file's job. */
  breakers(): Promise<unknown>;
  /** Opens a network's breaker and writes the alert and audit rows. False when it was already open. */
  openBreaker(input: { network: string; reason: BreakerReason; details: Record<string, unknown>; now: number }): Promise<boolean>;
  closeBreaker(input: { network: string; adminUid: string; now: number }): Promise<boolean>;
  listAlerts(limit: number): Promise<IntegrityAlert[]>;
}

/* ── Breaker state, read without ever failing open on garbage ───────────── */

export type BreakerView = { readonly kind: "ok"; readonly open: ReadonlySet<string> } | { readonly kind: "all-open" };

/** Which networks are paused. Anything unreadable pauses everything it could refer to. */
export function parseBreakers(raw: unknown): BreakerView {
  if (!Array.isArray(raw)) return { kind: "all-open" };
  const open = new Set<string>();
  for (const row of raw) {
    if (typeof row !== "object" || row === null) return { kind: "all-open" };
    const value = row as Record<string, unknown>;
    if (typeof value["network"] !== "string" || value["network"] === "") return { kind: "all-open" };
    if (typeof value["open"] !== "boolean") { open.add(value["network"]); continue; }
    if (value["open"]) open.add(value["network"]);
  }
  return { kind: "ok", open };
}

/** True when the network must not be listed or paid. A thrown read is an outage, not corruption: fail open. */
export async function networkPaused(store: AdIntegrityStore | undefined, network: string): Promise<boolean> {
  if (store === undefined) return false;
  let raw: unknown;
  try { raw = await store.breakers(); } catch { return false; }
  const view = parseBreakers(raw);
  return view.kind === "all-open" || view.open.has(network);
}

/** Filters a network list down to the unpaused ones; same corruption rule as above. */
export async function withoutPausedNetworks<T extends { readonly id: string }>(store: AdIntegrityStore | undefined, networks: readonly T[]): Promise<T[]> {
  if (store === undefined) return [...networks];
  let raw: unknown;
  try { raw = await store.breakers(); } catch { return [...networks]; }
  const view = parseBreakers(raw);
  if (view.kind === "all-open") return [];
  return networks.filter((network) => !view.open.has(network.id));
}

/* ── Breaker thresholds, pure ───────────────────────────────────────────── */

export interface WindowFigures { readonly claims: number; readonly repeats: number; readonly breaches: number }

/** The reason to open a breaker for these figures, or null. */
export function assessBreaker(figures: WindowFigures): BreakerReason | null {
  if (figures.breaches >= BREACHES_OPEN) return "conversation-breaches";
  if (figures.claims >= REPEAT_MIN_CLAIMS && figures.repeats / figures.claims >= REPEAT_RATIO_OPEN) return "repeat-ratio";
  return null;
}

export const countryKind = (country: string): string => `country:${country}`;
const normalCountry = (country: string | null | undefined): string | null => (typeof country === "string" && /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null);

export interface ClaimInput {
  readonly uid: string;
  readonly network: string;
  /** The conversation the card was shown in; absent from clients that predate this guard. */
  readonly conversation: string | null;
  readonly country: string | null;
  readonly now: number;
}

/** A conversation id from a request body: a short plain string, or null. */
export function parseConversationId(raw: unknown): string | null {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["conversationId"] : undefined;
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null;
}

/**
 * True the first time an account is seen for a signal in a bucket. One signed-in account must
 * not be able to open a whole network's breaker alone (that would be a denial of every other
 * person's earnings, and the breaker never closes itself): each account feeds the network-wide
 * counters at most once per bucket, so opening one takes several accounts, not a loop.
 */
async function firstFromAccount(store: AdIntegrityStore, scope: string, uid: string, bucket: number): Promise<boolean> {
  return (await store.bump(`_acct-${scope}`, uid, bucket)) === 1;
}

/** Counts a signal, ignoring failures: telemetry must never block a claim. */
async function quietly<T>(work: () => Promise<T>): Promise<T | undefined> {
  try { return await work(); } catch { return undefined; }
}

/** Looks at the last window of signals and opens the breaker when they say so. */
export async function evaluateBreaker(store: AdIntegrityStore, network: string, now: number): Promise<BreakerReason | null> {
  const to = Math.floor(now / BREAKER_BUCKET_MS) * BREAKER_BUCKET_MS;
  const from = to - BREAKER_WINDOW_MS + BREAKER_BUCKET_MS;
  const [claims, repeats, breaches] = await Promise.all([
    store.sum(network, "claim", from, to), store.sum(network, "repeat", from, to), store.sum(network, "breach", from, to),
  ]);
  const reason = assessBreaker({ claims, repeats, breaches });
  if (reason !== null) await store.openBreaker({ network, reason, details: { claims, repeats, breaches, windowMs: BREAKER_WINDOW_MS }, now });
  return reason;
}

/**
 * Decides one claim. Never throws: a store error lets the claim through (fail open, see the
 * header), except that an open or corrupt breaker refuses it.
 */
export async function checkClaim(store: AdIntegrityStore | undefined, claim: ClaimInput): Promise<ClaimDecision> {
  if (store === undefined) return { allow: true };
  const refuse = (reason: RefusalReason): ClaimDecision => ({ allow: false, reason, message: REFUSAL_MESSAGE[reason] });
  if (await networkPaused(store, claim.network)) return refuse("network-paused");

  const minute = Math.floor(claim.now / BREAKER_BUCKET_MS) * BREAKER_BUCKET_MS;
  const day = Math.floor(claim.now / DAY_MS) * DAY_MS;
  const country = normalCountry(claim.country);
  try {
    const claims = await store.bump(claim.network, "claim", minute);

    // Network-wide: one country sending claims at machine speed. Evaluated once, when the
    // bucket first reaches the limit.
    if (country !== null) {
      const bucket = Math.floor(claim.now / COUNTRY_BUCKET_MS) * COUNTRY_BUCKET_MS;
      const seen = (await firstFromAccount(store, "country", claim.uid, bucket)) ? await store.bump(claim.network, countryKind(country), bucket) : 0;
      if (seen === Math.ceil((COUNTRY_RPS_OPEN * COUNTRY_BUCKET_MS) / 1000)) {
        await store.openBreaker({ network: claim.network, reason: "country-spike", details: { country, claimsInBucket: seen, bucketMs: COUNTRY_BUCKET_MS }, now: claim.now });
        return refuse("network-paused");
      }
    }

    const today = await store.bump("_account", claim.uid, day);
    if (today > ACCOUNT_CARDS_PER_DAY) return refuse("account-daily-cap");

    if (claim.conversation !== null) {
      const touched = await store.touch({ uid: claim.uid, conversation: claim.conversation, now: claim.now });
      if (touched.beatRun >= BEAT_RUN_REFUSE) {
        if (await firstFromAccount(store, "repeat", claim.uid, minute)) await store.bump(claim.network, "repeat", minute);
        await quietly(() => evaluateBreaker(store, claim.network, claim.now));
        return refuse("timer-signature");
      }
      if (touched.hourCount > CONVERSATION_CARDS_PER_HOUR) {
        const breaches = (await firstFromAccount(store, "breach", claim.uid, minute)) ? await store.bump(claim.network, "breach", minute) : 0;
        // Judge on the breach that first reaches the limit in a minute and every 10th claim after.
        if (breaches === 1 || claims % 10 === 0) await quietly(() => evaluateBreaker(store, claim.network, claim.now));
        return refuse("conversation-hourly-cap");
      }
    }
    if (claims % 10 === 0) await quietly(() => evaluateBreaker(store, claim.network, claim.now));
    // A claim just refused by the breaker it opened is caught on the next one; this one is checked again here.
    if (await networkPaused(store, claim.network)) return refuse("network-paused");
    return { allow: true };
  } catch {
    return { allow: true };
  }
}

/* ── In memory, for tests and the local server ──────────────────────────── */

export function createMemoryAdIntegrityStore(): AdIntegrityStore & { readonly audit: Array<{ action: string; network: string; at: number }> } {
  const beats = new Map<string, { last: number; run: number; hour: number[] }>();
  const buckets = new Map<string, number>();
  const breakers = new Map<string, BreakerState>();
  const alerts: IntegrityAlert[] = [];
  const audit: Array<{ action: string; network: string; at: number }> = [];
  const key = (network: string, kind: string, bucket: number): string => `${network}\u0000${kind}\u0000${bucket}`;
  return {
    audit,
    async touch({ uid, conversation, now }) {
      const id = `${uid}\u0000${conversation}`;
      const prior = beats.get(id);
      const gap = prior === undefined ? null : now - prior.last;
      const run = gap !== null && gap >= BEAT_MIN_MS && gap <= BEAT_MAX_MS ? (prior?.run ?? 0) + 1 : 0;
      const hour = [...(prior?.hour ?? []).filter((at) => at > now - HOUR_MS), now];
      beats.set(id, { last: now, run, hour });
      return { hourCount: hour.length, beatRun: run };
    },
    async bump(network, kind, bucket) {
      const k = key(network, kind, bucket);
      const n = (buckets.get(k) ?? 0) + 1;
      buckets.set(k, n);
      return n;
    },
    async sum(network, kind, from, to) {
      let total = 0;
      for (const [k, n] of buckets) {
        const [net, kd, bucket] = k.split("\u0000");
        if (net === network && kd === kind && Number(bucket) >= from && Number(bucket) <= to) total += n;
      }
      return total;
    },
    async breakers() { return [...breakers.values()]; },
    async openBreaker({ network, reason, details, now }) {
      if (breakers.get(network)?.open === true) return false;
      breakers.set(network, { network, open: true, reason, openedAt: now });
      alerts.unshift({ id: alerts.length + 1, network, reason, details, at: now });
      audit.push({ action: `ad-breaker-open:${reason}`, network, at: now });
      return true;
    },
    async closeBreaker({ network, now }) {
      if (breakers.get(network)?.open !== true) return false;
      breakers.set(network, { network, open: false, reason: null, openedAt: null });
      audit.push({ action: "ad-breaker-close", network, at: now });
      return true;
    },
    async listAlerts(limit) { return alerts.slice(0, limit); },
  };
}
