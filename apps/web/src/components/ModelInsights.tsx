"use client";

/**
 * What each model does for people, on Admin > ADCode models: figures on every row, one model's
 * full data in a slide-over, and a side-by-side comparison.
 *
 * Read from the daily rollup (services/api/src/adminInsights.ts), so opening a model costs one
 * small query whatever the range. The slide-over keeps the catalogue where it was: closing it
 * returns to the same row, scrolled and filtered as before.
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { TimeChart } from "@/components/charts/TimeChart";
import { seriesColor } from "@/components/charts/palette";
import { ChartSkeleton, ExportButtons, InsightEmpty, InsightProblem, InsightStat, Loading, StatSkeleton, TableSkeleton, useInsightResource } from "@/components/AdminInsightsUI";
import { RefreshStamp } from "@/components/RefreshStamp";
import { change, compact, count, ms, modelQuery, previousRange, rangeLabel, share, usd, type DayRange, type ModelDetail, type ModelInsightRow } from "@/lib/adminInsights";

const KIND_LABEL = { free: "Free", included: "Included", paid: "Paid" } as const;

export function KindBadge({ kind }: { kind: ModelInsightRow["kind"] }) {
  if (kind === null) return null;
  return <span className="model-kind" data-kind={kind} title={kind === "free" ? "Costs people nothing" : kind === "included" ? "Uses the free allowance or a plan" : "Charged to the dollar wallet"}>{KIND_LABEL[kind]}</span>;
}

/** The row's figures in one line. `loaded` false while the first answer is on its way. */
export function ModelRowFigures({ row, loaded }: { row: ModelInsightRow; loaded: boolean }) {
  if (!loaded) return <span className="model-figures" aria-hidden="true"><span className="adm-skel-bar" style={{ width: 180 }} /></span>;
  const c = row.current;
  if (c.requests === 0) return <span className="model-figures">{row.previous.requests > 0 ? `No requests in this range (${count(row.previous.requests)} before)` : "No requests in this range"}</span>;
  const errorTone = c.errorRate === null ? undefined : c.errorRate >= 0.1 ? "bad" : c.errorRate >= 0.03 ? "warn" : undefined;
  return (
    <span className="model-figures">
      <span><b>{compact(c.requests)}</b> requests</span>
      <span><b>{compact(c.users)}</b> users</span>
      <span data-tone={errorTone}><b>{share(c.errorRate)}</b> errors</span>
      <span><b>{ms(c.firstTokenP50)}</b> first token</span>
    </span>
  );
}

/** A slide-over panel, closed by Escape, the backdrop or its button; focus returns where it was. */
function Drawer({ title, subtitle, onClose, children, labelledBy }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; before?.focus?.(); };
  }, [onClose]);
  return (
    <>
      <div className="model-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="model-drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <header>
          <div><h2 id={labelledBy}>{title}</h2>{subtitle !== undefined && <p>{subtitle}</p>}</div>
          <button ref={close} type="button" className="btn btn-small" onClick={onClose}>Close</button>
        </header>
        <div className="model-drawer-body">{children}</div>
      </aside>
    </>
  );
}

interface DetailResponse extends ModelDetail { range: DayRange & { previousFrom: string; previousTo: string }; modelName: string | null; generatedAt: number }

const tone = (current: number | null, previous: number | null, lowerIsBetter = false): "good" | "bad" | null => {
  if (current === null || previous === null || previous === 0 || current === previous) return null;
  return (current < previous) === lowerIsBetter ? "good" : "bad";
};

/** One model: every figure for the range, against the window before, and day by day. */
export function ModelDetailDrawer({ row, range, onClose, onEdit }: { row: ModelInsightRow; range: DayRange; onClose: () => void; onEdit?: () => void }) {
  const path = `/admin/insights/model?${modelQuery(range, row)}`;
  const detail = useInsightResource<DetailResponse>(path);
  const data = detail.value;
  const before = previousRange(range);
  return (
    <Drawer labelledBy="model-detail-title" onClose={onClose} title={row.name}
      subtitle={<>{row.providerName} · <code>{row.modelId}</code>{row.upstreamModel !== row.modelId && <> → <code>{row.upstreamModel}</code></>} · {row.kind === null ? "No longer in the catalogue" : `${KIND_LABEL[row.kind]}, ${row.status}`}</>}>
      <div className="model-drawer-actions">
        <span className="insight-range"><strong>{rangeLabel(range)}</strong> · compared with {rangeLabel(before)}</span>
      </div>
      <div className="model-drawer-actions">
        <RefreshStamp asOf={detail.asOf} refreshing={detail.refreshing} fromCache={detail.fromCache} onRefresh={() => void detail.refresh()} />
        <ExportButtons label="Export this model" query={`dataset=model&${modelQuery(range, row)}`} disabled={data === null} />
        {onEdit !== undefined && <button type="button" className="btn btn-small" onClick={onEdit}>Edit model settings</button>}
      </div>
      {detail.failure !== null && <InsightProblem {...detail.failure} onRetry={() => void detail.refresh()} fills="Per-model figures come from the daily rollup that migration 20261120180100 adds; pg_cron fills it every 10 minutes." />}
      {data === null && detail.failure === null && (
        <Loading label={`Loading ${row.name}`}><StatSkeleton count={8} /><ChartSkeleton /><TableSkeleton rows={4} /></Loading>
      )}
      {data !== null && <ModelDetailBody data={data} row={row} />}
    </Drawer>
  );
}

