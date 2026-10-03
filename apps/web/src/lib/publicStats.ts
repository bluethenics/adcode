export interface PublicStats { impressions: number; clicks: number; activeCampaigns: number; developers: number; developersThisWeek: number; asOf: number }

/**
 * Small early totals undermine the network story they are meant to tell, so the
 * section stays hidden until traction is real. Verified clicks are the gate:
 * impressions can be driven, campaigns come and go, but 2K verified clicks means
 * developers actually clicked.
 */
export const PUBLIC_STATS_MIN_VERIFIED_CLICKS = 2000;

export function meetsPublicStatsThreshold(stats: PublicStats): boolean {
  return stats.clicks >= PUBLIC_STATS_MIN_VERIFIED_CLICKS;
}

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parsePublicStats(value: unknown): PublicStats | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  const keys = ["impressions", "clicks", "activeCampaigns", "developers", "asOf"] as const;
  if (!keys.every((key) => count(data[key]))) return null;
  return {
    impressions: data.impressions as number,
    clicks: data.clicks as number,
    activeCampaigns: data.activeCampaigns as number,
    developers: data.developers as number,
    // Newer than the other fields; an API that predates it reads as "none this week".
    developersThisWeek: count(data.developersThisWeek) ? data.developersThisWeek : 0,
    asOf: data.asOf as number,
  };
}
