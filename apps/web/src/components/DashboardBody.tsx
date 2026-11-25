"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdcodeLoader } from "@/components/AdcodeLoader";
import { useAuth } from "@/components/AuthContext";
import { CopyField } from "@/components/CopyField";
import { EmailPreferences } from "@/components/EmailPreferences";
import { InvitePanel } from "@/components/InvitePanel";
import { EarningsHero, EarningsMonth } from "@/components/EarningsOverview";
import { LedgerRows } from "@/components/LedgerRows";
import { PayoutPanel } from "@/components/PayoutPanel";
import { Donut } from "@/components/charts/Donut";
import { StackedBars } from "@/components/charts/StackedBars";
import { TimeChart } from "@/components/charts/TimeChart";
import { seriesColor } from "@/components/charts/palette";
import { calendar } from "@/components/earningsMath";
import { cardRateLabel, type SponsoredCardRate } from "@/lib/cardRate";
import {
  apiFetch,
  MESSAGES,
  type ActivityView,
  type BalanceView,
  type LedgerPageView,
  type LedgerRowView,
  type PayoutsView,
} from "@/lib/api";

/*
 * How much of the ledger the screen reads by itself. The API pages it 200 rows at a time and a
 * card pays a fraction of a cent, so a busy account's month is thousands of rows: the first
 * page paints at once, and further pages load behind it until the month is covered or this
 * many rows are in. Past that, the screen says how far back it reaches ("Load older entries").
 */
const LEDGER_PAGE = 200;
const LEDGER_BACKFILL_ROWS = 1_000;
const MONTH_MS = 30 * 86_400_000;

/** Manual and agent are two halves of one measure, so they take adjacent palette slots. */
const MANUAL = seriesColor(0);
const AGENT = seriesColor(1);

/*
 * Charts are drawn over a complete calendar (`calendar` in earningsMath.ts), not over the days
 * that happen to have data: three entries on three scattered days would otherwise draw as three
 * evenly spaced points and read as a steady trickle.
 */

const hours = (ms: number): string => {
  const total = Math.round(ms / 60_000);
  return total < 60 ? `${total}m` : `${Math.floor(total / 60)}h ${total % 60}m`;
};

