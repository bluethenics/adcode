"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Pause, Play, Plus } from "lucide";
import { Icon } from "@/components/Icon";
import { CampaignBudgetMove } from "@/components/CampaignBudgetMove";
import { TimeChart } from "@/components/charts/TimeChart";
import { seriesColor } from "@/components/charts/palette";
import { money, moneyProgress } from "@/components/money";
import { AdPreviews } from "@/components/advertisers/portal/AdPreviews";
import { PortalError, PortalSkeleton, usePortal } from "@/components/advertisers/portal/PortalShell";
import { regionSummary } from "@/components/advertisers/portal/RegionPicker";
import { SignInCard } from "@/components/SignInCard";
import { apiFetch, MESSAGES, type CampaignView, type CreativeView } from "@/lib/api";
import { calendar, campaignState, ctr, dollarsFromMicros, domainOf, seriesTotals } from "@/lib/portalModel";
import { REGION_PREFIX } from "@adcode/api/src/regions.ts";
import { CreativeForm } from "./CreativeForm";

export default function CampaignPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params?.id ?? "");
  const portal = usePortal();
  const campaign = portal.campaigns.find((one) => one.campaignId === id) ?? null;
  const [cards, setCards] = useState<CreativeView[] | null>(null);
  const [cardsError, setCardsError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "previews">("table");
  const [adding, setAdding] = useState(false);

  useEffect(() => setCreated(new URLSearchParams(globalThis.location.search).get("created")), []);

  const loadCards = useCallback(async () => {
    const res = await apiFetch<CreativeView[]>({ path: `/portal/campaigns/${encodeURIComponent(id)}/creatives`, token: await portal.token() });
    if (res.ok) {
      setCards(res.value);
      setCardsError(null);
    } else setCardsError(MESSAGES[res.error]);
  }, [id, portal]);

  useEffect(() => {
    if (portal.status === "ready" && campaign !== null) void loadCards();
  }, [portal.status, campaign?.campaignId, loadCards]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => calendar(Number(portal.window)), [portal.window]);
  const totals = useMemo(() => seriesTotals(portal.series, days, id), [portal.series, days, id]);

  if (portal.status === "checking" || portal.status === "loading") return <PortalSkeleton />;
  if (portal.status === "signed-out") {
    return <div className="ap-signin"><SignInCard heading="Sign in to see this campaign" audience="advertiser" headingTag="h2" initialMode="in" /></div>;
  }
  if (portal.status === "error") return <PortalError message={portal.error} onRetry={() => void portal.reload()} />;
  if (campaign === null) {
    return (
      <div className="ap-state">
        <h2>Campaign not found</h2>
        <p>It doesn&apos;t exist, or it belongs to another advertiser account.</p>
        <Link href="/portal" className="ap-btn"><Icon node={ArrowLeft} />Back to overview</Link>
      </div>
    );
  }

  const state = campaignState(campaign, portal.advertiser);
  const live = (cards ?? []).filter((card) => card.status !== "rejected");
  const first = live[0] ?? cards?.[0] ?? null;
  const contexts = campaign.targetTags.filter((tag) => !tag.startsWith(REGION_PREFIX));
  const regions = campaign.targetTags.filter((tag) => tag.startsWith(REGION_PREFIX)).map((tag) => tag.slice(REGION_PREFIX.length));

  return (
    <article className="ap-campaign">
      <Link href="/portal" className="ap-back"><Icon node={ArrowLeft} />Overview</Link>

      <header className="ap-campaign-head">
        <span className="ap-campaign-logo" aria-hidden="true">
          {first !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- a hosted 128px logo at its rendered size
            <img src={first.logoLight} alt="" width={48} height={48} />
          ) : (
            campaign.name.slice(0, 1).toUpperCase()
          )}
        </span>
        <div>
          <h1>{campaign.name}</h1>
          <ul className="ap-meta">
            <li><span className="ap-chip" data-tone={state.tone}>{state.label}</span></li>
            {first !== null && <li>{domainOf(first.clickUrl)}</li>}
            <li><strong className="money">{money(campaign.budgetMicros)}</strong> budget</li>
            <li>{contexts.length === 0 ? "Every developer" : `${contexts.length} ${contexts.length === 1 ? "context" : "contexts"}`}</li>
            <li>{regionSummary(regions)}</li>
          </ul>
        </div>
        {state.tone !== "waiting" && <StatusControl campaign={campaign} />}
      </header>

      {created === "1" && state.tone === "live" && <Banner tone="ok">Your campaign is live. Cards start reaching matching developers at their next ad slot.</Banner>}
      {created === "partial" && <Banner tone="warn">The campaign was created, but not every ad was accepted. Add it again below.</Banner>}
      {state.tone === "waiting" && (
        <Banner tone="warn" action={<Link href={`/portal/billing?amount=${dollarsFromMicros(state.shortfallMicros)}`} className="ap-btn ap-btn-primary ap-btn-small">Add {money(state.shortfallMicros.toString())}</Link>}>
          <strong>Waiting for credits.</strong> Everything is set up. It goes live as soon as your balance covers the {money((BigInt(campaign.budgetMicros) - BigInt(campaign.spentMicros)).toString())} left of its budget.
        </Banner>
      )}
      {state.tone === "paused" && <Banner tone="info">Paused. Set it live and it starts serving again at the next ad slot.</Banner>}
      {state.label === "Budget spent" && <Banner tone="info">This campaign has used its whole budget. Move unspent budget from another campaign below, or start a new one.</Banner>}

      <dl className="ap-kpis">
        <div><dt>Verified views</dt><dd>{campaign.impressions.toLocaleString("en-US")}</dd></div>
        <div><dt>Clicks</dt><dd>{campaign.clicks.toLocaleString("en-US")}</dd></div>
        <div><dt>Click rate</dt><dd>{ctr(campaign.clicks, campaign.impressions) ?? "-"}</dd></div>
        <div><dt>Spent</dt><dd className="money">{moneyProgress(campaign.spentMicros)}<small> of {money(campaign.budgetMicros)}</small></dd></div>
      </dl>

      {campaign.impressions > 0 && (
        <section className="ap-panel" aria-labelledby="ap-camp-chart">
          <header className="ap-panel-head"><h2 id="ap-camp-chart">Views and clicks</h2><span>Last {portal.window} days</span></header>
          <TimeChart
            days={days}
            height={200}
            summary={`Views and clicks per day for ${campaign.name}.`}
            series={[
              { label: "Views", color: seriesColor(0), values: totals.views },
              { label: "Clicks", color: seriesColor(1), values: totals.clicks },
            ]}
          />
        </section>
      )}

      <section className="ap-panel ap-panel-flush" aria-labelledby="ap-ads-title">
        <header className="ap-panel-head">
          <h2 id="ap-ads-title">Ads</h2>
          <div className="ap-head-tools">
            <div className="ap-toggle" role="group" aria-label="Show ads as">
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button>
              <button type="button" aria-pressed={view === "previews"} onClick={() => setView("previews")}>Previews</button>
            </div>
            <button type="button" className="ap-link" onClick={() => setAdding((open) => !open)} aria-expanded={adding}><Icon node={Plus} />Add an ad</button>
          </div>
        </header>

        {cards === null ? (
          cardsError !== null ? (
            <div className="ap-inline-state" role="alert"><p>The ads didn&apos;t load. {cardsError}</p><button type="button" className="ap-btn ap-btn-small" onClick={() => void loadCards()}>Try again</button></div>
          ) : (
            <div className="ap-rows-skeleton" aria-busy="true"><i /><i /></div>
          )
        ) : cards.length === 0 ? (
          <div className="ap-inline-state"><p>No ads yet. A campaign serves once it has one.</p><button type="button" className="ap-btn ap-btn-primary ap-btn-small" onClick={() => setAdding(true)}>Add the first ad</button></div>
        ) : view === "table" ? (
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead><tr><th scope="col">Ad</th><th scope="col">Status</th><th scope="col">Destination</th><th scope="col"><span className="sr-only">Preview</span></th></tr></thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={card.creativeId}>
                    <th scope="row">
                      <span className="ap-ad-cell">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a hosted 128px logo */}
                        <img src={card.logoLight} alt="" width={22} height={22} />
                        <span><strong>{card.headline}</strong>{card.body !== null && <small>{card.body}</small>}</span>
                      </span>
                    </th>
                    <td><span className="ap-chip" data-tone={card.status === "rejected" ? "ended" : state.tone === "live" ? "live" : "paused"}>{card.status === "rejected" ? "Rejected" : state.tone === "live" ? "Serving" : "Ready"}</span></td>
                    <td><a href={card.clickUrl} target="_blank" rel="noopener noreferrer" className="ap-link">{domainOf(card.clickUrl)}<Icon node={ExternalLink} /></a></td>
                    <td className="num"><button type="button" className="ap-link" onClick={() => setView("previews")}>Preview</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ap-note">Views and clicks are counted for the whole campaign; ads rotate evenly within it.</p>
          </div>
        ) : (
          <AdPreviews compact ads={cards.map((card) => ({ brand: card.advertiser, headline: card.headline, body: card.body ?? "", logo: card.logoLight }))} />
        )}

        {adding && (
          <div className="ap-add-ad">
            <CreativeForm
              campaignId={campaign.campaignId}
              defaultAdvertiser={first?.advertiser ?? portal.advertiser?.name ?? ""}
              defaultUrl={first?.clickUrl ?? ""}
              onCreated={() => {
                void loadCards();
                void portal.reload();
              }}
            />
          </div>
        )}
      </section>

      {portal.campaigns.length > 1 && (
        <section className="ap-panel ap-move" aria-label="Move credits to another campaign">
          <CampaignBudgetMove campaign={campaign} campaigns={portal.campaigns} advertiser={portal.advertiser} onMoved={() => void portal.reload()} />
        </section>
      )}
    </article>
  );
}

function Banner({ tone, children, action }: { tone: "ok" | "warn" | "info"; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="ap-banner" data-tone={tone} role="status">
      <p>{children}</p>
      {action}
    </div>
  );
}

/** Pause or set live: the one control between a funded campaign and serving. */
function StatusControl({ campaign }: { campaign: CampaignView }) {
  const portal = usePortal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (campaign.status !== "active" && campaign.status !== "paused") return null;
  const next = campaign.status === "active" ? "paused" : "active";

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch<CampaignView>({ path: `/portal/campaigns/${encodeURIComponent(campaign.campaignId)}/status`, token: await portal.token(), method: "POST", body: { status: next } });
    setBusy(false);
    if (!res.ok) {
      setError(MESSAGES[res.error]);
      return;
    }
    await portal.reload();
  };

  return (
    <div className="ap-status-control">
      <button type="button" className={next === "active" ? "ap-btn ap-btn-primary" : "ap-btn"} disabled={busy} onClick={() => void run()}>
        <Icon node={next === "active" ? Play : Pause} />
        {busy ? "Working…" : next === "active" ? "Set live" : "Pause"}
      </button>
      {error !== null && <p className="ap-field-error" role="alert">{error}</p>}
    </div>
  );
}
