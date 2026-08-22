"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type CampaignView, type CreativeView } from "@/lib/api";
import { money, statusLabel, tone } from "@/components/money";
import { PORTAL_TABS } from "../../tabs";
import { CreativeForm } from "./CreativeForm";

export default function CampaignDetail() {
  return (
    <AppShell title="Campaign" tabs={PORTAL_TABS}>
      <CampaignBody />
    </AppShell>
  );
}

function CampaignBody() {
  const params = useParams<{ id: string }>();
  const campaignId = params.id;
  const { token } = useAuth();

  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [creatives, setCreatives] = useState<CreativeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await token();

    // There is no single-campaign GET; the list is the source and this filters it. One
    // endpoint fewer to secure, and the list is already scoped to the caller.
    const list = await apiFetch<CampaignView[]>({ path: "/portal/campaigns", token: t });
    if (!list.ok) {
      setError(MESSAGES[list.error]);
      setLoading(false);
      return;
    }

    setCampaign(list.value.find((c) => c.campaignId === campaignId) ?? null);

    const found = await apiFetch<CreativeView[]>({
      path: `/portal/campaigns/${encodeURIComponent(campaignId)}/creatives`,
      token: t,
    });
    if (found.ok) setCreatives(found.value);

    setLoading(false);
  }, [token, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (status: "active" | "paused" | "ended") => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await apiFetch<CampaignView>({
      path: `/portal/campaigns/${encodeURIComponent(campaignId)}/status`,
      token: await token(),
      method: "POST",
      body: { status },
    });

    setBusy(false);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setCampaign(result.value);
  };

  if (loading) return <p className="lede">Loading…</p>;

  if (campaign === null) {
    return (
      <div className="empty">
        <h3>Campaign not found</h3>
        <p>It may have been removed, or it belongs to another account.</p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <Link href="/portal" className="btn btn-outline btn-small">
            Back to campaigns
          </Link>
        </div>
      </div>
    );
  }

  const approved = creatives.filter((c) => c.status === "approved").length;
  const remaining = BigInt(campaign.budgetMicros) - BigInt(campaign.spentMicros);

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="app-head" style={{ marginTop: -8 }}>
        <div>
          <h2 style={{ fontSize: 22 }}>{campaign.name}</h2>
          <p className="row-sub">
            <span className="pill" data-tone={tone(campaign.status)}>
              {statusLabel(campaign.status)}
            </span>{" "}
            {money(campaign.cpmMicros)} CPM ·{" "}
            {campaign.targetTags.length === 0 ? "everyone" : campaign.targetTags.join(", ")}
          </p>
        </div>

        <div className="actions" style={{ marginTop: 0 }}>
          {campaign.status === "active" ? (
            <button className="btn btn-outline btn-small" disabled={busy} onClick={() => void setStatus("paused")}>
              Pause
            </button>
          ) : (
            campaign.status !== "ended" && (
              <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void setStatus("active")}>
                Set live
              </button>
            )
          )}
          {campaign.status !== "ended" && (
            <button className="btn btn-outline btn-small" disabled={busy} onClick={() => void setStatus("ended")}>
              End
            </button>
          )}
        </div>
      </div>

      {campaign.status !== "active" && approved === 0 && (
        <div className="notice" data-tone="info">
          This campaign needs an approved creative before it can go live. Add one below —
          we review creatives before they reach anyone&apos;s editor.
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Views</span>
          <span className="stat-value">{campaign.impressions.toLocaleString("en-US")}</span>
          <span className="stat-hint">Verified, billed</span>
        </div>
        <div className="stat">
          <span className="stat-label">Clicks</span>
          <span className="stat-value">{campaign.clicks.toLocaleString("en-US")}</span>
          <span className="stat-hint">
            {campaign.impressions === 0
              ? "—"
              : `${((campaign.clicks / campaign.impressions) * 100).toFixed(2)}% of views`}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Spent</span>
          <span className="stat-value">{money(campaign.spentMicros)}</span>
          <span className="stat-hint">of {money(campaign.budgetMicros)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Remaining</span>
          <span className="stat-value">{money(remaining.toString())}</span>
          <span className="stat-hint">Serving stops at zero</span>
        </div>
      </div>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Creatives</h3>

      {creatives.length === 0 ? (
        <div className="empty" style={{ marginBottom: 24 }}>
          <h3>No creative yet</h3>
          <p>A creative is the card developers actually see. Add one to get started.</p>
        </div>
      ) : (
        <div className="rows" style={{ marginBottom: 24 }}>
          {creatives.map((creative) => (
            <div key={creative.creativeId} className="row">
              <span className="row-main">
                <span className="row-title">{creative.headline}</span>
                <span className="row-sub">
                  <span className="pill" data-tone={tone(creative.status)}>
                    {statusLabel(creative.status)}
                  </span>{" "}
                  {creative.advertiser}
                  {creative.body === null ? "" : ` · ${creative.body}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <CreativeForm campaignId={campaignId} onCreated={() => void load()} />
    </>
  );
}
