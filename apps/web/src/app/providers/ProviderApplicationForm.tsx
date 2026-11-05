"use client";

import { useState, type FormEvent } from "react";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

const OFFERS = [
  { id: "free", label: "Free and sponsored" },
  { id: "paid", label: "Paid credits through ADCode" },
  { id: "byok", label: "Bring your own key" },
] as const;

/**
 * One form, one submit, no account: the shortest path from "we would like to be in ADCode"
 * to a reply. Required fields are the ones the team cannot reply without.
 */
export function ProviderApplicationForm() {
  const [offers, setOffers] = useState<string[]>(["free"]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? "");
    if (offers.length === 0) { setError("Choose at least one way ADCode could offer your models."); return; }
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/v1/provider-applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: text("company"), contactName: text("contactName"), email: text("email"), website: text("website"),
          models: text("models"), apiBase: text("apiBase"), offers, pricing: text("pricing"), message: text("message"), url2: text("url2"),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "That did not send. Try again in a moment."); return; }
      setSent(true);
      trackWebsiteEvent("provider_applied");
    } catch {
      setError("That did not send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="providers-sent glass-card" role="status">
        <h3>Application received</h3>
        <p>Thank you. We read every application and reply to the email you gave, usually within a few days.</p>
      </div>
    );
  }

  return (
    <form className="providers-form glass-card" onSubmit={(event) => void submit(event)}>
      {error !== null && <div className="glass-notice" data-tone="error" role="alert">{error}</div>}
      <div className="support-fields">
        <label className="glass-field">
          <span>Company</span>
          <input name="company" required maxLength={120} autoComplete="organization" />
        </label>
        <label className="glass-field">
          <span>Website</span>
          <input name="website" required type="url" maxLength={300} placeholder="https://" pattern="https://.*" />
        </label>
        <label className="glass-field">
          <span>Your name</span>
          <input name="contactName" required maxLength={120} autoComplete="name" />
        </label>
        <label className="glass-field">
          <span>Work email</span>
          <input name="email" required type="email" maxLength={254} autoComplete="email" />
        </label>
        <label className="glass-field glass-field-wide">
          <span>Models <small>one per line, as your API names them</small></span>
          <textarea name="models" required rows={3} maxLength={2000} placeholder="your-coder-32b" />
        </label>
        <fieldset className="glass-field glass-field-wide providers-offers-field">
          <legend>How should ADCode offer them?</legend>
          {OFFERS.map((offer) => (
            <label key={offer.id} className="providers-check">
              <input type="checkbox" checked={offers.includes(offer.id)} onChange={(event) => setOffers((current) => event.target.checked ? [...current, offer.id] : current.filter((id) => id !== offer.id))} />
              {offer.label}
            </label>
          ))}
        </fieldset>
        <label className="glass-field">
          <span>API base URL <small>optional</small></span>
          <input name="apiBase" type="url" maxLength={300} placeholder="https://api.example.com/v1" pattern="https://.*" />
        </label>
        <label className="glass-field">
          <span>Pricing <small>optional</small></span>
          <input name="pricing" maxLength={300} placeholder="$0.20 / $0.60 per 1M tokens" />
        </label>
        <label className="glass-field glass-field-wide">
          <span>Anything else <small>optional</small></span>
          <textarea name="message" rows={3} maxLength={2000} placeholder="Rate limits, context sizes, which models go where" />
        </label>
        {/* Hidden from people, filled only by scripts. */}
        <label className="providers-trap" aria-hidden="true">Leave empty<input name="url2" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <button type="submit" className="glass-submit" disabled={sending}>{sending ? "Sending…" : "Send application"}</button>
    </form>
  );
}
