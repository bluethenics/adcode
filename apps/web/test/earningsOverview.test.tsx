import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EarningsHero } from "../src/components/EarningsOverview";
import { LedgerRows } from "../src/components/LedgerRows";
import {
  calendar,
  cardsSeen,
  earningsByDay,
  groupLedger,
  periodTotal,
  withdrawProgress,
} from "../src/components/earningsMath";
import type { LedgerRowView, PayoutsView } from "../src/lib/api";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 24, 15, 0, 0);
let next = 0;
const row = (kind: string, micros: string, createdAt: number): LedgerRowView => ({
  entryId: `e${next++}`,
  kind,
  micros,
  description: "",
  createdAt,
  refId: null,
});

describe("earnings arithmetic", () => {
  const rows = [
    row("impression", "2000", NOW - 1_000),
    row("impression", "2000", NOW - 2_000),
    row("withdrawal_requested", "-5000000", NOW - 3_000),
    row("impression", "2000", NOW - DAY),
    row("referral", "1500000", NOW - 2 * DAY),
    row("reversal", "-2000", NOW - 2 * DAY - 10),
    row("credit_conversion", "-1000000", NOW - 3 * DAY),
  ];

  it("totals only what was earned, exactly, and says when the period is only partly loaded", () => {
    // Withdrawals and conversions are on the ledger but are not earnings.
    expect(periodTotal(rows, NOW - 7 * DAY, null)).toEqual({ micros: 1_504_000n, complete: true });
    // Rows reach back only two days: a seven-day total is a lower bound.
    expect(periodTotal(rows, NOW - 7 * DAY, NOW - 2 * DAY).complete).toBe(false);
    expect(periodTotal(rows, NOW - 12 * 3_600_000, NOW - 2 * DAY).complete).toBe(true);
  });

  it("splits each day into cards and extras, and keeps the exact total", () => {
    const days = calendar(3, NOW);
    const byDay = earningsByDay(rows, days);
    expect(byDay.cards[2]).toBeCloseTo(0.004);
    expect(byDay.extras[0]).toBeCloseTo(1.5);
    // The day with the reversal nets it against the invite in the exact total.
    expect(byDay.totals).toEqual([1_498_000n, 2_000n, 4_000n]);
    expect(cardsSeen(rows, NOW - 7 * DAY)).toBe(3);
  });

  it("measures progress to the withdrawal minimum without rounding up", () => {
    expect(withdrawProgress("18734000", "50000000")).toEqual({ percent: 37, shortMicros: 31_266_000n, reached: false });
    expect(withdrawProgress("50000000", "50000000").reached).toBe(true);
    expect(withdrawProgress("0", "50000000").percent).toBe(0);
    expect(withdrawProgress("not money", "50000000").reached).toBe(false);
  });

  it("folds each day's cards into one line and leaves every other entry where it was", () => {
    const lines = groupLedger(rows);
    expect(lines.map((line) => (line.type === "cards" ? `cards:${line.rows.length}:${line.micros}` : line.row.kind))).toEqual([
      "cards:2:4000",
      "withdrawal_requested",
      "cards:1:2000",
      "referral",
      "reversal",
      "credit_conversion",
    ]);
  });
});

describe("earnings screen", () => {
  const payouts: PayoutsView = {
    minMicros: "50000000",
    availableMicros: "18734000",
    pendingMicros: "0",
    lifetimeMicros: "23412000",
    eligible: false,
    rules: [],
    profile: null,
    withdrawals: [],
  };

  it("leads with dollars and cents, keeps every micro, and shows the server's minimum", () => {
    const html = renderToStaticMarkup(
      <EarningsHero balance={{ availableMicros: "18734000", lifetimeMicros: "23412000" }} rows={[]} coveredFrom={null} payouts={payouts} />,
    );
    expect(html).toContain('$18.73<span class="hero-figure-micro">4</span>');
    expect(html).toContain("$31.26");
    expect(html).toContain("$18.73 of $50.00");
    expect(html).toContain('aria-valuenow="37"');
  });

  it("drops a tail of zeros, and marks a period it cannot fully see", () => {
    const html = renderToStaticMarkup(
      <EarningsHero balance={{ availableMicros: "12500000", lifetimeMicros: "12500000" }} rows={[row("impression", "2000", Date.now() - 1000)]} coveredFrom={Date.now() - DAY} payouts={null} />,
    );
    expect(html).toContain("$12.50</strong>");
    expect(html).toContain('class="earnings-at-least"');
    expect(html).not.toContain("earnings-meter");
  });

  it("offers withdrawing once the server says the account can", () => {
    const html = renderToStaticMarkup(
      <EarningsHero balance={{ availableMicros: "60000000", lifetimeMicros: "60000000" }} rows={[]} coveredFrom={null} payouts={{ ...payouts, availableMicros: "60000000", eligible: true }} />,
    );
    expect(html).toContain("You can withdraw");
    expect(html).toContain('href="#payouts"');
  });

  it("folds cards in the user's ledger but not in the admin's", () => {
    const rows = [row("impression", "2000", NOW), row("impression", "2000", NOW - 5), row("referral", "1500000", NOW - 10)];
    const grouped = renderToStaticMarkup(<LedgerRows rows={rows} groupCards />);
    expect(grouped).toContain("2 sponsored cards seen");
    expect(grouped).toContain("+$0.004");
    expect(grouped.match(/class="row"/g)?.length).toBe(4);
    // The folded line is the exact sum, without the six-place padding of a single entry.
    expect(grouped).toContain(">+$0.004</span>");
    const flat = renderToStaticMarkup(<LedgerRows rows={rows} />);
    expect(flat).not.toContain("sponsored cards seen");
  });
});
