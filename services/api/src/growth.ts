/**
 * The admin growth numbers, computed from rows.
 *
 * Pure, so the in-memory and Firestore stores share one definition of "seen", "returning"
 * and "shown" with each other - and with `growth_stats` in Postgres, which
 * `test/growth.test.ts` pins to the same cases. Three definitions of a headline number would
 * eventually disagree, and the disagreement would be a figure Sinan posted.
 *
 * **Seen** is anything the editor reports while it is open: a non-test ad fetch, a flush of
 * editor activity, or a first-session milestone. A **developer** is an account that has
 * been seen at least once. An account that never was - most were twins made by a sign-up
 * race at first launch, fixed on 2026-10-03, and the rest are web-only accounts such as
 * advertisers - stays in `accounts` and nowhere else.
 *
 * A developer **joins** the first time they are seen, not when the account was made. The two
 * are moments apart for a desktop install, but somebody who signs in on the website and opens
 * the editor three days later is a new developer on the third day - counting from the account
 * would have called their first visit a return.
 */
import { utcDay } from "./day.ts";
import { MILESTONES } from "./milestones.ts";
import type { GrowthCohort, GrowthDay, GrowthStats, ReceiptRecord, ServeRecord, UserRecord } from "./store.ts";

const DAY_MS = 86_400_000;
const COHORT_WEEKS = 6;

/** How long after a developer is first seen still counts as their first day. */
export const FIRST_DAY_MS = DAY_MS;

/**
 * The main path through a first day, in order. Each step counts somebody only if they reached
 * it after the one before, inside their first day, so the numbers can only fall step to step.
 * The milestones left out are alternatives (skip or finish the welcome, three ways to connect
 * AI) or detours (an AI error), shown on their own rather than forced into a line.
 */
export const FIRST_DAY_JOURNEY = ["welcome_shown", "prompt_sent", "turn_ok", "preview_opened"] as const;

export interface MilestoneRow {
  uid: string;
  name: string;
  firstAt: number;
  lastAt: number;
}

/** The first and last moment an account was seen on one UTC day. */
export interface PresenceRow {
  uid: string;
  day: string;
  firstAt: number;
  lastAt: number;
}

/**
 * One account's editor activity for one UTC day. `firstAt` and `lastAt` are when the first
 * and the latest flush for that day arrived; a store that predates them leaves them out, and
 * the day then counts from its start.
 */
export interface ActivityRow {
  uid: string;
  day: string;
  firstAt?: number | null;
  lastAt?: number | null;
}

export interface GrowthInput {
  now: number;
  users: Iterable<UserRecord>;
  /** Every serve, not just the window: "ever seen" and "came back" reach back to sign-up. */
  serves: Iterable<ServeRecord>;
  receipts: Iterable<ReceiptRecord>;
  /** One entry per account per UTC day of reported editor activity. */
  activity: Iterable<ActivityRow>;
  milestones?: Iterable<MilestoneRow>;
  /** Each UTC day a milestone was reported on - the days between the first and the last. */
  milestoneDays?: Iterable<PresenceRow>;
  /** Withdrawals, for what has actually been paid out as opposed to credited. */
  withdrawals?: Iterable<{ amountMicros: bigint; status: string }>;
}

/** Midnight UTC of a `YYYY-MM-DD` day. */
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

/** A moment inside `day`: the time itself if it falls on that day, else the nearer edge. */
const withinDay = (day: string, at: number): number => {
  const start = dayStart(day);
  return Math.min(Math.max(at, start), start + DAY_MS - 1);
};

/**
 * Every moment an account was seen. Exported so `publicStats` counts developers the same way.
 *
 * Activity is a day, not a moment, so it is placed at the arrival of the day's first flush
 * (kept inside that day, where the work was done) and again at the latest flush. The latest
 * flush is a real moment the editor was open, which is what a rolling "last 24 hours" needs;
 * counting the day from midnight dropped yesterday evening's work from that window hours
 * early.
 */
