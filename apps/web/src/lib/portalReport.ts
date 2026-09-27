import {
  apiFetch,
  type AdvertiserView,
  type ApiResult,
  type CampaignView,
  type SeriesPointView,
} from "./api";

export interface PortalReport {
  advertiser: AdvertiserView;
  campaigns: CampaignView[];
  series: SeriesPointView[];
}

/** Publish a complete report, never turn a failed statistics request into zero views. */
export async function loadPortalReport(
  token: string | null,
  days: string,
): Promise<ApiResult<PortalReport>> {
  const advertiser = await apiFetch<AdvertiserView>({ path: "/portal/advertiser", token });
  if (!advertiser.ok) return advertiser;

  const [campaigns, series] = await Promise.all([
    apiFetch<CampaignView[]>({ path: "/portal/campaigns", token }),
    apiFetch<SeriesPointView[]>({ path: `/portal/series?days=${days}`, token }),
  ]);
  if (!campaigns.ok) return campaigns;
  if (!series.ok) return series;

  return {
    ok: true,
    value: { advertiser: advertiser.value, campaigns: campaigns.value, series: series.value },
  };
}
