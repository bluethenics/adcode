"use client";

/**
 * Start or stop a free model promotion: the first N verified accounts each get a fixed amount of
 * free usage on chosen paid models (for example $0.15 of DeepSeek for 300 accounts). The grant
 * is charged at listed prices and pays only for those models. See services/api/src/modelPromo.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { MAX_PROMO_DAYS, MAX_PROMO_MICROS, MAX_PROMO_NAME, MAX_PROMO_USERS, type ModelPromo } from "@adcode/api/src/modelPromo.ts";
import { WALLET_MARKUP_PERCENT } from "@adcode/api/src/modelWallet.ts";
import { offerEndDate } from "@/lib/pricing";

type AdminCall = <T>(path: string, body?: unknown) => Promise<T>;
interface PromoState { promo: ModelPromo | null; active: boolean; claims: number; spentMicros: number; models: { id: string; name: string }[] }

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const DAY_MS = 86_400_000;

/** What the status line says about the running (or last) promotion. */
export function promoStatus(state: PromoState | null): string {
  if (state === null) return "Loading…";
  if (state.promo === null) return "No free model promotion is running.";
  const { promo } = state;
  const names = promo.models.map((id) => state.models.find((model) => model.id === id)?.name ?? id).join(", ");
  const used = `${state.claims.toLocaleString("en-US")} of ${promo.maxUsers.toLocaleString("en-US")} places claimed, ${usd(state.spentMicros)} used at listed prices`;
  return state.active
    ? `${promo.name} is running until ${offerEndDate(promo.endsAt)}: ${usd(promo.perUserMicros)} of ${names} free per verified account. ${used}.`
    : `The last promotion, ${promo.name}, ended ${offerEndDate(promo.endsAt)}. ${used}.`;
}

export function ModelPromoAdmin({ call }: { call: AdminCall }) {
  const [state, setState] = useState<PromoState | null>(null);
  const [name, setName] = useState("Free DeepSeek");
  const [cents, setCents] = useState("15");
  const [users, setUsers] = useState("300");
  const [days, setDays] = useState("30");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await call<PromoState>("/admin/ai-plans/model-promo");
      setState(next);
      setModels((chosen) => chosen.length > 0 ? chosen : next.models.filter((model) => /deepseek/i.test(`${model.id} ${model.name}`)).map((model) => model.id).slice(0, 1));
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "Couldn't load the promotion.", error: true }); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  async function change(body: unknown, done: string): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await call("/admin/ai-plans/model-promo", body); await load(); setNotice({ text: done, error: false }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "The change couldn't be confirmed. Check the status above, then try again.", error: true }); }
    finally { setBusy(false); }
  }

  const perUser = Number(cents), accounts = Number(users), length = Number(days);
  const valid = name.trim() !== "" && name.trim().length <= MAX_PROMO_NAME && Number.isInteger(perUser) && perUser >= 1 && perUser * 10_000 <= MAX_PROMO_MICROS
    && Number.isInteger(accounts) && accounts >= 1 && accounts <= MAX_PROMO_USERS && Number.isInteger(length) && length >= 1 && length <= MAX_PROMO_DAYS && models.length > 0;
  // Listed prices carry the markup, so the provider bill is lower than what the grants spend.
  const listed = valid ? perUser * accounts / 100 : 0;
  const providerCost = listed * 100 / (100 + WALLET_MARKUP_PERCENT);

  function start(): void {
    if (!valid) { setNotice({ text: `Enter a name, 1 to ${MAX_PROMO_MICROS / 10_000} cents per account, 1 to ${MAX_PROMO_USERS.toLocaleString("en-US")} accounts, 1 to ${MAX_PROMO_DAYS} days, and at least one model.`, error: true }); return; }
    if (!window.confirm(`Give the first ${accounts.toLocaleString("en-US")} verified accounts $${(perUser / 100).toFixed(2)} each of free usage for ${length} day${length === 1 ? "" : "s"}, starting now? At most $${listed.toFixed(2)} at listed prices (about $${providerCost.toFixed(2)} at provider cost).`)) return;
    void change({ name: name.trim(), perUserCents: perUser, maxUsers: accounts, days: length, models }, `Started. The first ${accounts.toLocaleString("en-US")} verified accounts get it, on first use or from AI credits.`);
  }

  return <div className="plans-admin-group">
    <header className="admin-card-head"><h4>Free model promotion</h4><button type="button" className="btn" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    <p className="row-sub" role="status">{promoStatus(state)}</p>
    <form onSubmit={(event) => { event.preventDefault(); start(); }} aria-label="Start free model promotion">
      <div className="tagflow-fields">
        <label className="tagflow-field"><span>Name, shown to customers</span><input className="input" required maxLength={MAX_PROMO_NAME} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="tagflow-field"><span>Cents per account</span><input className="input" type="number" required min={1} max={MAX_PROMO_MICROS / 10_000} step={1} disabled={busy} value={cents} onChange={(event) => setCents(event.target.value)} /><small>Spent at listed prices, only on the models below.</small></label>
        <label className="tagflow-field"><span>Accounts</span><input className="input" type="number" required min={1} max={MAX_PROMO_USERS} step={1} disabled={busy} value={users} onChange={(event) => setUsers(event.target.value)} /><small>Verified accounts only; first come, first served.</small></label>
        <label className="tagflow-field"><span>Days, starting now</span><input className="input" type="number" required min={1} max={MAX_PROMO_DAYS} step={1} disabled={busy} value={days} onChange={(event) => setDays(event.target.value)} /><small>Starting another replaces this one, as a new pool.</small></label>
      </div>
      <fieldset className="tagflow-field" disabled={busy}>
        <legend>Models it pays for</legend>
        {(state?.models ?? []).map((model) => <label key={model.id} className="checkbox"><input type="checkbox" checked={models.includes(model.id)} onChange={(event) => setModels((chosen) => event.target.checked ? [...chosen, model.id] : chosen.filter((id) => id !== model.id))} /> {model.name}</label>)}
      </fieldset>
      <button className="btn" disabled={busy}>{busy ? "Applying…" : "Start promotion"}</button>
      {state?.active === true && <button type="button" className="btn" disabled={busy} onClick={() => void change({ stop: true }, "Stopped. Nobody new can claim it, and nobody's remaining grant pays for anything after now.")}>End promotion now</button>}
    </form>
    <p className="row-sub">{valid ? `Budget: at most $${listed.toFixed(2)} at listed prices, about $${providerCost.toFixed(2)} of provider cost. ` : ""}A verified account claims its place the first time it uses one of these models, or with the button on AI credits. Requests that start before the end are honoured.</p>
    {notice !== null && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </div>;
}
