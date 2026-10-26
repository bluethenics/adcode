"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { money } from "@/components/money";
import { apiFetch, type AdminOverviewView } from "@/lib/api";
import { dollars, parseGrowth, type Growth } from "@/lib/growth";
import { LEVEL_LABELS, parseStatusView, type StatusModel, type StatusView } from "@/lib/statusView";

/**
 * The front desk: what needs a decision, how ADCode is doing, and whether the AI is up.
 *
 * Three questions, in the order somebody opening the panel asks them. "Is anything waiting on
 * me?" - the queues, coloured only when they hold something. "Is it growing?" - five numbers
 * with a month of shape behind each and the change against the week before, because a number
 * without a comparison cannot be read. "Is the AI working?" - the same measurements as the
 * public status page, plus how many people will be emailed when it is not.
 *
 * Everything here is a summary with a door: each card links to the page where the work or the
 * detail is. Nothing is computed that the API did not already send.
 */
export default function AdminPage() {
  return (
    <AdminShell title="Overview" subtitle="What needs you, how ADCode is doing, and whether the AI is up.">
      <Overview />
    </AdminShell>
  );
}

interface Subscribers {
  active: number;
  models: number;
  incidents: number;
  pending: number;
}

const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** Exact below a hundred thousand; compact above, with the exact figure in the tooltip. */
const big = (value: number): string => (value >= 100_000 ? compact.format(value) : number.format(value));
const plural = (count: number, one: string, many: string): string => `${number.format(count)} ${count === 1 ? one : many}`;
/** Money is never broken across lines: from $100k up it reads "$12.3M", exact in the tooltip. */
const bigDollars = (micros: bigint): string =>
  micros >= 100_000_000_000n
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(micros / 1_000_000n))
    : dollars(micros);

function Overview() {
  const { token } = useAuth();
  const [counts, setCounts] = useState<AdminOverviewView | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [subscribers, setSubscribers] = useState<Subscribers | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);

  const load = useCallback(async () => {
    const auth = await token();
    const [overview, growthResult, statusResult, subscriberResult] = await Promise.all([
      apiFetch<AdminOverviewView>({ path: "/admin/overview", token: auth }),
      apiFetch<unknown>({ path: "/admin/growth", token: auth }),
      apiFetch<unknown>({ path: "/status", token: auth }),
      apiFetch<Subscribers>({ path: "/admin/status/subscribers", token: auth }),
    ]);
    if (overview.ok) setCounts(overview.value);
    setGrowth(growthResult.ok ? parseGrowth(growthResult.value) : null);
    setStatus(statusResult.ok ? parseStatusView(statusResult.value) : null);
    setSubscribers(subscriberResult.ok ? subscriberResult.value : null);
    setAsOf(Date.now());
    setLoaded(true);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="adm-overview">
      <Queues counts={counts} />
      <Pulse growth={growth} loaded={loaded} asOf={asOf} onRefresh={() => void load()} />
      <div className="adm-split">
        <ModelHealth status={status} loaded={loaded} />
        <Alerts subscribers={subscribers} loaded={loaded} />
      </div>
      <p className="adm-footnote">
        Paste any id into the box in the sidebar - or press <kbd>/</kbd> - and it opens the screen that shows it.
      </p>
    </div>
  );
}

/* ── Needs you ───────────────────────────────────────────────────────────── */

