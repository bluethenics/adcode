"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CreditCard, Plus } from "lucide";
import { Icon } from "@/components/Icon";
import { SignInCard } from "@/components/SignInCard";
import { DoneCard, maskEmail } from "@/components/DoneCard";
import { Segmented } from "@/components/ios/Segmented";
import { TimeChart } from "@/components/charts/TimeChart";
import { seriesColor } from "@/components/charts/palette";
import { money, moneyProgress } from "@/components/money";
import { LiveReach } from "@/components/advertisers/portal/LiveReach";
import { PortalError, PortalSkeleton, usePortal, type PortalWindow } from "@/components/advertisers/portal/PortalShell";
import { calendar, campaignState, ctr, legacyPortalTarget, seriesTotals } from "@/lib/portalModel";

const WINDOWS = [
  { value: "7" as const, label: "7 days" },
  { value: "30" as const, label: "30 days" },
  { value: "90" as const, label: "90 days" },
];

export default function PortalOverview() {
  const portal = usePortal();
  const router = useRouter();
  const [announcement, setAnnouncement] = useState<{ tone: "ok" | "info"; text: string } | null>(null);
  // Back from a paid checkout: the shared success card, over the page until closed.
  const [paid, setPaid] = useState<{ order: string | null } | null>(null);

  // Old one-page anchors and the builder's old return address now have pages of their own.
  useEffect(() => {
    const target = legacyPortalTarget(globalThis.location.hash, globalThis.location.search);
    if (target !== null) {
      router.replace(target);
      return;
    }
    const params = new URLSearchParams(globalThis.location.search);
    if (params.get("signin") === "1") portal.askSignIn();
    if (params.get("checkout") === "success") {
      setPaid({ order: params.get("order") });
    } else if (params.get("checkout") === "cancelled") {
      setAnnouncement({ tone: "info", text: "Checkout was cancelled. Nothing was charged." });
    }
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  const paidCard = paid === null ? null : (
    <DoneCard
      overlay
      live
      title="Payment received"
      rows={[
        ...(maskEmail(portal.email) === "" ? [] : [{ label: "Account", value: maskEmail(portal.email) }]),
        { label: "Purchase", value: "Advertising credits" },
        ...(paid.order === null ? [] : [{ label: "Order", value: paid.order }]),
        { label: "Balance", value: "Updates once the payment settles" },
      ]}
      notes={["It usually settles within a minute, and campaigns waiting on credits can then go live."]}
      action={{ kind: "button", label: "Continue to your dashboard", onClick: () => setPaid(null) }}
    />
  );

  if (portal.status === "checking" || portal.status === "loading") return <>{paidCard}<PortalSkeleton /></>;
  if (portal.status === "error") return <>{paidCard}<PortalError message={portal.error} onRetry={() => void portal.reload()} /></>;

  if (portal.status === "signed-out" || portal.status === "none" || portal.campaigns.length === 0) {
    return (
      <>
        {paidCard}
        {announcement !== null && <Announcement {...announcement} onDismiss={() => setAnnouncement(null)} />}
        <section className="ap-launch" aria-labelledby="ap-launch-title">
          <div className="ap-launch-copy">
            <h1 id="ap-launch-title">Launch your first campaign</h1>
            <p>Put a sponsored card in front of developers while they code. From $1 per 500 verified views, live in minutes.</p>
            <Link href="/portal/campaigns/new" className="ap-btn ap-btn-primary ap-btn-large">
              Build my campaign <Icon node={ArrowRight} />
            </Link>
            {portal.status === "signed-out" && !portal.signInAsked && (
              <p className="ap-launch-returning">
                Already advertising? <button type="button" className="ap-link" onClick={portal.askSignIn}>Sign in</button>
              </p>
            )}
          </div>
          <LiveReach />
        </section>
        {portal.status === "signed-out" && portal.signInAsked && (
          <div className="ap-signin">
            <SignInCard heading="Sign in to your advertiser account" audience="advertiser" headingTag="h2" initialMode="in" />
          </div>
        )}
        <ol className="ap-howto" aria-label="How a campaign starts">
          <li><strong>Pick an audience</strong><span>Every developer, or only the stacks your product is for.</span></li>
          <li><strong>Write your ad</strong><span>A logo, one line and a link. See it in the editor as you type.</span></li>
          <li><strong>Set a budget</strong><span>Pay only for views held on screen four seconds or more.</span></li>
        </ol>
      </>
    );
  }

  return <>{paidCard}<Dashboard announcement={announcement} onDismiss={() => setAnnouncement(null)} /></>;
}

function Announcement({ tone, text, onDismiss }: { tone: "ok" | "info"; text: string; onDismiss: () => void }) {
  return (
    <div className="ap-banner" data-tone={tone} role="status">
      <p>{text}</p>
      <button type="button" className="ap-link" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function Dashboard({ announcement, onDismiss }: { announcement: { tone: "ok" | "info"; text: string } | null; onDismiss: () => void }) {
  const portal = usePortal();
  const { advertiser, campaigns, series, window } = portal;
  const days = useMemo(() => calendar(Number(window)), [window]);
  const totals = useMemo(() => seriesTotals(series, days), [series, days]);
  const views = totals.views.reduce((sum, value) => sum + value, 0);
  const clicks = totals.clicks.reduce((sum, value) => sum + value, 0);
  const spent = moneyProgress(series.filter((point) => days.includes(point.day)).reduce((sum, point) => sum + BigInt(point.spentMicros), 0n).toString());
  const waiting = campaigns.map((campaign) => ({ campaign, state: campaignState(campaign, advertiser) })).filter((row) => row.state.tone === "waiting");

  return (
    <>
      {announcement !== null && <Announcement {...announcement} onDismiss={onDismiss} />}
      <header className="ap-page-head">
        <div>
          <h1>Overview</h1>
          <p>Verified views only. A view counts after four seconds on screen in a focused editor.</p>
        </div>
        <Segmented label="Reporting window" value={window} options={WINDOWS} onChange={(next: PortalWindow) => portal.setWindow(next)} />
      </header>

      {waiting.length > 0 && (
        <div className="ap-banner" data-tone="warn" role="status">
          <p>
            {waiting.length === 1 ? <><strong>{waiting[0]?.campaign.name}</strong> is ready but waiting for credits.</> : <>{waiting.length} campaigns are ready but waiting for credits.</>}{" "}
            It goes live as soon as your balance covers its budget.
          </p>
          <Link href="/portal/billing" className="ap-btn ap-btn-small">Add credits</Link>
        </div>
      )}

      <dl className="ap-kpis">
        <div><dt>Verified views</dt><dd>{views === 0 ? "-" : views.toLocaleString("en-US")}</dd></div>
        <div><dt>Clicks</dt><dd>{clicks === 0 ? "-" : clicks.toLocaleString("en-US")}</dd></div>
        <div><dt>Click rate</dt><dd>{ctr(clicks, views) ?? "-"}</dd></div>
        <div><dt>Spent</dt><dd className="money">{views === 0 ? "-" : spent}</dd></div>
      </dl>
      {views === 0 && <p className="ap-note">No verified views in the last {window} days yet. Figures appear here from the first one.</p>}

      <section className="ap-panel" aria-labelledby="ap-activity-title">
        <header className="ap-panel-head">
          <h2 id="ap-activity-title">Views and clicks</h2>
          <span>Last {window} days</span>
        </header>
        <TimeChart
          days={days}
          height={220}
          summary={`Views and clicks per day over ${window} days: ${views} views, ${clicks} clicks.`}
          series={[
            { label: "Views", color: seriesColor(0), values: totals.views },
            { label: "Clicks", color: seriesColor(1), values: totals.clicks },
          ]}
        />
      </section>

      <div className="ap-split">
        <section className="ap-panel ap-panel-flush" id="campaigns" aria-labelledby="ap-campaigns-title">
          <header className="ap-panel-head">
            <h2 id="ap-campaigns-title">Campaigns</h2>
            <Link href="/portal/campaigns/new" className="ap-link"><Icon node={Plus} />New campaign</Link>
          </header>
          <div className="ap-table-wrap">
            <table className="ap-table">
              <thead>
                <tr><th scope="col">Campaign</th><th scope="col">Status</th><th scope="col" className="num">Views</th><th scope="col" className="num">Clicks</th><th scope="col" className="num">CTR</th><th scope="col" className="num">Spent</th></tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const state = campaignState(campaign, advertiser);
                  return (
                    <tr key={campaign.campaignId}>
                      <th scope="row"><Link href={`/portal/campaigns/${encodeURIComponent(campaign.campaignId)}`}>{campaign.name}</Link></th>
                      <td><span className="ap-chip" data-tone={state.tone}>{state.label}</span></td>
                      <td className="num">{campaign.impressions.toLocaleString("en-US")}</td>
                      <td className="num">{campaign.clicks.toLocaleString("en-US")}</td>
                      <td className="num">{ctr(campaign.clicks, campaign.impressions) ?? "-"}</td>
                      <td className="num money">{moneyProgress(campaign.spentMicros)}<small> of {money(campaign.budgetMicros)}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="ap-panel ap-balance" aria-labelledby="ap-balance-title">
          <h2 id="ap-balance-title">Available credits</h2>
          <strong className="money">{money(advertiser?.availableMicros ?? "0")}</strong>
          <dl>
            <div><dt>Held by live campaigns</dt><dd className="money">{money(advertiser?.reservedMicros ?? "0")}</dd></div>
            <div><dt>Bought all time</dt><dd className="money">{money(advertiser?.fundedMicros ?? "0")}</dd></div>
          </dl>
          <Link href="/portal/billing" className="ap-btn"><Icon node={CreditCard} />Add credits</Link>
        </aside>
      </div>
    </>
  );
}