export function DashboardBody() {
  const { token, user } = useAuth();

  const [balance, setBalance] = useState<BalanceView | null>(null);
  const [activity, setActivity] = useState<ActivityView | null>(null);
  const [payouts, setPayouts] = useState<PayoutsView | null>(null);
  const [cardRate, setCardRate] = useState<string | null>(null);
  const [rows, setRows] = useState<LedgerRowView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    const t = await token().catch(() => null);

    // Independent reads, so they go together. Sequentially this was a round trip each of
    // latency before anything painted.
    const [bal, page, acts, pay, rate] = await Promise.all([
      apiFetch<BalanceView>({ path: "/balance", token: t }),
      apiFetch<LedgerPageView>({ path: `/ledger?limit=${LEDGER_PAGE}`, token: t }),
      apiFetch<ActivityView>({ path: "/activity?days=30", token: t }),
      // Only for the withdrawal meter under the balance; PayoutPanel reads its own.
      apiFetch<PayoutsView>({ path: "/payouts", token: t }),
      // What a card pays this person where they are: pay depends on the country (2026-11-25).
      apiFetch<SponsoredCardRate>({ path: "/sponsored/rate", token: t }),
    ]);

    if (!bal.ok) {
      setError(MESSAGES[bal.error]);
      setLoading(false);
      return;
    }

    setBalance(bal.value);
    setPayouts(pay.ok ? pay.value : null);
    setCardRate(rate.ok ? cardRateLabel(rate.value) : null);
    if (page.ok) {
      setRows(page.value.rows);
      setCursor(page.value.nextCursor);
    }
    if (acts.ok) setActivity(acts.value);
    if (!page.ok || !acts.ok) setError("Some account details could not be loaded. Please refresh to try again.");
    setLoading(false);

    // The rest of the month, behind the first paint. A failed page stops here quietly: the
    // screen already says how far back it reaches, and "Load older entries" tries again.
    if (!page.ok) return;
    let loaded = page.value.rows;
    let next = page.value.nextCursor;
    const monthStart = Date.now() - MONTH_MS;
    while (next !== null && loaded.length < LEDGER_BACKFILL_ROWS && (loaded.at(-1)?.createdAt ?? 0) > monthStart) {
      const older = await apiFetch<LedgerPageView>({
        path: `/ledger?limit=${LEDGER_PAGE}&cursor=${encodeURIComponent(next)}`,
        token: await token().catch(() => t),
      });
      if (!older.ok) break;
      loaded = [...loaded, ...older.value.rows];
      next = older.value.nextCursor;
      setRows(loaded);
      setCursor(next);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => calendar(30), []);

  /*
   * How far back the loaded rows reach: null when there is nothing older to load, otherwise
   * the oldest row's time. Totals for a period that starts before it are shown as lower bounds.
   * Only kinds that move `lifetimeMicros` count as earned (earningsMath.ts): a withdrawal is
   * an entry on this ledger too, and counting it would draw a cash-out as a cliff in earnings.
   */
  const coveredFrom = cursor === null ? null : (rows.at(-1)?.createdAt ?? Date.now());

  const activityByDay = useMemo(() => {
    const found = new Map(activity?.days.map((day) => [day.day, day]) ?? []);
    return {
      manual: days.map((day) => found.get(day)?.manualChars ?? 0),
      agent: days.map((day) => found.get(day)?.agentChars ?? 0),
      active: days.map((day) => found.get(day)?.activeMs ?? 0),
      files: days.map((day) => found.get(day)?.filesTouched ?? 0),
    };
  }, [activity, days]);

  if (loading) return <AdcodeLoader fill />;
  if (balance === null) return <div className="notice" data-tone="error" role="alert"><p>{error ?? "Couldn’t load your account."}</p><button className="btn btn-outline btn-small" onClick={() => void load()}>Try again</button></div>;

  const totals = activity?.totals;
  const written = (totals?.manualChars ?? 0) + (totals?.agentChars ?? 0);

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      {/* The hero figure: one per view, and this is the number people come for. */}
      <EarningsHero balance={balance} rows={rows} coveredFrom={coveredFrom} payouts={payouts} cardRate={cardRate} />

      <section className="workspace-section" id="earnings" aria-labelledby="earnings-title">
        <h2 className="workspace-section-title" id="earnings-title">Earnings</h2>
        <>
          <EarningsMonth rows={rows} coveredFrom={coveredFrom} />

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

          {/* The balance card shows the server's minimum when the rules loaded; this is the fallback. */}
          {payouts === null && (
            <div className="notice" data-tone="info">
              Withdrawals open once your balance reaches the minimum.{" "}
              <a className="link-button" href="#payouts">
                Check whether you&apos;re eligible
              </a>
              .
            </div>
          )}
        </>
      </section>

      <section className="workspace-section" id="invites" aria-labelledby="invites-title">
        <h2 className="workspace-section-title" id="invites-title">Invites</h2>
        <InvitePanel progress={{ activeMs: activity?.totals.activeMs ?? 0, lifetimeMicros: balance?.lifetimeMicros ?? "0" }} />
      </section>

      <section className="workspace-section" id="payouts" aria-labelledby="payouts-title">
        <h2 className="workspace-section-title" id="payouts-title">Payouts</h2>
        <PayoutPanel />
      </section>

      <section className="workspace-section" id="activity" aria-labelledby="activity-title">
        <h2 className="workspace-section-title" id="activity-title">Coding activity</h2>
        <>
          {written === 0 ? (
            <div className="empty">
              <h3>No coding recorded yet</h3>
              <p>
                Open ADCode and write something. The editor counts characters you typed and
                characters the AI agent wrote for you, and nothing else: no file names, no
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
                      label="Time in the editor"
                      value={hours(totals?.activeMs ?? 0)}
                      hint="Last 30 days"
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
                These numbers come from the editor on your machine and are counts only:
                characters, files, minutes. No file name, path, language, prompt or line of
                code is ever sent, which is the same rule the ad tags follow.
              </p>
            </>
          )}
        </>
      </section>

      <EmailPreferences />
      <section className="workspace-section" id="ledger" aria-labelledby="ledger-title">
        <h2 className="workspace-section-title" id="ledger-title">Ledger</h2>
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
              <LedgerRows rows={rows} groupCards />
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
            This ledger is append-only. Nothing is ever edited or deleted. If a credit has
            to be taken back, a separate reversal row appears and both stay visible. What
            you see here is exactly what we see.
          </p>
        </>
      </section>
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
