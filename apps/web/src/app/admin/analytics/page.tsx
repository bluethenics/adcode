"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell, AdminTabs } from "@/components/AdminShell";
import { GrowthPanel } from "@/components/GrowthPanel";
import { FeatureUsePanel } from "@/components/FeatureUsePanel";
import { AiUsagePanel } from "@/components/AiUsagePanel";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { DailyChange } from "@/components/DailyChange";
import { useCachedResource } from "@/lib/adminCache";
import { RefreshStamp } from "@/components/RefreshStamp";
import { ChartSkeleton, ExportButtons, InsightProblem, Loading, StatSkeleton, TableSkeleton, type InsightFailure } from "@/components/AdminInsightsUI";
import { insightsFailure, rangeLabel, utcDate } from "@/lib/adminInsights";
import { browserExcluded, setBrowserExcluded, type Ranking, type WebsiteAnalyticsReport } from "@/lib/websiteAnalytics";
import "@/components/websiteAnalytics.css";

/*
 * Four questions, one tab each, each with its own URL so the one you came for is at the top:
 * how many people use the editor (and a post to share it), how the included AI is used, how the
 * website converts, and which desktop features people use.
 */
const TABS = [
  { id: "people", label: "People and ads" },
  { id: "ai", label: "AI models" },
  { id: "website", label: "Website" },
  { id: "features", label: "Desktop features" },
];
const SUBTITLES: Record<string, string> = {
  people: "Who uses ADCode and how many ads it showed, with a post to share the numbers.",
  ai: "Requests, users, tokens, cost and revenue across the included models, for any range.",
  website: "How the website converts: traffic, install intent, top pages and page speed.",
  features: "Which parts of the desktop app people use, from the editor's Help improve ADCode counts.",
};

function AnalyticsBody() {
  const requested = useSearchParams().get("tab");
  const tab = requested !== null && TABS.some((one) => one.id === requested) ? requested : "people";
  return (
    <AdminShell title="Analytics" subtitle={SUBTITLES[tab] ?? ""}>
      <AdminTabs base="/admin/analytics" active={tab} tabs={TABS} />
      {tab === "website" ? <Reports /> : tab === "features" ? <FeatureUsePanel /> : tab === "ai" ? <AiUsagePanel /> : <><GrowthPanel /><SourcesMoved /></>}
    </AdminShell>
  );
}

export default function AnalyticsPage() {
  return <Suspense fallback={null}><AnalyticsBody /></Suspense>;
}
/** Sources, campaign links and partners have their own section now; this is the way there. */
function SourcesMoved() {
  return <p className="website-analytics-note">Where new people came from, campaign links, partners and loops are in <Link href="/admin/growth">Growth</Link>.</p>;
}
type RankingTable = "pages" | "sources" | "campaigns" | "invitePages" | "devices" | "events" | "placements";
function RankingTable({ title, rows, unit = "Page views", table, days }: { title: string; rows: Ranking[]; unit?: string; table: RankingTable; days: number }) {
  return <section className="website-analytics-card">
    <header className="insight-card-head"><h2>{title}</h2>{rows.length > 0 && <ExportButtons label="CSV" formats={["csv"]} query={`dataset=website&days=${days}&table=${table}`} />}</header>
    {rows.length ? <table><thead><tr><th scope="col">{title}</th><th scope="col">{unit}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{row.label.replaceAll("_", " ")}</td><td>{row.count.toLocaleString()}</td></tr>)}</tbody></table> : <p className="website-analytics-note">No measurements in this period.</p>}
  </section>;
}
function FunnelCard({ funnel }: { funnel: WebsiteAnalyticsReport["funnels"][number] }) {
  const entries = funnel.steps[0]?.sessions ?? 0;
  const completed = funnel.steps.at(-1)?.sessions ?? 0;
  return <section className="website-analytics-card">
    <h2>{funnel.label}</h2>
    {funnel.label === "Install journey" && <p className="website-analytics-note">Sitewide intent includes docs readers and returning users. A session without an install action is not necessarily an abandoned installation.</p>}
    {funnel.label === "Installation pages" && <p className="website-analytics-note">Starts with a visit to Versions &amp; install or the installation guide. Command copies from docs are measured from the tracking update onward.</p>}
    <p className="website-analytics-note">{entries > 0
      ? `${(completed / entries * 100).toFixed(1)}% reached the final step (${completed.toLocaleString()} of ${entries.toLocaleString()} sessions).`
      : "No entry sessions measured in this period."}</p>
    <table>
      <thead><tr><th scope="col">Step</th><th scope="col">Sessions</th><th scope="col">Drop-off</th></tr></thead>
      <tbody>{funnel.steps.map((step, index) => {
        const previous = funnel.steps[index - 1]?.sessions ?? 0;
        return <tr key={step.label}>
          <td>{step.label}</td><td>{step.sessions.toLocaleString()}</td>
          <td>{index === 0 || previous === 0 ? "—" : `${step.lost.toLocaleString()} (${(step.lost / previous * 100).toFixed(1)}%)`}</td>
        </tr>;
      })}</tbody>
    </table>
    <p className="website-analytics-note">Same-session steps in order. Drop-off shows sessions lost from the previous step. These actions do not confirm installation or payment.</p>
  </section>;
}
/**
 * Whether this browser's own visits are counted. An administrator's browser is left out once
 * they sign in here, so checking the site does not show up as an audience; this is the switch
 * for a setup check that needs to see its own events arrive.
 */
