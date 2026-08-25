/**
 * Shared types and port interfaces for the ad client. No logic.
 *
 * Everything the five pure modules are allowed to import lives here (brief §8).
 */

/* ── Money ──────────────────────────────────────────────────────────────── */

declare const MicrosBrand: unique symbol;

/**
 * int64 micros of USD.
 *
 * Brief §1: "All monetary values are int64 micros of USD. Never floats." A JavaScript
 * `number` is an IEEE-754 double. It happens to be exact below 2^53 - about $9 billion
 * in micros - but that rule exists precisely to keep "happens to be exact" out of a
 * revenue-share ledger, so this is a bigint. The consequence is that money crosses the
 * wire as a decimal string, since JSON has no bigint.
 */
export type Micros = bigint & { readonly [MicrosBrand]: true };

export const micros = (value: bigint): Micros => value as Micros;

export const MICROS_PER_USD = 1_000_000n;

/* ── Result ─────────────────────────────────────────────────────────────── */

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/* ── Primitives ─────────────────────────────────────────────────────────── */

export type ThemeKind = "light" | "dark";
export type FrequencyPreset = "off" | "light" | "standard" | "max";
export type Outcome = "impression" | "click" | "dismissed";

export interface FrequencyCaps {
  readonly minIntervalMs: number;
  readonly dailyCap: number;
}

/**
 * Caps as they arrive from the network: every field optional, and explicitly allowed to
 * be `undefined`. `Partial<FrequencyCaps>` would not do under `exactOptionalPropertyTypes`
 * - it rejects `{ dailyCap: undefined }`, which is precisely one of the shapes a
 * misconfigured server sends and which `tightenCaps` must survive.
 */
export interface RemoteCaps {
  readonly minIntervalMs?: number | undefined;
  readonly dailyCap?: number | undefined;
}

/**
 * Brief §8.1. `off` is short-circuited by the `frequency-off` reason before caps are
 * ever consulted; its zeros exist so no code path can read an undefined cap.
 */
/*
 * Denser than they were - 60/30/15 minutes and 4/8/20 a day.
 *
 * At the old standard an impression arrived twice an hour, which is about two cents a
 * week: a ledger that technically works and never visibly moves. The point of showing
 * somebody their earnings is that they can watch them change, and a number that takes a
 * fortnight to reach a cent teaches the opposite lesson.
 *
 * The restraint rules are untouched and they are the ones that actually protect focus: no
 * card while typing, while debugging, while the window is unfocused, or inside the settle
 * period after launch. This changes how often a *pause* is eligible, not whether work gets
 * interrupted. `off` still means off.
 */
export const PRESETS: Readonly<Record<FrequencyPreset, FrequencyCaps>> = {
  off: { minIntervalMs: 0, dailyCap: 0 },
  light: { minIntervalMs: 1_800_000, dailyCap: 8 },
  standard: { minIntervalMs: 600_000, dailyCap: 24 },
  max: { minIntervalMs: 300_000, dailyCap: 60 },
};

export const DEFAULT_PRESET: FrequencyPreset = "standard";

/* ── Constants ──────────────────────────────────────────────────────────── */

/** §1: 60s settle period after launch. */
export const SETTLE_MS = 60_000;
/** §1: 8s auto-dismiss, timer pauses on hover. */
export const AUTO_DISMISS_MS = 8_000;
/** §1: an impression requires at least 4 seconds on screen. */
export const MIN_DWELL_MS = 4_000;
/** §9: 3s fetch timeout - a display never waits on the network. */
export const FETCH_TIMEOUT_MS = 3_000;
/** §9: a prefetch cache of ~10 creatives. */
export const PREFETCH_TARGET = 10;
/** §9: queue to disk, capped at 500, oldest dropped. */
export const RECEIPT_QUEUE_CAP = 500;
/** Not specified in the brief; chosen. See spec §5.1. */
export const MAX_TAGS = 8;

/* ── Tag vocabulary ─────────────────────────────────────────────────────── */

/**
 * Brief §1: "The tagger's output must be a subset of a fixed, compiled-in tag
 * vocabulary." §8.2 makes the intersection against this list the tagger's final step,
 * so even a carelessly edited mapping table cannot leak a tag that was not compiled in.
 */
export const TAG_VOCABULARY = [
  "lang:c", "lang:cpp", "lang:csharp", "lang:css", "lang:go", "lang:html",
  "lang:java", "lang:javascript", "lang:json", "lang:kotlin", "lang:lua",
  "lang:markdown", "lang:php", "lang:python", "lang:ruby", "lang:rust",
  "lang:shell", "lang:sql", "lang:swift", "lang:typescript", "lang:yaml",

  "fw:angular", "fw:django", "fw:express", "fw:laravel", "fw:next",
  "fw:nuxt", "fw:rails", "fw:react", "fw:spring", "fw:svelte", "fw:vue",

  "tool:cargo", "tool:docker", "tool:gradle", "tool:kubernetes", "tool:maven",
  "tool:npm", "tool:terraform", "tool:vite", "tool:webpack",

  "platform:backend", "platform:desktop", "platform:mobile", "platform:web",
] as const;

