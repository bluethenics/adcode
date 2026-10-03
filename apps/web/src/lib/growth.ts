/**
 * The admin growth numbers, and the words that go with them when they are posted.
 *
 * Every figure here is read from `/v1/admin/growth`, which counts real rows. The share
 * card and the post text only choose which true numbers to show - they never round up,
 * pad, or extrapolate, because a number posted on X will be compared against the next one.
 */
import { SITE } from "./site";

export interface GrowthDay { day: string; active: number; joined: number; adsShown: number }

export interface Growth {
  developers: number;
  joined7d: number;
  joined30d: number;
  active1d: number;
  active7d: number;
  active30d: number;
  adsShown: number;
  adsShown7d: number;
  adsShown30d: number;
  clicks: number;
  creditedMicros: bigint;
  daily: GrowthDay[];
  asOf: number;
}

const COUNT_KEYS = ["developers", "joined7d", "joined30d", "active1d", "active7d", "active30d", "adsShown", "adsShown7d", "adsShown30d", "clicks", "asOf"] as const;
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseGrowth(value: unknown): Growth | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  if (!COUNT_KEYS.every((key) => isCount(data[key]))) return null;
  if (typeof data.creditedMicros !== "string" || !/^\d+$/.test(data.creditedMicros)) return null;
  if (!Array.isArray(data.daily)) return null;
  const daily: GrowthDay[] = [];
  for (const row of data.daily as unknown[]) {
    if (typeof row !== "object" || row === null) return null;
    const { day, active, joined, adsShown } = row as Record<string, unknown>;
    if (typeof day !== "string" || !isCount(active) || !isCount(joined) || !isCount(adsShown)) return null;
    daily.push({ day, active, joined, adsShown });
  }
  const counts = Object.fromEntries(COUNT_KEYS.map((key) => [key, data[key] as number])) as Record<(typeof COUNT_KEYS)[number], number>;
  return { ...counts, creditedMicros: BigInt(data.creditedMicros), daily };
}

/** Dollars from micros, to the cent. Rounds down: never claim a cent that was not paid. */
export function dollars(micros: bigint): string {
  const cents = micros / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export type ShareMetric = "developers" | "joined7d" | "joined30d" | "active1d" | "active7d" | "active30d" | "adsShown" | "adsShown30d" | "credited";

export interface ShareLine { metric: ShareMetric; value: string; label: string }

/** Each figure as it reads on a card and in a post: the number, then what it counts. */
export function shareLine(growth: Growth, metric: ShareMetric): ShareLine {
  const n = (value: number) => value.toLocaleString("en-US");
  switch (metric) {
    case "developers": return { metric, value: n(growth.developers), label: "developers on ADCode" };
    case "joined7d": return { metric, value: `+${n(growth.joined7d)}`, label: "joined this week" };
    case "joined30d": return { metric, value: `+${n(growth.joined30d)}`, label: "joined this month" };
    case "active1d": return { metric, value: n(growth.active1d), label: "active today" };
    case "active7d": return { metric, value: n(growth.active7d), label: "active this week" };
    case "active30d": return { metric, value: n(growth.active30d), label: "active this month" };
    case "adsShown": return { metric, value: n(growth.adsShown), label: "sponsored cards shown" };
    case "adsShown30d": return { metric, value: n(growth.adsShown30d), label: "ads shown this month" };
    case "credited": return { metric, value: dollars(growth.creditedMicros), label: "paid to developers" };
  }
}

export const SHARE_METRICS: readonly ShareMetric[] = ["developers", "joined7d", "joined30d", "active1d", "active7d", "active30d", "adsShown", "adsShown30d", "credited"];
export const DEFAULT_SHARE: readonly ShareMetric[] = ["developers", "joined7d", "active30d"];

/** The post, ready for X: the figures, one line of what ADCode is, and the link. */
export function buildPost(growth: Growth, metrics: readonly ShareMetric[]): string {
  const lines = metrics.map((metric) => {
    const line = shareLine(growth, metric);
    return `${line.value} ${line.label}`;
  });
  return ["ADCode, by the numbers:", "", ...lines, "", "The free AI code editor that pays you to build.", SITE.origin.replace(/^https?:\/\//, "")].join("\n");
}

/** X's compose window, prefilled. The person still reads and sends it themselves. */
export function xIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
