export interface PublicStats { impressions: number; clicks: number; activeCampaigns: number; asOf: number }

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

export function parsePublicStats(value: unknown): PublicStats | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as Record<string, unknown>;
  const keys = ["impressions", "clicks", "activeCampaigns", "asOf"] as const;
  if (!keys.every((key) => typeof data[key] === "number" && Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)) return null;
  return { impressions: data.impressions as number, clicks: data.clicks as number, activeCampaigns: data.activeCampaigns as number, asOf: data.asOf as number };
}
