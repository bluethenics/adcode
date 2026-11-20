/**
 * From retention events to answers: per-user facts, a likely reason for leaving, cohorts,
 * the drop-off funnel and friction ranked by how many churned users hit it.
 *
 * This file is the specification. Production runs the same rules in SQL, in the hourly
 * rollup of `supabase/migrations/20261120120000_retention_tracking.sql`, because a summary
 * over a million events has to be built next to the data and cached, not rebuilt per page
 * view. `test/sqlParity.test.ts` replays the same events through both and fails if they ever
 * disagree, so a rule changed here and not there (or the other way round) cannot ship.
 *
 * Pure: every function takes `now` where it needs one, and reads no clock.
 */
import {
  ERROR_EVENTS,
  FRICTION_EVENTS,
  FUNNEL_STEPS,
  type FrictionEvent,
  type FunnelStep,
  type RetentionEvent,
  type RetentionEventName,
} from "./events.ts";

export const DAY_MS = 86_400_000;

/** Churned users and friction look this far back - as far as raw events are kept. */
export const LOOKBACK_DAYS = 90;

/** Cohort table: this many weeks, newest last. */
export const COHORT_WEEKS = 12;

/** "Silent for N days" choices the admin page offers; the rollup caches each. */
export const SILENT_DAY_CHOICES = [3, 7, 14, 30] as const;

/**
 * Likely reasons, most specific first: the first rule that matches is the reason given.
 * Order matters - somebody who crashed and also never applied an edit left because of the
 * crash, not the edit.
 */
export const CHURN_REASONS = [
  "crashed",
  "hit_limit",
  "sign_in_dead_end",
  "no_api_key",
  "first_turn_failed",
  "ai_failing",
  "update_failed",
  "slow_answers",
  "gave_up_waiting",
  "no_project",
  "no_ai_message",
  "no_edit",
  "faded",
] as const;

export type ChurnReason = (typeof CHURN_REASONS)[number];

/** What the admin page says for each reason. */
export const CHURN_REASON_LABELS: { readonly [K in ChurnReason]: string } = {
  crashed: "Crashed, then left",
  hit_limit: "Hit a limit, then left",
  sign_in_dead_end: "Could not get signed in",
  no_api_key: "Needed an API key, never got a working model",
  first_turn_failed: "First AI turn failed, never had one work",
  ai_failing: "AI kept failing in the last session",
  update_failed: "An update failed",
  slow_answers: "Answers were slow in the last session",
  gave_up_waiting: "Cancelled a turn in the last session",
  no_project: "Never opened a project",
  no_ai_message: "Opened a project, never asked the AI",
  no_edit: "AI answered, but no edit was ever applied",
  faded: "No friction recorded - use faded",
};

/** Everything the rules need about one account, folded from its events. */
export interface UserFacts {
  readonly uid: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  /** Distinct UTC days with at least one event. */
  readonly activeDays: number;
  /** Event name → first time it happened. */
  readonly first: Readonly<Record<string, number>>;
  /** Event name → last time it happened. */
  readonly last: Readonly<Record<string, number>>;
  /** `name` and `name:code` → how many times. */
  readonly counts: Readonly<Record<string, number>>;
  readonly lastError: { readonly name: RetentionEventName; readonly code: string | null; readonly at: number } | null;
  readonly lastSession: { readonly code: string | null; readonly ms: number | null; readonly at: number } | null;
  readonly version: string | null;
}

export const dayOf = (at: number): number => Math.floor(at / DAY_MS);

/** Monday of the UTC week holding `day` (1970-01-01, day 0, was a Thursday). */
export const weekStartOf = (day: number): number => day - ((day + 3) % 7 + 7) % 7;