function Queues({ counts }: { counts: AdminOverviewView | null }) {
  const queues = [
    { href: "/admin/review", count: counts?.creativesWaiting, label: "Creatives to review", hint: "Ads waiting before delivery", clear: "No ads waiting" },
    { href: "/admin/money", count: counts?.withdrawalsPending, label: "Payouts to send", hint: counts === null ? "Withdrawals" : `${money(counts.pendingWithdrawalMicros)} held`, clear: "No withdrawals waiting" },
    { href: "/admin/review?tab=feedback", count: counts?.reportsOpen, label: "Reports to answer", hint: "From inside ADCode", clear: "Inbox zero" },
  ];
  const waiting = queues.reduce((total, queue) => total + (queue.count ?? 0), 0);
  return (
    <section className="adm-section" aria-labelledby="adm-queues-heading">
      <header className="adm-section-head">
        <h2 id="adm-queues-heading">Needs you</h2>
        <span className="adm-section-meta">{counts === null ? "Counting…" : waiting === 0 ? "All clear" : `${number.format(waiting)} waiting`}</span>
      </header>
      <div className="adm-queues">
        {queues.map((queue) => {
          const busy = (queue.count ?? 0) > 0;
          return (
            <Link key={queue.href} href={queue.href} className="adm-queue" data-waiting={busy}>
              <span className="adm-queue-count" title={queue.count === undefined ? undefined : number.format(queue.count)}>
                {queue.count === undefined ? "—" : big(queue.count)}
              </span>
              <span className="adm-queue-label">{queue.label}</span>
              <span className="adm-queue-hint">{busy || queue.count === undefined ? queue.hint : queue.clear}</span>
              <span className="adm-queue-go" aria-hidden="true">{busy ? "Review" : "Open"} →</span>
            </Link>
          );
        })}
        <div className="adm-queue adm-queue-quiet">
          <span className="adm-queue-label">Live in the editor</span>
          <span className="adm-queue-facts">
            <Link href="/admin/content?tab=notices">{counts === null ? "— notices" : plural(counts.noticesActive, "notice", "notices")}</Link>
            <Link href="/admin/money?tab=advertisers">{counts === null ? "— advertisers" : plural(counts.advertisers, "advertiser", "advertisers")}</Link>
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── Pulse ───────────────────────────────────────────────────────────────── */

/** Change of the last seven days against the seven before, or null without two full weeks. */
function weekChange(values: number[], mode: "sum" | "mean"): number | null {
  if (values.length < 14) return null;
  const total = (slice: number[]) => slice.reduce((sum, value) => sum + value, 0) / (mode === "mean" ? slice.length : 1);
  const recent = total(values.slice(-7)), before = total(values.slice(-14, -7));
  if (before === 0) return null;
  return Math.round(((recent - before) / before) * 1000) / 10;
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span className="adm-spark adm-spark-empty" aria-hidden="true" />;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const width = 120, height = 32, span = max - min || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(1)}`);
  return (
    <svg className="adm-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={`0,${height} ${points.join(" ")} ${width},${height}`} className="adm-spark-fill" />
      <polyline points={points.join(" ")} className="adm-spark-line" />
    </svg>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="adm-delta" data-trend="none">No earlier week</span>;
  const trend = value > 0.5 ? "up" : value < -0.5 ? "down" : "flat";
  return (
    <span className="adm-delta" data-trend={trend} title="Last 7 days against the 7 before">
      {trend === "up" ? "▲" : trend === "down" ? "▼" : "–"} {Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}%
      <span className="adm-delta-note"> vs last week</span>
    </span>
  );
}

function Pulse({ growth, loaded, asOf, onRefresh }: { growth: Growth | null; loaded: boolean; asOf: number | null; onRefresh: () => void }) {
  const daily = growth?.daily ?? [];
  const active = daily.map((day) => day.active), joined = daily.map((day) => day.joined), ads = daily.map((day) => day.adsShown);
  const kpis = growth === null ? [] : [
    { label: "Active, last 24 hours", value: growth.active1d, sub: `${number.format(growth.active7d)} in 7 days · ${number.format(growth.active30d)} in 30`, spark: active, delta: weekChange(active, "mean"), href: "/admin/growth" },
    { label: "New developers, 7 days", value: growth.joined7d, sub: `${number.format(growth.developers)} have used ADCode`, spark: joined, delta: weekChange(joined, "sum"), href: "/admin/growth" },
    { label: "Came back, 7 days", value: growth.returning7d ?? growth.active7d, sub: growth.returning7d === null ? "Active in 7 days" : `Of ${number.format(growth.active7d)} active this week`, spark: daily.map((day) => day.returning ?? 0), delta: weekChange(daily.map((day) => day.returning ?? 0), "mean"), href: "/admin/growth" },
    { label: "Ads shown, 7 days", value: growth.adsShown7d, sub: `${number.format(growth.clicks)} clicks all time`, spark: ads, delta: weekChange(ads, "sum"), href: "/admin/analytics" },
  ];
  return (
    <section className="adm-section" aria-labelledby="adm-pulse-heading">
      <header className="adm-section-head">
        <h2 id="adm-pulse-heading">Pulse</h2>
        <span className="adm-section-meta">
          {asOf === null ? "Loading…" : `Last 30 days · updated ${new Date(asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
          <button type="button" className="adm-link-button" onClick={onRefresh}>Refresh</button>
        </span>
      </header>
      {growth === null ? (
        <p className="adm-empty">{loaded ? "Growth numbers could not be loaded. Open Growth for details, or refresh." : "Counting…"}</p>
      ) : (
        <div className="adm-kpis">
          {kpis.map((kpi) => (
            <Link key={kpi.label} href={kpi.href} className="adm-kpi">
              <span className="adm-kpi-label">{kpi.label}</span>
              <strong className="adm-kpi-value" title={number.format(kpi.value)}>{big(kpi.value)}</strong>
              <Delta value={kpi.delta} />
              <Sparkline values={kpi.spark} label={`${kpi.label}, daily for the last ${String(kpi.spark.length)} days`} />
              <span className="adm-kpi-sub">{kpi.sub}</span>
            </Link>
          ))}
          <Link href="/admin/money" className="adm-kpi adm-kpi-money">
            <span className="adm-kpi-label">Earned by developers</span>
            <strong className="adm-kpi-value" title={dollars(growth.creditedMicros)}>{bigDollars(growth.creditedMicros)}</strong>
            <span className="adm-kpi-sub">{growth.paidOutMicros === null ? "Credited from billed views and clicks" : `${bigDollars(growth.paidOutMicros)} paid out so far`}</span>
          </Link>
        </div>
      )}
    </section>
  );
}

/* ── Model health ────────────────────────────────────────────────────────── */

const speed = (ms: number | null): string => (ms === null ? "—" : ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${String(Math.round(ms))}ms`);

function ModelRow({ model }: { model: StatusModel }) {
  const recent = model.days.slice(-14);
  return (
    <li className="adm-model" data-state={model.state}>
      <span className="adm-dot" data-state={model.state} aria-hidden="true" />
      <span className="adm-model-name">
        <b title={model.name}>{model.name}</b>
        <small>{`${LEVEL_LABELS[model.state] ?? model.state} · ${model.providerName}`}</small>
      </span>
      <span className="adm-model-days" aria-label={`Last ${String(recent.length)} days`}>
        {recent.map((day) => <i key={day.day} data-level={day.level} title={`${day.day}: ${number.format(day.turns)} turns, ${number.format(day.errors)} errors`} />)}
      </span>
      <span className="adm-model-num" title="Uptime over 90 days">{model.uptimePct === null ? "—" : `${model.uptimePct.toFixed(2)}%`}</span>
      <span className="adm-model-num adm-model-speed" title="Average answer time, 7 days">{speed(model.avgMs)}</span>
    </li>
  );
}

function ModelHealth({ status, loaded }: { status: StatusView | null; loaded: boolean }) {
  return (
    <section className="adm-card" aria-labelledby="adm-health-heading">
      <header className="adm-card-head">
        <div>
          <h2 id="adm-health-heading">Included AI</h2>
          <p>Measured from real turns, same as the public status page.</p>
        </div>
        {status !== null && (
          <span className="adm-state" data-state={status.overall.state}>
            <span className="adm-dot" data-state={status.overall.state} aria-hidden="true" />
            {status.overall.state === "operational" ? "Operational" : LEVEL_LABELS[status.overall.state] ?? status.overall.state}
          </span>
        )}
      </header>
      {status === null ? (
        <p className="adm-empty">{loaded ? "The status service did not answer." : "Loading…"}</p>
      ) : status.models.length === 0 ? (
        <p className="adm-empty">No included model has served a request yet.</p>
      ) : (
        <>
          {status.overall.state !== "operational" && <p className="adm-callout" data-state={status.overall.state}>{status.overall.title}</p>}
          <div className="adm-model-legend" aria-hidden="true"><span>Model</span><span>14 days</span><span>Uptime</span><span>Speed</span></div>
          <ul className="adm-models">{status.models.map((model) => <ModelRow key={`${model.provider}:${model.model}`} model={model} />)}</ul>
        </>
      )}
      <footer className="adm-card-foot">
        <Link href="/admin/status" className="adm-cta">Post an incident</Link>
        <a href="/status" target="_blank" rel="noreferrer">Public page ↗</a>
      </footer>
    </section>
  );
}

/* ── Alerts ──────────────────────────────────────────────────────────────── */

function Alerts({ subscribers, loaded }: { subscribers: Subscribers | null; loaded: boolean }) {
  return (
    <section className="adm-card" aria-labelledby="adm-alerts-heading">
      <header className="adm-card-head">
        <div>
          <h2 id="adm-alerts-heading">Status email alerts</h2>
          <p>People who joined from /status, no account needed.</p>
        </div>
      </header>
      {subscribers === null ? (
        <p className="adm-empty">{loaded ? "Subscriber counts are unavailable - is the status subscribers migration applied?" : "Loading…"}</p>
      ) : (
        <>
          <p className="adm-alerts-total">
            <strong title={number.format(subscribers.active)}>{big(subscribers.active)}</strong>
            <span>{subscribers.active === 1 ? "confirmed subscriber" : "confirmed subscribers"}</span>
          </p>
          <dl className="adm-facts">
            <div><dt>Model health</dt><dd>{number.format(subscribers.models)}</dd></div>
            <div><dt>Incident updates</dt><dd>{number.format(subscribers.incidents)}</dd></div>
            <div><dt>Not confirmed yet</dt><dd>{number.format(subscribers.pending)}</dd></div>
          </dl>
          <p className="adm-note">Model alerts send themselves: every 15 minutes the service checks each model and emails when one degrades, fails, or is back to normal. Incident emails go out when you send them from the Status page.</p>
        </>
      )}
      <footer className="adm-card-foot">
        <Link href="/admin/status" className="adm-cta">Status page tools</Link>
        <a href="/status#subscribe" target="_blank" rel="noreferrer">The sign-up form ↗</a>
      </footer>
    </section>
  );
}
