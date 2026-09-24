"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell, SideIcon, type SideNavGroup } from "@/components/AppShell";
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
  type CreativeView,
  type SeriesPointView,
} from "@/lib/api";
import { BillingBody } from "./billing/page";
import { NewCampaignForm } from "./campaigns/new/page";
import { CreativeForm } from "./campaigns/[id]/CreativeForm";

type Window = "7" | "30" | "90";

const WINDOWS = [
  { value: "7" as const, label: "7 days" },
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
];

/**
 * The advertiser portal is one long workspace, and its destinations are the rail on the
 * left. Each item is a section of this page - the sheet on a phone opens to the same
 * list, so the trip from "where am I" to the campaign builder is one tap either way.
 */
const PORTAL_SIDEBAR: SideNavGroup[] = [
  {
    label: "Advertiser",
    items: [
      { href: "/portal", label: "Overview", icon: "grid" },
      { href: "/portal#campaigns", label: "Campaigns", icon: "target" },
      { href: "/portal#credits", label: "Credits", icon: "card" },
      { href: "/portal#new-campaign", label: "New campaign", icon: "plus" },
    ],
  },
];

export default function PortalHome() {
  return (
    <AppShell
      title="Campaigns"
      subtitle="What you are spending, and what it is buying"
      sidebar={PORTAL_SIDEBAR}
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
  // Which campaign rows are unfolded. Cards load only for open rows, so a long list
  // costs one request per row you actually look at rather than one per row you have.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  // One-shot confirmations from redirects: `?created=1` after the builder and
  // `?checkout=success|cancelled` from the payment provider's return URL. Neither is
  // read anywhere else, so without this the moment passes with no confirmation.
  const [announcement, setAnnouncement] = useState<string | null>(null);

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

  useEffect(() => {
    // `globalThis`, not `window`: the reporting-window state above is also called
    // `window` and shadows the global inside this component.
    const params = new URLSearchParams(globalThis.location.search);
    if (params.get("created") === "1") {
      setAnnouncement(
        "Campaign created. Funded campaigns go live by themselves; otherwise one click on Set live below finishes it.",
      );
    } else if (params.get("checkout") === "success") {
      setAnnouncement(
        "Payment received. Your balance updates as soon as it settles, usually within a minute.",
      );
    } else if (params.get("checkout") === "cancelled") {
      setAnnouncement("Checkout was cancelled — nothing was charged. Try again whenever you're ready.");
    }
  }, []);

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
        <NewCampaignForm />
      </div>
    );
  }

  const live = campaigns.filter((c) => c.status === "active").length;
  const viewTotal = totals.views.reduce((sum, value) => sum + value, 0);
  const clickTotal = totals.clicks.reduce((sum, value) => sum + value, 0);
  const spentTotal = totals.spend.reduce((sum, value) => sum + value, 0);

  return (
    <>
      {announcement !== null && (
        <div className="notice" data-tone="ok" role="status">
          {announcement}
          <div className="actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setAnnouncement(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="portal-overview">
        <div className="ios-card hero-balance portal-balance">
          <span className="hero-balance-label">Available to commit</span>
          <strong className="hero-figure money">{money(advertiser?.availableMicros ?? "0")}</strong>
          <span className="hero-balance-sub">
            {money(advertiser?.reservedMicros ?? "0")} committed to live campaigns ·{" "}
            {money(advertiser?.fundedMicros ?? "0")} funded all time
          </span>
          <div className="actions" style={{ marginTop: 18 }}>
            <a href="#new-campaign" className="btn btn-primary btn-small">New campaign</a>
            <a href="#credits" className="btn btn-outline btn-small">Add credits</a>
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

        <section className="ios-card portal-activity">
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
        <section className="ios-card portal-spend">
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

      </div>

      {campaigns.length === 0 ? (
        /* The rail's Campaigns item must land somewhere even before the list exists. */
        <div className="empty" id="campaigns">
          <h3>No campaigns yet</h3>
          <p>
            A campaign holds your budget, your card, and who sees it. One screen creates all
            three.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}><a href="#new-campaign" className="btn btn-primary btn-small">Create your first campaign</a></div>
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

          <section id="campaigns" className="workspace-section">
            <h2 className="section-title">All campaigns</h2>
            <div className="campaign-stack">
              <div className="row row-head">
                <span className="row-main">Campaign</span>
                <span className="row-num">Views</span>
                <span className="row-num">Clicks</span>
                <span className="row-num">Spent</span>
              </div>
              {campaigns.map((campaign, index) => (
                <details
                  key={campaign.campaignId}
                  className="campaign-inline"
                  onToggle={(event) => {
                    const id = campaign.campaignId;
                    setOpenRows((prev) => {
                      const next = new Set(prev);
                      if (event.currentTarget.open) next.add(id);
                      else next.delete(id);
                      return next;
                    });
                  }}
                >
                  <summary>
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
                    <span className="row-num mono">{campaign.impressions.toLocaleString("en-US")} views</span>
                    <span className="row-num mono">{campaign.clicks.toLocaleString("en-US")} clicks</span>
                    <span className="row-num mono">{money(campaign.spentMicros)} spent</span>
                  </summary>
                  <div className="campaign-inline-body"><p>Maximum bid and creative controls stay attached to this campaign. Detailed editing is being folded into this row; the current campaign remains fully tracked here.</p><dl><div><dt>Budget</dt><dd>{money(campaign.budgetMicros)}</dd></div><div><dt>Spent</dt><dd>{money(campaign.spentMicros)}</dd></div><div><dt>Audience</dt><dd>{campaign.targetTags.length === 0 ? "Every developer" : `${campaign.targetTags.length} contexts`}</dd></div></dl><CampaignStatusToggle campaign={campaign} onChanged={load} />{openRows.has(campaign.campaignId) && (<CampaignCards campaignId={campaign.campaignId} advertiserName={advertiser?.name ?? ""} onChanged={load} />)}</div>
                </details>
              ))}
            </div>
          </section>
        </>
      )}

      {/*
        Open, not a disclosure. The rail on the left is how these sections are reached
        now, and collapsing them would leave the sidebar pointing at a "+" to unfold.
      */}
      <section className="workspace-section" id="credits" aria-labelledby="credits-title">
        <h2 className="workspace-section-title" id="credits-title">Credits</h2>
        <BillingBody />
      </section>

      <section className="workspace-section" id="new-campaign" aria-labelledby="new-campaign-title">
        <h2 className="workspace-section-title" id="new-campaign-title">Create a campaign</h2>
        <NewCampaignForm />
      </section>
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
      <span className="stat-icon"><SideIcon name={isMoney ? "card" : label === "Clicks" ? "send" : label === "Live campaigns" ? "target" : "chart"} /></span>
      <span className="ios-tile-label">{label}</span>
      <span className={`ios-tile-value${isMoney ? " money" : ""}`}>{value}</span>
      <span className="ios-tile-hint">{hint}</span>
    </div>
  );
}

