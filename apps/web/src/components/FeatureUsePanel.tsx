"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { useCachedResource } from "@/lib/adminCache";
import { RefreshStamp } from "@/components/RefreshStamp";
import { ExportButtons, InsightProblem, Loading, TableSkeleton } from "@/components/AdminInsightsUI";
import { rangeLabel, utcDate } from "@/lib/adminInsights";

interface Row { name: string; kind: "cmd" | "page" | "event" | "addon"; label: string; uses: number; clientDays: number; trend: number | null }
interface Summary { days: number; reportingDays: number; totalUses: number; top: Row[]; rare: Row[]; byKind: Record<Row["kind"], number> }

const KIND: Record<Row["kind"], string> = { cmd: "Command", page: "Page", event: "Event", addon: "Add-on" };

function trend(value: number | null): string {
  if (value === null) return "new";
  return `${value > 0 ? "+" : ""}${value}%`;
}

function Table({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) return <p className="lede">{empty}</p>;
  return (
    <div className="ai-token-table-scroll" role="region" tabIndex={0} aria-label="Feature use">
      <table className="table">
        <thead><tr><th>Feature</th><th>Kind</th><th>Uses</th><th>Install-days</th><th>Second half vs first</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td><code>{row.label}</code></td>
              <td>{KIND[row.kind]}</td>
              <td>{row.uses.toLocaleString("en-US")}</td>
              <td>{row.clientDays.toLocaleString("en-US")}</td>
              <td>{trend(row.trend)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What desktop users actually use, from the editor's "Help improve ADCode" daily counts:
 * names and numbers only, with no account attached. The rare list is the useful one for
 * product work - a command almost nobody runs is either not needed or not findable.
 */
export function FeatureUsePanel() {
  const { token } = useAuth();
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  // A changed range cancels the request for the old one (adminCache.ts).
  const load = useCallback(async (signal: AbortSignal): Promise<Summary | null> => {
    const found = await apiFetch<Summary>({ path: `/admin/app-usage?days=${days}`, token: await token(), signal });
    if (found.ok) { setError(null); return found.value; }
    if (!signal.aborted) setError(MESSAGES[found.error]);
    return null;
  }, [days, token]);
  const cached = useCachedResource(`app-usage:${days}`, load);
  const summary = cached.value;
  const now = Date.now();
  const range = { from: utcDate(now - (days - 1) * 86_400_000), to: utcDate(now) };

  return (
    <section aria-label="Desktop feature use">
      <div className="insight-toolbar">
        <div className="insight-toolbar-group">
          <label className="insight-field" htmlFor="feature-days"><span>Range</span>
            <select id="feature-days" className="select" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
        <div className="insight-toolbar-group">
          <RefreshStamp asOf={cached.asOf} refreshing={cached.refreshing} fromCache={cached.fromCache} onRefresh={() => void cached.refresh()} />
          <ExportButtons label="Export every feature" query={`dataset=features&days=${days}`} disabled={summary === null} />
        </div>
      </div>
      <p className="insight-range">Period: <strong>{rangeLabel(range, now)}</strong>. Editors report each finished day once, so today fills in tomorrow.</p>
      {cached.failed && error !== null && <InsightProblem kind="server" message={error} onRetry={() => void cached.refresh()} />}
      {summary === null && !cached.failed && <Loading label="Loading feature use"><TableSkeleton rows={8} columns={5} /></Loading>}
      {summary !== null && <>
        <p className="lede">
          {summary.totalUses.toLocaleString("en-US")} uses over {summary.reportingDays} reporting {summary.reportingDays === 1 ? "day" : "days"}:
          {" "}{summary.byKind.cmd.toLocaleString("en-US")} commands, {summary.byKind.page.toLocaleString("en-US")} page opens, {summary.byKind.event.toLocaleString("en-US")} events, {summary.byKind.addon.toLocaleString("en-US")} add-on uses.
          {" "}Counts come only from editors with Help improve ADCode on, and carry no account.
        </p>
        <h2>Most used</h2>
        <Table rows={summary.top} empty="No reports yet. Editors send yesterday's counts once a day." />
        <h2>Barely used commands</h2>
        <p className="lede">Each was run by someone, but rarely. Worth asking whether people cannot find it or do not need it.</p>
        <Table rows={summary.rare} empty="Nothing yet." />
      </>}
    </section>
  );
}
