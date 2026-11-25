"use client";

import type { LedgerRowView } from "@/lib/api";
import { groupLedger } from "./earningsMath";
import { moneyExact, when } from "./money";

/** The exact sum, with the zeros past the cents dropped: "$0.014", "$1.50". */
const exactTrimmed = (micros: bigint): string => moneyExact(micros.toString()).replace(/(\.\d{2}\d*?)0+$/, "$1");

/**
 * The ledger, as rows.
 *
 * Shared by the user's own dashboard and the admin's view of someone's account, so the
 * two can never drift. The description text is generated on the server for the same
 * reason: a user disputing a figure and an admin looking it up must be reading the same
 * sentence, not two renderings of the same enum.
 *
 * A debit is shown in the warning colour, never hidden and never merged into the credit
 * it corrects.
 *
 * `groupCards` (the user's dashboard) folds each day's sponsored cards into one line that
 * opens to show every card: a card pays a fraction of a cent, so an active day is hundreds
 * of identical rows, and a withdrawal or a correction between them was lost in the scroll.
 * Nothing else is folded, and nothing is merged into anything else - the folded line is the
 * exact sum of the rows inside it, and they are all still there. The admin view keeps one
 * row per entry.
 */
const KIND_LABEL: Record<string, string> = {
  impression: "Ad viewed",
  click: "Ad clicked",
  reversal: "Reversed",
  adjustment: "Adjustment",
  withdrawal_requested: "Withdrawal requested",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_failed: "Withdrawal failed",
  referral: "Invite earnings",
  contribution: "Thanks from ADCode",
  credit_conversion: "Converted to AI credits",
};

const dayLabel = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function Entry({ row }: { row: LedgerRowView }) {
  const negative = row.micros.startsWith("-");
  return (
    <div className="row" data-kind={row.kind}>
      <span className="row-main">
        <span className="row-title">{row.description || (KIND_LABEL[row.kind] ?? row.kind)}</span>
        <span className="row-sub">
          {KIND_LABEL[row.kind] ?? row.kind} · {when(row.createdAt)}
          {row.refId === null ? "" : ` · ref ${row.refId}`}
        </span>
      </span>
      <span
        className="row-num mono"
        style={{ color: negative ? "var(--warn)" : "var(--money)" }}
      >
        {negative ? "" : "+"}
        {moneyExact(row.micros)}
      </span>
    </div>
  );
}

export function LedgerRows({ rows, groupCards = false }: { rows: LedgerRowView[]; groupCards?: boolean }) {
  return (
    <div className="rows">
      <div className="row row-head">
        <span className="row-main">Entry</span>
        <span className="row-num">Amount</span>
      </div>

      {!groupCards
        ? rows.map((row) => <Entry key={row.entryId} row={row} />)
        : groupLedger(rows).map((line) =>
            line.type === "entry" ? (
              <Entry key={line.row.entryId} row={line.row} />
            ) : (
              <details key={`cards-${line.day}`} className="row-group" data-kind="impression">
                <summary className="row">
                  <span className="row-main">
                    <span className="row-title">
                      {`${line.rows.length.toLocaleString("en-US")} sponsored ${line.rows.length === 1 ? "card" : "cards"} seen`}
                    </span>
                    <span className="row-sub">{`${dayLabel(line.day)} · latest ${when(line.newest)}`}</span>
                  </span>
                  <span className="row-num mono" style={{ color: "var(--money)" }}>
                    {`+${exactTrimmed(line.micros)}`}
                  </span>
                </summary>
                <div className="row-group-body">
                  {line.rows.map((row) => <Entry key={row.entryId} row={row} />)}
                </div>
              </details>
            ),
          )}
    </div>
  );
}