/**
 * One click between a funded campaign and serving - no approval step.
 *
 * New cards go live by themselves when the balance covers them; this is the control
 * for everything else: a campaign created before credits arrived, or a live one to
 * pause. Failures name the fix (usually adding credits) rather than a state to wait
 * in, because there is no queue behind this button anymore.
 */
function CampaignStatusToggle({  campaign,
  onChanged,
}: {
  campaign: CampaignView;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (campaign.status !== "active" && campaign.status !== "paused") return null;
  const next = campaign.status === "active" ? "paused" : "active";

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch<CampaignView>({
      path: `/portal/campaigns/${encodeURIComponent(campaign.campaignId)}/status`,
      token: await token(),
      method: "POST",
      body: { status: next },
    });
    setBusy(false);
    if (!res.ok) {
      setError(MESSAGES[res.error]);
      return;
    }
    onChanged();
  };

  return (
    <div>
      {campaign.status === "paused" && (
        <p>Paused. Set it live and cards start serving to matching developers.</p>
      )}
      <div className="actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className={next === "active" ? "btn btn-primary btn-small" : "btn btn-ghost"}
          disabled={busy}
          onClick={run}
        >
          {busy ? "Working…" : next === "active" ? "Set live" : "Pause"}
        </button>
      </div>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * The cards on a campaign, with the state of each one.
 *
 * The campaign row's pill says whether the campaign serves; it says nothing about the
 * cards, so a rejected card used to look identical to a live one and the advertiser
 * funded credits into a campaign that could never serve. Every card now names its own
 * state, a rejected one says to publish a replacement, and the form that publishes it
 * sits directly underneath - the resubmission path that used to be a dead export.
 */
function CampaignCards({
  campaignId,
  advertiserName,
  onChanged,
}: {
  campaignId: string;
  advertiserName: string;
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [cards, setCards] = useState<CreativeView[] | null>(null);

  const loadCards = useCallback(async () => {
    const res = await apiFetch<CreativeView[]>({
      path: `/portal/campaigns/${encodeURIComponent(campaignId)}/creatives`,
      token: await token(),
    });
    if (res.ok) setCards(res.value);
  }, [token, campaignId]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 15, marginBottom: 8 }}>Cards</h4>
      {cards === null ? (
        <p className="lede">Loading…</p>
      ) : cards.length === 0 ? (
        <p className="lede">No cards yet — publish the first one below.</p>
      ) : (
        <ul className="meter-list">
          {cards.map((card) => (
            <li key={card.creativeId}>
              <span className="meter-head">
                <span>{card.headline}</span>
                <span className="pill" data-tone={tone(card.status)}>
                  {statusLabel(card.status)}
                </span>
              </span>
              {card.status === "rejected" && (
                <span className="meter-foot">Rejected — publish a replacement below.</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 12 }}>
        <CreativeForm
          campaignId={campaignId}
          defaultAdvertiser={advertiserName}
          onCreated={() => {
            void loadCards();
            onChanged();
          }}
        />
      </div>
    </div>
  );
}
