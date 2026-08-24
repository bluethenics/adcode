"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { Segmented } from "@/components/ios/Segmented";
import { Donut } from "@/components/charts/Donut";
import { TimeChart } from "@/components/charts/TimeChart";
import { MONEY, seriesColor } from "@/components/charts/palette";
import { money, statusLabel, tone } from "@/components/money";
import {
  apiFetch,
  MESSAGES,
  type AdvertiserView,
  type CampaignView,
  type SeriesPointView,
} from "@/lib/api";
import { PORTAL_TABS } from "./tabs";

type Window = "7" | "30" | "90";

const WINDOWS = [
  { value: "7" as const, label: "7 days" },
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
];

export default function PortalHome() {
  return (
    <AppShell
      title="Campaigns"
      subtitle="What you are spending, and what it is buying"
      tabs={PORTAL_TABS}
    >
      <PortalBody />
    </AppShell>
  );
}

/** The last `count` UTC days, oldest first - the calendar every chart is drawn over. */
function calendar(count: number): string[] {
  const today = Date.now();
  return Array.from({ length: count }, (_, index) =>
    new Date(today - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

function PortalBody() {
  const { token } = useAuth();

  const [advertiser, setAdvertiser] = useState<AdvertiserView | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignView[]>([]);
  const [series, setSeries] = useState<SeriesPointView[]>([]);
  const [window, setWindow] = useState<Window>("30");
  const [state, setState] = useState<"loading" | "ready" | "signup" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await token();
    const found = await apiFetch<AdvertiserView>({ path: "/portal/advertiser", token: t });

    if (!found.ok) {
      // "No advertiser yet" is the sign-up path, not an error to apologise for - and it
      // now sends people straight into the one screen that creates everything at once.
      if (found.error === "no-advertiser") {
        setState("signup");
        return;
      }
      setError(MESSAGES[found.error]);
      setState("error");
      return;
    }

    setAdvertiser(found.value);

    const [list, points] = await Promise.all([
      apiFetch<CampaignView[]>({ path: "/portal/campaigns", token: t }),
      apiFetch<SeriesPointView[]>({ path: `/portal/series?days=${window}`, token: t }),
    ]);

    if (list.ok) setCampaigns(list.value);
    if (points.ok) setSeries(points.value);
    setState("ready");
  }, [token, window]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => calendar(Number(window)), [window]);

  /** The series rolled up across campaigns, one value per day of the calendar. */
  const totals = useMemo(() => {
    const views = new Map<string, number>();
    const clicks = new Map<string, number>();
    const spend = new Map<string, number>();

    for (const point of series) {
      views.set(point.day, (views.get(point.day) ?? 0) + point.impressions);
      clicks.set(point.day, (clicks.get(point.day) ?? 0) + point.clicks);
      spend.set(point.day, (spend.get(point.day) ?? 0) + Number(point.spentMicros) / 1_000_000);
    }

    return {
      views: days.map((day) => views.get(day) ?? 0),
      clicks: days.map((day) => clicks.get(day) ?? 0),
      spend: days.map((day) => spend.get(day) ?? 0),
    };
  }, [series, days]);

  if (state === "loading") {
    return (
      <>
        <div className="skeleton skeleton-tiles" />
        <div className="skeleton skeleton-card" />
      </>
    );
  }

  if (state === "error") {
    return (
      <div className="notice" data-tone="error" role="alert">
        {error}
      </div>
    );
  }

  if (state === "signup") {
    return (
      <div className="empty">
        <h3>Start your first campaign</h3>
        <p>
          One screen: your logo, your message, a budget. Your advertiser account is created
          along with the campaign — there is no separate sign-up to get through first.
        </p>
        <div className="actions" style={{ justifyContent: "center" }}>
          <Link href="/portal/campaigns/new" className="btn btn-primary">
            Create a campaign
          </Link>
        </div>
      </div>
    );
  }

  const live = campaigns.filter((c) => c.status === "active").length;
  const viewTotal = totals.views.reduce((sum, value) => sum + value, 0);
  const clickTotal = totals.clicks.reduce((sum, value) => sum + value, 0);
  const spentTotal = totals.spend.reduce((sum, value) => sum + value, 0);

  return (
    <>
      <div className="ios-card hero-balance">
        <span className="hero-balance-label">Available to commit</span>
        <strong className="hero-figure money">{money(advertiser?.availableMicros ?? "0")}</strong>
        <span className="hero-balance-sub">
          {money(advertiser?.reservedMicros ?? "0")} committed to live campaigns ·{" "}
          {money(advertiser?.fundedMicros ?? "0")} funded all time
        </span>
        <div className="actions" style={{ marginTop: 18 }}>
          <Link href="/portal/campaigns/new" className="btn btn-primary btn-small">
            New campaign
          </Link>
          <Link href="/portal/billing" className="btn btn-outline btn-small">
            Add funds
          </Link>
        </div>
      </div>

      <div className="filter-row">
        <Segmented label="Reporting window" value={window} options={WINDOWS} onChange={setWindow} />
      </div>

      <div className="ios-tiles">
        <Tile label="Verified views" value={viewTotal.toLocaleString("en-US")} hint={`Last ${window} days`} />
        <Tile
          label="Clicks"
          value={clickTotal.toLocaleString("en-US")}
          hint={viewTotal === 0 ? "—" : `${((clickTotal / viewTotal) * 100).toFixed(2)}% of views`}
        />
        <Tile label="Spent" value={`$${spentTotal.toFixed(2)}`} hint={`Last ${window} days`} money />
        <Tile label="Live campaigns" value={String(live)} hint={`${campaigns.length} total`} />
      </div>

      <section className="ios-card">
        <header className="ios-card-head">
          <h2>Views and clicks</h2>
          <p>Only verified views appear here, because only verified views bill.</p>
        </header>
        <TimeChart
          days={days}
          height={240}
          summary={`Views and clicks per day over ${window} days: ${viewTotal} views, ${clickTotal} clicks.`}
          series={[
            { label: "Views", color: seriesColor(0), values: totals.views },
            { label: "Clicks", color: seriesColor(1), values: totals.clicks },
          ]}
        />
      </section>

      {/*
        Spend is a separate chart rather than a second axis on the one above. A dual axis
        lets whoever drew it decide which line looks like it is winning, and views and
        dollars are three orders of magnitude apart.
      */}
      <section className="ios-card">
        <header className="ios-card-head">
          <h2>Spend</h2>
          <p>Charged as receipts are verified. Serving stops the moment a budget is out.</p>
        </header>
        <TimeChart
          days={days}
          area
          height={200}
          summary={`Spend per day over ${window} days, totalling $${spentTotal.toFixed(2)}.`}
          series={[
            {
              label: "Spent",
              color: MONEY,
              values: totals.spend,
              format: (value) => `$${value.toFixed(2)}`,
            },
          ]}
        />
      </section>

      {campaigns.length === 0 ? (
        <div className="empty">
          <h3>No campaigns yet</h3>
          <p>
            A campaign holds your budget, your card, and who sees it. One screen creates all
            three.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <Link href="/portal/campaigns/new" className="btn btn-primary btn-small">
              Create your first campaign
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="ios-split">
            <section className="ios-card">
              <header className="ios-card-head">
                <h2>Where the money went</h2>
                <p>Spend by campaign, over the last {window} days.</p>
              </header>
              <Donut
                summary={`Spend by campaign over ${window} days, totalling $${spentTotal.toFixed(2)}.`}
                centerValue={`$${spentTotal.toFixed(2)}`}
                centerLabel={`in ${window} days`}
                slices={campaigns.map((campaign) => {
                  const spent = series
                    .filter((point) => point.campaignId === campaign.campaignId)
                    .reduce((sum, point) => sum + Number(point.spentMicros) / 1_000_000, 0);
                  return {
                    label: campaign.name,
                    value: spent,
                    display: `$${spent.toFixed(2)}`,
                  };
                })}
              />
            </section>

            <section className="ios-card">
              <header className="ios-card-head">
                <h2>Budget used</h2>
                <p>Lifetime, per campaign.</p>
              </header>
              <ul className="meter-list">
                {campaigns.map((campaign) => {
                  const budget = Number(BigInt(campaign.budgetMicros) / 1000n);
                  const spent = Number(BigInt(campaign.spentMicros) / 1000n);
                  const percent = budget === 0 ? 0 : Math.min(100, (spent / budget) * 100);

                  return (
                    <li key={campaign.campaignId}>
                      <span className="meter-head">
                        <span>{campaign.name}</span>
                        <b className="money">{money(campaign.spentMicros)}</b>
                      </span>
                      <span className="meter-track">
                        <span
                          className="meter-fill"
                          style={{
                            width: `${percent}%`,
                            // The fill carries severity: green while there is room,
                            // amber as it runs out, because a campaign about to stop
                            // serving is something to notice before it does.
                            background: percent > 90 ? "var(--warn)" : MONEY,
                          }}
                        />
                      </span>
                      <span className="meter-foot">
                        {percent.toFixed(0)}% of {money(campaign.budgetMicros)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

          <section>
            <h2 className="section-title">All campaigns</h2>
            <div className="rows">
              <div className="row row-head">
                <span className="row-main">Campaign</span>
                <span className="row-num">Views</span>
                <span className="row-num">Clicks</span>
                <span className="row-num">Spent</span>
              </div>
              {campaigns.map((campaign, index) => (
                <Link
                  key={campaign.campaignId}
                  href={`/portal/campaigns/${campaign.campaignId}`}
                  className="row"
                >
                  <span className="row-main">
                    <span className="row-title">
                      <i className="row-dot" style={{ background: seriesColor(index) }} aria-hidden="true" />
                      {campaign.name}
                    </span>
                    <span className="row-sub">
                      <span className="pill" data-tone={tone(campaign.status)}>
                        {statusLabel(campaign.status)}
                      </span>{" "}
                      {money(campaign.budgetMicros)} budget ·{" "}
                      {campaign.targetTags.length === 0
                        ? "everyone"
                        : `${campaign.targetTags.length} tag${campaign.targetTags.length === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="row-num mono">{campaign.impressions.toLocaleString("en-US")}</span>
                  <span className="row-num mono">{campaign.clicks.toLocaleString("en-US")}</span>
                  <span className="row-num mono">{money(campaign.spentMicros)}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
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
