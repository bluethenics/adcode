"use client";

/** Admin allowance actions and subscription/promotion reporting. All actions are server audited. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanId, PromoInput } from "@adcode/api/src/aiPlans.ts";
import { dollars, formatTokens } from "@/app/ai-tokens/tokenFormatting";
import { planName } from "@/app/ai-tokens/Plans";

type AdminCall = <T>(path: string, body?: unknown) => Promise<T>;
type PromoView = PromoInput & { redemptions: number };
interface SubscriptionSummary { plan: PlanId; active: number; mrrCents: number }
interface Notice { text: string; error: boolean }

const expiry = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function PromoAdminTable({ promos, now = Date.now() }: { promos: readonly PromoView[]; now?: number }) {
  if (promos.length === 0) return <p className="row-sub">No promo codes yet. Create one below to share tokens or a plan.</p>;
  return <div className="admin-models-scroll" role="region" aria-label="Promo codes" tabIndex={0}><table className="admin-models-table">
    <thead><tr><th scope="col">Code</th><th scope="col">Reward</th><th scope="col">Uses</th><th scope="col">Expires (UTC)</th><th scope="col">Status</th></tr></thead>
    <tbody>{promos.map((promo) => <tr key={promo.code}>
      <td><code>{promo.code}</code></td>
      <td>{promo.kind === "tokens" ? `${formatTokens(promo.tokens ?? 0)} tokens` : `${promo.days} days of ${planName(promo.plan ?? "")}`}</td>
      <td>{promo.redemptions} / {promo.maxRedemptions}</td><td>{expiry(promo.expiresAt)}</td>
      <td>{promo.expiresAt <= now ? "Expired" : promo.redemptions >= promo.maxRedemptions ? "Fully redeemed" : "Available"}</td>
    </tr>)}</tbody>
  </table></div>;
}

export function SubscriptionSummaryTable({ plans }: { plans: readonly SubscriptionSummary[] }) {
  if (plans.length === 0 || plans.every((plan) => plan.active === 0)) return <p className="row-sub">No active paid subscriptions yet.</p>;
  return <div className="admin-models-scroll" role="region" aria-label="Active subscription summary" tabIndex={0}><table className="admin-models-table">
    <thead><tr><th scope="col">Plan</th><th scope="col">Active subscriptions</th><th scope="col">Monthly revenue equivalent</th></tr></thead>
    <tbody>{plans.map((plan) => <tr key={plan.plan}><td>{planName(plan.plan)}</td><td>{plan.active.toLocaleString()}</td><td>{dollars(plan.mrrCents)}</td></tr>)}</tbody>
    <tfoot><tr><th scope="row">Total</th><td>{plans.reduce((sum, plan) => sum + plan.active, 0).toLocaleString()}</td><td>{dollars(plans.reduce((sum, plan) => sum + plan.mrrCents, 0))}</td></tr></tfoot>
  </table></div>;
}

function PlanSelect({ value, onChange, disabled = false }: { value: PlanId; onChange: (plan: PlanId) => void; disabled?: boolean }) {
  return <label className="tagflow-field"><span>Plan</span><select className="select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as PlanId)}><option value="weekly">Weekly (60M/week)</option><option value="monthly">Monthly (60M/week)</option><option value="pro">Pro (150M/week)</option></select></label>;
}

function StatusNotice({ notice }: { notice: Notice | null }) {
  return notice === null ? null : <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>;
}

export function resetResultMessage(result: { reset: number; busy: number; none: number }): string {
  return `${result.reset} weekly allowance${result.reset === 1 ? "" : "s"} reset. ${result.busy > 0 ? `${result.busy} account${result.busy === 1 ? " has" : "s have"} a request in progress; try again in a minute. ` : ""}${result.none > 0 ? `${result.none} account${result.none === 1 ? " has" : "s have"} no weekly usage to reset.` : ""}`.trim();
}

export interface ResetProgress { reset: number; busy: number; none: number; after: string | null; failed: string[] }
interface ResetBatch { reset: number; busy: number; none: number; nextCursor: string | null; failed: string[] }
export const newResetProgress = (): ResetProgress => ({ reset: 0, busy: 0, none: 0, after: "", failed: [] });
export const resetHasMore = (progress: ResetProgress): boolean => progress.after !== null || progress.failed.length > 0;

/** Confirm each page before advancing. A failed page or explicit pause retains its checkpoint. */
export async function resetEveryoneInBatches(call: AdminCall, previous: ResetProgress, onProgress: (progress: ResetProgress) => void, shouldPause: () => boolean = () => false): Promise<ResetProgress> {
  let progress = previous;
  while (resetHasMore(progress) && !shouldPause()) {
    const retrying = progress.failed.length > 0;
    const result = await call<ResetBatch>("/admin/ai-plans/reset", retrying ? { uid: "*", retryUids: progress.failed } : { uid: "*", after: progress.after });
    if (![result.reset, result.busy, result.none].every(value => Number.isSafeInteger(value) && value >= 0) ||
        !Array.isArray(result.failed) || result.failed.some(uid => typeof uid !== "string") ||
        result.nextCursor !== null && typeof result.nextCursor !== "string") throw new Error("Couldn't confirm the reset progress. Resume to retry the remaining batch.");
    progress = { reset: progress.reset + result.reset, busy: progress.busy + result.busy, none: progress.none + result.none,
      after: retrying ? progress.after : result.nextCursor, failed: result.failed };
    onProgress(progress);
    if (progress.failed.length > 0) break;
  }
  return progress;
}

