"use client";

/**
 * Buying AI tokens for Heabsy's models in ADCode.
 *
 * Every account gets a free weekly allowance on those models; past it, the relay draws on tokens
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
import { dollars, formatTokens } from "./tokenFormatting";
export { formatTokens } from "./tokenFormatting";

export interface TokenPack { id: string; priceCents: number; tokens: number }
export interface TokensView { enabled: boolean; free: { limit: number; used: number; held: number; remaining: number; resetsAt: number | null }; purchased: number; plan?: { id: PlanId; endsAt: number; source: "subscription" | "gift" } | null }
interface TokenOrderView { orderId: string; packId: string; priceCents: number; tokens: number; status: "pending" | "paid" | "refunded" | "abandoned"; createdAt: number; paidAt: number | null }
interface TokenLedgerView { id: string; delta: number; kind: "purchase" | "usage" | "refund" | "grant"; note: string; createdAt: number }
interface TokenActivityView { tokens: TokensView; orders: TokenOrderView[]; ledger: TokenLedgerView[]; subscription?: { plan: PlanId; status: string; periodEnd: number; active?: boolean } | null }
interface PaidOffer { enabled: boolean; freeWeeklyTokens: number; packs: TokenPack[]; plans?: PlanSpec[] }
interface CheckoutReturn { order: string; plan: PlanId | null }

const POLL_MS = 3_000;
const POLL_FOR_MS = 120_000;

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
    <ul className="token-packs" aria-label="Token packs">
      {packs.map((pack) => (
        <li key={pack.id} className="token-pack">
          <span className="token-pack-price">{dollars(pack.priceCents)}</span>
          <span className="token-pack-tokens">{formatTokens(pack.tokens)} tokens</span>
          <span className="field-hint">${(pack.priceCents / 100 / (pack.tokens / 1_000_000)).toFixed(2)} per million</span>
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => onBuy(pack)}>
            {busy === pack.id ? "Opening checkout…" : `Buy ${formatTokens(pack.tokens)}`}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BalanceSummary({ tokens, now }: { tokens: TokensView; now: number }) {
  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-label">{tokens.plan ? `${planName(tokens.plan.id)} this week` : "Free this week"}</span>
        <span className="stat-value">{formatTokens(tokens.free.remaining)} of {formatTokens(tokens.free.limit)} free</span>
        <span className="stat-hint">{tokens.free.resetsAt === null ? "Starts with your first Heabsy request" : `Free tokens refill ${refillText(tokens.free.resetsAt, now)}`}{tokens.plan && <>. {tokens.plan.source === "gift" ? "Gifted plan" : "Paid period"} ends {new Date(tokens.plan.endsAt).toLocaleDateString()}.</>}</span>
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
  const account = user?.uid ?? null;
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => { setCountry(guessCountry()); }, []);

  const loadOffer = useCallback(async (): Promise<void> => {
    setOfferError(null);
    try {
      const response = await fetch("/v1/ai/tagflow/config");
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json() as { paid?: PaidOffer };
      if (body.paid === undefined) throw new Error("missing-offer");
      setOffer(body.paid);
    } catch { setOfferError("Couldn't load plans and token packs. Check your connection and try again."); }
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

  const buy = async (pack: TokenPack) => {
    if (busy !== null) return;
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

  if (authLoading) return <AdcodeLoader />;

  // The heading and the offer are rendered by the page on the server (page.tsx).
  return (
    <>
      {user === null ? (
        <SignInCard heading="Sign in with your ADCode account" />
      ) : (
        <>
          {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
          {arrival !== null && (
            <div className="notice" data-tone={arrival === "added" ? "success" : undefined} role="status">
              {checkoutReturn?.plan ? planArrivalMessage(arrival, checkoutReturn.plan) : arrivalMessage(arrival)}{" "}
              {arrival === "not-yet" && <button type="button" className="btn btn-outline btn-small" onClick={() => void refresh()}>Refresh</button>}
            </div>
          )}

          {activity !== null && <BalanceSummary tokens={activity.tokens} now={now} />}
          {balanceError !== null && <p className="notice" data-tone="error" role="alert">{balanceError} <button type="button" className="btn btn-outline btn-small" onClick={() => void refresh()}>Retry balance</button></p>}
          {activity === null && balanceError === null && <p role="status" className="field-hint">Loading your allowance and balance…</p>}
          {subscription !== null && <div className="ai-plan-management"><p>{planName(subscription.plan)} subscription. Manage your plan, payment method or cancellation in Dodo.</p><button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void managePlan()}>{busy === "portal" ? "Opening portal…" : "Manage subscription"}</button></div>}

          {offerError !== null ? <p className="notice" data-tone="error" role="alert">{offerError} <button type="button" className="btn btn-outline btn-small" onClick={() => void loadOffer()}>Retry offers</button></p> : offer === null ? <AdcodeLoader /> : !offer.enabled ? (
            <p className="notice">Buying tokens opens soon. Tagflow AI stays free in the meantime.</p>
          ) : (
            <>
              <div className="field ai-tokens-country">
                <label htmlFor="t-country">Billing country</label>
                <span className="field-hint">Two-letter code, used for tax.</span>
                <input id="t-country" className="input" required pattern="[A-Z]{2}" autoComplete="country" maxLength={2} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} />
              </div>
              {(offer.plans?.length ?? 0) > 0 && <section className="ai-plans-section" aria-labelledby="ai-plans-heading"><h2 id="ai-plans-heading">A plan for every week</h2><p className="field-hint">Plans raise your weekly Heabsy allowance. They renew at the interval shown; manage or cancel in your subscription portal. Tagflow AI stays free.</p><PlanCards plans={offer.plans!} current={activity?.tokens.plan?.id ?? null} busy={activity === null ? "loading-balance" : busy} subscribed={subscribed} onChoose={(plan) => void choosePlan(plan)} /></section>}
              <CodeRedeemer key={`code:${account}`} token={token} onRedeem={() => void refresh()} />
              {subscription?.plan === "pro" && subscriptionAccess && <InviteCard key={`invite:${account}`} token={token} />}
              <section className="ai-packs-section" aria-labelledby="ai-packs-heading"><h2 id="ai-packs-heading">One-time token packs</h2><p className="field-hint">Extra tokens are used after your weekly allowance. They never expire, and packs don&apos;t renew.</p><PackList packs={offer.packs} busy={busy} onBuy={(pack) => void buy(pack)} /></section>
              <p className="field-hint">You&apos;ll pay on Dodo Payments&apos; secure page; Dodo handles sales tax. For a refund of unused tokens, contact us from the Help page.</p>
            </>
          )}

          {activity !== null && activity.ledger.length > 0 && (
            <section className="ai-tokens-history" aria-label="Token history">
              <h2>History</h2>
              <div className="ai-token-table-scroll" role="region" aria-label="Token transaction history" tabIndex={0}><table className="table">
                <thead><tr><th>Date</th><th>What</th><th>Tokens</th></tr></thead>
                <tbody>
                  {activity.ledger.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td>{{ purchase: "Bought", usage: "Used", refund: "Refunded", grant: "Added by ADCode" }[row.kind]}{row.note ? ` - ${row.note}` : ""}</td>
                      <td>{row.delta > 0 ? "+" : "-"}{formatTokens(Math.abs(row.delta))}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </section>
          )}
        </>
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
