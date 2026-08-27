"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type AdvertiserView, type CheckoutView } from "@/lib/api";
import { money, dollarsToMicros } from "@/components/money";

const PRESETS = ["50.00", "100.00", "500.00", "1000.00"] as const;

export default function Billing() {
  const router = useRouter();
  useEffect(() => router.replace("/portal#credits"), [router]);
  return null;
}

export function BillingBody() {
  const { token, user } = useAuth();

  const [advertiser, setAdvertiser] = useState<AdvertiserView | null>(null);
  const [amount, setAmount] = useState("100.00");
  const [country, setCountry] = useState("US");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<AdvertiserView>({
      path: "/portal/advertiser",
      token: await token(),
    });
    if (found.ok) setAdvertiser(found.value);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (user?.email != null && email.length === 0) setEmail(user.email);
  }, [user, email.length]);

  const addFunds = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const micros = dollarsToMicros(amount);
    if (micros === null) {
      setError("Enter an amount like 100.00.");
      return;
    }
    if (BigInt(micros) < 1_000_000n) {
      setError("The minimum payment is $1.00.");
      return;
    }
    if (BigInt(micros) % 10_000n !== 0n) {
      setError("Amounts are charged in whole cents.");
      return;
    }

    setBusy(true);
    setError(null);

    const session = await apiFetch<CheckoutView>({
      path: "/portal/checkout",
      token: await token(),
      method: "POST",
      body: { amountMicros: micros, billingCountry: country, email: email.trim() },
    });

    setBusy(false);
    if (!session.ok) {
      setError(MESSAGES[session.error]);
      return;
    }

    // Leaving the site is the point - payment happens on Dodo's hosted page, so no card
    // details ever touch this app.
    window.location.href = session.value.checkoutUrl;
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Available ad credits</span>
          <span className="stat-value money">{money(advertiser?.availableMicros ?? "0")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Committed to campaigns</span>
          <span className="stat-value">{money(advertiser?.reservedMicros ?? "0")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Credits purchased</span>
          <span className="stat-value">{money(advertiser?.fundedMicros ?? "0")}</span>
        </div>
      </div>

      <form onSubmit={addFunds} style={{ maxWidth: 480 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Buy advertising credits</h3>

        <div className="field">
          <label htmlFor="b-amount">Amount</label>
          <span className="field-hint">Minimum $1.00. Charged in your local currency by Dodo Payments.</span>
          <input
            id="b-amount"
            className="input"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <div className="actions" style={{ marginTop: 8 }}>
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="btn btn-outline btn-small"
                onClick={() => setAmount(preset)}
              >
                ${preset}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="b-email">Billing email</label>
          <input
            id="b-email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="b-country">Billing country</label>
          <span className="field-hint">Two-letter code. Used for tax.</span>
          <input
            id="b-country"
            className="input"
            maxLength={2}
            required
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            style={{ maxWidth: 100 }}
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Continue to payment
          </button>
        </div>

        <p className="field-hint" style={{ marginTop: 14 }}>
          You&apos;ll finish on Dodo Payments&apos; secure page. Your balance updates once
          the payment settles, which is usually seconds — refresh this page if it
          hasn&apos;t appeared after a minute.
        </p>
      </form>
    </>
  );
}
