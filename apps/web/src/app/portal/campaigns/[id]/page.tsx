"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { MONEY, seriesColor } from "@/components/charts/palette";
import { money, statusLabel, tone } from "@/components/money";
import {
  apiFetch,
  MESSAGES,
  type CampaignView,
  type CreativeView,
  type SeriesPointView,
} from "@/lib/api";
import { PORTAL_TABS } from "../../tabs";
import { CreativeForm } from "./CreativeForm";

export default function CampaignDetail() {
  return (
    <AppShell title="Campaign" tabs={PORTAL_TABS}>
      <CampaignBody />
    </AppShell>
  );
}

function calendar(count: number): string[] {
  const today = Date.now();
  return Array.from({ length: count }, (_, index) =>
    new Date(today - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

function CampaignBody() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const campaignId = params.id;
  const justCreated = search.get("created") === "1";
  const { token } = useAuth();

  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [creatives, setCreatives] = useState<CreativeView[]>([]);
  const [series, setSeries] = useState<SeriesPointView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const t = await token();

    // There is no single-campaign GET; the list is the source and this filters it. One
    // endpoint fewer to secure, and the list is already scoped to the caller.
    const [list, found, points] = await Promise.all([
      apiFetch<CampaignView[]>({ path: "/portal/campaigns", token: t }),
      apiFetch<CreativeView[]>({
        path: `/portal/campaigns/${encodeURIComponent(campaignId)}/creatives`,
        token: t,
      }),
      apiFetch<SeriesPointView[]>({ path: "/portal/series?days=30", token: t }),
    ]);

    if (!list.ok) {
      setError(MESSAGES[list.error]);
      setLoading(false);
      return;
    }

    setCampaign(list.value.find((c) => c.campaignId === campaignId) ?? null);
    if (found.ok) setCreatives(found.value);
    if (points.ok) setSeries(points.value.filter((point) => point.campaignId === campaignId));

    setLoading(false);
  }, [token, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => calendar(30), []);

  const daily = useMemo(() => {
    const views = new Map(series.map((point) => [point.day, point.impressions]));
    const clicks = new Map(series.map((point) => [point.day, point.clicks]));
    const spend = new Map(series.map((point) => [point.day, Number(point.spentMicros) / 1_000_000]));

    return {
      views: days.map((day) => views.get(day) ?? 0),
      clicks: days.map((day) => clicks.get(day) ?? 0),
      spend: days.map((day) => spend.get(day) ?? 0),
    };
  }, [series, days]);

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

  if (loading) {
    return (
      <>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-tiles" />
      </>
    );
  }

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
  const used =
    campaign.budgetMicros === "0"
      ? 0
      : Number((BigInt(campaign.spentMicros) * 100n) / BigInt(campaign.budgetMicros));

  return (
    <>
      {justCreated && (
        <div className="notice" data-tone="ok">
          Campaign created and your card is in review. We check every card before it reaches
          anyone&apos;s editor — you&apos;ll be able to set this live once it&apos;s approved
          and the budget is funded.
        </div>
      )}

      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="ios-card campaign-head">
        <div>
          <h2>{campaign.name}</h2>
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
            <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => void setStatus("ended")}>
              End
            </button>
          )}
        </div>
      </div>

      {campaign.status !== "active" && approved === 0 && !justCreated && (
        <div className="notice" data-tone="info">
          This campaign needs an approved card before it can go live. Add one below — we
          review cards before they reach anyone&apos;s editor.
        </div>
      )}

      <div className="ios-tiles">
        <Tile label="Views" value={campaign.impressions.toLocaleString("en-US")} hint="Verified, billed" />
        <Tile
          label="Clicks"
          value={campaign.clicks.toLocaleString("en-US")}
          hint={
            campaign.impressions === 0
              ? "—"
              : `${((campaign.clicks / campaign.impressions) * 100).toFixed(2)}% of views`
          }
        />
        <Tile label="Spent" value={money(campaign.spentMicros)} hint={`of ${money(campaign.budgetMicros)}`} money />
        <Tile label="Remaining" value={money(remaining.toString())} hint="Serving stops at zero" money />
      </div>

      <section className="ios-card">
        <header className="ios-card-head">
          <h2>Budget</h2>
          <p>{used}% spent. There is no overrun to argue about afterwards.</p>
        </header>
        <span className="meter-track meter-track-lg">
          <span
            className="meter-fill"
            style={{ width: `${Math.min(100, used)}%`, background: used > 90 ? "var(--warn)" : MONEY }}
          />
        </span>
      </section>

      <section className="ios-card">
        <header className="ios-card-head">
          <h2>Views and clicks</h2>
          <p>Last 30 days. Only verified views appear, because only verified views bill.</p>
        </header>
        <TimeChart
          days={days}
          height={220}
          summary={`Views and clicks per day for ${campaign.name} over 30 days.`}
          series={[
            { label: "Views", color: seriesColor(0), values: daily.views },
            { label: "Clicks", color: seriesColor(1), values: daily.clicks },
          ]}
        />
      </section>

      <section className="ios-card">
        <header className="ios-card-head">
          <h2>Spend</h2>
          <p>Charged as receipts are verified.</p>
        </header>
        <TimeChart
          days={days}
          area
          height={190}
          summary={`Spend per day for ${campaign.name} over 30 days.`}
          series={[
            {
              label: "Spent",
              color: MONEY,
              values: daily.spend,
              format: (value) => `$${value.toFixed(2)}`,
            },
          ]}
        />
      </section>

      <h2 className="section-title">Cards</h2>

      {creatives.length === 0 ? (
        <div className="empty" style={{ marginBottom: 24 }}>
          <h3>No card yet</h3>
          <p>A card is what developers actually see. Add one to get started.</p>
        </div>
      ) : (
        <div className="rows" style={{ marginBottom: 24 }}>
          {creatives.map((creative) => (
            <div key={creative.creativeId} className="row">
              <span className="row-main">
                <span className="row-title">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the stored
                      logo, at its rendered size. */}
                  <img src={creative.logoDark} alt="" className="row-logo" width={26} height={26} />
                  {creative.headline}
                </span>
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

      <CreativeForm
        campaignId={campaignId}
        defaultAdvertiser={creatives[0]?.advertiser ?? ""}
        onCreated={() => void load()}
      />
    </>
  );
}

function Tile({
  label,
  value,
  hint,
  money: isMoney = false,
}: {
  label: string;
  value: string;
  hint: string;
  money?: boolean;
}) {
  return (
    <div className="ios-tile">
      <span className="ios-tile-label">{label}</span>
      <span className={`ios-tile-value${isMoney ? " money" : ""}`}>{value}</span>
      <span className="ios-tile-hint">{hint}</span>
    </div>
  );
}
