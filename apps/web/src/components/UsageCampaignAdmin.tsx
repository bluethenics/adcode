"use client";

/** Start or stop a usage campaign: no weekly cap on paid models for everyone, for a set number of days. */
import { useCallback, useEffect, useState } from "react";
import { MAX_CAMPAIGN_DAYS, type UsageCampaign } from "@adcode/api/src/usageCampaign.ts";

type AdminCall = <T>(path: string, body?: unknown) => Promise<T>;
interface CampaignState { campaign: UsageCampaign | null; active: boolean }

const expiry = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** What the status line says; a campaign that already ended is history, not news. */
export function campaignStatus(state: CampaignState | null): string {
  if (state === null) return "Loading…";
  if (state.campaign === null) return "No campaign is running. Paid models use each account's daily allowance.";
  return state.active
    ? `${state.campaign.name} is running until ${expiry(state.campaign.endsAt)}. Paid models have no weekly cap and nothing is counted against anyone's week.`
    : `The last campaign, ${state.campaign.name}, ended ${expiry(state.campaign.endsAt)}.`;
}

export function UsageCampaignAdmin({ call }: { call: AdminCall }) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [name, setName] = useState("Unlimited usage");
  const [days, setDays] = useState("4");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try { setState(await call<CampaignState>("/admin/ai-plans/campaign")); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "Couldn't load the campaign.", error: true }); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  async function change(body: { name: string; days: number } | { stop: true }, done: string): Promise<void> {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { setState(await call<CampaignState>("/admin/ai-plans/campaign", body)); setNotice({ text: done, error: false }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "The change couldn't be confirmed. Check the status above, then try again.", error: true }); }
    finally { setBusy(false); }
  }

  function start(): void {
    const length = Number(days);
    if (!name.trim() || !Number.isInteger(length) || length < 1 || length > MAX_CAMPAIGN_DAYS) { setNotice({ text: `Enter a name and a whole number of days from 1 to ${MAX_CAMPAIGN_DAYS}.`, error: true }); return; }
    if (!window.confirm(`Lift the weekly cap on paid models for everyone for ${length} day${length === 1 ? "" : "s"}, starting now? This is real provider spend.`)) return;
    void change({ name: name.trim(), days: length }, `Started. Everyone has unlimited paid-model usage for ${length} day${length === 1 ? "" : "s"}.`);
  }

  return <div className="plans-admin-group">
    <header className="admin-card-head"><h4>Usage campaign</h4><button type="button" className="btn" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    <p className="row-sub" role="status">{campaignStatus(state)}</p>
    <form onSubmit={(event) => { event.preventDefault(); start(); }} aria-label="Start usage campaign">
      <div className="tagflow-fields">
        <label className="tagflow-field"><span>Campaign name</span><input className="input" required maxLength={80} disabled={busy} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="tagflow-field"><span>Days, starting now</span><input className="input" type="number" required min={1} max={MAX_CAMPAIGN_DAYS} step={1} disabled={busy} value={days} onChange={(event) => setDays(event.target.value)} /><small>Starting another campaign replaces the running one.</small></label>
      </div>
      <button className="btn" disabled={busy}>{busy ? "Applying…" : "Start campaign"}</button>
      {state?.active === true && <button type="button" className="btn" disabled={busy} onClick={() => void change({ stop: true }, "Stopped. Weekly allowances apply again.")}>End campaign now</button>}
    </form>
    <p className="row-sub">Usage during a campaign is not counted, so nobody is capped when it ends. To clear usage from before it, use Reset weekly usage below.</p>
    {notice !== null && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </div>;
}