export function ModelDetailBody({ data, row }: { data: DetailResponse; row: Pick<ModelInsightRow, "kind" | "name"> }) {
  const t = data.totals, p = data.previous;
  const days = data.daily.map((day) => day.day);
  const counted = data.refreshedAt === null ? "not yet counted" : `counted ${new Date(data.refreshedAt).toLocaleString()}`;
  if (t.requests === 0 && p.requests === 0) {
    return <InsightEmpty>No requests to {row.name} in this range or the one before. Figures appear here within 10 minutes of the first request{data.coverageFrom !== null ? `; history starts ${data.coverageFrom}` : ""}.</InsightEmpty>;
  }
  return (
    <>
      <dl className="insight-stats">
        <InsightStat label="Requests" value={count(t.requests)} delta={change(t.requests, p.requests)} note=" vs previous" />
        <InsightStat label="Users" value={count(t.users)} delta={change(t.users, p.users)} note=" distinct accounts" />
        <InsightStat label="Tokens in" value={compact(t.inputTokens)} delta={change(t.inputTokens, p.inputTokens)} />
        <InsightStat label="Tokens out" value={compact(t.outputTokens)} delta={change(t.outputTokens, p.outputTokens)} />
        <InsightStat label="Cached input" value={share(t.cachedShare)} note={t.cachedShare === null ? "Not recorded for these requests yet: the relay stores it from this release on, for providers that report it" : `${compact(t.cachedInputTokens)} tokens from the provider's cache`} />
        <InsightStat label="Provider cost" value={usd(t.costMicros)} delta={change(t.costMicros, p.costMicros)} tone={tone(t.costMicros, p.costMicros, true)} note=" at catalogue prices" />
        <InsightStat label="Revenue" value={row.kind === "paid" || t.revenueMicros > 0 ? usd(t.revenueMicros) : "—"} note={row.kind === "paid" || t.revenueMicros > 0 ? ` ${count(t.walletCharges)} wallet charges` : "Included models are paid for by plans, not per model"} />
        <InsightStat label="Error rate" value={share(t.errorRate)} delta={t.errorRate === null || p.errorRate === null ? null : `${t.errorRate >= p.errorRate ? "+" : "−"}${Math.abs((t.errorRate - p.errorRate) * 100).toFixed(1)} pts`} tone={tone(t.errorRate, p.errorRate, true)} note={` ${count(t.providerErrors)} provider errors`} />
        <InsightStat label="First token, median" value={ms(t.firstTokenP50)} delta={t.firstTokenP50 === null || p.firstTokenP50 === null ? null : change(t.firstTokenP50, p.firstTokenP50)} tone={tone(t.firstTokenP50, p.firstTokenP50, true)} note={` ${count(t.firstTokenSamples)} samples`} />
        <InsightStat label="First token, p90" value={ms(t.firstTokenP90)} note="Slowest 10% start after this" />
        <InsightStat label="Cancelled" value={count(t.cancelled)} delta={change(t.cancelled, p.cancelled)} tone={tone(t.cancelled, p.cancelled, true)} note={` ${share(t.cancelRate)} of requests`} />
        <InsightStat label="Not answered" value={count(t.rejected + t.relayErrors + t.unfinished)} note={`${count(t.rejected)} refused by ADCode, ${count(t.relayErrors)} relay errors, ${count(t.unfinished)} unfinished`} />
      </dl>
      <section className="insight-card">
        <header><div><h3>Requests and users per day</h3><p>UTC days. Users are distinct accounts that day.</p></div></header>
        <TimeChart days={days} series={[
          { label: "Requests", color: seriesColor(0), values: data.daily.map((day) => day.requests) },
          { label: "Users", color: seriesColor(1), values: data.daily.map((day) => day.users) },
        ]} summary={`${row.name}: ${t.requests} requests from ${t.users} accounts over ${days.length} days.`} />
      </section>
      <section className="insight-card">
        <header><div><h3>Time to first token per day</h3><p>Successful responses. Median and 90th percentile, read from a histogram accurate to within 10%.</p></div></header>
        {t.firstTokenSamples === 0 ? <InsightEmpty>No timed responses in this range.</InsightEmpty> : (
          <TimeChart days={days} area={false} series={[
            { label: "Median", color: seriesColor(0), values: data.daily.map((day) => day.firstTokenP50 ?? 0), format: (v) => ms(v) },
            { label: "p90", color: seriesColor(3), values: data.daily.map((day) => day.firstTokenP90 ?? 0), format: (v) => ms(v) },
          ]} summary={`Median time to first token ${ms(t.firstTokenP50)}, p90 ${ms(t.firstTokenP90)}.`} />
        )}
      </section>
      <section className="insight-card">
        <header><div><h3>Errors and cancellations per day</h3></div></header>
        <TimeChart days={days} area={false} series={[
          { label: "Provider errors", color: seriesColor(4), values: data.daily.map((day) => day.providerErrors) },
          { label: "Cancelled", color: seriesColor(6), values: data.daily.map((day) => day.cancelled) },
        ]} summary={`${t.providerErrors} provider errors and ${t.cancelled} cancellations.`} />
      </section>
      <section className="insight-card">
        <header><div><h3>Top error codes</h3><p>Provider and relay errors in this range, most frequent first.</p></div></header>
        {data.errors.length === 0 ? <InsightEmpty title="No errors">Nothing failed with an error code in this range.</InsightEmpty> : (
          <div className="insight-table-wrap"><table className="insight-table">
            <thead><tr><th scope="col">Code</th><th scope="col">Stage</th><th scope="col">Upstream status</th><th scope="col">Requests</th><th scope="col">Share</th><th scope="col">Seen</th></tr></thead>
            <tbody>{data.errors.map((error) => (
              <tr key={`${error.outcome}:${error.code}:${error.upstreamStatus ?? "none"}`}>
                <td><code>{error.code}</code></td><td>{error.outcome.replace("_", " ")}</td><td>{error.upstreamStatus ?? "none received"}</td>
                <td>{count(error.requests)}</td><td>{share(t.requests > 0 ? error.requests / t.requests : null)}</td>
                <td>{error.firstDay === error.lastDay ? error.firstDay : `${error.firstDay} – ${error.lastDay}`}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      <p className="insight-muted">Figures {counted}; the rollup refreshes every 10 minutes. Admin tests are left out. Cost uses the catalogue's prices and is not an invoice.</p>
    </>
  );
}

/** Up to four models side by side: the list's figures, and their daily requests on one chart. */
export function ModelCompareDrawer({ rows, range, onClose, onOpen }: { rows: ModelInsightRow[]; range: DayRange; onClose: () => void; onOpen: (row: ModelInsightRow) => void }) {
  const metrics: { label: string; value: (row: ModelInsightRow) => number | null; show: (value: number | null) => string; best: "high" | "low" | null }[] = [
    { label: "Requests", value: (r) => r.current.requests, show: (v) => count(v ?? 0), best: "high" },
    { label: "Users", value: (r) => r.current.users, show: (v) => count(v ?? 0), best: "high" },
    { label: "Tokens in", value: (r) => r.current.inputTokens, show: (v) => compact(v ?? 0), best: null },
    { label: "Tokens out", value: (r) => r.current.outputTokens, show: (v) => compact(v ?? 0), best: null },
    { label: "Cached input", value: (r) => r.current.cachedShare, show: (v) => share(v), best: "high" },
    { label: "Provider cost", value: (r) => r.current.costMicros, show: (v) => usd(v ?? 0), best: null },
    { label: "Cost per 1K requests", value: (r) => (r.current.requests > 0 ? r.current.costMicros / r.current.requests * 1000 : null), show: (v) => (v === null ? "—" : usd(v)), best: "low" },
    { label: "Revenue", value: (r) => r.current.revenueMicros, show: (v) => usd(v ?? 0), best: null },
    { label: "Error rate", value: (r) => r.current.errorRate, show: (v) => share(v), best: "low" },
    { label: "First token, median", value: (r) => r.current.firstTokenP50, show: (v) => ms(v), best: "low" },
    { label: "First token, p90", value: (r) => r.current.firstTokenP90, show: (v) => ms(v), best: "low" },
    { label: "Cancelled", value: (r) => r.current.cancelRate, show: (v) => share(v), best: "low" },
    { label: "Share of all requests", value: (r) => r.share, show: (v) => share(v), best: null },
  ];
  return (
    <Drawer labelledBy="model-compare-title" onClose={onClose} title={`Comparing ${rows.length} models`} subtitle={rangeLabel(range)}>
      <section className="insight-card">
        <div className="insight-table-wrap"><table className="insight-table">
          <thead><tr><th scope="col">Figure</th>{rows.map((row, index) => <th scope="col" key={row.key}><span style={{ color: seriesColor(index) }}>■</span> <button type="button" className="admin-models-link" onClick={() => onOpen(row)}>{row.name}</button></th>)}</tr></thead>
          <tbody>{metrics.map((metric) => {
            const values = rows.map(metric.value);
            const usable = values.filter((v): v is number => v !== null && (metric.best !== "low" || rows[values.indexOf(v)]!.current.requests > 0));
            const best = metric.best === null || usable.length < 2 ? null : metric.best === "high" ? Math.max(...usable) : Math.min(...usable);
            return <tr key={metric.label}><th scope="row">{metric.label}</th>{values.map((value, index) => <td key={rows[index]!.key} className={best !== null && value === best ? "best" : undefined}>{metric.show(value)}</td>)}</tr>;
          })}</tbody>
        </table></div>
        <p className="insight-muted">Green marks the best value where higher or lower is clearly better. Rates need requests to mean anything; a model with none is not marked.</p>
      </section>
      <CompareTrend rows={rows} range={range} />
      <ExportButtons label="Export comparison" query={`dataset=models&from=${range.from}&to=${range.to}&keys=${encodeURIComponent(JSON.stringify(rows.map((row) => row.key)))}`} formats={["csv"]} />
    </Drawer>
  );
}

/** Daily requests per compared model. Each model is one small rollup read, in parallel. */
function CompareTrend({ rows, range }: { rows: ModelInsightRow[]; range: DayRange }) {
  const a = useInsightResource<DetailResponse>(rows[0] ? `/admin/insights/model?${modelQuery(range, rows[0])}` : null);
  const b = useInsightResource<DetailResponse>(rows[1] ? `/admin/insights/model?${modelQuery(range, rows[1])}` : null);
  const c = useInsightResource<DetailResponse>(rows[2] ? `/admin/insights/model?${modelQuery(range, rows[2])}` : null);
  const d = useInsightResource<DetailResponse>(rows[3] ? `/admin/insights/model?${modelQuery(range, rows[3])}` : null);
  const loaded = [a, b, c, d].slice(0, rows.length);
  const ready = loaded.every((one) => one.value !== null);
  const failed = loaded.find((one) => one.failure !== null)?.failure ?? null;
  const days = useMemo(() => loaded.find((one) => one.value !== null)?.value?.daily.map((day) => day.day) ?? [], [loaded]);
  return (
    <section className="insight-card">
      <header><div><h3>Requests per day</h3><p>UTC days.</p></div></header>
      {failed !== null ? <InsightProblem {...failed} onRetry={() => loaded.forEach((one) => void one.refresh())} /> : !ready ? <Loading label="Loading the trend"><ChartSkeleton /></Loading> : (
        <TimeChart days={days} area={false} series={rows.map((row, index) => ({ label: row.name, color: seriesColor(index), values: loaded[index]!.value!.daily.map((day) => day.requests) }))} summary={`Daily requests for ${rows.map((row) => row.name).join(", ")}.`} />
      )}
    </section>
  );
}

/** Models with history in the range that the catalogue no longer lists. */
export function RetiredModels({ rows, onOpen }: { rows: ModelInsightRow[]; onOpen: (row: ModelInsightRow) => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="retired-models">
      <h4>No longer in the catalogue</h4>
      <p className="row-sub">Removed models, or older provider revisions of a model, with requests in this range or the one before.</p>
      <ul>{rows.map((row) => (
        <li key={row.key}>
          <span><strong>{row.name}</strong> <span className="insight-muted">{row.providerName} · {row.upstreamModel}</span></span>
          <ModelRowFigures row={row} loaded />
          <button type="button" className="btn btn-small" onClick={() => onOpen(row)}>Data</button>
        </li>
      ))}</ul>
    </section>
  );
}