function ThisBrowser() {
  const [excluded, setExcluded] = useState<boolean | null>(null);
  const [automated, setAutomated] = useState(false);
  useEffect(() => {
    const sync = () => {
      setExcluded(browserExcluded());
      let chosen = false;
      try { chosen = localStorage.getItem("adcode.website-analytics-exclude") === "1"; } catch { /* storage disabled */ }
      setAutomated(browserExcluded() && !chosen);
    };
    sync();
    window.addEventListener("website-analytics-choice", sync);
    return () => window.removeEventListener("website-analytics-choice", sync);
  }, []);
  if (excluded === null) return null;
  return <p className="website-analytics-note" role="status">
    {automated
      ? "This browser is automated or identifies as a crawler, so its visits are never counted."
      : excluded
        ? <>This browser&apos;s visits are not counted - administrators&apos; own visits are left out. <button type="button" className="install-link-button" onClick={() => setBrowserExcluded(false)}>Count this browser</button> to check that events arrive.</>
        : <>This browser&apos;s visits are counted, if it allowed analytics. <button type="button" className="install-link-button" onClick={() => setBrowserExcluded(true)}>Stop counting this browser</button></>}
  </p>;
}

type Report = WebsiteAnalyticsReport & { source?: "summary" | "events" };

function Reports() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [failure, setFailure] = useState<InsightFailure | null>(null);
  /*
   * The whole period, counted in the database (/admin/insights/website). Until migration
   * 20261120180100 is applied that answers "apply the migration", and the older report is used:
   * the most recent 20,000 events, flagged as partial when the period holds more.
   */
  const load = useCallback(async (signal: AbortSignal): Promise<Report | null> => {
    const idToken = await token();
    if (idToken === null) { setFailure({ kind: "auth", message: "Sign in again as an administrator." }); return null; }
    const get = (path: string) => fetch(`/v1${path}`, { headers: { authorization: `Bearer ${idToken}` }, signal });
    try {
      const response = await get(`/admin/insights/website?days=${days}`);
      if (response.ok) { setFailure(null); return { ...await response.json() as WebsiteAnalyticsReport, source: "summary" }; }
      const problem = await insightsFailure(response);
      if (problem.kind !== "migration") { setFailure(problem); return null; }
      const older = await get(`/admin/website-analytics?days=${days}`);
      if (!older.ok) { setFailure(await insightsFailure(older)); return null; }
      setFailure(null);
      return { ...await older.json() as WebsiteAnalyticsReport, source: "events" };
    } catch {
      if (!signal.aborted) setFailure({ kind: "offline", message: "Could not reach the server. Check the connection and retry." });
      return null;
    }
  }, [days, token]);
  const cached = useCachedResource(`analytics-website:${days}`, load);
  const report = cached.value;
  const range = useMemo(() => report === null ? null : { from: utcDate(report.start), to: utcDate(report.end - 1) }, [report]);
  return <>
    <ThisBrowser />
    <div className="website-analytics-controls">
      <label>Period <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
      <RefreshStamp asOf={cached.asOf} refreshing={cached.refreshing} fromCache={cached.fromCache} onRefresh={() => void cached.refresh()} />
      <ExportButtons label="Export report" query={`dataset=website&days=${days}&table=all`} disabled={report === null || report.source === "events"} />
    </div>
    {range !== null && <p className="insight-range">Period: <strong>{rangeLabel(range)}</strong>{report?.source === "summary" ? ", every event counted" : ""}</p>}
    {cached.failed && failure !== null && <InsightProblem {...failure} onRetry={() => void cached.refresh()} />}
    {report === null && !cached.failed && <Loading label="Loading website analytics"><StatSkeleton count={4} /><ChartSkeleton /><TableSkeleton rows={5} columns={2} /></Loading>}
    {report && <>
      {report.truncated && <p role="status" className="notice" data-tone="info">This period exceeds 20,000 events, and the database does not have the summary function yet, so figures below cover the most recent 20,000 events only. Apply migration 20261120180100 for the whole period, or choose a shorter one.</p>}
      {report.totalEvents === 0 && <p className="website-analytics-note">No events in this period. Measurements start when visitors allow analytics. Earlier visits cannot be recovered.</p>}
      <div className="admin-tiles">{[
        { label: "Page views", value: report.pageViews.toLocaleString(), current: report.pageViews, previous: report.dayComparison?.previous?.pageViews },
        { label: "Sessions", value: report.sessions.toLocaleString(), current: report.sessions, previous: report.dayComparison?.previous?.sessions },
        { label: "Install intent", value: report.sessions ? `${(report.installSessions / report.sessions * 100).toFixed(1)}%` : "—", current: report.sessions ? report.installSessions / report.sessions : null,
          previous: report.dayComparison?.previous?.sessions ? report.dayComparison.previous.installSessions / report.dayComparison.previous.sessions : null },
        { label: "Browser errors", value: report.errorCount.toLocaleString(), current: report.errorCount, previous: report.dayComparison?.previous?.errorCount },
      ].map(tile => <div className="admin-tile" key={tile.label}><strong>{tile.value}</strong><span>{tile.label}</span><DailyChange current={tile.current} previous={tile.previous} lowerIsBetter={tile.label === "Browser errors"} unavailableReason={report.dayComparison?.reason === "retention-limit" ? "The previous window reaches beyond the 90-day retention period. Choose 7 or 30 days." : report.dayComparison?.reason === "partial-data" ? "A comparison is unavailable because one window exceeds the event limit." : undefined} /></div>)}</div>
      <p className="website-analytics-note">Changes compare the selected period so far with the same window shifted one day earlier, ending at the same time of day. Install intent shows relative percentage change, not percentage points. Comparisons are unavailable for windows beyond retained history.</p>
      <details className="adm-method"><summary>How these figures are counted</summary><p className="website-analytics-note">Only visitors who allowed analytics are measured; how many declined is deliberately not recorded. Admin pages, administrators&apos; browsers, automated browsers and crawlers are excluded. A session ends after 30 minutes with nobody scrolling, clicking or typing, and is not a unique person; one that resumes later starts a new session with its own page view. Install intent means a session with a copied install command or download click, not a completed installation - website visits are not linked to installs. Events are dated by when they happened, in UTC days; the growth figures use rolling windows instead (last 24 hours, 7 and 30 days). Traffic sources group the spellings of one place - t.co, x.com and twitter count as x, l.threads.com as threads. Raw events are kept for 90 days.</p></details>
      <section className="website-analytics-card"><header className="insight-card-head"><h2>Traffic over time</h2><ExportButtons label="CSV" formats={["csv"]} query={`dataset=website&days=${days}&table=daily`} disabled={report.source === "events"} /></header><TimeChart days={report.daily.map(d => d.day)} series={[{ label: "Page views", color: "#78a9ff", values: report.daily.map(d => d.views) }, { label: "Sessions", color: "#55c9a2", values: report.daily.map(d => d.sessions) }]} summary={`Daily traffic: ${report.pageViews} page views and ${report.sessions} sessions in the selected period.`} /></section>
      <div className="website-analytics-grid">{report.funnels.map(funnel => <FunnelCard key={funnel.label} funnel={funnel} />)}</div>
      <div className="website-analytics-grid"><RankingTable title="Top pages" rows={report.pages} table="pages" days={days} /><RankingTable title="Traffic sources" rows={report.sources} table="sources" days={days} /><RankingTable title="Campaigns" rows={report.campaigns} table="campaigns" days={days} />{report.invitePages !== undefined && <RankingTable title="Invite pages, by loop" rows={report.invitePages} table="invitePages" days={days} />}<RankingTable title="Devices" rows={report.devices} table="devices" days={days} /><RankingTable title="Actions and conversions" rows={report.events} unit="Events" table="events" days={days} />{report.placements !== undefined && <RankingTable title="Install buttons" rows={report.placements} unit="Install actions" table="placements" days={days} />}
        <section className="website-analytics-card"><h2>Page performance</h2><table><thead><tr><th scope="col">Metric</th><th scope="col">Samples</th><th scope="col">75th percentile</th></tr></thead><tbody>{report.metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th><td>{metric.samples}</td><td>{metric.p75 === null ? "—" : metric.name === "CLS" ? metric.p75.toFixed(3) : `${Math.round(metric.p75).toLocaleString()} ms`}</td></tr>)}</tbody></table><p className="website-analytics-note">LCP: main content loading. INP: interaction delay. CLS: layout movement. FCP: first content. TTFB: server response. Browser support and consent affect sample coverage.</p><p className="website-analytics-note">CLS and INP are the latest value each visit reported, not the first. Engaged time: {Math.round(report.engagementSeconds / 60).toLocaleString()} minutes - time with the page visible, counting at most a minute past the last scroll, click, key press or pointer movement. Browser errors count at most five per page.</p></section>
      </div>
    </>}
  </>;
}