export function sightings(input: Pick<GrowthInput, "serves" | "activity" | "milestones" | "milestoneDays">): { uid: string; at: number }[] {
  const seen: { uid: string; at: number }[] = [];
  const both = (uid: string, first: number, last: number): void => {
    seen.push({ uid, at: first });
    if (last !== first) seen.push({ uid, at: last });
  };
  for (const serve of input.serves) if (serve.test !== true) seen.push({ uid: serve.uid, at: serve.servedAt });
  for (const row of input.activity) {
    const last = row.lastAt ?? null;
    if (last === null) seen.push({ uid: row.uid, at: dayStart(row.day) });
    else both(row.uid, withinDay(row.day, row.firstAt ?? last), last);
  }
  for (const row of input.milestones ?? []) both(row.uid, row.firstAt, row.lastAt);
  for (const row of input.milestoneDays ?? []) both(row.uid, row.firstAt, row.lastAt);
  return seen;
}

/** The first and last moment each account was seen. */
function span(seen: Iterable<{ uid: string; at: number }>): Map<string, { first: number; last: number }> {
  const spans = new Map<string, { first: number; last: number }>();
  for (const row of seen) {
    const current = spans.get(row.uid);
    if (current === undefined) spans.set(row.uid, { first: row.at, last: row.at });
    else {
      current.first = Math.min(current.first, row.at);
      current.last = Math.max(current.last, row.at);
    }
  }
  return spans;
}

/** Active-status accounts seen at least once, and the ones of those first seen in the last week. */
export function countDevelopers(
  now: number,
  users: Iterable<UserRecord>,
  seen: Iterable<{ uid: string; at: number }>,
): { developers: number; developersThisWeek: number } {
  const spans = span(seen);
  const developers = [...users].filter((user) => user.status === "active" && spans.has(user.uid));
  return {
    developers: developers.length,
    developersThisWeek: developers.filter((user) => spans.get(user.uid)!.first > now - 7 * DAY_MS).length,
  };
}

/** Midnight UTC on the Monday of the week `at` falls in. Cohort weeks are calendar weeks. */
export function weekStart(at: number): number {
  const day = dayStart(utcDay(at));
  const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return day - weekday * DAY_MS;
}

/**
 * When a milestone happened inside `[after, until]`, or null if neither recorded time did.
 * Only the first and the latest time are kept per milestone, so a time between them that
 * would also qualify is invisible - this can under-count a step, never over-count one.
 */
export function occurrence(row: { firstAt: number; lastAt: number } | undefined, after: number, until: number): number | null {
  if (row === undefined) return null;
  if (row.firstAt >= after && row.firstAt <= until) return row.firstAt;
  if (row.lastAt >= after && row.lastAt <= until) return row.lastAt;
  return null;
}

