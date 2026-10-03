/**
 * The admin growth numbers, computed from rows.
 *
 * Pure, so the in-memory and Firestore stores share one definition of "active" and "shown"
 * with each other - and with `growth_stats` in Postgres, which `test/growth.test.ts` pins to
 * the same cases. Three definitions of a headline number would eventually disagree, and the
 * disagreement would be a figure Sinan posted.
 */
import { utcDay } from "./day.ts";
import type { GrowthDay, GrowthStats, ReceiptRecord, ServeRecord, UserRecord } from "./store.ts";

const DAY_MS = 86_400_000;

export interface GrowthInput {
  now: number;
  users: Iterable<UserRecord>;
  serves: Iterable<ServeRecord>;
  receipts: Iterable<ReceiptRecord>;
  /** One entry per account per UTC day of reported editor activity. */
  activity: Iterable<{ uid: string; day: string }>;
}

/** Midnight UTC of a `YYYY-MM-DD` day. Activity counts from here, so it can only under-count. */
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00.000Z`);

export function summarizeGrowth(input: GrowthInput): GrowthStats {
  const { now } = input;
  const since30 = now - 30 * DAY_MS;

  const seen: { uid: string; at: number }[] = [];
  for (const serve of input.serves) {
    if (serve.test !== true && serve.servedAt > since30) seen.push({ uid: serve.uid, at: serve.servedAt });
  }
  const earliestDay = utcDay(since30);
  for (const row of input.activity) {
    if (row.day >= earliestDay) seen.push({ uid: row.uid, at: dayStart(row.day) });
  }

  const activeSince = (from: number, to = Infinity): number => {
    const uids = new Set<string>();
    for (const row of seen) if (row.at > from && row.at < to) uids.add(row.uid);
    return uids.size;
  };

  const users = [...input.users];
  const paid = [...input.receipts].filter((receipt) => receipt.costMicros > 0n);
  const shown = paid.filter((receipt) => receipt.outcome !== "click").map((receipt) => receipt.createdAt);

  const today = dayStart(utcDay(now));
  const daily: GrowthDay[] = [];
  for (let back = 29; back >= 0; back -= 1) {
    const start = today - back * DAY_MS;
    const end = start + DAY_MS;
    const uids = new Set<string>();
    for (const row of seen) if (row.at >= start && row.at < end) uids.add(row.uid);
    daily.push({
      day: utcDay(start),
      active: uids.size,
      joined: users.filter((user) => user.createdAt >= start && user.createdAt < end).length,
      adsShown: shown.filter((at) => at >= start && at < end).length,
    });
  }

  return {
    developers: users.filter((user) => user.status === "active").length,
    joined7d: users.filter((user) => user.createdAt > now - 7 * DAY_MS).length,
    joined30d: users.filter((user) => user.createdAt > since30).length,
    active1d: activeSince(now - DAY_MS),
    active7d: activeSince(now - 7 * DAY_MS),
    active30d: new Set(seen.map((row) => row.uid)).size,
    adsShown: shown.length,
    adsShown7d: shown.filter((at) => at > now - 7 * DAY_MS).length,
    adsShown30d: shown.filter((at) => at > since30).length,
    clicks: paid.length - shown.length,
    creditedMicros: paid.reduce((total, receipt) => total + receipt.creditedMicros, 0n),
    daily,
  };
}

/** The wire shape: micros as a decimal string, like every other money figure the API sends. */
export function growthToWire(stats: GrowthStats): Omit<GrowthStats, "creditedMicros"> & { creditedMicros: string } {
  return { ...stats, creditedMicros: stats.creditedMicros.toString() };
}
