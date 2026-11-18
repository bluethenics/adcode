"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Lock } from "lucide";
import { Icon } from "@/components/Icon";
import { useAuth } from "@/components/AuthProvider";
import { SignInCard } from "@/components/SignInCard";
import { PortalError, PortalSkeleton, usePortal } from "@/components/advertisers/portal/PortalShell";
import { apiFetch, MESSAGES, type CheckoutView } from "@/lib/api";
import { money, dollarsToMicros } from "@/components/money";
import { campaignState } from "@/lib/portalModel";

const PRESETS = ["50", "100", "500", "1000"] as const;

/**
 * Credits: what the balance is, what live campaigns are holding, and the way to add more.
 *
 * Payment happens on Dodo Payments' hosted page, so no card details touch this site. A
 * campaign page that is waiting for credits links here with `?amount=` set to exactly the
 * shortfall, so the fix is one click and one payment.
 */
export function BillingBody() {
  const portal = usePortal();
  const { user } = useAuth();
  const [amount, setAmount] = useState("100");
  const [country, setCountry] = useState("US");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const asked = new URLSearchParams(globalThis.location.search).get("amount");
    if (asked !== null && dollarsToMicros(asked) !== null) setAmount(asked);
  }, []);
  useEffect(() => {
    if (email.length === 0 && (user?.email ?? portal.email) != null) setEmail(user?.email ?? portal.email ?? "");
  }, [user, portal.email, email.length]);

  if (portal.status === "checking" || portal.status === "loading") return <PortalSkeleton />;
  if (portal.status === "signed-out") return <div className="ap-signin"><SignInCard heading="Sign in to manage credits" audience="advertiser" headingTag="h2" initialMode="in" /></div>;
  if (portal.status === "error") return <PortalError message={portal.error} onRetry={() => void portal.reload()} />;
  if (portal.status === "none") {
    return (
      <div className="ap-state">
        <h2>Credits come with your first campaign</h2>
        <p>Build a campaign first. Your advertiser account is created when you launch it, and you can add credits right after.</p>
        <Link href="/portal/campaigns/new" className="ap-btn ap-btn-primary">Build my campaign <Icon node={ArrowRight} /></Link>
      </div>
    );
  }

  const advertiser = portal.advertiser;
  const waiting = portal.campaigns.map((c) => campaignState(c, advertiser)).filter((s) => s.tone === "waiting");

  const pay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const micros = dollarsToMicros(amount);
    if (micros === null) return setError("Enter an amount like 100 or 100.00.");
    if (BigInt(micros) < 1_000_000n) return setError("The minimum payment is $1.00.");
    if (BigInt(micros) % 10_000n !== 0n) return setError("Amounts are charged in whole cents.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter the email address for your receipt.");
    if (!/^[A-Z]{2}$/.test(country)) return setError("Use your two-letter billing country, such as US or DE.");

    setBusy(true);
    setError(null);
    const session = await apiFetch<CheckoutView>({ path: "/portal/checkout", token: await portal.token(), method: "POST", body: { amountMicros: micros, billingCountry: country, email: email.trim() } });
    if (!session.ok) {
      setBusy(false);
      setError(MESSAGES[session.error]);
      return;
    }
    window.location.href = session.value.checkoutUrl;
  };

  return (
    <>
      <header className="ap-page-head">
        <div>
          <h1>Billing</h1>
          <p>Credits you buy stay in your balance until a campaign spends them on verified views.</p>
        </div>
      </header>

      <dl className="ap-kpis ap-kpis-3">
        <div><dt>Available</dt><dd className="money">{money(advertiser?.availableMicros ?? "0")}</dd></div>
        <div><dt>Held by live campaigns</dt><dd className="money">{money(advertiser?.reservedMicros ?? "0")}</dd></div>
        <div><dt>Bought all time</dt><dd className="money">{money(advertiser?.fundedMicros ?? "0")}</dd></div>
      </dl>

      {waiting.length > 0 && (
        <div className="ap-banner" data-tone="warn" role="status">
          <p>{waiting.length === 1 ? "One campaign is" : `${waiting.length} campaigns are`} waiting for credits. It goes live by itself once the balance covers it.</p>
        </div>
      )}

      <form className="ap-panel ap-pay" onSubmit={pay} noValidate>
        <h2>Add credits</h2>
        {error !== null && <p className="ap-field-error" role="alert">{error}</p>}
        <fieldset className="ap-budget">
          <legend>Amount</legend>
          <div className="ap-presets" role="group" aria-label="Amount shortcuts">
            {PRESETS.map((preset) => (
              <button key={preset} type="button" aria-pressed={Number(amount) === Number(preset)} onClick={() => setAmount(preset)}>
                ${Number(preset).toLocaleString("en-US")}
              </button>
            ))}
          </div>
          <div className="ap-money">
            <span aria-hidden="true">$</span>
            <input aria-label="Amount in dollars" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/^\$/, ""))} />
          </div>
        </fieldset>
        <div className="ap-pay-row">
          <div className="field">
            <label htmlFor="b-email">Receipt email</label>
            <input id="b-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field ap-field-short">
            <label htmlFor="b-country">Country</label>
            <input id="b-country" className="input" maxLength={2} autoComplete="country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
          </div>
        </div>
        <button type="submit" className="ap-btn ap-btn-primary ap-btn-large" disabled={busy}>
          {busy ? "Opening checkout…" : `Continue to payment`}<Icon node={ArrowRight} />
        </button>
        <p className="field-hint ap-pay-note">
          <Icon node={Lock} />Checkout by Dodo Payments, charged in your local currency. Credits are added after a signed payment confirmation, usually within seconds.
        </p>
      </form>
    </>
  );
}
