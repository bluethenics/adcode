/**
 * Retention tracking: who stops coming back, and what went wrong just before.
 *
 * The editor sends fixed event names with a time, an optional code from a fixed list and
 * an optional duration, alongside its first-session milestones on `POST /v1/milestones`
 * (one pipeline, one disk queue, one request). It sends them only while Help improve ADCode
 * is on. This file refuses anything that is not exactly such an event, so no prompt, path,
 * file, code or chat text can be stored: there is nowhere in the request to put one that
 * survives these checks.
 *
 * Under spec D1 the service keeps its own copy of the vocabulary; the editor's is
 * `packages/retention/src/events.ts`, and `packages/retention/test/apiCopy.test.ts` fails if
 * they drift. The rules that turn events into cohorts and churn reasons run in SQL (the
 * hourly rollup), specified by `packages/retention/src/rules.ts`.
 */

export const FUNNEL_STEPS = [
  "first_launch", "signed_in", "project_opened", "ai_message", "ai_turn_ok", "edit_applied", "preview_opened",
] as const;
export const FRICTION_EVENTS = [
  "turn_failed", "cli_failed", "limit_reached", "no_api_key", "sign_in_needed", "sign_in_failed",
  "slow_first_answer", "turn_cancelled", "crash", "renderer_gone", "update_failed",
] as const;
export const SESSION_EVENTS = ["day_active", "session_start", "session_end"] as const;
export const RETENTION_EVENTS = [...FUNNEL_STEPS, ...SESSION_EVENTS, ...FRICTION_EVENTS] as const;
export type RetentionEventName = (typeof RETENTION_EVENTS)[number];

const TURN_ERROR_CODES = [
  "auth", "credits", "rate_limit", "too_large", "model_missing", "no_tools", "tool_format",
  "network", "server", "output_limit", "thinking_limit", "history", "refused", "setup", "other",
];
const CLI_IDS = ["claude", "codex", "opencode", "gemini", "freebuff"];
const CLI_FAILURES = ["failed", "signed_out", "missing", "stopped_part_way", "empty"];

export const EVENT_CODES: { readonly [K in RetentionEventName]: readonly string[] | "version" | null } = {
  first_launch: null,
  signed_in: ["google", "github", "password"],
  project_opened: ["folder", "new", "recent", "shared"],
  ai_message: null,
  ai_turn_ok: null,
  edit_applied: ["automatic", "review"],
  preview_opened: null,
  day_active: null,
  session_start: "version",
  session_end: ["quit", "update", "unclean"],
  turn_failed: TURN_ERROR_CODES,
  cli_failed: CLI_IDS.flatMap((cli) => CLI_FAILURES.map((failure) => `${cli}.${failure}`)),
  limit_reached: ["daily", "weekly", "session", "tokens", "credits", "paid", "rate"],
  no_api_key: ["key", "custom", "free_unavailable"],
  sign_in_needed: null,
  sign_in_failed: ["google", "github", "password", "not_configured"],
  slow_first_answer: null,
  turn_cancelled: null,
  crash: ["main_exception", "gpu_gone", "utility_gone"],
  renderer_gone: ["crashed", "oom", "killed", "launch-failed", "integrity-failure", "abnormal-exit", "memory-eviction"],
  update_failed: ["check", "download", "install", "prepare"],
};

export const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[a-z0-9.]{1,20})?$/;

export const CHURN_REASONS = [
  "crashed", "hit_limit", "sign_in_dead_end", "no_api_key", "first_turn_failed", "ai_failing",
  "update_failed", "slow_answers", "gave_up_waiting", "no_project", "no_ai_message", "no_edit", "faded",
] as const;
export type ChurnReason = (typeof CHURN_REASONS)[number];

export const SILENT_DAY_CHOICES = [3, 7, 14, 30] as const;

export const RETENTION_LIMITS = {
  /** Events in one request: the editor sends at most 100. */
  perRequest: 100,
  /** Requests per account per UTC day; a normal day is a handful. */
  requestsPerDay: 200,
  /** A time more than a week old, or in the future, is clamped. */
  maxAgeMs: 7 * 86_400_000,
  maxMs: 86_400_000,
} as const;

export interface RetentionEvent {
  readonly name: RetentionEventName;
  readonly at: number;
  readonly code?: string;
  readonly ms?: number;
}

const KNOWN: ReadonlySet<string> = new Set(RETENTION_EVENTS);
const ALLOWED_KEYS: ReadonlySet<string> = new Set(["name", "at", "code", "ms"]);

