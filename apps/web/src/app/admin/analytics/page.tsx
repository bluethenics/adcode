"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { GrowthPanel } from "@/components/GrowthPanel";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { apiFetch } from "@/lib/api";
import { browserExcluded, setBrowserExcluded, type Ranking, type WebsiteAnalyticsReport } from "@/lib/websiteAnalytics";
import "@/components/websiteAnalytics.css";

export default function AnalyticsPage() {
  return <AdminShell title="Analytics" subtitle="Who uses ADCode, where they came from, what it showed them, and how the website converts."><GrowthPanel /><SourcesMoved /><h2 className="growth-website-heading">Website</h2><Reports /></AdminShell>;
}
/** Sources, campaign links and partners have their own section now; this is the way there. */
function SourcesMoved() {
  return <p className="website-analytics-note">Where new people came from, campaign links, partners and loops are in <Link href="/admin/growth">Growth</Link>.</p>;
}
function RankingTable({ title, rows, unit = "Page views" }: { title: string; rows: Ranking[]; unit?: string }) {
  return <section className="website-analytics-card"><h2>{title}</h2>{rows.length ? <table><thead><tr><th scope="col">{title}</th><th scope="col">{unit}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{row.label.replaceAll("_", " ")}</td><td>{row.count.toLocaleString()}</td></tr>)}</tbody></table> : <p className="website-analytics-note">No measurements yet.</p>}</section>;
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
function Reports() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [report, setReport] = useState<WebsiteAnalyticsReport | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setReport(null);
    void (async () => {
      try {
        const result = await apiFetch<WebsiteAnalyticsReport>({ path: `/admin/website-analytics?days=${days}`, token: await token() });
        if (!active) return;
        if (result.ok) setReport(result.value); else setError(true);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [days, refresh, token]);
  const exportReport = () => {
    if (!report) return;
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    link.href = url; link.download = `adcode-analytics-${days}days.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <ThisBrowser />
    <div className="website-analytics-controls"><label>Period <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label><button type="button" className="btn btn-small" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh</button><button type="button" className="btn btn-small" disabled={!report} onClick={exportReport}>Export report</button></div>
    {loading && <p role="status">Loading website analytics…</p>}
    {error && <p role="alert">Analytics could not be loaded. Retry, or check that the website analytics database migration has been applied.</p>}
    {report && <>
      {report.truncated && <p role="status">This period exceeds 20,000 events. Figures below cover the most recent 20,000 events only; choose a shorter period for a complete report.</p>}
      {report.totalEvents === 0 && <p className="website-analytics-note">No events in this period. Measurements start when visitors allow analytics. Earlier visits cannot be recovered.</p>}
      <div className="admin-tiles">{[
        ["Page views", report.pageViews.toLocaleString()], ["Sessions", report.sessions.toLocaleString()],
        ["Install intent", report.sessions ? `${(report.installSessions / report.sessions * 100).toFixed(1)}%` : "—"],
        ["Browser errors", report.errorCount.toLocaleString()],
      ].map(([label, value]) => <div className="admin-tile" key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
      <p className="website-analytics-note">Only visitors who allowed analytics are measured; how many declined is deliberately not recorded. Admin pages, administrators&apos; browsers, automated browsers and crawlers are excluded. A session ends after 30 minutes with nobody scrolling, clicking or typing, and is not a unique person; one that resumes later starts a new session with its own page view. Install intent means a session with a copied install command or download click, not a completed installation - website visits are not linked to installs. Events are dated by when they happened, in UTC days; the growth figures above use rolling windows instead (last 24 hours, 7 and 30 days). Traffic sources group the spellings of one place - t.co, x.com and twitter count as x, l.threads.com as threads. Raw events are kept for 90 days.</p>
      <section className="website-analytics-card"><h2>Traffic over time</h2><TimeChart days={report.daily.map(d => d.day)} series={[{ label: "Page views", color: "#78a9ff", values: report.daily.map(d => d.views) }, { label: "Sessions", color: "#55c9a2", values: report.daily.map(d => d.sessions) }]} summary={`Daily traffic: ${report.pageViews} page views and ${report.sessions} sessions in the selected period.`} /></section>
      <div className="website-analytics-grid">{report.funnels.map(funnel => <FunnelCard key={funnel.label} funnel={funnel} />)}</div>
      <div className="website-analytics-grid"><RankingTable title="Top pages" rows={report.pages} /><RankingTable title="Traffic sources" rows={report.sources} /><RankingTable title="Campaigns" rows={report.campaigns} />{report.invitePages !== undefined && <RankingTable title="Invite pages, by loop" rows={report.invitePages} />}<RankingTable title="Devices" rows={report.devices} /><RankingTable title="Actions and conversions" rows={report.events} unit="Events" />{report.placements !== undefined && <RankingTable title="Install buttons" rows={report.placements} unit="Install actions" />}
        <section className="website-analytics-card"><h2>Page performance</h2><table><thead><tr><th scope="col">Metric</th><th scope="col">Samples</th><th scope="col">75th percentile</th></tr></thead><tbody>{report.metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th><td>{metric.samples}</td><td>{metric.p75 === null ? "—" : metric.name === "CLS" ? metric.p75.toFixed(3) : `${Math.round(metric.p75).toLocaleString()} ms`}</td></tr>)}</tbody></table><p className="website-analytics-note">LCP: main content loading. INP: interaction delay. CLS: layout movement. FCP: first content. TTFB: server response. Browser support and consent affect sample coverage.</p><p className="website-analytics-note">CLS and INP are the latest value each visit reported, not the first. Engaged time: {Math.round(report.engagementSeconds / 60).toLocaleString()} minutes - time with the page visible, counting at most a minute past the last scroll, click, key press or pointer movement. Browser errors count at most five per page.</p></section>
      </div>
    </>}
  </>;
}
