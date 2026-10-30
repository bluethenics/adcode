"use client";

/**
 * Buying AI tokens for Heabsy's models in ADCode.
 *
 * Every account gets a free daily allowance on those models; past it, the relay draws on tokens
 * bought here. Payment happens on Dodo's hosted page, so no card details touch this site, and the
 * webhook credits the tokens - this page only starts the checkout and shows what arrived.
 * Spec: docs/superpowers/specs/2026-10-21-paid-ai-tokens-design.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AdcodeLoader } from "@/components/AdcodeLoader";
import { useAuth } from "@/components/AuthProvider";
import { SignInCard } from "@/components/SignInCard";
import { apiFetch, MESSAGES } from "@/lib/api";
import type { PlanId, PlanSpec } from "@adcode/api/src/aiPlans.ts";
import { subscriptionBlocksCheckout } from "@adcode/api/src/aiPlans.ts";
import { CodeRedeemer, InviteCard, PlanCards, planArrivalMessage, planName, planRequest } from "./Plans";
import { ModelWallet } from "./ModelWallet";
import { dollars, formatTokens } from "./tokenFormatting";
import { topUpDescription, topUpName } from "@/lib/pricing";
export { formatTokens } from "./tokenFormatting";

export interface TokenPack { id: string; priceCents: number; tokens: number }
export interface TokensView { enabled: boolean; free: { limit: number; used: number; held: number; remaining: number; resetsAt: number | null }; purchased: number; plan?: { id: PlanId; endsAt: number; source: "subscription" | "gift" } | null; campaign?: { name: string; endsAt: number } | null }
interface TokenOrderView { orderId: string; packId: string; priceCents: number; tokens: number; status: "pending" | "paid" | "refunded" | "abandoned"; createdAt: number; paidAt: number | null }
interface TokenLedgerView { id: string; delta: number; kind: "purchase" | "usage" | "refund" | "grant"; note: string; createdAt: number }
interface TokenActivityView { tokens: TokensView; orders: TokenOrderView[]; ledger: TokenLedgerView[]; subscription?: { plan: PlanId; status: string; periodEnd: number; active?: boolean } | null }
interface PaidOffer { enabled: boolean; freeWeeklyTokens: number; packs: TokenPack[]; plans?: PlanSpec[] }
interface CheckoutReturn { order: string; plan: PlanId | null }

const POLL_MS = 3_000;
const POLL_FOR_MS = 120_000;

/** A pricing link highlights a plan for review; it never starts checkout by itself. */
export function selectedPricingPlan(search: string): PlanId | null {
  const query = new URLSearchParams(search);
  if (query.has("order")) return null;
  const id = query.get("plan");
  return id === "weekly" || id === "monthly" || id === "pro" ? id : null;
}

export function refillText(resetsAt: number, now: number): string {
  const ms = resetsAt - now;
  if (ms <= 0) return "now";
  const unit = (value: number, word: string) => `in ${value} ${word}${value === 1 ? "" : "s"}`;
  if (ms >= 86_400_000) return unit(Math.round(ms / 86_400_000), "day");
  if (ms >= 3_600_000) return unit(Math.round(ms / 3_600_000), "hour");
  return unit(Math.max(1, Math.round(ms / 60_000)), "minute");
}

export type Arrival = "checking" | "added" | "not-yet";

/** Back from Dodo: a payment is only "received" once the webhook has marked the order paid. */
export function arrivalMessage(arrival: Arrival): string {
  if (arrival === "checking") return "Checking your payment…";
  if (arrival === "added") return "Your tokens are added. A task that paused carries on by itself.";
  return "We haven't received this payment yet. If you paid, your tokens arrive within a few minutes - press Refresh to check again. If you closed the checkout, nothing was charged.";
}

