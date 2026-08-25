"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { CopyField } from "@/components/CopyField";
import { LedgerRows } from "@/components/LedgerRows";
import { Segmented } from "@/components/ios/Segmented";
import { Donut } from "@/components/charts/Donut";
import { StackedBars } from "@/components/charts/StackedBars";
import { Sparkline, TimeChart } from "@/components/charts/TimeChart";
import { MONEY, seriesColor } from "@/components/charts/palette";
import { moneyExact, moneyProgress } from "@/components/money";
import {
  apiFetch,
  MESSAGES,
  type ActivityView,
  type BalanceView,
  type LedgerPageView,
  type LedgerRowView,
} from "@/lib/api";

type View = "overview" | "activity" | "ledger";

const VIEWS = [
  { value: "overview" as const, label: "Overview" },
  { value: "activity" as const, label: "Coding" },
  { value: "ledger" as const, label: "Ledger" },
];

/** Manual and agent are two halves of one measure, so they take adjacent palette slots. */
const MANUAL = seriesColor(0);
const AGENT = seriesColor(1);

export default function Dashboard() {
  return (
    <AppShell title="Your account" subtitle="Earnings, activity, and every entry behind them">
      <DashboardBody />
    </AppShell>
  );
}

/**
 * The last `count` UTC days, oldest first.
 *
 * Charts are drawn over a complete calendar, not over the days that happen to have data:
 * three entries on three scattered days would otherwise draw as three evenly spaced
 * points and read as a steady trickle.
 */
