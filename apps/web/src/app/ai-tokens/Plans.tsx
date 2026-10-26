"use client";

/** Subscription, promo and invite controls. Access is only confirmed by the server. */
import { useCallback, useEffect, useState } from "react";
import type { PlanId, PlanSpec } from "@adcode/api/src/aiPlans.ts";
import { dollars, formatTokens } from "./tokenFormatting";

export const planName = (id: string): string => ({ weekly: "Weekly", monthly: "Monthly", pro: "Pro" } as Record<string, string>)[id] ?? "Plan";

export function PlanCards({ plans, current, busy, onChoose, subscribed = false }: {
  plans: readonly PlanSpec[];
  current: string | null;
  busy: string | null;
  onChoose: (plan: PlanSpec) => void;
  subscribed?: boolean;
}) {
  return <ul className="ai-plan-cards" aria-label="AI plans">
    {plans.map((plan) => <li key={plan.id} className="ai-plan-card" data-current={current === plan.id}>
      <div className="ai-plan-title"><h3>{plan.name}</h3>{current === plan.id && <span className="ai-plan-badge">Current plan</span>}</div>
      <p className="ai-plan-price">{dollars(plan.priceCents)}<span>/{plan.interval}</span></p>
      <p className="ai-plan-allowance">{formatTokens(plan.weeklyTokens)} tokens a week</p>
      <p className="field-hint">{plan.invites > 0 ? `Invite ${plan.invites} friends. When each subscribes, you both get 4M extra tokens.` : "A bigger weekly allowance for Heabsy models."}</p>
      <button type="button" className={`btn ${plan.id === "pro" ? "btn-primary" : "btn-outline"}`} disabled={busy !== null || current === plan.id || subscribed} onClick={() => onChoose(plan)} aria-label={current === plan.id ? `${plan.name}: current plan` : `Choose ${plan.name}`}>
        {busy === plan.id ? "Opening checkout…" : current === plan.id ? "Current plan" : subscribed ? "Manage in portal" : `Choose ${plan.name}`}
      </button>
    </li>)}
  </ul>;
}