/** `YYYY-MM-DD` for a UTC day number, without reading a clock (civil-from-days). */
export function isoDay(day: number): string {
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** One account's events, in the order they were received. */
export function foldEvents(uid: string, events: readonly RetentionEvent[]): UserFacts | null {
  if (events.length === 0) return null;
  let firstSeenAt = Infinity, lastSeenAt = -Infinity;
  const days = new Set<number>();
  const first: Record<string, number> = {}, last: Record<string, number> = {}, counts: Record<string, number> = {};
  let lastError: UserFacts["lastError"] = null, lastSession: UserFacts["lastSession"] = null;
  let versionAt = -Infinity, version: string | null = null;
  for (const event of events) {
    firstSeenAt = Math.min(firstSeenAt, event.at);
    lastSeenAt = Math.max(lastSeenAt, event.at);
    days.add(dayOf(event.at));
    first[event.name] = Math.min(first[event.name] ?? Infinity, event.at);
    last[event.name] = Math.max(last[event.name] ?? -Infinity, event.at);
    counts[event.name] = (counts[event.name] ?? 0) + 1;
    if (event.code !== undefined) counts[`${event.name}:${event.code}`] = (counts[`${event.name}:${event.code}`] ?? 0) + 1;
    // Ties go to the later event received, as `order by at desc, id desc` does in SQL.
    if (ERROR_EVENTS.has(event.name) && (lastError === null || event.at >= lastError.at)) lastError = { name: event.name, code: event.code ?? null, at: event.at };
    if (event.name === "session_end" && (lastSession === null || event.at >= lastSession.at)) lastSession = { code: event.code ?? null, ms: event.ms ?? null, at: event.at };
    if (event.name === "session_start" && event.at >= versionAt) { versionAt = event.at; version = event.code ?? null; }
  }
  return { uid, firstSeenAt, lastSeenAt, activeDays: days.size, first, last, counts, lastError, lastSession, version };
}

/** The furthest funnel step this account reached, in funnel order, or null for none. */
export function furthestStep(facts: UserFacts): FunnelStep | null {
  let furthest: FunnelStep | null = null;
  for (const step of FUNNEL_STEPS) if (facts.first[step] !== undefined) furthest = step;
  return furthest;
}

/** Why this account most likely stopped coming back, if it has. Independent of `now`. */
export function churnReason(facts: UserFacts): ChurnReason {
  const ever = (name: RetentionEventName): boolean => facts.first[name] !== undefined;
  const recent = (name: RetentionEventName): boolean => (facts.last[name] ?? -Infinity) >= facts.lastSeenAt - DAY_MS;
  if ((facts.lastSession !== null && facts.lastSession.code === "unclean" && facts.lastSession.at >= facts.lastSeenAt - DAY_MS) || recent("crash") || recent("renderer_gone")) return "crashed";
  if (recent("limit_reached")) return "hit_limit";
  if ((ever("sign_in_needed") || ever("sign_in_failed")) && !ever("signed_in") && !ever("ai_turn_ok")) return "sign_in_dead_end";
  if (ever("no_api_key") && !ever("ai_turn_ok")) return "no_api_key";
  if ((ever("turn_failed") || ever("cli_failed")) && !ever("ai_turn_ok")) return "first_turn_failed";
  if (recent("turn_failed") || recent("cli_failed")) return "ai_failing";
  if (recent("update_failed")) return "update_failed";
  if (recent("slow_first_answer")) return "slow_answers";
  if (recent("turn_cancelled")) return "gave_up_waiting";
  if (!ever("project_opened")) return "no_project";
  if (!ever("ai_message")) return "no_ai_message";
  if (!ever("edit_applied") && facts.activeDays <= 2) return "no_edit";
  return "faded";
}

/** In the lookback window and silent for at least `silentDays`. */
export function isChurned(facts: UserFacts, now: number, silentDays: number): boolean {
  return facts.lastSeenAt >= now - LOOKBACK_DAYS * DAY_MS && now - facts.lastSeenAt >= silentDays * DAY_MS;
}

export interface RetentionPoint { readonly eligible: number; readonly retained: number }

export interface RetentionSummary {
  readonly silentDays: number;
  readonly totals: {
    readonly users: number;
    readonly newInstalls: number;
    readonly active1d: number;
    readonly active7d: number;
    readonly active30d: number;
    readonly churned: number;
  };
  /** New installs by the week of their first launch, oldest first. */
  readonly cohorts: readonly {
    readonly weekStart: string;
    readonly users: number;
    readonly d1: RetentionPoint;
    readonly d7: RetentionPoint;
    readonly d30: RetentionPoint;
  }[];
  /** New installs in the lookback window: how many reached each step. */
  readonly funnel: { readonly base: number; readonly steps: readonly { readonly step: string; readonly users: number }[] };
  readonly reasons: readonly { readonly reason: ChurnReason; readonly users: number }[];
  readonly friction: readonly {
    readonly name: FrictionEvent;
    readonly churned: number;
    readonly users: number;
    readonly topCodes: readonly { readonly code: string; readonly churned: number }[];
  }[];
}

/** The two steps after the funnel proper: came back on a later day, and a week or more later. */
export const RETURN_STEPS = ["returned_day1", "returned_day7"] as const;

/**
 * The page's summary, from every account's facts. "Came back on day N" means seen again on
 * UTC day N after the first launch or later; a cohort member counts toward day N only once
 * N days have passed since they started.
 */
export function summarize(users: readonly UserFacts[], now: number, silentDays: number): RetentionSummary {
  const nowDay = dayOf(now);
  const pool = users.filter((user) => user.lastSeenAt >= now - LOOKBACK_DAYS * DAY_MS);
  const churned = pool.filter((user) => isChurned(user, now, silentDays));
  const launched = (user: UserFacts): number | undefined => user.first["first_launch"];

  const thisWeek = weekStartOf(nowDay);
  const cohorts = Array.from({ length: COHORT_WEEKS }, (_, index) => {
    const week = thisWeek - (COHORT_WEEKS - 1 - index) * 7;
    const members = users.filter((user) => launched(user) !== undefined && weekStartOf(dayOf(launched(user)!)) === week);
    const point = (n: number): RetentionPoint => {
      const eligible = members.filter((user) => nowDay - dayOf(launched(user)!) >= n);
      return { eligible: eligible.length, retained: eligible.filter((user) => dayOf(user.lastSeenAt) - dayOf(launched(user)!) >= n).length };
    };
    return { weekStart: isoDay(week), users: members.length, d1: point(1), d7: point(7), d30: point(30) };
  });

  const recentInstalls = users.filter((user) => launched(user) !== undefined && launched(user)! >= now - LOOKBACK_DAYS * DAY_MS);
  const back = (user: UserFacts, n: number): boolean => dayOf(user.lastSeenAt) - dayOf(launched(user)!) >= n;
  const funnel = {
    base: recentInstalls.length,
    steps: [
      ...FUNNEL_STEPS.map((step) => ({ step, users: recentInstalls.filter((user) => user.first[step] !== undefined).length })),
      { step: RETURN_STEPS[0], users: recentInstalls.filter((user) => back(user, 1)).length },
      { step: RETURN_STEPS[1], users: recentInstalls.filter((user) => back(user, 7)).length },
    ],
  };

  const reasonOf = new Map(churned.map((user) => [user.uid, churnReason(user)]));
  const reasons = CHURN_REASONS
    .map((reason, order) => ({ reason, users: churned.filter((user) => reasonOf.get(user.uid) === reason).length, order }))
    .sort((a, b) => b.users - a.users || a.order - b.order)
    .map(({ reason, users: count }) => ({ reason, users: count }));

  const friction = FRICTION_EVENTS
    .map((name, order) => {
      const hit = (user: UserFacts, key: string): boolean => (user.counts[key] ?? 0) > 0;
      const byCode = new Map<string, number>();
      for (const user of churned) {
        for (const key of Object.keys(user.counts)) {
          if (key.startsWith(`${name}:`) && hit(user, key)) byCode.set(key.slice(name.length + 1), (byCode.get(key.slice(name.length + 1)) ?? 0) + 1);
        }
      }
      // Ties by code in byte order - `collate "C"` in the SQL.
      const topCodes = [...byCode]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, 3)
        .map(([code, count]) => ({ code, churned: count }));
      return { name, churned: churned.filter((user) => hit(user, name)).length, users: pool.filter((user) => hit(user, name)).length, topCodes, order };
    })
    .filter((entry) => entry.users > 0)
    .sort((a, b) => b.churned - a.churned || b.users - a.users || a.order - b.order)
    .map(({ order: _order, ...entry }) => entry);

  return {
    silentDays,
    totals: {
      users: pool.length,
      newInstalls: pool.filter((user) => launched(user) !== undefined).length,
      active1d: users.filter((user) => user.lastSeenAt > now - DAY_MS).length,
      active7d: users.filter((user) => user.lastSeenAt > now - 7 * DAY_MS).length,
      active30d: users.filter((user) => user.lastSeenAt > now - 30 * DAY_MS).length,
      churned: churned.length,
    },
    cohorts,
    funnel,
    reasons,
    friction,
  };
}
