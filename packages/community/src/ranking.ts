/**
 * Trending, creator points, levels, badges and streaks.
 *
 * These are the reasons to come back: what is new and rising this week, how far you are
 * from the next level, which badge is one accepted improvement away, and a streak you do
 * not want to break. All of it is computed from counts the service already keeps, here,
 * so the numbers on the website, the desktop app and the server can never disagree.
 */
import type { CreatorProfile, CreatorTotals } from "./types.ts";

const DAY = 86_400_000;

/**
 * A listing's place in Trending: recent activity, weighted toward what took effort to give
 * (a remix or an improvement beats an install, which beats a star), decaying with age so a
 * good new plugin can overtake an old favourite within a week.
 */
export function trendingScore(input: { readonly weekly: number; readonly stars: number; readonly remixes: number; readonly createdAt: number; readonly updatedAt: number }, now: number): number {
  const ageDays = Math.max(0, (now - input.createdAt) / DAY);
  const freshDays = Math.max(0, (now - input.updatedAt) / DAY);
  const activity = input.weekly * 3 + input.stars * 2 + input.remixes * 4 + 1;
  const newcomer = ageDays < 7 ? 1.5 : 1;
  const updated = freshDays < 3 ? 1.2 : 1;
  return (activity * newcomer * updated) / Math.pow(ageDays + 2, 0.8);
}

export const POINTS = { install: 1, star: 3, remix: 5, acceptedImprovement: 20, plugin: 10, artifact: 10 } as const;

export function creatorPoints(totals: CreatorTotals): number {
  return totals.installs * POINTS.install + totals.stars * POINTS.star + totals.remixes * POINTS.remix +
    totals.acceptedImprovements * POINTS.acceptedImprovement + totals.plugins * POINTS.plugin + totals.artifacts * POINTS.artifact;
}

export const LEVELS = [
  { name: "Newcomer", points: 0 },
  { name: "Tinkerer", points: 25 },
  { name: "Builder", points: 100 },
  { name: "Maker", points: 300 },
  { name: "Craftsperson", points: 1000 },
  { name: "Luminary", points: 3000 },
  { name: "Legend", points: 10000 },
] as const;

export function creatorLevel(points: number): CreatorProfile["level"] {
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i]!.points) index = i;
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1] ?? null;
  const span = next === null ? 1 : next.points - current.points;
  return {
    name: current.name,
    index,
    next: next?.name ?? null,
    toNext: next === null ? 0 : next.points - points,
    progress: next === null ? 1 : Math.min(1, (points - current.points) / span),
  };
}

const BADGES: readonly { readonly id: string; readonly name: string; readonly detail: string; readonly earned: (t: CreatorTotals) => boolean }[] = [
  { id: "first-plugin", name: "First plugin", detail: "Publish a plugin to the directory", earned: (t) => t.plugins >= 1 },
  { id: "first-artifact", name: "Show and tell", detail: "Publish a project artifact", earned: (t) => t.artifacts >= 1 },
  { id: "helper", name: "Helping hand", detail: "Have an improvement accepted", earned: (t) => t.acceptedImprovements >= 1 },
  { id: "ten-installs", name: "Ten installs", detail: "Your plugins reach 10 installs", earned: (t) => t.installs >= 10 },
  { id: "remixed", name: "Remixed", detail: "Somebody remixes your work", earned: (t) => t.remixes >= 1 },
  { id: "starred", name: "Rising star", detail: "Collect 25 stars", earned: (t) => t.stars >= 25 },
  { id: "hundred-installs", name: "Hundred club", detail: "Your plugins reach 100 installs", earned: (t) => t.installs >= 100 },
  { id: "collaborator", name: "Collaborator", detail: "Have 5 improvements accepted", earned: (t) => t.acceptedImprovements >= 5 },
  { id: "streak-7", name: "On a roll", detail: "Create something 7 days in a row", earned: (t) => t.streakDays >= 7 },
  { id: "thousand-installs", name: "Thousand club", detail: "Your plugins reach 1,000 installs", earned: (t) => t.installs >= 1000 },
];

export function creatorBadges(totals: CreatorTotals): CreatorProfile["badges"] {
  return BADGES.map((badge) => ({ id: badge.id, name: badge.name, detail: badge.detail, earned: badge.earned(totals) }));
}

/** Badges earned by going from `before` to `after` - what the service announces in activity. */
export function newlyEarnedBadges(before: CreatorTotals, after: CreatorTotals): string[] {
  return BADGES.filter((badge) => !badge.earned(before) && badge.earned(after)).map((badge) => badge.name);
}

export function creatorProfile(uid: string, name: string, totals: CreatorTotals): CreatorProfile {
  const points = creatorPoints(totals);
  return { uid, name, totals, points, level: creatorLevel(points), badges: creatorBadges(totals) };
}

/** The UTC day number of a timestamp, the unit a streak counts in. */
export const dayNumber = (at: number): number => Math.floor(at / DAY);

/**
 * Consecutive days with activity, ending today or yesterday (a streak survives until the
 * end of the day after the last one, so it does not break while you sleep).
 */
export function streakDays(activeDays: readonly number[], now: number): number {
  const days = new Set(activeDays);
  const today = dayNumber(now);
  let day = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (day === null) return 0;
  let count = 0;
  while (days.has(day)) { count++; day--; }
  return count;
}

/** "1.2k", for counts on cards. */
export function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "3 days ago", for activity and listings. */
export function timeAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const units: readonly [number, string][] = [[60, "minute"], [3600, "hour"], [86_400, "day"], [604_800, "week"], [2_592_000, "month"], [31_536_000, "year"]];
  let chosen: [number, string] = units[0]!;
  for (const unit of units) if (seconds >= unit[0]) chosen = unit;
  const count = Math.floor(seconds / chosen[0]);
  return `${count} ${chosen[1]}${count === 1 ? "" : "s"} ago`;
}

/** Monetization is coming soon; the waitlist records the price a creator would charge. */
export function checkWaitlistPrice(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 500) throw new Error("Choose a price between $0 and $500.");
  return Math.round(value * 100) / 100;
}