export class PlanRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Keep promo/invite outcomes, which the general API helper intentionally folds into statuses. */
export async function planRequest<T>(path: string, idToken: string | null, body?: unknown): Promise<T> {
  if (idToken === null) throw new PlanRequestError("unauthenticated", "Your session expired. Sign in again.");
  let response: Response;
  try {
    response = await fetch(`/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${idToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch { throw new PlanRequestError("offline", "Couldn't reach the server. Check your connection and try again."); }
  let parsed: unknown;
  try { parsed = await response.json(); }
  catch { throw new PlanRequestError("server-error", "Couldn't read the server's reply. Please try again."); }
  if (!response.ok) {
    const value = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    const error = typeof value["error"] === "object" && value["error"] !== null ? value["error"] as Record<string, unknown> : {};
    const code = value["result"] ?? error["code"] ?? value["error"];
    const messages: Record<string, string> = {
      "verify-account": "Verify your email address, then try again.",
      "already-subscribed": "You already have an active subscription. Use Manage subscription to make changes.",
      "paid-off": "Plans and token sales are paused. Please try again later.",
      "not-configured": "Subscription payments aren't ready yet. Please try again later.",
      "portal-unavailable": "Couldn't open the subscription portal. Please try again shortly.",
      "no-subscription": "No billing subscription was found for this account.",
      "no-invite": "Invites are available with an active Pro subscription. Refresh your balance after your plan starts.",
      "bad-country": "Enter a two-letter billing country, like US or DE.",
      "bad-code": "Use a code with 3–24 letters or numbers, without spaces.",
      "too-many-checkouts": "You've opened several checkouts. Wait a few minutes before trying again.",
    };
    const fallback = response.status === 401 ? "Your session expired. Sign in again." : "This request couldn't be completed. Please try again.";
    throw new PlanRequestError(typeof code === "string" ? code : String(response.status), typeof error["message"] === "string" ? error["message"] : typeof code === "string" ? messages[code] ?? fallback : fallback);
  }
  return parsed as T;
}

export function codeMessage(result: string, invite = false): string {
  const messages: Record<string, string> = {
    tokens: "Your promo tokens have been added to your balance.",
    plan: "Your promo plan is active. Your weekly allowance has been updated.",
    joined: "Invite accepted. Start any paid plan and you and your friend will each receive 4M tokens.",
    unknown: invite ? "That invite code wasn't found. Check the code with your friend." : "That promo code wasn't found. Check the spelling and try again.",
    expired: "That promo code has expired.",
    "used-up": invite ? "That invite code has no uses left." : "That promo code has reached its redemption limit.",
    already: invite ? "You've already accepted an invite. Each account can accept one." : "You've already redeemed this promo code.",
    "own-code": "You can't use your own invite code. Share it with a friend.",
    "has-plan": "Invites are for accounts that haven't started a paid plan yet.",
    "email-not-verified": "Verify your email address, then try again.",
    "not-verified": "Verify your email address, then try again.",
  };
  return messages[result] ?? "The code couldn't be redeemed. Please try again.";
}

export function CodeRedeemer({ token, onRedeem }: { token: () => Promise<string | null>; onRedeem: () => void }) {
  const [kind, setKind] = useState<"promo" | "invite">("promo");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  async function redeem(): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(null);
    try {
      const value = await planRequest<{ result: string }>(kind === "promo" ? "/ai/promo/redeem" : "/ai/invites/redeem", await token(), { code: code.trim().toUpperCase() });
      setNotice({ text: codeMessage(value.result, kind === "invite"), error: false }); setCode(""); onRedeem();
    } catch (error) {
      const known = error instanceof PlanRequestError && ["unknown", "expired", "used-up", "already", "own-code", "has-plan", "email-not-verified", "not-verified"].includes(error.code);
      setNotice({ text: known ? codeMessage(error.code, kind === "invite") : error instanceof Error ? error.message : "Couldn't redeem the code. Try again.", error: true });
    } finally { setBusy(false); }
  }
  return <section className="ai-token-code" aria-labelledby="ai-code-heading">
    <h2 id="ai-code-heading">Have a code?</h2>
    <p className="field-hint">Redeem a promotion, or accept a friend&apos;s invite before subscribing.</p>
    <form className="ai-code-form" onSubmit={(event) => { event.preventDefault(); void redeem(); }}>
      <label className="field"><span>Code type</span><select className="select" value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as "promo" | "invite"); setNotice(null); }}><option value="promo">Promo code</option><option value="invite">Friend&apos;s invite</option></select></label>
      <label className="field"><span>{kind === "promo" ? "Promo code" : "Invite code"}</span><input className="input" required minLength={3} maxLength={24} pattern="[A-Za-z0-9]{3,24}" autoCapitalize="characters" autoComplete="off" spellCheck={false} disabled={busy} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
      <button className="btn btn-outline" disabled={busy}>{busy ? "Redeeming…" : kind === "promo" ? "Redeem code" : "Accept invite"}</button>
    </form>
    {notice !== null && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

interface InviteView { code: string; uses: number; maxUses: number }

export function InviteCard({ token }: { token: () => Promise<string | null> }) {
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError("");
    try { setInvite(await planRequest<InviteView>("/ai/invites", await token())); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't load your invite code."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  async function copy(): Promise<void> {
    if (invite === null) return;
    try { await navigator.clipboard.writeText(invite.code); setCopied("Invite code copied."); }
    catch { setCopied("Couldn't copy automatically. Select the code above and copy it."); }
  }
  return <section className="ai-token-code" aria-labelledby="ai-invite-heading">
    <h2 id="ai-invite-heading">Your Pro invites</h2>
    <p className="field-hint">When a friend accepts your invite and starts a paid plan, you both get 4M purchased tokens. Each friend can earn this reward once.</p>
    {loading ? <p role="status">Loading your invite code…</p> : error ? <p className="notice" data-tone="error" role="alert">{error} <button type="button" className="btn btn-outline btn-small" onClick={() => void load()}>Retry</button></p> : invite !== null && <>
      <div className="ai-invite-copy"><input className="input" aria-label="Your invite code" readOnly value={invite.code} onFocus={(event) => event.target.select()} /><button type="button" className="btn btn-outline" onClick={() => void copy()}>Copy code</button></div>
      <p className="field-hint">{Math.max(0, invite.maxUses - invite.uses)} of {invite.maxUses} invites remaining.</p>
      {copied && <p role="status" className="field-hint">{copied}</p>}
    </>}
  </section>;
}

export function planArrivalMessage(arrival: "checking" | "added" | "not-yet", plan: PlanId): string {
  if (arrival === "checking") return `Checking your ${planName(plan)} subscription… Your allowance updates after payment is confirmed.`;
  if (arrival === "added") return `Your ${planName(plan)} plan is active. Your weekly allowance has been updated.`;
  return "Your subscription hasn't been confirmed yet. If you paid, allow a few minutes, then press Refresh. Need help? Contact us from the Help page.";
}
