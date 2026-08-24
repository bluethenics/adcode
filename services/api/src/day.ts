/**
 * What a day is.
 *
 * One definition, because three places have to agree on it: the in-memory store folds
 * receipts into days in JavaScript, Postgres folds them in `series_for_advertiser`, and
 * the activity endpoint decides which day a flush belongs to. If any two of those
 * disagree about where a day starts, a chart shows a spike on one side of midnight and a
 * hole on the other, and nothing in the test suite would notice.
 *
 * UTC, always. Local time would mean a user who flies to Tokyo gets two Mondays, and a
 * campaign spanning timezones has no single answer to "how much did today cost".
 */

/** Milliseconds since the epoch to 'YYYY-MM-DD' in UTC. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The UTC day `count` days before `ms`. Used to bound a "last 30 days" read. */
export function utcDayBefore(ms: number, count: number): string {
  return utcDay(ms - count * 86_400_000);
}

/** Midnight UTC, `count` days before `ms`. The lower bound of a series query. */
export function startOfDayBefore(ms: number, count: number): number {
  return Date.parse(`${utcDayBefore(ms, count)}T00:00:00.000Z`);
}
