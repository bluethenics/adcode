"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { dollarsToMicros, money, statusLabel } from "@/components/money";
import { apiFetch, MESSAGES, type AdvertiserView, type BudgetMoveView, type CampaignView } from "@/lib/api";
import { canHoldBudget, checkMove, describeMove, dollarsInput, moveTargets, unspentMicros } from "@/lib/budgetMove";

/**
 * Moves credits from this campaign's budget to another of the advertiser's campaigns.
 *
 * For the advertiser who put most of their credits behind one campaign and wants some of
 * it working elsewhere, without ending this one. Only the unspent part can move, and the
 * line under the amount says what the move does to the balance before it happens - a live
 * campaign's budget is held out of "available" and a paused one's is not, so the same
 * move can free credits, commit them, or do neither.
 */
export function CampaignBudgetMove({
  campaign,
  campaigns,
  advertiser,
  onMoved,
}: {
  campaign: CampaignView;
  campaigns: CampaignView[];
  advertiser: AdvertiserView | null;
  onMoved: () => void;
}) {
  const { token } = useAuth();
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canHoldBudget(campaign)) return null;
  const unspent = unspentMicros(campaign);
  const targets = moveTargets(campaigns, campaign);
  const to = targets.find((target) => target.campaignId === toId) ?? targets[0];
  const fieldId = (name: string) => `move-${name}-${campaign.campaignId}`;

  if (to === undefined) {
    return (
      <p className="budget-move field-hint">
        To move this campaign&apos;s credits somewhere else, <a href="#new-campaign">create another campaign</a> first.
      </p>
    );
  }
  if (unspent === 0n) {
    return <p className="budget-move field-hint">This campaign has spent its whole budget, so there are no credits left to move.</p>;
  }

  const micros = amount.trim() === "" ? null : dollarsToMicros(amount);
  const check = micros === null ? null : checkMove(campaign, to, BigInt(micros), advertiser);
  const hint =
    amount.trim() === ""
      ? `Up to ${money(unspent.toString())} can move. Spent credits stay with this campaign.`
      : micros === null
        ? "Enter an amount like 25.00."
        : check?.ok === true
          ? describeMove(campaign, to, BigInt(micros))
          : (check?.reason ?? "");

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || micros === null || check?.ok !== true) return;
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await apiFetch<BudgetMoveView>({
      path: `/portal/campaigns/${encodeURIComponent(campaign.campaignId)}/move-budget`,
      token: await token(),
      method: "POST",
      body: { toCampaignId: to.campaignId, amountMicros: micros },
    });
    setBusy(false);
    if (!res.ok) {
      setError(MESSAGES[res.error]);
      return;
    }
    setAmount("");
    setDone(`Moved ${money(micros)} to ${res.value.to.name}. Its budget is now ${money(res.value.to.budgetMicros)}.`);
    onMoved();
  };

  return (
    <form className="budget-move" onSubmit={run}>
      <h4>Move credits to another campaign</h4>
      <div className="budget-move-fields">
        <div className="field">
          <label htmlFor={fieldId("to")}>To</label>
          <select
            id={fieldId("to")}
            className="select"
            value={to.campaignId}
            onChange={(event) => setToId(event.target.value)}
          >
            {targets.map((target) => (
              <option key={target.campaignId} value={target.campaignId}>
                {target.name} · {statusLabel(target.status)} · {money(target.budgetMicros)} budget
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={fieldId("amount")}>Amount</label>
          <input
            id={fieldId("amount")}
            className="input"
            inputMode="decimal"
            placeholder="25.00"
            autoComplete="off"
            value={amount}
            aria-describedby={fieldId("hint")}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
      </div>
      <p id={fieldId("hint")} className="field-hint" aria-live="polite">{hint}</p>
      <div className="actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={busy || check?.ok !== true}>
          {busy ? "Moving…" : "Move credits"}
        </button>
        <button type="button" className="btn btn-outline btn-small" onClick={() => setAmount(dollarsInput(unspent))}>
          All unspent ({money(unspent.toString())})
        </button>
      </div>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {done !== null && (
        <div className="notice" data-tone="ok" role="status">
          {done}
        </div>
      )}
    </form>
  );
}