/** Kept outside the settings form: submitting one action never saves unrelated model edits. */
export function PlansAdmin({ call }: { call: AdminCall }) {
  const [action, setAction] = useState<"reset" | "boost" | "gift">("reset");
  const [everyone, setEveryone] = useState(false);
  const [uid, setUid] = useState("");
  const [weeklyTokens, setWeeklyTokens] = useState("60000000");
  const [endsAt, setEndsAt] = useState("");
  const [gift, setGift] = useState<PlanId>("monthly");
  const [giftDays, setGiftDays] = useState("7");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetProgress, setResetProgress] = useState<ResetProgress | null>(null);
  const resetCheckpoint = useRef<ResetProgress | null>(null);
  const pauseReset = useRef(false);
  const [promos, setPromos] = useState<PromoView[] | null>(null);
  const [promoListError, setPromoListError] = useState("");
  const [promoListLoading, setPromoListLoading] = useState(true);
  const [summaries, setSummaries] = useState<SubscriptionSummary[] | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"tokens" | "plan">("tokens");
  const [promoTokens, setPromoTokens] = useState("50000000");
  const [promoPlan, setPromoPlan] = useState<PlanId>("pro");
  const [promoDays, setPromoDays] = useState("7");
  const [maxRedemptions, setMaxRedemptions] = useState("100");
  const [expiresAt, setExpiresAt] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoNotice, setPromoNotice] = useState<Notice | null>(null);

  const loadPromos = useCallback(async (): Promise<void> => {
    setPromoListLoading(true); setPromoListError("");
    try { setPromos((await call<{ promos: PromoView[] }>("/admin/ai-plans/promo")).promos); }
    catch (error) { setPromoListError(error instanceof Error ? error.message : "Couldn't load promo codes."); }
    finally { setPromoListLoading(false); }
  }, [call]);
  const loadSummary = useCallback(async (): Promise<void> => {
    setSummaryLoading(true); setSummaryError("");
    try { setSummaries((await call<{ plans: SubscriptionSummary[] }>("/admin/ai-plans/subscriptions")).plans); }
    catch (error) { setSummaryError(error instanceof Error ? error.message : "Couldn't load subscriptions."); }
    finally { setSummaryLoading(false); }
  }, [call]);
  useEffect(() => { void loadPromos(); void loadSummary(); }, [loadPromos, loadSummary]);
  useEffect(() => { pauseReset.current = false; return () => { pauseReset.current = true; }; }, []);

  async function applyAction(): Promise<void> {
    if (busy) return;
    const target = everyone ? "*" : uid.trim();
    if (!target) { setNotice({ text: "Choose a user ID or Everyone.", error: true }); return; }
    const end = new Date(endsAt).getTime();
    if (action === "boost" && (!Number.isFinite(end) || end <= Date.now())) { setNotice({ text: "Choose a future date for the boost to end.", error: true }); return; }
    setBusy(true); setNotice(null);
    try {
      if (action === "reset") {
        if (target === "*") {
          pauseReset.current = false;
          const checkpoint = resetCheckpoint.current;
          const start = checkpoint !== null && resetHasMore(checkpoint) ? checkpoint : newResetProgress();
          resetCheckpoint.current = start; setResetProgress(start);
          const result = await resetEveryoneInBatches(call, start, progress => { resetCheckpoint.current = progress; setResetProgress(progress); }, () => pauseReset.current);
          setNotice({ text: `${resetResultMessage(result)}${resetHasMore(result) ? " Reset paused. Resume to continue the remaining accounts." : " Reset finished."}`, error: result.busy > 0 || result.failed.length > 0 });
        } else {
          const result = await call<{ reset: number; busy: number; none: number }>("/admin/ai-plans/reset", { uid: target });
          setNotice({ text: resetResultMessage(result), error: result.busy > 0 });
        }
      } else {
        const body = action === "boost" ? { uid: target, weeklyTokens: Number(weeklyTokens), endsAt: end, note: note.trim() } : { uid: target, plan: gift, days: Number(giftDays), note: note.trim() };
        await call(`/admin/ai-plans/${action}`, body);
        setNotice({ text: action === "boost" ? `${everyone ? "Everyone's" : "This account's"} weekly allowance is at least ${formatTokens(Number(weeklyTokens))} tokens until ${expiry(end)}.` : `Gifted ${giftDays} days of ${planName(gift)} to ${everyone ? "everyone" : target}. The best active allowance applies.`, error: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The request couldn't be confirmed. Please try again.";
      const progress = resetCheckpoint.current;
      setNotice({ text: action === "reset" && target === "*" && progress !== null ? `${message} Last confirmed: ${resetResultMessage(progress)} The latest batch may have applied. Resume to retry the remaining batch.` : message, error: true });
    }
    finally { setBusy(false); }
  }

  async function createPromo(): Promise<void> {
    if (promoBusy) return;
    const end = new Date(expiresAt).getTime();
    if (!Number.isFinite(end) || end <= Date.now()) { setPromoNotice({ text: "Choose a future expiry date for this promo code.", error: true }); return; }
    setPromoBusy(true); setPromoNotice(null);
    try {
      const reward = kind === "tokens" ? { tokens: Number(promoTokens) } : { plan: promoPlan, days: Number(promoDays) };
      await call("/admin/ai-plans/promo", { code: code.trim().toUpperCase(), kind, ...reward, maxRedemptions: Number(maxRedemptions), expiresAt: end });
      setPromoNotice({ text: `Created ${code.trim().toUpperCase()}. Each account can redeem it once.`, error: false }); setCode("");
      await loadPromos();
    } catch (error) { setPromoNotice({ text: error instanceof Error ? error.message : "The promo code wasn't created. Try again.", error: true }); }
    finally { setPromoBusy(false); }
  }

  const actionLabel = action === "reset" ? `Reset ${everyone ? "everyone's" : "user's"} week` : action === "boost" ? `Boost ${everyone ? "everyone" : "user"}` : `Gift ${planName(gift)} to ${everyone ? "everyone" : "user"}`;
  return <section className="admin-models-provider plans-admin" aria-labelledby="plans-admin-heading">
    <h3 id="plans-admin-heading">Plans &amp; promotions</h3>
    <p className="row-sub">Raise allowances for an account or everyone, share promo codes, and track subscriptions. Plans and boosts apply while paid models are enabled.</p>
    <div className="plans-admin-group">
      <h4>Allowance actions</h4>
      <form onSubmit={(event) => { event.preventDefault(); void applyAction(); }} aria-label="Plan allowance action">
        <div className="tagflow-fields">
          <label className="tagflow-field"><span>Action</span><select className="select" value={action} disabled={busy} onChange={(event) => { setAction(event.target.value as typeof action); setNotice(null); }}><option value="reset">Reset weekly usage</option><option value="boost">Boost weekly allowance</option><option value="gift">Gift a plan</option></select></label>
          <label className="tagflow-field"><span>Applies to</span><select className="select" value={everyone ? "everyone" : "user"} disabled={busy} onChange={(event) => { setEveryone(event.target.value === "everyone"); setNotice(null); }}><option value="user">One account</option><option value="everyone">Everyone</option></select></label>
          {!everyone && <label className="tagflow-field"><span>User ID from People</span><input className="input" required maxLength={128} disabled={busy} value={uid} onChange={(event) => setUid(event.target.value)} /></label>}
          {action === "boost" && <>
            <label className="tagflow-field"><span>Weekly tokens</span><input className="input" type="number" required min={1} max={10_000_000_000} step={1} disabled={busy} value={weeklyTokens} onChange={(event) => setWeeklyTokens(event.target.value)} /><small>The allowance becomes at least this amount; existing usage stays counted.</small></label>
            <label className="tagflow-field"><span>Boost ends (your local time)</span><input className="input" type="datetime-local" required disabled={busy} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          </>}
          {action === "gift" && <><PlanSelect value={gift} onChange={setGift} disabled={busy} /><label className="tagflow-field"><span>Gift days</span><input className="input" type="number" required min={1} max={366} step={1} disabled={busy} value={giftDays} onChange={(event) => setGiftDays(event.target.value)} /></label></>}
          {action !== "reset" && <label className="tagflow-field"><span>Note for admin history</span><input className="input" maxLength={500} disabled={busy} value={note} onChange={(event) => setNote(event.target.value)} /></label>}
        </div>
        {action === "reset" && <p className="row-sub">Resets weekly Heabsy usage. Accounts with a request in progress are left for a retry. Everyone is processed in small batches; keep this page open to finish, or pause and resume here.</p>}
        <button className="btn" disabled={busy}>{busy ? "Applying…" : action === "reset" && everyone && resetProgress !== null && resetHasMore(resetProgress) ? "Resume reset" : actionLabel}</button>
        {busy && action === "reset" && everyone && <button type="button" className="btn" onClick={() => { pauseReset.current = true; }}>Pause after this batch</button>}
      </form>
      {action === "reset" && everyone && resetProgress !== null && <p className="row-sub" role="status">Confirmed so far: {resetProgress.reset} reset, {resetProgress.busy} busy, {resetProgress.none} without usage.{resetProgress.failed.length > 0 ? ` ${resetProgress.failed.length} failed account${resetProgress.failed.length === 1 ? " needs" : "s need"} a retry.` : ""}</p>}
      <StatusNotice notice={notice} />
    </div>
    <div className="plans-admin-group">
      <header className="admin-card-head"><h4>Active subscriptions</h4><button type="button" className="btn" disabled={summaryLoading} onClick={() => void loadSummary()}>{summaryLoading ? "Loading…" : "Refresh subscriptions"}</button></header>
      {summaryError && <p className="notice" data-tone="error" role="alert">{summaryError} Use Refresh subscriptions to retry.</p>}
      {summaryLoading && summaries === null ? <p className="row-sub" role="status">Loading subscriptions…</p> : summaries !== null && <SubscriptionSummaryTable plans={summaries} />}
      <p className="row-sub">Weekly subscriptions count as 52 payments divided across 12 months. Gifts and promo plans are excluded.</p>
    </div>
    <div className="plans-admin-group">
      <header className="admin-card-head"><h4>Promo codes</h4><button type="button" className="btn" disabled={promoListLoading} onClick={() => void loadPromos()}>{promoListLoading ? "Loading…" : "Refresh codes"}</button></header>
      {promoListError && <p className="notice" data-tone="error" role="alert">{promoListError} Use Refresh codes to retry.</p>}
      {promoListLoading && promos === null ? <p className="row-sub" role="status">Loading promo codes…</p> : promos !== null && <PromoAdminTable promos={promos} />}
      <form onSubmit={(event) => { event.preventDefault(); void createPromo(); }} aria-label="Create promo code">
        <div className="tagflow-fields">
          <label className="tagflow-field"><span>New code</span><input className="input" required minLength={3} maxLength={24} pattern="[A-Z0-9]{3,24}" autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={promoBusy} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /><small>3–24 letters or numbers, without spaces.</small></label>
          <label className="tagflow-field"><span>Reward</span><select className="select" value={kind} disabled={promoBusy} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="tokens">Purchased tokens</option><option value="plan">Plan days</option></select></label>
          {kind === "tokens" ? <label className="tagflow-field"><span>Tokens per redemption</span><input className="input" type="number" required min={1} max={10_000_000_000} step={1} disabled={promoBusy} value={promoTokens} onChange={(event) => setPromoTokens(event.target.value)} /></label> : <><PlanSelect value={promoPlan} onChange={setPromoPlan} disabled={promoBusy} /><label className="tagflow-field"><span>Plan days per redemption</span><input className="input" type="number" required min={1} max={366} step={1} disabled={promoBusy} value={promoDays} onChange={(event) => setPromoDays(event.target.value)} /></label></>}
          <label className="tagflow-field"><span>Maximum redemptions</span><input className="input" type="number" required min={1} max={1_000_000} step={1} disabled={promoBusy} value={maxRedemptions} onChange={(event) => setMaxRedemptions(event.target.value)} /></label>
          <label className="tagflow-field"><span>Expires (your local time)</span><input className="input" type="datetime-local" required disabled={promoBusy} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
        </div>
        <button className="btn" disabled={promoBusy}>{promoBusy ? "Creating…" : "Create promo code"}</button>
      </form>
      <StatusNotice notice={promoNotice} />
    </div>
  </section>;
}
