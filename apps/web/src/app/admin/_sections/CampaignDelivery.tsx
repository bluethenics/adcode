"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { moneyExact, statusLabel } from "@/components/money";
import { apiFetch, MESSAGES, type CampaignView } from "@/lib/api";

export function CampaignDelivery({ advertiserId }: { advertiserId: string }) {
  const { token } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const result = await apiFetch<{ campaigns: CampaignView[] }>({
          path: `/admin/advertisers/${encodeURIComponent(advertiserId)}/campaigns`, token: await token(),
        });
        if (!active) return;
        if (result.ok) { setCampaigns(result.value.campaigns); setError(null); }
        else setError(MESSAGES[result.error]);
      } catch {
        if (active) setError(MESSAGES.offline);
      } finally { running = false; }
    };
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    const timer = globalThis.setInterval(refreshVisible, 30_000);
    globalThis.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
      globalThis.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [advertiserId, token, refresh]);

  return (
    <section className="card" aria-label="Campaign delivery">
      <div className="admin-toolbar">
        <strong>Campaign delivery</strong>
        <span className="field-hint">Lifetime totals · Updates every 30 seconds</span>
        <button type="button" className="btn btn-outline btn-small" onClick={() => setRefresh((value) => value + 1)}>Refresh</button>
      </div>
      <p className="field-hint">Views and spend come from accepted ad receipts. Ad fetches include cards that were never displayed. Test views can appear in the totals but never add spend.</p>
      {error !== null && <p role="alert">Could not refresh campaign delivery. {error} {campaigns !== null && "Showing the last loaded totals."}</p>}
      {campaigns === null && error === null && <p role="status">Loading campaign delivery…</p>}
      {campaigns?.length === 0 && <p>No campaigns for this advertiser.</p>}
      {campaigns?.map((campaign) => (
        <div className="row" key={campaign.campaignId}>
          <span className="row-main">
            <span className="row-title">{campaign.name}</span>
            <span className="row-sub">{statusLabel(campaign.status)} · {campaign.serves.toLocaleString("en-US")} ad fetches</span>
          </span>
          <span className="row-num mono">{campaign.impressions.toLocaleString("en-US")} verified views</span>
          <span className="row-num mono">{campaign.clicks.toLocaleString("en-US")} clicks</span>
          <span className="row-num mono">{moneyExact(campaign.spentMicros)} spent</span>
        </div>
      ))}
    </section>
  );
}
