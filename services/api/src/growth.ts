/**
 * The admin growth numbers, computed from rows.
 *
 * Pure, so the in-memory and Firestore stores share one definition of "seen", "returning"
 * and "shown" with each other - and with `growth_stats` in Postgres, which
 * `test/growth.test.ts` pins to the same cases. Three definitions of a headline number would
 * eventually disagree, and the disagreement would be a figure Sinan posted.
 *
 * **Seen** is anything the editor reports while it is open: a non-test ad fetch, a day of
 * editor activity, or a first-session milestone. A **developer** is an account that has
 * been seen at least once. An account that never was - most were twins made by a sign-up
 * race at first launch, fixed on 2026-10-03 - stays in `accounts` and nowhere else.
 */
import { utcDay } from "./day.ts";
import { MILESTONES } from "./milestones.ts";
import type { GrowthCohort, GrowthDay, GrowthStats, ReceiptRecord, ServeRecord, UserRecord } from "./store.ts";

const DAY_MS = 86_400_000;
const COHORT_WEEKS = 6;

export interface MilestoneRow {
  uid: string;
  name: string;
  firstAt: number;
  lastAt: number;
}

export interface GrowthInput {
  now: number;
  users: Iterable<UserRecord>;
  /** Every serve, not just the window: "ever seen" and "came back" reach back to sign-up. */
  serves: Iterable<ServeRecord>;
  receipts: Iterable<ReceiptRecord>;
  /** One entry per account per UTC day of reported editor activity. */
  activity: Iterable<{ uid: string; day: string }>;
  milestones?: Iterable<MilestoneRow>;
}

/** Midnight UTC of a `YYYY-MM-DD` day. Activity counts from here, so it can only under-count. */
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

/** Every moment an account was seen. Exported so `publicStats` counts developers the same way. */
export function sightings(input: Pick<GrowthInput, "serves" | "activity" | "milestones">): { uid: string; at: number }[] {
  const seen: { uid: string; at: number }[] = [];
  for (const serve of input.serves) if (serve.test !== true) seen.push({ uid: serve.uid, at: serve.servedAt });
  for (const row of input.activity) seen.push({ uid: row.uid, at: dayStart(row.day) });
  for (const row of input.milestones ?? []) {
    seen.push({ uid: row.uid, at: row.firstAt });
    if (row.lastAt !== row.firstAt) seen.push({ uid: row.uid, at: row.lastAt });
  }
  return seen;
}

/** Active-status accounts seen at least once, and the ones of those created in the last week. */
export function countDevelopers(
  now: number,
  users: Iterable<UserRecord>,
  seen: Iterable<{ uid: string }>,
): { developers: number; developersThisWeek: number } {
  const ever = new Set<string>();
  for (const row of seen) ever.add(row.uid);
  const developers = [...users].filter((user) => user.status === "active" && ever.has(user.uid));
  return {
    developers: developers.length,
    developersThisWeek: developers.filter((user) => user.createdAt > now - 7 * DAY_MS).length,
  };
}

export function summarizeGrowth(input: GrowthInput): GrowthStats {
  const { now } = input;
  const since30 = now - 30 * DAY_MS;

  // Read twice below - for sightings and for the funnel - and a store may hand over an
  // iterator, which the first read would use up.
  const milestones = [...(input.milestones ?? [])];
  const allSeen = sightings({ ...input, milestones });
  const users = [...input.users].filter((user) => user.status === "active");
  const createdAt = new Map(users.map((user) => [user.uid, user.createdAt]));

  const lastSeen = new Map<string, number>();
  for (const row of allSeen) lastSeen.set(row.uid, Math.max(lastSeen.get(row.uid) ?? -Infinity, row.at));
  const developers = users.filter((user) => lastSeen.has(user.uid));
  const cameBack = (uid: string, after: number): boolean =>
    (lastSeen.get(uid) ?? -Infinity) >= (createdAt.get(uid) ?? Infinity) + after;

  const seen = allSeen.filter((row) => row.at > since30);
  /** A sighting at least a day after the account was made: somebody who came back. */
  const isReturn = (row: { uid: string; at: number }): boolean =>
    row.at >= (createdAt.get(row.uid) ?? Infinity) + DAY_MS;

  const distinct = (rows: Iterable<{ uid: string }>): number => new Set([...rows].map((row) => row.uid)).size;
  const activeSince = (from: number): number => distinct(seen.filter((row) => row.at > from));
  const returningSince = (from: number): number => distinct(seen.filter((row) => row.at > from && isReturn(row)));

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
      joined: developers.filter((user) => user.createdAt >= start && user.createdAt < end).length,
      adsShown: shown.filter((at) => at >= start && at < end).length,
    });
  }

  const cohorts: GrowthCohort[] = [];
  for (let week = COHORT_WEEKS - 1; week >= 0; week -= 1) {
    const start = today - (7 * week + 6) * DAY_MS;
    const end = start + 7 * DAY_MS;
    const joined = developers.filter((user) => user.createdAt >= start && user.createdAt < end);
    cohorts.push({
      weekStart: utcDay(start),
      joined: joined.length,
      back1d: joined.filter((user) => cameBack(user.uid, DAY_MS)).length,
      back7d: joined.filter((user) => cameBack(user.uid, 7 * DAY_MS)).length,
    });
  }

  const recent = new Set(developers.filter((user) => user.createdAt > since30).map((user) => user.uid));
  const reached = new Map<string, Set<string>>();
  for (const row of milestones) {
    if (!recent.has(row.uid)) continue;
    const set = reached.get(row.name) ?? new Set<string>();
    set.add(row.uid);
    reached.set(row.name, set);
  }

  return {
    accounts: users.length,
    developers: developers.length,
    joined7d: developers.filter((user) => user.createdAt > now - 7 * DAY_MS).length,
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
    daily,
    cohorts,
    funnel: {
      base: recent.size,
      steps: MILESTONES.map((name) => ({ name, accounts: reached.get(name)?.size ?? 0 })),
    },
  };
}

/** The wire shape: micros as a decimal string, like every other money figure the API sends. */
export function growthToWire(stats: GrowthStats): Omit<GrowthStats, "creditedMicros"> & { creditedMicros: string } {
  return { ...stats, creditedMicros: stats.creditedMicros.toString() };
}
