"use client";

/**
 * Start or stop a price offer: a percentage off every model paid from USD credits, for a set
 * number of days. The service applies it to every charge and every listed price, and the
 * website shows it on Pricing, AI credits and in the header. See services/api/src/priceOffer.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { MAX_OFFER_DAYS, MAX_OFFER_NAME, MAX_OFFER_PERCENT, type PriceOffer } from "@adcode/api/src/priceOffer.ts";
import { offerEndDate } from "@/lib/pricing";

type AdminCall = <T>(path: string, body?: unknown) => Promise<T>;
interface OfferState { offer: PriceOffer | null; active: boolean }

const expiry = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const DAY_MS = 86_400_000;

/** What the status line says; an offer that already ended is history, not news. */
export function offerStatus(state: OfferState | null): string {
  if (state === null) return "Loading…";
  if (state.offer === null) return "No offer is running. Paid models are charged their regular prices.";
  return state.active
    ? `${state.offer.name} is running until ${expiry(state.offer.endsAt)}: every paid model is ${state.offer.percent}% off, on each request and on every listed price.`
    : `The last offer, ${state.offer.name} (${state.offer.percent}% off), ended ${expiry(state.offer.endsAt)}.`;
}

export function PriceOfferAdmin({ call }: { call: AdminCall }) {
  const [state, setState] = useState<OfferState | null>(null);
  const [name, setName] = useState("Limited-time offer");
  const [percent, setPercent] = useState("15");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try { setState(await call<OfferState>("/admin/ai-plans/offer")); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "Couldn't load the offer.", error: true }); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  async function change(body: { name: string; percent: number; days: number } | { stop: true }, done: string): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { setState(await call<OfferState>("/admin/ai-plans/offer", body)); setNotice({ text: done, error: false }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "The change couldn't be confirmed. Check the status above, then try again.", error: true }); }
    finally { setBusy(false); }
  }

  const off = Number(percent);
  const length = Number(days);
  const valid = name.trim() !== "" && name.trim().length <= MAX_OFFER_NAME && Number.isInteger(off) && off >= 1 && off <= MAX_OFFER_PERCENT && Number.isInteger(length) && length >= 1 && length <= MAX_OFFER_DAYS;
  // A $1.00 regular price, as the price list would show it with this offer.
  const example = valid ? `$1.00 becomes $${(1 - off / 100).toFixed(2)}` : null;

  function start(): void {
    if (!valid) { setNotice({ text: `Enter a name, a whole percent from 1 to ${MAX_OFFER_PERCENT}, and whole days from 1 to ${MAX_OFFER_DAYS}.`, error: true }); return; }
    if (!window.confirm(`Charge every paid model ${off}% less for ${length} day${length === 1 ? "" : "s"}, starting now? It shows on the website at once and comes out of your margin.`)) return;
    void change({ name: name.trim(), percent: off, days: length }, `Started. Every paid model is ${off}% off until ${offerEndDate(Date.now() + length * DAY_MS)}.`);
  }

  return <div className="plans-admin-group">
    <header className="admin-card-head"><h4>Price offer</h4><button type="button" className="btn" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    <p className="row-sub" role="status">{offerStatus(state)}</p>
    <form onSubmit={(event) => { event.preventDefault(); start(); }} aria-label="Start price offer">
      <div className="tagflow-fields">
        <label className="tagflow-field"><span>Offer name, shown on the website</span><input className="input" required maxLength={MAX_OFFER_NAME} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="tagflow-field"><span>Percent off</span><input className="input" type="number" required min={1} max={MAX_OFFER_PERCENT} step={1} disabled={busy} value={percent} onChange={(event) => setPercent(event.target.value)} /><small>At most {MAX_OFFER_PERCENT}%, so no model is ever sold below what its provider charges you.</small></label>
        <label className="tagflow-field"><span>Days, starting now</span><input className="input" type="number" required min={1} max={MAX_OFFER_DAYS} step={1} disabled={busy} value={days} onChange={(event) => setDays(event.target.value)} /><small>Starting another offer replaces the running one.</small></label>
      </div>
      <button className="btn" disabled={busy}>{busy ? "Applying…" : "Start offer"}</button>
      {state?.active === true && <button type="button" className="btn" disabled={busy} onClick={() => void change({ stop: true }, "Stopped. Listed prices are back to regular now; requests in the next 5 minutes are still charged the offer price, so nobody pays more than a price still on their screen.")}>End offer now</button>}
    </form>
    <p className="row-sub">{valid ? `Customers see "${name.trim()}: ${off}% off every paid model until ${offerEndDate(Date.now() + length * DAY_MS)}" on Pricing, AI credits and in the site header, and each price with the regular one struck through (${example}). ` : ""}It applies to requests that start while it runs; the editor&apos;s model picker shows the lower prices with no update.</p>
    {notice !== null && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </div>;
}
