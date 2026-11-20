"use client";

/**
 * Admin > Analytics > AI models: how much the included AI is used, what it costs and what it
 * earns, for a chosen range, against the window before it.
 *
 * Every figure comes from the daily model rollup (adminInsights.ts), the same numbers the Models
 * page shows per model, so the two pages always agree. Per-model detail lives on the Models page;
 * this tab links there rather than repeating it.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { TimeChart } from "@/components/charts/TimeChart";
import { MONEY, seriesColor } from "@/components/charts/palette";
import { RefreshStamp } from "@/components/RefreshStamp";
import { ChartSkeleton, ExportButtons, InsightEmpty, InsightProblem, InsightStat, Loading, RangeSelect, StatSkeleton, TableSkeleton, useInsightResource } from "@/components/AdminInsightsUI";
import { change, compact, count, modelsQuery, ms, presetRange, previousRange, rangeLabel, share, usd, type ModelInsightRow, type RangePreset, type RawInsightDay } from "@/lib/adminInsights";
interface Response { range: { from: string; to: string }; refreshedAt: number | null; coverageFrom: string | null; users: number; previousUsers: number; rows: ModelInsightRow[]; daily: RawInsightDay[] }

const sum = (days: readonly RawInsightDay[], key: keyof Omit<RawInsightDay, "day">): number => days.reduce((total, day) => total + day[key], 0);

export function AiUsagePanel() {
  const [preset, setPreset] = useState<RangePreset>("30");
  const range = useMemo(() => presetRange(Number(preset), Date.now()), [preset]);
  const data = useInsightResource<Response>(`/admin/insights/models?${modelsQuery(range)}`);
  const value = data.value;
  return (
    <section aria-label="AI model usage">
      <div className="insight-toolbar">
        <div className="insight-toolbar-group"><RangeSelect value={preset} onChange={setPreset} /></div>
        <div className="insight-toolbar-group">
          <RefreshStamp asOf={data.asOf} refreshing={data.refreshing} fromCache={data.fromCache} onRefresh={() => void data.refresh()} />
          <ExportButtons label="Export days" query={`dataset=ai-daily&${modelsQuery(range)}`} disabled={value === null} />
          <ExportButtons label="Export models" query={`dataset=models&${modelsQuery(range)}`} formats={["csv"]} disabled={value === null} />
        </div>
      </div>
      <p className="insight-range"><strong>{rangeLabel(range)}</strong>, compared with {rangeLabel(previousRange(range))}.{value?.refreshedAt ? ` Counted ${new Date(value.refreshedAt).toLocaleString()}; recounted every 10 minutes.` : ""}</p>
      {data.failure !== null && <InsightProblem {...data.failure} onRetry={() => void data.refresh()} fills="These figures come from the daily model rollup that migration 20261120180100 adds. Once it is applied, pg_cron counts every included-model request into it every 10 minutes, back to the first recorded request." />}
      {value === null && data.failure === null && <Loading label="Loading AI usage"><StatSkeleton count={8} /><ChartSkeleton /><TableSkeleton rows={6} columns={6} /></Loading>}
      {value !== null && <AiUsageReport data={value} />}
    </section>
  );
}

export function AiUsageReport({ data }: { data: Response }) {
  const days = data.daily;
  const requests = sum(days, "requests"), successes = sum(days, "successes"), providerErrors = sum(days, "providerErrors");
  const cost = sum(days, "costMicros"), revenue = sum(days, "revenueMicros");
  const cached = sum(days, "cachedInputTokens"), measured = sum(days, "cacheMeasuredInputTokens");
  const previous = data.rows.reduce((acc, row) => ({ requests: acc.requests + row.previous.requests, cost: acc.cost + row.previous.costMicros, revenue: acc.revenue + row.previous.revenueMicros }), { requests: 0, cost: 0, revenue: 0 });
  const errorRate = successes + providerErrors > 0 ? providerErrors / (successes + providerErrors) : null;
  const top = [...data.rows].filter((row) => row.current.requests > 0).sort((a, b) => b.current.requests - a.current.requests).slice(0, 10);
  if (requests === 0 && previous.requests === 0) {
    return <InsightEmpty>No included-model requests in this range or the one before.{data.coverageFrom !== null ? ` Recorded history starts ${data.coverageFrom}.` : " Requests appear here within 10 minutes of being made."}</InsightEmpty>;
  }
  const busiest = top[0];
  return (
    <>
      <dl className="insight-stats">
        <InsightStat label="Requests" value={count(requests)} delta={change(requests, previous.requests)} note=" vs previous" />
        <InsightStat label="Users" value={count(data.users)} delta={change(data.users, data.previousUsers)} note=" distinct accounts" />
        <InsightStat label="Tokens in" value={compact(sum(days, "inputTokens"))} />
        <InsightStat label="Tokens out" value={compact(sum(days, "outputTokens"))} />
        <InsightStat label="Cached input" value={share(measured > 0 ? cached / measured : null)} note={measured > 0 ? `${compact(cached)} tokens from provider caches` : "Not recorded yet: the relay stores it from this release on"} />
        <InsightStat label="Provider cost" value={usd(cost)} delta={change(cost, previous.cost)} tone={cost > previous.cost && previous.cost > 0 ? "bad" : null} note=" at catalogue prices" />
        <InsightStat label="Wallet revenue" value={usd(revenue)} delta={change(revenue, previous.revenue)} note=" paid models only; plans are not split per model" />
        <InsightStat label="Error rate" value={share(errorRate)} note={` ${count(providerErrors)} provider errors`} />
      </dl>
      <section className="insight-card">
        <header><div><h2>Requests and users per day</h2><p>UTC days. Users are distinct accounts that day; the range total above counts each account once.</p></div></header>
        <TimeChart days={days.map((day) => day.day)} series={[
          { label: "Requests", color: seriesColor(0), values: days.map((day) => day.requests) },
          { label: "Users", color: seriesColor(1), values: days.map((day) => day.users) },
        ]} summary={`${requests} requests from ${data.users} accounts.`} />
      </section>
      <section className="insight-card">
        <header><div><h2>Provider cost per day</h2><p>Estimated from each model's catalogue prices; not an invoice.</p></div></header>
        <TimeChart days={days.map((day) => day.day)} series={[{ label: "Provider cost", color: MONEY, values: days.map((day) => day.costMicros / 1_000_000), format: (v) => `$${v.toFixed(2)}` }]} summary={`Provider cost ${usd(cost)}.`} />
      </section>
      <section className="insight-card">
        <header>
          <div><h2>Busiest models</h2><p>Top {top.length} by requests. {busiest ? `${busiest.name} handled ${share(busiest.share)} of all requests.` : ""}</p></div>
          <Link className="btn btn-small" href="/admin/tagflow?view=models">Open Models for every model</Link>
        </header>
        <div className="insight-table-wrap"><table className="insight-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Requests</th><th scope="col">Users</th><th scope="col">Error rate</th><th scope="col">First token (median)</th><th scope="col">Cost</th><th scope="col">Change</th></tr></thead>
          <tbody>{top.map((row) => (
            <tr key={row.key}>
              <td>{row.name} <span className="insight-muted">{row.providerName}</span></td>
              <td>{count(row.current.requests)}</td><td>{count(row.current.users)}</td><td>{share(row.current.errorRate)}</td>
              <td>{ms(row.current.firstTokenP50)}</td><td>{usd(row.current.costMicros)}</td><td>{change(row.current.requests, row.previous.requests) ?? "—"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
      <p className="insight-muted">Requests are verified-account attempts, including ones ADCode refused; admin tests are left out. Error rate is provider errors over successes plus provider errors, as in the provider reports. Time to first token is measured on successful responses and shown per model, because a median does not average across models.</p>
    </>
  );
}
