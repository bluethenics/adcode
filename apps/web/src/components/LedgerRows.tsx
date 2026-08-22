"use client";

import type { LedgerRowView } from "@/lib/api";
import { moneyExact, when } from "./money";

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
 */
const KIND_LABEL: Record<string, string> = {
  impression: "Ad viewed",
  click: "Ad clicked",
  reversal: "Reversed",
  adjustment: "Adjustment",
  withdrawal_requested: "Withdrawal requested",
  withdrawal_paid: "Withdrawal paid",
  withdrawal_failed: "Withdrawal failed",
};

export function LedgerRows({ rows }: { rows: LedgerRowView[] }) {
  return (
    <div className="rows">
      <div className="row row-head">
        <span className="row-main">Entry</span>
        <span className="row-num">Amount</span>
      </div>

      {rows.map((row) => {
        const negative = row.micros.startsWith("-");
        return (
          <div key={row.entryId} className="row" data-kind={row.kind}>
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
      })}
    </div>
  );
}