export function PackList({ packs, busy, onBuy }: { packs: TokenPack[]; busy: string | null; onBuy: (pack: TokenPack) => void }) {
  return (
    <ul className="token-packs" aria-label="One-time AI top-ups">
      {packs.map((pack) => (
        <li key={pack.id} className="token-pack">
          <h3>{topUpName(pack.id)}</h3><span className="field-hint">{formatTokens(pack.tokens)} tokens</span>
          <span className="token-pack-price">{dollars(pack.priceCents)}<small> once</small></span>
          <span className="field-hint">{topUpDescription(pack.id)}<br />Available on the free plan. Never expires.</span>
          <span className="field-hint">${(pack.priceCents / 100 / (pack.tokens / 1_000_000)).toFixed(2)} per million</span><button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => onBuy(pack)}>
            {busy === pack.id ? "Opening checkout…" : `Get ${topUpName(pack.id)}`}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BalanceSummary({ tokens, now }: { tokens: TokensView; now: number }) {
  const campaign = tokens.campaign !== undefined && tokens.campaign !== null && tokens.campaign.endsAt > now ? tokens.campaign : null;
  return (
    <div className="stats">
      {campaign !== null && <div className="stat">
        <span className="stat-label">{campaign.name}</span>
        <span className="stat-value">Unlimited included AI use</span>
        <span className="stat-hint">Until {new Date(campaign.endsAt).toLocaleString()}. Nothing you use is counted against your week or your purchased tokens.</span>
      </div>}
      <div className="stat">
        <span className="stat-label">{tokens.plan ? `${planName(tokens.plan.id)} today` : "Free today"}</span>
        <span className="stat-value">{tokens.plan?.id === "pro" && !tokens.enabled ? "Unlimited tokens" : `${formatTokens(tokens.free.remaining)} of ${formatTokens(tokens.free.limit)} free`}</span>
        <span className="stat-hint">{tokens.plan?.id === "pro" && !tokens.enabled ? "No daily token cap. Provider availability and rate limits still apply" : tokens.free.resetsAt === null ? "Starts with your first included AI request" : `Free tokens refill ${refillText(tokens.free.resetsAt, now)}`}{tokens.plan && <>. {tokens.plan.source === "gift" ? "Gifted plan" : "Paid period"} ends {new Date(tokens.plan.endsAt).toLocaleDateString()}.</>}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Purchased</span>
        <span className="stat-value">{formatTokens(tokens.purchased)} purchased</span>
        <span className="stat-hint">Used after your free tokens. They never expire.</span>
      </div>
    </div>
  );
}

/** A two-letter region from the browser's language, for Dodo's tax country; the person can change it. */
const guessCountry = (): string => {
  if (typeof navigator === "undefined") return "US";
  const region = /-([A-Z]{2})\b/.exec(navigator.language)?.[1];
  return region ?? "US";
};

export default function AiTokens() {
  const { user, loading: authLoading, token } = useAuth();
  const [offer, setOffer] = useState<PaidOffer | null>(null);
  const [activity, setActivity] = useState<TokenActivityView | null>(null);
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [checkoutReturn, setCheckoutReturn] = useState<CheckoutReturn | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const account = user?.uid ?? null;
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => { setCountry(guessCountry()); }, []);
  useEffect(() => { setSelectedPlan(selectedPricingPlan(window.location.search)); }, []);

  const loadOffer = useCallback(async (): Promise<void> => {
    setOfferError(null);
    try {
      const response = await fetch("/v1/ai/tagflow/config");
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json() as { paid?: PaidOffer };
      if (body.paid === undefined) throw new Error("missing-offer");
      setOffer(body.paid);
    } catch { setOfferError("Couldn't load plans and top-ups. Check your connection and try again."); }
  }, []);
  useEffect(() => { void loadOffer(); }, [loadOffer]);

  const load = useCallback(async (): Promise<TokenActivityView | null> => {
    try {
      const idToken = await token();
      const [found, usage] = await Promise.all([
        apiFetch<TokenActivityView>({ path: "/ai/tokens/orders", token: idToken }),
        apiFetch<{ tokens?: TokensView | null }>({ path: "/ai/tagflow/usage", token: idToken }),
      ]);
      if (accountRef.current !== account) return null;
      if (!found.ok || !usage.ok) { setBalanceError(MESSAGES[!found.ok ? found.error : !usage.ok ? usage.error : "server-error"]); return null; }
      const view = { ...found.value, tokens: usage.value.tokens ?? found.value.tokens };
      setActivity(view); setBalanceError(null); setNow(Date.now());
      return view;
    } catch { if (accountRef.current === account) setBalanceError("Couldn't load your balance. Check your connection and try again."); return null; }
  }, [token, account]);

  useEffect(() => { setActivity(null); setBalanceError(null); setError(null); if (account !== null) void load(); }, [account, load]);

  // Back from Dodo: wait for the webhook to credit this order, then say so.
  useEffect(() => {
    if (account === null) return;
    const query = new URLSearchParams(window.location.search);
    const order = query.get("order");
    if (order === null) return;
    const rawPlan = query.get("plan");
    const returned = { order, plan: rawPlan === "weekly" || rawPlan === "monthly" || rawPlan === "pro" ? rawPlan : null } satisfies CheckoutReturn;
    setCheckoutReturn(returned);
    setArrival("checking");
    const started = Date.now();
    let active = true;
    let timer: number | undefined;
    const check = async (): Promise<void> => {
      const view = await load();
      if (!active) return;
      if (view !== null && checkoutArrived(view, returned)) { setArrival("added"); forgetCheckoutReturn(); }
      else if (Date.now() - started > POLL_FOR_MS) setArrival("not-yet");
      else timer = window.setTimeout(() => void check(), POLL_MS);
    };
    void check();
    return () => { active = false; window.clearTimeout(timer); };
  }, [account, load]);

  const refresh = async (): Promise<void> => {
    const view = await load();
    if (view !== null && checkoutReturn !== null && checkoutArrived(view, checkoutReturn)) { setArrival("added"); forgetCheckoutReturn(); }
  };

  const needsSignIn = (plan?: PlanId): boolean => {
    if (user !== null) return false;
    if (plan !== undefined) {
      setSelectedPlan(plan);
      const url = new URL(window.location.href);
      url.searchParams.set("plan", plan);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const signIn = document.getElementById("ai-sign-in");
    signIn?.scrollIntoView({ behavior: "instant", block: "start" });
    signIn?.focus({ preventScroll: true });
    return true;
  };

  const buy = async (pack: TokenPack) => {
    if (busy !== null) return;
    if (needsSignIn()) return;
    if (!/^[A-Z]{2}$/.test(country)) { setError("Enter your country as a two-letter code, like US or DE."); return; }
    setBusy(pack.id); setError(null);
    try {
      const session = await apiFetch<{ orderId: string; checkoutUrl: string }>({ path: "/ai/tokens/checkout", token: await token(), method: "POST", body: { pack: pack.id, billingCountry: country } });
      if (!session.ok) { setError(MESSAGES[session.error]); return; }
      window.location.assign(session.value.checkoutUrl);
    } catch { setError("Couldn't open checkout. Please try again."); }
    finally { setBusy(null); }
  };

  const choosePlan = async (plan: PlanSpec): Promise<void> => {
    if (busy !== null) return;
    if (needsSignIn(plan.id)) return;
    if (!/^[A-Z]{2}$/.test(country)) { setError("Enter your country as a two-letter code, like US or DE."); return; }
    setBusy(plan.id); setError(null);
    try { const session = await planRequest<{ checkoutUrl: string }>("/ai/plans/checkout", await token(), { plan: plan.id, billingCountry: country }); window.location.assign(session.checkoutUrl); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't open subscription checkout. Try again."); }
    finally { setBusy(null); }
  };
  const managePlan = async (): Promise<void> => {
    if (busy !== null) return;
    setBusy("portal"); setError(null);
    try { const portal = await planRequest<{ link: string }>("/ai/plans/portal", await token(), {}); window.location.assign(portal.link); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't open the subscription portal. Try again."); }
    finally { setBusy(null); }
  };
  const subscription = activity?.subscription ?? (activity?.tokens.plan?.source === "subscription" ? { plan: activity.tokens.plan.id, periodEnd: activity.tokens.plan.endsAt, status: "active" } : null);
  const subscriptionAccess = subscription !== null && subscription.periodEnd > now && ("active" in subscription ? subscription.active !== false : true);
  const subscribed = subscription !== null && subscriptionBlocksCheckout(subscription.status, subscription.periodEnd, now);

  const checkoutBusy = authLoading || (user !== null && activity === null) ? "loading-account" : busy;

  return (
    <>
      {selectedPlan !== null && <p className="notice" role="status">You&apos;re viewing the {planName(selectedPlan)} plan. {user === null ? "Sign in with the account you use in ADCode, then review the plan and billing country." : subscribed ? "Use Manage subscription below to review your existing billing plan." : "Review your billing country and choose the plan below to continue."}</p>}
          {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
          {arrival !== null && (
            <div className="notice" data-tone={arrival === "added" ? "success" : undefined} role="status">
              {checkoutReturn?.plan ? planArrivalMessage(arrival, checkoutReturn.plan) : arrivalMessage(arrival)}{" "}
              {arrival === "not-yet" && <button type="button" className="btn btn-outline btn-small" onClick={() => void refresh()}>Refresh</button>}
            </div>
          )}

          {activity !== null && <BalanceSummary tokens={activity.tokens} now={now} />}
          {balanceError !== null && <p className="notice" data-tone="error" role="alert">{balanceError} <button type="button" className="btn btn-outline btn-small" onClick={() => void refresh()}>Retry balance</button></p>}
          {user !== null && activity === null && balanceError === null && <p role="status" className="field-hint">Loading your AI access…</p>}
          {subscription !== null && <div className="ai-plan-management"><p>{planName(subscription.plan)} subscription. Manage your plan, payment method or cancellation in Dodo.</p><button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void managePlan()}>{busy === "portal" ? "Opening portal…" : "Manage subscription"}</button></div>}

          {offerError !== null ? <p className="notice" data-tone="error" role="alert">{offerError} <button type="button" className="btn btn-outline btn-small" onClick={() => void loadOffer()}>Retry offers</button></p> : offer === null ? <AdcodeLoader /> : !offer.enabled ? (
            <p className="notice">AI upgrades are temporarily unavailable. Tagflow AI stays free in the meantime.</p>
          ) : (
            <>
              {user !== null && <div className="ai-billing-details"><div><strong>Simple billing. Your choice.</strong><p className="field-hint">Prices in USD. Applicable tax is shown before payment.</p></div><div className="field ai-tokens-country">
                <label htmlFor="t-country">Billing country</label>
                <input id="t-country" className="input" aria-describedby="t-country-help" required pattern="[A-Z]{2}" autoComplete="country" maxLength={2} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} />
                <span id="t-country-help" className="field-hint">Two-letter code, like US or IN.</span>
              </div></div>}
              <section id="plans" className="ai-plans-section" aria-labelledby="ai-plans-heading"><div className="ai-section-heading"><div><p className="ai-eyebrow">MAKE SPACE FOR WHAT’S NEXT</p><h2 id="ai-plans-heading">A plan for the way you build.</h2></div><p>All Heabsy models. Weekly refills or unlimited Pro.<br />Tagflow AI stays free.</p></div>{(offer.plans?.length ?? 0) > 0 ? <PlanCards plans={offer.plans!} current={activity?.tokens.plan?.id ?? null} busy={checkoutBusy} subscribed={subscribed} selected={selectedPlan} onChoose={(plan) => void choosePlan(plan)} /> : <p className="notice" role="status">Subscription plans are unavailable right now. Check the one-time top-ups below, or try again later.</p>}</section>
              <div className="ai-checkout-trust"><span>Secure checkout by Dodo Payments</span><span>Cancel your plan in the billing portal</span><span>Works in web + desktop</span></div>
              <section id="packs" className="ai-packs-section" aria-labelledby="ai-packs-heading"><div className="ai-section-heading"><div><p className="ai-eyebrow">JUST NEED A LITTLE EXTRA?</p><h2 id="ai-packs-heading">Top up. Keep going.</h2></div><p>A one-time purchase for a busy stretch.<br />Used after your daily allowance. No expiry.</p></div>{offer.packs.length > 0 ? <PackList packs={offer.packs} busy={checkoutBusy} onBuy={(pack) => void buy(pack)} /> : <p className="notice" role="status">No top-ups are available right now. Please check back later.</p>}</section>
              <p className="ai-purchase-note">Prices in USD before applicable tax. Plans renew at the interval shown; top-ups never renew. Provider availability and model limits apply. For a refund of unused top-ups, <a href="/support">contact support</a>.</p>
            </>
          )}

          <ModelWallet country={country} />
          {!authLoading && user === null && <section id="ai-sign-in" className="ai-sign-in" tabIndex={-1} aria-label="Sign in to upgrade"><SignInCard headingTag="h2" heading={selectedPlan === null ? "Sign in to upgrade" : `Continue with ${planName(selectedPlan)}`} /></section>}
          {user !== null && <CodeRedeemer key={`code:${account}`} token={token} onRedeem={() => void refresh()} />}
          {subscription?.plan === "pro" && subscriptionAccess && <InviteCard key={`invite:${account}`} token={token} />}

          {activity !== null && activity.orders.length > 0 && (
            <section className="ai-tokens-history" aria-label="Purchase history">
              <h2>Your purchases</h2>
              <div className="ai-token-table-scroll" role="region" aria-label="AI purchase history" tabIndex={0}><table className="table">
                <thead><tr><th>Date</th><th>Purchase</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {activity.orders.map((row) => (
                    <tr key={row.orderId}>
                      <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td>{topUpName(row.packId)}</td>
                      <td>{dollars(row.priceCents)}</td>
                      <td>{{ pending: "Pending", paid: "Paid", refunded: "Refunded", abandoned: "Not completed" }[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          )}
    </>
  );
}

/** A return URL alone never proves payment; wait for the webhook-backed subscription or order. */
export function checkoutArrived(view: Pick<TokenActivityView, "tokens" | "orders" | "subscription">, returned: CheckoutReturn): boolean {
  if (returned.plan !== null) {
    const subscription = view.subscription;
    return subscription !== undefined && subscription !== null
      ? subscription.plan === returned.plan && subscription.periodEnd > Date.now() && (subscription.active ?? ["active", "cancelled"].includes(subscription.status))
      : view.tokens.plan?.id === returned.plan && view.tokens.plan.source === "subscription" && view.tokens.plan.endsAt > Date.now();
  }
  return view.orders.some((order) => order.orderId === returned.order && order.status === "paid");
}

function forgetCheckoutReturn(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("order"); url.searchParams.delete("plan");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
