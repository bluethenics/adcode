"use client";

import { useMemo, useState } from "react";
import { StackedBars } from "@/components/charts/StackedBars";
import { MONEY, seriesColor } from "@/components/charts/palette";
import { money, moneyExact, moneyProgress } from "@/components/money";
import type { BalanceView, LedgerRowView, PayoutsView } from "@/lib/api";
import {
  calendar,
  cardsSeen,
  earningsByDay,
  periodTotal,
  startOfToday,
  withdrawProgress,
  type PeriodTotal,
} from "./earningsMath";

/**
 * The top of the earnings screen: the balance, what it has done lately, how far it is from
 * a withdrawal, then the month as a chart and four figures.
 *
 * Every money figure is formatted from exact micros. The ledger arrives a page at a time,
 * so `coveredFrom` says how far back the loaded rows reach: a period that starts before that
 * is shown as "at least" (a trailing +), never as a smaller total presented as the whole.
 */
export interface EarningsOverviewProps {
  balance: BalanceView;
  rows: LedgerRowView[];
  /** The oldest moment the loaded rows reach back to, or null when nothing older exists. */
  coveredFrom: number | null;
  /** The withdrawal rules as the server sent them; null while unknown. */
  payouts: PayoutsView | null;
}

const DAY_MS = 86_400_000;

function Period({ label, total }: { label: string; total: PeriodTotal }) {
  return (
    <div className="earnings-period">
      <dt>{label}</dt>
      <dd className="money" title={total.complete ? undefined : "At least this much: older entries are still loading"}>
        {moneyProgress(total.micros.toString())}
        {!total.complete && <span className="earnings-at-least" aria-label="or more">+</span>}
      </dd>
    </div>
  );
}

/**
 * "$1.44", then "15" smaller: every micro is still on screen, so a single card seen visibly
 * moves the balance, but the figure reads as dollars and cents first. Trailing zeros of the
 * fraction are dropped - "$12.50" rather than "$12.50 0000".
 */
function ExactFigure({ value }: { value: string }) {
  const cut = value.indexOf(".") + 3;
  if (cut < 3) return <>{value}</>;
  const tail = value.slice(cut).replace(/0+$/, "");
  return (
    <>
      {value.slice(0, cut)}
      {tail.length > 0 && <span className="hero-figure-micro">{tail}</span>}
    </>
  );
}

function WithdrawMeter({ payouts }: { payouts: PayoutsView }) {
  const progress = withdrawProgress(payouts.availableMicros, payouts.minMicros);
  if (payouts.eligible) {
    return (
      <div className="earnings-meter" data-state="ready">
        <div className="earnings-meter-text">
          <strong>You can withdraw</strong>
          <span>Above the {money(payouts.minMicros)} minimum, and every check passes.</span>
        </div>
        <a className="btn btn-primary btn-small" href="#payouts">Withdraw</a>
      </div>
    );
  }
  if (progress.reached) {
    return (
      <div className="earnings-meter" data-state="checks">
        <div className="earnings-meter-text">
          <strong>Minimum reached</strong>
          <span>A few checks are left before your first withdrawal.</span>
        </div>
        <a className="btn btn-outline btn-small" href="#payouts">See what&apos;s left</a>
      </div>
    );
  }
  return (
    <div className="earnings-meter" data-state="progress">
      <div className="earnings-meter-row">
        <span>
          <strong className="money">{moneyProgress(progress.shortMicros.toString())}</strong> to go until you can withdraw
        </span>
        <span className="earnings-meter-of">
          {`${money(payouts.availableMicros)} of ${money(payouts.minMicros)}`}
        </span>
      </div>
      <div
        className="earnings-meter-track"
        role="progressbar"
        aria-label="Progress to the withdrawal minimum"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
      >
        <span style={{ width: `${Math.max(progress.percent, 1.5)}%` }} />
      </div>
      <p className="earnings-meter-note">
        Or spend it on AI now: earnings convert to AI credits with no minimum wait.
      </p>
    </div>
  );
}

const dollarsShort = (value: number): string =>
  value === 0 ? "$0.00" : value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;

const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function EarningsHero({ balance, rows, coveredFrom, payouts }: EarningsOverviewProps) {
  const now = Date.now();
  const today = periodTotal(rows, startOfToday(), coveredFrom);
  const week = periodTotal(rows, now - 7 * DAY_MS, coveredFrom);
  const month = periodTotal(rows, now - 30 * DAY_MS, coveredFrom);
  return (
    <div className="ios-card hero-balance earnings-hero">
      <div className="earnings-hero-top">
        <span className="hero-balance-label">Available balance</span>
        <span className="earnings-hero-lifetime">
          <span className="money">{money(balance.lifetimeMicros)}</span> earned all time
        </span>
      </div>
      <strong className="hero-figure money" aria-label={moneyExact(balance.availableMicros)}>
        <ExactFigure value={moneyExact(balance.availableMicros)} />
      </strong>
      <dl className="earnings-periods">
        <Period label="Today" total={today} />
        <Period label="Last 7 days" total={week} />
        <Period label="Last 30 days" total={month} />
      </dl>
      {payouts !== null && <WithdrawMeter payouts={payouts} />}
    </div>
  );
}