export type Tag = (typeof TAG_VOCABULARY)[number];

/* ── Scheduler ──────────────────────────────────────────────────────────── */

/**
 * Brief §8.1, evaluated in exactly this order: user intent first, then context, then
 * rate limits, then inventory - so the reason returned stays meaningful as telemetry.
 */
export type SuppressReason =
  | "ads-disabled"
  | "kill-switch"
  | "frequency-off"
  | "settling"
  | "window-unfocused"
  | "debug-active"
  | "do-not-disturb"
  | "daily-cap"
  | "min-interval"
  | "no-creative";

export interface SchedulerState {
  /** Epoch ms. Supplied by the caller: a pure module never reads a clock. */
  readonly now: number;
  readonly adsEnabled: boolean;
  readonly killSwitch: boolean;
  readonly preset: FrequencyPreset;
  /** Already passed through `tightenCaps`. */
  readonly caps: FrequencyCaps;
  readonly launchedAt: number;
  readonly settleMs: number;
  readonly windowFocused: boolean;
  readonly debugActive: boolean;
  readonly doNotDisturb: boolean;
  readonly impressionsToday: number;
  readonly lastImpressionAt: number | null;
  readonly creativeAvailable: boolean;
  /**
   * The next card waiting is an admin test.
   *
   * Skips the daily cap and the minimum gap, and nothing else. Those two are pacing -
   * how often it is *polite* to interrupt - and a test that waits out a ten-minute
   * cadence gets its answer long after whoever asked has concluded delivery is broken.
   * Everything above them in `decide` is restraint, and a test card obeys all of it.
   */
  readonly testCardWaiting?: boolean;
}

export type SchedulerDecision =
  | { readonly show: true }
  | { readonly show: false; readonly reason: SuppressReason };

/* ── Wire types ─────────────────────────────────────────────────────────── */

export interface Creative {
  readonly creativeId: string;
  readonly advertiser: string;
  readonly headline: string;
  readonly body: string | null;
  readonly clickUrl: string;
  readonly logoLight: string;
  readonly logoDark: string;
  readonly ttlMs: number;
  /** An admin test card. Skips pacing, never restraint - see `decide`. */
  readonly test?: boolean;
}

export interface Receipt {
  readonly receiptId: string;
  readonly creativeId: string;
  readonly shownAt: number;
  readonly dwellMs: number;
  readonly themeKind: ThemeKind;
  readonly outcome: Outcome;
}

export interface Balance {
  readonly availableMicros: Micros;
  readonly lifetimeMicros: Micros;
}

export interface RemoteConfig {
  readonly killSwitch: boolean;
  /** §1: may only *tighten* local caps, never loosen them. */
  readonly caps: RemoteCaps;
  /** Spec deviation D1: server-computed micros per hour, per preset. */
  readonly projections: Readonly<Record<FrequencyPreset, Micros>>;
}

export interface ServeRequest {
  readonly tags: readonly string[];
  readonly themeKind: ThemeKind;
  readonly count: number;
}

/* ── Errors ─────────────────────────────────────────────────────────────── */

export interface ValidationError {
  readonly kind: "validation";
  readonly field: string;
  readonly detail: string;
}

export interface AuthError {
  readonly kind: "auth";
  readonly detail: string;
  /**
   * Set when the refusal means "that credential already belongs to another account".
   *
   * The distinction matters because it is the one refusal a caller can act on without
   * the user typing anything: the credential is good, it just names an account that
   * already exists, so signing in as that account succeeds where linking to it cannot.
   * Callers branch on this rather than matching the sentence, which is prose and will
   * be reworded.
   */
  readonly reason?: "account-exists";
}

export interface ClientError {
  readonly kind: "timeout" | "network" | "http" | "validation" | "auth";
  readonly detail: string;
  readonly status?: number;
}

export interface AssetError {
  readonly kind: "disallowed-host" | "insecure-scheme" | "too-large" | "network";
  readonly detail: string;
}

/* ── Ports ──────────────────────────────────────────────────────────────── */

export interface Clock {
  now(): number;
}

export interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface FileStore {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface TokenProvider {
  getToken(): Promise<Result<string, AuthError>>;
  invalidate(): void;
}

/** What the IDE actually renders. Deliberately not a `Creative`. */
export interface SponsoredNotification {
  readonly creativeId: string;
  readonly advertiser: string;
  readonly headline: string;
  readonly body: string | null;
  /** Already resolved for the current theme (§8.3). */
  readonly logo: string;
  readonly clickUrl: string;
  readonly autoDismissMs: number;
}

export interface NotificationHandle {
  update(next: SponsoredNotification): void;
  dismiss(): void;
}

export interface NotificationSink {
  show(notification: SponsoredNotification): NotificationHandle;
}

export interface IdeSignals {
  windowFocused(): boolean;
  debugActive(): boolean;
  doNotDisturb(): boolean;
  themeKind(): ThemeKind;
  /** Open editors' language IDs. Never file contents. */
  languageIds(): readonly string[];
  /** Workspace filenames. Basenames only reach the tagger (§8.2). */
  filenames(): readonly string[];
}