function calendar(count: number): string[] {
  const today = Date.now();
  return Array.from({ length: count }, (_, index) =>
    new Date(today - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  );
}

const hours = (ms: number): string => {
  const total = Math.round(ms / 60_000);
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`;
};

function DashboardBody() {
  const { token, user } = useAuth();

  const [view, setView] = useState<View>("overview");
  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [activity, setActivity] = useState<ActivityView | null>(null);
  const [rows, setRows] = useState<LedgerRowView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await token();

    // Three independent reads, so they go together. Sequentially this was three round
    // trips of latency before anything painted.
    const [bal, page, acts] = await Promise.all([
      apiFetch<BalanceView>({ path: "/balance", token: t }),
      apiFetch<LedgerPageView>({ path: "/ledger?limit=200", token: t }),
      apiFetch<ActivityView>({ path: "/activity?days=30", token: t }),
    ]);

    if (!bal.ok) {
      setError(MESSAGES[bal.error]);
      setLoading(false);
      return;
    }

    setBalance(bal.value);
    if (page.ok) {
      setRows(page.value.rows);
      setCursor(page.value.nextCursor);
    }
    if (acts.ok) setActivity(acts.value);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => calendar(30), []);

  /** Earnings per day, folded out of the ledger the page already has. */
  const earned = useMemo(() => {
    const byDay = new Map<string, bigint>();
    for (const row of rows) {
      const day = new Date(row.createdAt).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0n) + BigInt(row.micros || "0"));
    }
    // Micros to a float only for the plot. Every figure the reader is shown is still
    // formatted from the exact integer - this is the one place an approximation is
    // acceptable, because it decides a pixel rather than a payment.
    return days.map((day) => Number(byDay.get(day) ?? 0n) / 1_000_000);
  }, [rows, days]);

  const activityByDay = useMemo(() => {
    const found = new Map(activity?.days.map((day) => [day.day, day]) ?? []);
    return {
      manual: days.map((day) => found.get(day)?.manualChars ?? 0),
      agent: days.map((day) => found.get(day)?.agentChars ?? 0),
      active: days.map((day) => found.get(day)?.activeMs ?? 0),
      files: days.map((day) => found.get(day)?.filesTouched ?? 0),
    };
  }, [activity, days]);

  if (loading) return <p className="lede">Loading…</p>;

  const totals = activity?.totals;
  const written = (totals?.manualChars ?? 0) + (totals?.agentChars ?? 0);
  const thisWeek = earned.slice(-7).reduce((sum, value) => sum + value, 0);

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      {/* The hero figure: one per view, and this is the number people come for. */}
      <div className="ios-card hero-balance">
        <span className="hero-balance-label">Available balance</span>
        <strong className="hero-figure money">{moneyExact(balance?.availableMicros ?? "0")}</strong>
        <span className="hero-balance-sub">
          {moneyExact(balance?.lifetimeMicros ?? "0")} earned all time ·{" "}
          {moneyProgress((thisWeek * 1_000_000).toFixed(0))} in the last seven days
        </span>
        <div className="hero-balance-spark">
          <Sparkline values={earned.slice(-12)} color={MONEY} />
        </div>
      </div>

      <Segmented label="Dashboard view" value={view} options={VIEWS} onChange={setView} />

      {view === "overview" && (
        <>
          <section className="ios-card">
            <header className="ios-card-head">
              <h2>Earnings, day by day</h2>
              <p>Every verified view credited to you over the last 30 days.</p>
            </header>
            <TimeChart
              days={days}
              area
              height={230}
              summary={`Daily earnings over 30 days, totalling ${moneyExact(balance?.lifetimeMicros ?? "0")}.`}
              series={[
                {
                  label: "Earned",
                  color: MONEY,
                  values: earned,
                  format: (value) => `$${value.toFixed(value < 1 ? 4 : 2)}`,
                },
              ]}
            />
          </section>

          <div className="ios-tiles">
            <Tile
              label="Verified views"
              value={rows.filter((row) => row.kind === "impression").length.toLocaleString("en-US")}
              hint="Cards you actually saw"
            />
            <Tile
              label="Clicks"
              value={rows.filter((row) => row.kind === "click").length.toLocaleString("en-US")}
              hint="Sponsors you followed"
            />
            <Tile
              label="Corrections"
              value={rows.filter((row) => row.kind === "reversal").length.toLocaleString("en-US")}
              hint="Reversals, always visible"
            />
            <Tile
              label="Time in the editor"
              value={hours(totals?.activeMs ?? 0)}
              hint="Last 30 days"
            />
          </div>

          <div className="ios-card">
            <header className="ios-card-head">
              <h2>Your account</h2>
              <p>Quote this ID if you ever email us about a payment.</p>
            </header>
            <CopyField label="Account ID" value={user?.uid ?? "—"} />
            {user?.email !== null && user?.email !== undefined && (
              <CopyField label="Email" value={user.email} />
            )}
          </div>

          <div className="notice" data-tone="info">
            Withdrawals aren&apos;t open yet. Your balance keeps accruing and every entry
            stays on this ledger — we&apos;ll say here when cash-out is available.
          </div>
        </>
      )}

      {view === "activity" && (
        <>
          {written === 0 ? (
            <div className="empty">
              <h3>No coding recorded yet</h3>
              <p>
                Open ADCode and write something. The editor counts characters you typed and
                characters the AI agent wrote for you, and nothing else — no file names, no
                paths, no code. The split shows up here within a few minutes.
              </p>
            </div>
          ) : (
            <>
              <div className="ios-split">
                <section className="ios-card">
                  <header className="ios-card-head">
                    <h2>Who wrote it</h2>
                    <p>Characters, over the last 30 days.</p>
                  </header>
                  <Donut
                    summary={`${totals?.agentPercent ?? 0}% of characters written by the AI agent.`}
                    centerValue={`${100 - (totals?.agentPercent ?? 0)}%`}
                    centerLabel="by hand"
                    slices={[
                      {
                        label: "You typed",
                        value: totals?.manualChars ?? 0,
                        display: (totals?.manualChars ?? 0).toLocaleString("en-US"),
                      },
                      {
                        label: "AI agent wrote",
                        value: totals?.agentChars ?? 0,
                        display: (totals?.agentChars ?? 0).toLocaleString("en-US"),
                      },
                    ]}
                  />
                </section>

                <section className="ios-card">
                  <header className="ios-card-head">
                    <h2>Agent proposals</h2>
                    <p>Every change it offered went past you first.</p>
                  </header>
                  <div className="ios-tiles ios-tiles-tight">
                    <Tile
                      label="Accepted"
                      value={(totals?.acceptedEdits ?? 0).toLocaleString("en-US")}
                      hint="Hunks you applied"
                    />
                    <Tile
                      label="Rejected"
                      value={(totals?.rejectedEdits ?? 0).toLocaleString("en-US")}
                      hint="Hunks you turned down"
                    />
                    <Tile
                      label="Sessions"
                      value={(totals?.sessions ?? 0).toLocaleString("en-US")}
                      hint="Times you opened ADCode"
                    />
                    <Tile
                      label="Busiest day"
                      value={Math.max(
                        0,
                        ...activityByDay.manual.map(
                          (value, index) => value + (activityByDay.agent[index] ?? 0),
                        ),
                      ).toLocaleString("en-US")}
                      hint="Characters in one day"
                    />
                  </div>
                </section>
              </div>

              <section className="ios-card">
                <header className="ios-card-head">
                  <h2>Manual and agent, day by day</h2>
                  <p>Characters written, stacked.</p>
                </header>
                <StackedBars
                  days={days}
                  height={210}
                  summary="Characters written per day, split between you and the AI agent."
                  series={[
                    { label: "You typed", color: MANUAL, values: activityByDay.manual },
                    { label: "AI agent wrote", color: AGENT, values: activityByDay.agent },
                  ]}
                />
              </section>

              <section className="ios-card">
                <header className="ios-card-head">
                  <h2>Files and focus</h2>
                  <p>How wide the work spread, and how long it held.</p>
                </header>
                <TimeChart
                  days={days}
                  height={200}
                  summary="Files touched per day, over 30 days."
                  series={[
                    {
                      label: "Files touched",
                      color: seriesColor(2),
                      values: activityByDay.files,
                    },
                  ]}
                />
              </section>

              <p className="field-hint" style={{ maxWidth: "64ch" }}>
                These numbers come from the editor on your machine and are counts only —
                characters, files, minutes. No file name, path, language, prompt or line of
                code is ever sent, which is the same rule the ad tags follow.
              </p>
            </>
          )}
        </>
      )}

      {view === "ledger" && (
        <>
          {rows.length === 0 ? (
            <div className="empty">
              <h3>Nothing here yet</h3>
              <p>
                Open ADCode and keep working. When a sponsored card appears and you see it,
                a row lands here with the exact amount.
              </p>
            </div>
          ) : (
            <>
              <LedgerRows rows={rows} />
              {cursor !== null && (
                <div className="actions">
                  <button
                    className="btn btn-outline btn-small"
                    disabled={more}
                    onClick={() => {
                      void (async () => {
                        setMore(true);
                        const page = await apiFetch<LedgerPageView>({
                          path: `/ledger?limit=100&cursor=${encodeURIComponent(cursor)}`,
                          token: await token(),
                        });
                        setMore(false);
                        if (!page.ok) {
                          setError(MESSAGES[page.error]);
                          return;
                        }
                        setRows((current) => [...current, ...page.value.rows]);
                        setCursor(page.value.nextCursor);
                      })();
                    }}
                  >
                    Load older entries
                  </button>
                </div>
              )}
            </>
          )}

          <p className="field-hint" style={{ marginTop: 22, maxWidth: "64ch" }}>
            This ledger is append-only. Nothing is ever edited or deleted — if a credit has
            to be taken back, a separate reversal row appears and both stay visible. What
            you see here is exactly what we see.
          </p>
        </>
      )}
    </>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="ios-tile">
      <span className="ios-tile-label">{label}</span>
      <span className="ios-tile-value">{value}</span>
      <span className="ios-tile-hint">{hint}</span>
    </div>
  );
}