export function EarningsMonth({ rows, coveredFrom }: Pick<EarningsOverviewProps, "rows" | "coveredFrom">) {
  /*
   * Cards by default. A card pays a fraction of a cent and an invite can pay a dollar, so on one
   * scale a single invite flattens a month of steady card earnings into hairlines; "All" puts
   * them together, on the scale that fits.
   */
  const [view, setView] = useState<"cards" | "all">("cards");
  const days = useMemo(() => calendar(30), []);
  const byDay = useMemo(() => earningsByDay(rows, days), [rows, days]);
  const now = Date.now();
  const since = now - 30 * DAY_MS;
  const month = periodTotal(rows, since, coveredFrom);
  const partial = !month.complete;

  let bestIndex = -1;
  byDay.totals.forEach((value, index) => {
    if (value > 0n && (bestIndex < 0 || value > (byDay.totals[bestIndex] ?? 0n))) bestIndex = index;
  });
  // The average is over the days the loaded rows actually cover, so a partial month does not
  // read as a slow one.
  const coveredDays = coveredFrom === null ? 30 : Math.max(1, Math.min(30, Math.ceil((now - coveredFrom) / DAY_MS)));
  const average = month.micros > 0n ? month.micros / BigInt(coveredDays) : 0n;
  const cards = cardsSeen(rows, since);
  const corrections = rows.filter((row) => row.kind === "reversal" && row.createdAt >= since).length;
  const hasExtras = byDay.extras.some((value) => value > 0);

  return (
    <>
      <section className="ios-card">
        <header className="ios-card-head earnings-chart-head">
          <div>
            <h2>Earnings, day by day</h2>
            <p>What you earned each day over the last 30 days. Hover a day for its amount.</p>
          </div>
          <div className="earnings-chart-total">
            <span>30 days</span>
            <strong className="money">
              {moneyProgress(month.micros.toString())}
              {partial && <span className="earnings-at-least">+</span>}
            </strong>
          </div>
        </header>
        {hasExtras && (
          <div className="earnings-chart-switch" role="group" aria-label="What the chart shows">
            <button type="button" aria-pressed={view === "cards"} onClick={() => setView("cards")}>Sponsored cards</button>
            <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>All earnings</button>
          </div>
        )}
        <StackedBars
          days={days}
          height={220}
          format={dollarsShort}
          minScale={0.01}
          summary={`Daily earnings over 30 days, totalling ${moneyExact(month.micros.toString())}${partial ? " or more" : ""}.`}
          series={[
            { label: "Sponsored cards", color: MONEY, values: byDay.cards },
            ...(hasExtras && view === "all" ? [{ label: "Invites and extras", color: seriesColor(0), values: byDay.extras }] : []),
          ]}
        />
        {partial && coveredFrom !== null && (
          <p className="field-hint earnings-coverage">
            Showing entries back to {shortDate(coveredFrom)}. Earlier days are in the ledger below: use Load older entries.
          </p>
        )}
      </section>

      <div className="ios-tiles earnings-tiles">
        <div className="ios-tile">
          <span className="ios-tile-label">Cards seen</span>
          <span className="ios-tile-value">
            {cards.toLocaleString("en-US")}
            {partial && <span className="earnings-at-least">+</span>}
          </span>
          <span className="ios-tile-hint">Sponsored cards paid for, last 30 days</span>
        </div>
        <div className="ios-tile">
          <span className="ios-tile-label">Best day</span>
          <span className="ios-tile-value money">{bestIndex < 0 ? "—" : moneyProgress((byDay.totals[bestIndex] ?? 0n).toString())}</span>
          <span className="ios-tile-hint">
            {bestIndex < 0
              ? "Nothing earned yet this month"
              : new Date(`${days[bestIndex]}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}
          </span>
        </div>
        <div className="ios-tile">
          <span className="ios-tile-label">Daily average</span>
          <span className="ios-tile-value money">{moneyProgress(average.toString())}</span>
          <span className="ios-tile-hint">Over {coveredDays} {coveredDays === 1 ? "day" : "days"}</span>
        </div>
        <div className="ios-tile">
          <span className="ios-tile-label">Corrections</span>
          <span className="ios-tile-value">{corrections.toLocaleString("en-US")}</span>
          <span className="ios-tile-hint">{corrections === 0 ? "Nothing taken back" : "Taken back, each shown in the ledger"}</span>
        </div>
      </div>
    </>
  );
}
