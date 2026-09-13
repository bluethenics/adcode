"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { TimeChart } from "@/components/charts/TimeChart";
import { apiFetch } from "@/lib/api";
import type { Ranking, WebsiteAnalyticsReport } from "@/lib/websiteAnalytics";
import "@/components/websiteAnalytics.css";

export default function AnalyticsPage() {
  return <AdminShell title="Analytics" subtitle="Understand visits, measure intent, and find places to improve."><Reports /></AdminShell>;
}
function RankingTable({ title, rows, unit = "Page views" }: { title: string; rows: Ranking[]; unit?: string }) {
  return <section className="website-analytics-card"><h2>{title}</h2>{rows.length ? <table><thead><tr><th scope="col">{title}</th><th scope="col">{unit}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{row.label.replaceAll("_", " ")}</td><td>{row.count.toLocaleString()}</td></tr>)}</tbody></table> : <p className="website-analytics-note">No measurements yet.</p>}</section>;
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
      <p className="website-analytics-note">Consenting visits only; admin pages are excluded. Sessions expire after 30 minutes of inactivity and are not unique people. Install intent means a session with a copied install command or download click, not a completed installation. Dates use UTC.</p>
      <section className="website-analytics-card"><h2>Traffic over time</h2><TimeChart days={report.daily.map(d => d.day)} series={[{ label: "Page views", color: "#78a9ff", values: report.daily.map(d => d.views) }, { label: "Sessions", color: "#55c9a2", values: report.daily.map(d => d.sessions) }]} summary={`Daily traffic: ${report.pageViews} page views and ${report.sessions} sessions in the selected period.`} /></section>
      <div className="website-analytics-grid">{report.funnels.map(funnel => <section className="website-analytics-card" key={funnel.label}><h2>{funnel.label}</h2><table><thead><tr><th scope="col">Step</th><th scope="col">Sessions</th><th scope="col">Drop-off</th></tr></thead><tbody>{funnel.steps.map((step, index) => <tr key={step.label}><td>{step.label}</td><td>{step.sessions.toLocaleString()}</td><td>{index === 0 ? "—" : step.lost.toLocaleString()}</td></tr>)}</tbody></table><p className="website-analytics-note">Same-session steps in order within this period. Drop-off counts sessions that did not reach the next step.</p></section>)}</div>
      <div className="website-analytics-grid"><RankingTable title="Top pages" rows={report.pages} /><RankingTable title="Traffic sources" rows={report.sources} /><RankingTable title="Campaigns" rows={report.campaigns} /><RankingTable title="Devices" rows={report.devices} /><RankingTable title="Actions and conversions" rows={report.events} unit="Events" />
        <section className="website-analytics-card"><h2>Page performance</h2><table><thead><tr><th scope="col">Metric</th><th scope="col">Samples</th><th scope="col">75th percentile</th></tr></thead><tbody>{report.metrics.map(metric => <tr key={metric.name}><th scope="row">{metric.name}</th><td>{metric.samples}</td><td>{metric.p75 === null ? "—" : metric.name === "CLS" ? metric.p75.toFixed(3) : `${Math.round(metric.p75).toLocaleString()} ms`}</td></tr>)}</tbody></table><p className="website-analytics-note">LCP: main content loading. INP: interaction delay. CLS: layout movement. FCP: first content. TTFB: server response. Browser support and consent affect sample coverage.</p><p className="website-analytics-note">Visible engagement: {Math.round(report.engagementSeconds / 60).toLocaleString()} minutes.</p></section>
      </div>
    </>}
  </>;
}
