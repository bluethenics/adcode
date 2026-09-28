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

/**
 * A campaign row's toggle handler: records which report rows are open.
 *
 * `open` is read while the event is live. React sets `currentTarget` only for the length of
 * the handler, and a state updater can run later, during the next render - reading it there
 * threw "Cannot read properties of null" and took the advertiser's campaign report with it.
 */
export function campaignRowToggle(
  setOpenRows: (updater: (prev: ReadonlySet<string>) => Set<string>) => void,
  campaignId: string,
): (event: { readonly currentTarget: { readonly open: boolean } }) => void {
  return (event) => {
    const open = event.currentTarget.open;
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (open) next.add(campaignId);
      else next.delete(campaignId);
      return next;
    });
  };
}
