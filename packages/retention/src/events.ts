/**
 * The retention events the desktop app may send: fixed names, fixed codes, a time and an
 * optional duration. Nothing else.
 *
 * Retention asks two questions - who stops coming back, and what went wrong just before -
 * and both can be answered from words like `turn_failed` + `auth`, never from what a person
 * typed. So the wire has no free-text field at all: every name and every code is in a list
 * below, and anything else is dropped before it is stored or sent. A path, a prompt, a file
 * name or a provider's error message cannot pass, because none of them is in a list.
 *
 * The service keeps its own copy of these lists (`services/api/src/retention.ts`, spec D1);
 * `services/api/test/retention.test.ts` fails if the two drift.
 */

/** The meaningful moments, in the order a new person usually reaches them. */
export const FUNNEL_STEPS = [
  "first_launch",
  "signed_in",
  "project_opened",
  "ai_message",
  "ai_turn_ok",
  "edit_applied",
  "preview_opened",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Things that go wrong, which are what explain somebody leaving. */
export const FRICTION_EVENTS = [
  "turn_failed",
  "cli_failed",
  "limit_reached",
  "no_api_key",
  "sign_in_needed",
  "sign_in_failed",
  "slow_first_answer",
  "turn_cancelled",
  "crash",
  "renderer_gone",
  "update_failed",
] as const;

export type FrictionEvent = (typeof FRICTION_EVENTS)[number];

/** Bookkeeping: which days, which version, and how each session ended. */
export const SESSION_EVENTS = ["day_active", "session_start", "session_end"] as const;

export const RETENTION_EVENTS = [...FUNNEL_STEPS, ...SESSION_EVENTS, ...FRICTION_EVENTS] as const;

export type RetentionEventName = (typeof RETENTION_EVENTS)[number];

/** How an assistant turn failed: the editor's fixed model-outcome words, plus `setup`. */
export const TURN_ERROR_CODES = [
  "auth", "credits", "rate_limit", "too_large", "model_missing", "no_tools", "tool_format",
  "network", "server", "output_limit", "thinking_limit", "history", "refused", "setup", "other",
] as const;

/** The CLI agents ADCode can drive, and the ways a run of one can go wrong. */
export const CLI_IDS = ["claude", "codex", "opencode", "gemini", "freebuff"] as const;
export const CLI_FAILURES = ["failed", "signed_out", "missing", "stopped_part_way", "empty"] as const;

/** How a session ended. `unclean` is learnt at the next launch: no quit was ever recorded. */
export const SESSION_END_CODES = ["quit", "update", "unclean"] as const;

/**
 * The fixed codes each event may carry. `null`: no code. `"version"`: an app version
 * string, checked by `VERSION` rather than a list.
 */
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
  session_end: SESSION_END_CODES,
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

/** `2.6.3`, `2.7.0-beta.1`. Lower-case, so a code can never spell a name. */
export const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[a-z0-9.]{1,20})?$/;

/** Durations are capped at a day: longer is a clock jump or a machine asleep, not a timing. */
export const MAX_MS = 86_400_000;

/** A first answer slower than this is friction worth naming. */
export const SLOW_FIRST_ANSWER_MS = 20_000;

export interface RetentionEvent {
  readonly name: RetentionEventName;
  /** Epoch milliseconds. */
  readonly at: number;
  readonly code?: string;
  readonly ms?: number;
}

const KNOWN: ReadonlySet<string> = new Set(RETENTION_EVENTS);

export function isRetentionEventName(value: unknown): value is RetentionEventName {
  return typeof value === "string" && KNOWN.has(value);
}

/** Whether `code` is one this event may carry (`undefined` is fine for any event). */
export function isAllowedCode(name: RetentionEventName, code: unknown): boolean {
  if (code === undefined) return true;
  if (typeof code !== "string") return false;
  const allowed = EVENT_CODES[name];
  if (allowed === null) return false;
  if (allowed === "version") return VERSION.test(code);
  return allowed.includes(code);
}

/**
 * The one way an event becomes sendable: every field checked, everything unknown dropped.
 * Returns null for anything that is not exactly a retention event.
 */
export function sanitizeEvent(raw: unknown): RetentionEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, at, code, ms } = raw as Record<string, unknown>;
  if (!isRetentionEventName(name)) return null;
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at <= 0) return null;
  if (!isAllowedCode(name, code)) return null;
  if (ms !== undefined && (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0)) return null;
  const event: { name: RetentionEventName; at: number; code?: string; ms?: number } = { name, at };
  if (typeof code === "string") event.code = code;
  if (typeof ms === "number") event.ms = Math.min(MAX_MS, Math.round(ms));
  return event;
}

/** The friction events that count as an error a person saw. */
export const ERROR_EVENTS: ReadonlySet<RetentionEventName> = new Set([
  "turn_failed", "cli_failed", "no_api_key", "sign_in_failed", "crash", "renderer_gone", "update_failed",
]);

/**
 * How a CLI agent's turn went wrong, from what the turn reported - never the words
 * themselves. Null when nothing went wrong.
 *
 * `stopped_part_way` is the OpenCode silent stop fixed in 2.6.3: the run asked for a tool
 * and ended without an answer, which the editor now explains in a note.
 */
export function cliFailureOf(input: {
  readonly error: string | null;
  readonly answer: string;
  readonly cancelled: boolean;
}): (typeof CLI_FAILURES)[number] | null {
  if (input.cancelled) return null;
  if (input.error !== null) {
    if (/was not found on this computer/i.test(input.error)) return "missing";
    if (/Sign in by running/i.test(input.error)) return "signed_out";
    return "failed";
  }
  if (/ended its run straight after a tool call|stopped: (?:it was refused permission|in a chat it cannot ask you)/.test(input.answer)) return "stopped_part_way";
  if (input.answer.trim().length === 0) return "empty";
  return null;
}