/**
 * `events` from a flush, every one exactly a retention event, or null to refuse the lot.
 * Refusing the whole request rather than dropping the odd event keeps a client bug loud:
 * the editor treats a 400 as "never send this batch again".
 */
export function parseRetentionEvents(raw: unknown): RetentionEvent[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > RETENTION_LIMITS.perRequest) return null;
  const events: RetentionEvent[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const value = entry as Record<string, unknown>;
    if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) return null;
    const { name, at, code, ms } = value;
    if (typeof name !== "string" || !KNOWN.has(name)) return null;
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) return null;
    if (code !== undefined) {
      const allowed = EVENT_CODES[name as RetentionEventName];
      if (typeof code !== "string" || allowed === null) return null;
      if (allowed === "version" ? !VERSION.test(code) : !allowed.includes(code)) return null;
    }
    if (ms !== undefined && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) return null;
    events.push({
      name: name as RetentionEventName,
      at,
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof ms === "number" ? { ms: Math.min(RETENTION_LIMITS.maxMs, Math.round(ms)) } : {}),
    });
  }
  return events;
}

/** A wrong clock must not put a first launch in 2030 or 1970, where it would sit in every cohort. */
export function clampEvents(events: readonly RetentionEvent[], now: number): RetentionEvent[] {
  const earliest = now - RETENTION_LIMITS.maxAgeMs;
  return events.map((event) => ({ ...event, at: Math.min(now, Math.max(earliest, event.at)) }));
}

/* ── What the admin page reads ─────────────────────────────────────────── */

export interface RetentionPoint { readonly eligible: number; readonly retained: number }

export interface RetentionSummary {
  readonly builtAt: number;
  readonly silentDays: number;
  readonly totals: { readonly users: number; readonly newInstalls: number; readonly active1d: number; readonly active7d: number; readonly active30d: number; readonly churned: number };
  readonly cohorts: readonly { readonly weekStart: string; readonly users: number; readonly d1: RetentionPoint; readonly d7: RetentionPoint; readonly d30: RetentionPoint }[];
  readonly funnel: { readonly base: number; readonly steps: readonly { readonly step: string; readonly users: number }[] };
  readonly reasons: readonly { readonly reason: ChurnReason; readonly users: number }[];
  readonly friction: readonly { readonly name: string; readonly churned: number; readonly users: number; readonly topCodes: readonly { readonly code: string; readonly churned: number }[] }[];
}

export interface RetentionUserRow {
  readonly uid: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly activeDays: number;
  readonly newInstall: boolean;
  readonly furthestStep: string | null;
  readonly reason: ChurnReason;
  readonly lastError: { readonly name: string; readonly code: string | null; readonly at: number } | null;
  readonly lastSession: { readonly code: string | null; readonly ms: number | null; readonly at: number } | null;
  readonly version: string | null;
}

export interface RetentionTimeline {
  readonly user: (RetentionUserRow & { readonly counts: Readonly<Record<string, number>> }) | null;
  readonly daily: readonly { readonly day: string; readonly events: number; readonly counts: Readonly<Record<string, number>> }[];
  readonly events: readonly { readonly name: string; readonly code: string | null; readonly ms: number | null; readonly at: number }[];
}

export interface RetentionStore {
  record(uid: string, now: number, events: readonly RetentionEvent[]): Promise<void>;
  /** The cached summary, or null when the rollup has not built one yet. */
  summary(silentDays: number): Promise<RetentionSummary | null>;
  /** Folds new events and rebuilds every cached summary (the hourly job, on demand). */
  refresh(now: number): Promise<void>;
  churned(input: { now: number; silentDays: number; reason: ChurnReason | null; offset: number; limit: number }): Promise<{ total: number; users: RetentionUserRow[] }>;
  timeline(uid: string): Promise<RetentionTimeline>;
}

/** `?silentDays=` from the page, one of the cached choices; 7 when absent or anything else. */
export function silentDaysFrom(url: URL): number {
  const value = Number(url.searchParams.get("silentDays"));
  return (SILENT_DAY_CHOICES as readonly number[]).includes(value) ? value : 7;
}

export function reasonFrom(url: URL): ChurnReason | null {
  const value = url.searchParams.get("reason");
  return value !== null && (CHURN_REASONS as readonly string[]).includes(value) ? (value as ChurnReason) : null;
}

/** A uid as the auth layer issues them: Firebase ids and test ids, nothing with spaces or slashes. */
export const UID = /^[A-Za-z0-9_-]{1,128}$/;

/** A cached summary older than this is rebuilt when the page asks, rather than shown. */
export const SUMMARY_STALE_MS = 3 * 3_600_000;