export function summarizeGrowth(input: GrowthInput): GrowthStats {
  const { now } = input;
  const since30 = now - 30 * DAY_MS;

  // Read twice below - for sightings and for the funnel - and a store may hand over an
  // iterator, which the first read would use up.
  const milestones = [...(input.milestones ?? [])];
  const allSeen = sightings({ ...input, milestones });
  const spans = span(allSeen);
  const users = [...input.users].filter((user) => user.status === "active");

  const developers = users.filter((user) => spans.has(user.uid));
  const firstSeen = (uid: string): number => spans.get(uid)?.first ?? Infinity;
  const cameBack = (uid: string, after: number): boolean => {
    const known = spans.get(uid);
    return known !== undefined && known.last >= known.first + after;
  };

  const seen = allSeen.filter((row) => row.at > since30);
  /** A sighting at least a day after the account was first seen: somebody who came back. */
  const isReturn = (row: { uid: string; at: number }): boolean => row.at >= firstSeen(row.uid) + DAY_MS;

  const distinct = (rows: Iterable<{ uid: string }>): number => new Set([...rows].map((row) => row.uid)).size;
  const activeSince = (from: number): number => distinct(seen.filter((row) => row.at > from));
  const returningSince = (from: number): number => distinct(seen.filter((row) => row.at > from && isReturn(row)));
  const joinedBetween = (start: number, end: number): number =>
    developers.filter((user) => firstSeen(user.uid) >= start && firstSeen(user.uid) < end).length;

  const paid = [...input.receipts].filter((receipt) => receipt.costMicros > 0n);
  const shown = paid.filter((receipt) => receipt.outcome !== "click").map((receipt) => receipt.createdAt);

  const today = dayStart(utcDay(now));
  const daily: GrowthDay[] = [];
  for (let back = 29; back >= 0; back -= 1) {
    const start = today - back * DAY_MS;
    const end = start + DAY_MS;
    const that = seen.filter((row) => row.at >= start && row.at < end);
    daily.push({
      day: utcDay(start),
      active: distinct(that),
      returning: distinct(that.filter(isReturn)),
      joined: joinedBetween(start, end),
      adsShown: shown.filter((at) => at >= start && at < end).length,
    });
  }

  // Calendar weeks, Monday first, so a week keeps the same people from one report to the
  // next. Weeks counted back from today moved every day, and two reports a day apart were
  // comparing different groups.
  const thisWeek = weekStart(now);
  const cohorts: GrowthCohort[] = [];
  for (let week = COHORT_WEEKS - 1; week >= 0; week -= 1) {
    const start = thisWeek - week * 7 * DAY_MS;
    const joined = developers.filter((user) => firstSeen(user.uid) >= start && firstSeen(user.uid) < start + 7 * DAY_MS);
    cohorts.push({
      weekStart: utcDay(start),
      joined: joined.length,
      back1d: joined.filter((user) => cameBack(user.uid, DAY_MS)).length,
      back7d: joined.filter((user) => cameBack(user.uid, 7 * DAY_MS)).length,
    });
  }

  // The first day: milestones reached within a day of being first seen. One reached on day
  // three is a later session, and counting it here made the first day look better than it was.
  const recent = new Map(developers.filter((user) => firstSeen(user.uid) > since30).map((user) => [user.uid, firstSeen(user.uid)]));
  const byAccount = new Map<string, Map<string, MilestoneRow>>();
  for (const row of milestones) {
    if (!recent.has(row.uid)) continue;
    const mine = byAccount.get(row.uid) ?? new Map<string, MilestoneRow>();
    mine.set(row.name, row);
    byAccount.set(row.uid, mine);
  }
  const reached = new Map<string, number>();
  const journey = FIRST_DAY_JOURNEY.map(() => 0);
  for (const [uid, first] of recent) {
    const mine = byAccount.get(uid);
    const until = first + FIRST_DAY_MS;
    for (const row of mine?.values() ?? []) {
      if (occurrence(row, first, until) !== null) reached.set(row.name, (reached.get(row.name) ?? 0) + 1);
    }
    let after = first;
    for (const [index, name] of FIRST_DAY_JOURNEY.entries()) {
      const at = occurrence(mine?.get(name), after, until);
      if (at === null) break;
      journey[index] = journey[index]! + 1;
      after = at;
    }
  }

  return {
    accounts: users.length,
    developers: developers.length,
    joined7d: developers.filter((user) => firstSeen(user.uid) > now - 7 * DAY_MS).length,
    joined30d: recent.size,
    active1d: activeSince(now - DAY_MS),
    active7d: activeSince(now - 7 * DAY_MS),
    active30d: distinct(seen),
    returning1d: returningSince(now - DAY_MS),
    returning7d: returningSince(now - 7 * DAY_MS),
    adsShown: shown.length,
    adsShown7d: shown.filter((at) => at > now - 7 * DAY_MS).length,
    adsShown30d: shown.filter((at) => at > since30).length,
    clicks: paid.length - shown.length,
    creditedMicros: paid.reduce((total, receipt) => total + receipt.creditedMicros, 0n),
    paidOutMicros: [...(input.withdrawals ?? [])]
      .filter((withdrawal) => withdrawal.status === "paid")
      .reduce((total, withdrawal) => total + withdrawal.amountMicros, 0n),
    daily,
    cohorts,
    funnel: {
      base: recent.size,
      steps: MILESTONES.map((name) => ({ name, accounts: reached.get(name) ?? 0 })),
      journey: FIRST_DAY_JOURNEY.map((name, index) => ({ name, accounts: journey[index]! })),
    },
  };
}

/** The wire shape: micros as decimal strings, like every other money figure the API sends. */
export function growthToWire(stats: GrowthStats): Omit<GrowthStats, "creditedMicros" | "paidOutMicros"> & { creditedMicros: string; paidOutMicros: string } {
  return { ...stats, creditedMicros: stats.creditedMicros.toString(), paidOutMicros: stats.paidOutMicros.toString() };
}
