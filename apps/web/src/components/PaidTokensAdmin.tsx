"use client";

/**
 * Paid AI tokens in the admin panel: the switch, the free weekly allowance and the packs (saved
 * with the rest of the free-models config), plus granting tokens and the sales by day.
 * Spec: docs/superpowers/specs/2026-10-21-paid-ai-tokens-design.md.
 */
import { useState } from "react";
import { DEFAULT_PAID_CONFIG, type PaidConfig, type PaidPack } from "@adcode/api/src/paidTokens.ts";
import type { TokenSalesDay } from "@adcode/api/src/tagflowTypes.ts";
import { formatTokens } from "@/app/ai-tokens/AiTokens";

export function PaidTokensSettings({ value, onChange }: { value: PaidConfig | undefined; onChange: (next: PaidConfig) => void }) {
  const paid = value ?? DEFAULT_PAID_CONFIG;
  const pack = (index: number, patch: Partial<PaidPack>): void => onChange({ ...paid, packs: paid.packs.map((one, at) => at === index ? { ...one, ...patch } : one) });
  return (
    <>
      <div className="tagflow-checks">
        <label><input type="checkbox" checked={paid.enabled} onChange={(event) => onChange({ ...paid, enabled: event.target.checked })} /> Sell tokens for paid models</label>
      </div>
      <div className="tagflow-fields">
        <label className="tagflow-field"><span>Paid providers (IDs, comma-separated)</span>
          <input className="input" value={paid.providers.join(", ")} onChange={(event) => onChange({ ...paid, providers: event.target.value.split(",").map((id) => id.trim()).filter((id) => id.length > 0) })} />
          <small>Only registered custom providers. Tagflow is always free.</small></label>
        <label className="tagflow-field"><span>Free tokens per person per week</span>
          <input className="input" type="number" min={0} step={1_000_000} value={paid.freeWeeklyTokens} onChange={(event) => onChange({ ...paid, freeWeeklyTokens: event.currentTarget.valueAsNumber || 0 })} />
          <small>{formatTokens(paid.freeWeeklyTokens)} a week, from a person's first request on these models.</small></label>
      </div>
      <div className="admin-models-scroll">
        <table className="admin-models-table">
          <thead><tr><th scope="col">Pack ID</th><th scope="col">Price (cents)</th><th scope="col">Tokens</th><th scope="col">Per million</th></tr></thead>
          <tbody>
            {paid.packs.map((one, index) => (
              <tr key={index}>
                <td><input className="input" aria-label="Pack ID" value={one.id} onChange={(event) => pack(index, { id: event.target.value })} /></td>
                <td><input className="input" type="number" aria-label="Price in cents" min={100} value={one.priceCents} onChange={(event) => pack(index, { priceCents: event.currentTarget.valueAsNumber || 0 })} /></td>
                <td><input className="input" type="number" aria-label="Tokens" min={1} value={one.tokens} onChange={(event) => pack(index, { tokens: event.currentTarget.valueAsNumber || 0 })} /></td>
                <td>{one.tokens > 0 ? `$${(one.priceCents / 100 / (one.tokens / 1_000_000)).toFixed(3)}` : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="row-sub">Buying needs the Dodo product secret <code>DODO_AI_PRODUCT_ID</code>. Switch selling on only after the provider has agreed to resale. Save applies it to new requests at once.</p>
    </>
  );
}

export function SalesTable({ days }: { days: TokenSalesDay[] }) {
  if (days.length === 0) return <p className="row-sub">No token sales in this period.</p>;
  return (
    <div className="admin-models-scroll">
      <table className="admin-models-table">
        <thead><tr><th scope="col">Day (UTC)</th><th scope="col">Orders</th><th scope="col">Revenue</th><th scope="col">Tokens sold</th><th scope="col">Purchased tokens used</th></tr></thead>
        <tbody>
          {days.map((row) => (
            <tr key={row.day}><td>{row.day}</td><td>{row.orders}</td><td>${(row.revenueCents / 100).toFixed(2)}</td><td>{formatTokens(row.tokensSold)}</td><td>{formatTokens(row.tokensUsed)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Grant form and sales, which talk to the API directly; `call` is the page's authenticated fetch. */
export function PaidTokensActivity({ call }: { call: <T>(path: string, body?: unknown) => Promise<T> }) {
  const [uid, setUid] = useState("");
  const [tokens, setTokens] = useState(1_000_000);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [days, setDays] = useState<TokenSalesDay[] | null>(null);

  async function grant(): Promise<void> {
    setBusy(true); setNotice("");
    try { await call("/admin/ai-tokens/grant", { uid: uid.trim(), tokens, note: note.trim() }); setNotice(`Added ${formatTokens(tokens)} tokens to ${uid.trim()}.`); setNote(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not grant tokens."); }
    finally { setBusy(false); }
  }
  async function loadSales(): Promise<void> {
    try { setDays((await call<{ days: TokenSalesDay[] }>("/admin/ai-tokens/sales?days=30")).days); }
    catch { setDays([]); setNotice("Could not read sales. Apply the paid tokens migration, then try again."); }
  }

  return (
    <>
      <form className="admin-toolbar" onSubmit={(event) => { event.preventDefault(); void grant(); }}>
        <label className="tagflow-field"><span>User ID from People</span><input className="input" required maxLength={128} value={uid} onChange={(event) => setUid(event.target.value)} /></label>
        <label className="tagflow-field"><span>Tokens (negative removes)</span><input className="input" type="number" required step={1} value={tokens} onChange={(event) => setTokens(event.currentTarget.valueAsNumber || 0)} /></label>
        <label className="tagflow-field"><span>Note</span><input className="input" maxLength={500} value={note} placeholder="Why, for the person's history" onChange={(event) => setNote(event.target.value)} /></label>
        <button className="btn" disabled={busy || tokens === 0}>{busy ? "Granting…" : "Grant tokens"}</button>
      </form>
      {notice !== "" && <p className="row-sub" role="status">{notice}</p>}
      <header className="admin-card-head"><h3>Sales, last 30 days</h3><button type="button" className="btn" onClick={() => void loadSales()}>{days === null ? "Show sales" : "Refresh"}</button></header>
      {days !== null && <SalesTable days={days} />}
    </>
  );
}
