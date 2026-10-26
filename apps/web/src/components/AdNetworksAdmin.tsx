"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { adNetworkReadiness, parseAdNetworkConfig, type AdNetworkConfig, type AdNetworkProvider, type HttpAdNetworkConfig } from "@adcode/api/src/adNetworkConfig.ts";
import type { ServedCreative } from "@adcode/api/src/contract.ts";
import "./adNetworksAdmin.css";

export interface AdNetworkView extends AdNetworkConfig { keyConfigured: boolean; readiness: string }
interface NetworksView { networks: AdNetworkView[]; credentialsManageable: boolean }
interface TestView { creative?: ServedCreative | null; advertisements?: { id: string; name: string; headline: string; text: string; description: string }[] }
type Request = <T>(path: string, method?: "GET" | "PUT" | "POST", body?: unknown) => Promise<T>;

const providerName = (provider: AdNetworkProvider): string => ({ "http-json": "Generic JSON API", imprezia: "Imprezia", beehiiv: "beehiiv" })[provider];
const readinessLabel: Record<string, string> = { ready: "Ready", disabled: "Disabled", "key-required": "API key needed", "documentation-required": "API documentation needed", "inventory-required": "Approved inventory needed", "exchange-test-only": "Exchange test preview only", "newsletter-preview-only": "Newsletter preview only" };

export function payoutMicros(usd: string): string | null {
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,6})?$/.test(usd)) return null;
  const [whole, fraction = ""] = usd.split(".");
  const value = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  return value <= 10_000_000n ? String(value) : null;
}
const usd = (micros: string): string => String(Number(micros) / 1_000_000);

export function newAdNetwork(provider: AdNetworkProvider): AdNetworkConfig {
  const config: AdNetworkConfig = { id: "", name: provider === "http-json" ? "" : providerName(provider), provider, enabled: false, priority: 50, viewPayoutMicros: "0", clickPayoutMicros: "0" };
  if (provider === "beehiiv") return { ...config, beehiiv: { publicationId: "", offerId: "" } };
  if (provider === "imprezia") return { ...config, imprezia: { kind: "app", id: "" } };
  return { ...config, http: { serveUrl: "", verifyUrl: "", method: "POST", authHeader: "authorization", authPrefix: "Bearer ", requestTemplate: {}, creativePath: "", fields: { id: "", advertiser: "", headline: "", body: "", clickUrl: "", logoLight: "", logoDark: "" }, verifyTemplate: {}, verifiedPath: "", eventIdPath: "" } };
}

export function ProviderReadiness({ provider }: { provider: AdNetworkProvider }) {
  if (provider === "imprezia") return <p className="notice">Use an Exchange-enabled serving key and the app bundle or domain provisioned by Imprezia. Test requests a non-billable Native ad preview. No win, billing or tracking notices are sent. Delivery stays disabled. Live desktop delivery requires approved inventory, privacy and tracking support, and an agreed billing and reconciliation process; a notice acknowledgement does not confirm revenue.</p>;
  if (provider === "beehiiv") return <p className="notice">beehiiv provides newsletter advertisement content. Test fetches a content preview for your publication and offer. These creatives aren&apos;t delivered to the desktop, and this connection can&apos;t be enabled for desktop payouts.</p>;
  return <p className="row-sub">Connect a documented JSON ad API. Serve and event verification URLs must share an HTTPS origin. User payouts are credited only after the provider verifies each view or click.</p>;
}

export function AdNetworkTable({ networks, selected, busy, onEdit, onTest }: { networks: readonly AdNetworkView[]; selected: string | null; busy: string | null; onEdit: (network: AdNetworkView) => void; onTest: (network: AdNetworkView) => void }) {
  if (networks.length === 0) return <p className="row-sub">No ad networks connected yet. Add a provider below.</p>;
  return <div className="admin-models-scroll" role="region" aria-label="Ad network connections" tabIndex={0}><table className="admin-models-table">
    <thead><tr><th scope="col">Network</th><th scope="col">Status</th><th scope="col">Key</th><th scope="col">User payout / view</th><th scope="col">User payout / click</th><th scope="col">Actions</th></tr></thead>
    <tbody>{networks.map((network) => <tr key={network.id} aria-selected={selected === network.id}>
      <td><strong>{network.name}</strong><small>{providerName(network.provider)} / {network.id}</small></td><td>{readinessLabel[network.readiness] ?? "Unknown"}</td><td>{network.keyConfigured ? "Configured" : "Not configured"}</td><td>${usd(network.viewPayoutMicros)}</td><td>${usd(network.clickPayoutMicros)}</td>
      <td><div className="ad-network-actions"><button type="button" className="btn btn-small" onClick={() => onEdit(network)}>Edit</button><button type="button" className="btn btn-small" disabled={busy !== null || !network.keyConfigured || ["documentation-required", "inventory-required"].includes(network.readiness)} onClick={() => onTest(network)}>{busy === network.id ? "Testing…" : "Test saved connection"}</button></div></td>
    </tr>)}</tbody>
  </table></div>;
}

function TextField({ label, value, onChange, required = true, hint, pattern, type = "text", disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string; pattern?: string; type?: string; disabled?: boolean }) {
  return <label className="tagflow-field"><span>{label}</span><input className="input" type={type} required={required} maxLength={type === "url" ? 2048 : 200} {...(type === "number" ? { min: 0, max: 10, step: "0.000001" } : {})} {...(pattern === undefined ? {} : { pattern })} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function SecretEditor({ network, manageable, request, onChange }: { network: AdNetworkView; manageable: boolean; request: Request; onChange: (configured: boolean) => void }) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  async function save(remove = false): Promise<void> {
    if (busy || (!remove && secret.trim() === "")) return;
    setBusy(true); setNotice(null);
    try {
      const result = await request<{ keyConfigured: boolean }>(`/admin/ad-networks/${encodeURIComponent(network.id)}/key`, "PUT", { key: remove ? null : secret.trim() });
      setSecret(""); onChange(result.keyConfigured); setNotice({ text: remove ? "API key removed." : "API key saved securely. Test the saved connection to check it.", error: false });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "The key wasn't saved. Try again.", error: true }); }
    finally { setBusy(false); }
  }
  return <section className="ad-network-secret" aria-label="Provider API key">
    <h4>API key</h4><p className="row-sub">{network.keyConfigured ? "A key is configured. Enter a replacement to rotate it." : "No key is configured."} Keys are encrypted on the server and are never returned to this page.</p>
    {!manageable && <p className="notice" role="alert">Encrypted key storage isn&apos;t configured on the server. Configure server encryption before saving provider keys.</p>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="tagflow-field"><span>{network.keyConfigured ? "Replacement API key" : "Provider API key"}</span><input className="input" type="password" required autoComplete="new-password" spellCheck={false} maxLength={8192} disabled={busy || !manageable} value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
      <div className="ad-network-actions"><button className="btn" disabled={busy || !manageable || secret.trim() === ""}>{busy ? "Saving…" : "Save API key"}</button>{network.keyConfigured && <button type="button" className="btn" disabled={busy || !manageable} onClick={() => void save(true)}>Remove API key</button>}</div>
    </form>
    {notice && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

function NetworkEditor({ initial, saved, onSave, onCancel }: { initial: AdNetworkConfig; saved: boolean; onSave: (config: AdNetworkConfig) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [viewPay, setViewPay] = useState(usd(initial.viewPayoutMicros));
  const [clickPay, setClickPay] = useState(usd(initial.clickPayoutMicros));
  const [requestJson, setRequestJson] = useState(JSON.stringify(initial.http?.requestTemplate ?? {}, null, 2));
  const [verifyJson, setVerifyJson] = useState(JSON.stringify(initial.http?.verifyTemplate ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const change = (patch: Partial<AdNetworkConfig>): void => setDraft({ ...draft, ...patch });
  const http = (patch: Partial<HttpAdNetworkConfig>): void => { if (draft.http) change({ http: { ...draft.http, ...patch } }); };
  async function save(): Promise<void> {
    if (busy) return;
    setNotice(null);
    const views = payoutMicros(viewPay), clicks = payoutMicros(clickPay);
    if (views === null || clicks === null) { setNotice({ text: "Use a payout from $0 to $10, with at most six decimal places.", error: true }); return; }
    let configured = { ...draft, id: draft.id.trim(), name: draft.name.trim(), viewPayoutMicros: views, clickPayoutMicros: clicks };
    if (draft.http) {
      try { configured = { ...configured, http: { ...draft.http, requestTemplate: JSON.parse(requestJson), verifyTemplate: JSON.parse(verifyJson) } }; }
      catch { setNotice({ text: "The request or verification template isn't valid JSON. Check it and try again.", error: true }); return; }
    }
    const parsed = parseAdNetworkConfig(configured);
    if (parsed === null) { setNotice({ text: "Check the network ID, public HTTPS endpoints on the same origin, field mappings, and provider settings.", error: true }); return; }
    setBusy(true);
    try { await onSave(parsed); setDraft(parsed); setNotice({ text: "Connection settings saved. Add an API key, then test the saved connection.", error: false }); }
    catch (error) { setNotice({ text: error instanceof Error ? error.message : "Settings weren't saved. Try again.", error: true }); }
    finally { setBusy(false); }
  }
  const mappingLabels: Record<keyof HttpAdNetworkConfig["fields"], string> = { id: "Creative ID", advertiser: "Advertiser name", headline: "Headline", body: "Body text (optional)", clickUrl: "Click destination URL", logoLight: "Light logo URL", logoDark: "Dark logo URL (optional)" };
  return <section className="admin-models-provider ad-network-editor">
    <header className="admin-card-head"><h3>{saved ? `Edit ${initial.name}` : `Add ${providerName(initial.provider)}`}</h3><button type="button" className="btn" disabled={busy} onClick={onCancel}>Close editor</button></header>
    <ProviderReadiness provider={draft.provider} />
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label="Ad network settings">
      <fieldset disabled={busy}>
        <legend>Connection</legend><div className="tagflow-fields">
          <TextField label="Network ID" value={draft.id} pattern="[a-z][a-z0-9-]{1,39}" disabled={saved} hint="2–40 lowercase letters, numbers or hyphens. Starts with a letter." onChange={(id) => change({ id })} />
          <TextField label="Display name" value={draft.name} onChange={(name) => change({ name })} />
          <label className="tagflow-field"><span>Priority</span><input className="input" type="number" required min={0} max={100} step={1} value={draft.priority} onChange={(event) => change({ priority: event.target.valueAsNumber })} /><small>Lower numbers are tried first.</small></label>
          <label className="admin-models-check"><input type="checkbox" checked={draft.enabled} disabled={draft.provider !== "http-json"} onChange={(event) => change({ enabled: event.target.checked })} /> Enable desktop delivery</label>
        </div>
      </fieldset>
      {draft.provider === "http-json" && draft.http && <>
        <fieldset disabled={busy}><legend>JSON API requests</legend><div className="tagflow-fields">
          <TextField label="Serve endpoint (HTTPS)" value={draft.http.serveUrl} type="url" onChange={(serveUrl) => http({ serveUrl })} />
          <TextField label="Event verification endpoint (HTTPS)" value={draft.http.verifyUrl} type="url" hint="Must share the serve endpoint's origin." onChange={(verifyUrl) => http({ verifyUrl })} />
          <label className="tagflow-field"><span>Serve request method</span><select className="select" value={draft.http.method} onChange={(event) => http({ method: event.target.value as "GET" | "POST" })}><option value="POST">POST</option><option value="GET">GET</option></select></label>
          <TextField label="API key header" value={draft.http.authHeader} pattern="[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Xx]-[A-Za-z0-9-]{1,60}|[Aa][Pp][Ii]-[Kk][Ee][Yy]" hint="authorization, api-key, or an x- header." onChange={(authHeader) => http({ authHeader })} />
          <TextField label="Key prefix" value={draft.http.authPrefix} required={false} hint="For example, Bearer followed by a space. Leave blank for a raw key." onChange={(authPrefix) => http({ authPrefix })} />
          <TextField label="Creative object path" value={draft.http.creativePath} required={false} hint="Dotted JSON path, such as data.ad. Leave blank for the root object." onChange={(creativePath) => http({ creativePath })} />
        </div>
        <div className="tagflow-fields">
          <label className="tagflow-field"><span>Serve request template (JSON)</span><textarea className="textarea ad-network-json" rows={6} maxLength={8000} value={requestJson} onChange={(event) => setRequestJson(event.target.value)} /></label>
          <label className="tagflow-field"><span>Verification request template (JSON)</span><textarea className="textarea ad-network-json" rows={6} maxLength={8000} value={verifyJson} onChange={(event) => setVerifyJson(event.target.value)} /></label>
        </div>
        <p className="row-sub">Use complete string values <code>{"{{tags}}"}</code>, <code>{"{{theme}}"}</code>, <code>{"{{requestId}}"}</code>, <code>{"{{providerCreativeId}}"}</code>, <code>{"{{event}}"}</code> or <code>{"{{eventId}}"}</code> where your provider expects them. Keep API keys in the encrypted key field below.</p>
        </fieldset>
        <fieldset disabled={busy}><legend>Creative response fields</legend><p className="row-sub">Dotted paths relative to the creative object. Use the exact fields in your provider&apos;s documented response.</p><div className="tagflow-fields">{(Object.keys(mappingLabels) as (keyof HttpAdNetworkConfig["fields"])[]).map((field) => <TextField key={field} label={mappingLabels[field]} value={draft.http!.fields[field]} required={field !== "body" && field !== "logoDark"} onChange={(value) => http({ fields: { ...draft.http!.fields, [field]: value } })} />)}</div></fieldset>
        <fieldset disabled={busy}><legend>Event verification response</legend><div className="tagflow-fields">
          <TextField label="Verified boolean path" value={draft.http.verifiedPath} hint="Must resolve to the JSON boolean true before a payout is credited." onChange={(verifiedPath) => http({ verifiedPath })} />
          <TextField label="Verified event ID path" value={draft.http.eventIdPath} hint="A unique provider event ID prevents duplicate payouts." onChange={(eventIdPath) => http({ eventIdPath })} />
        </div></fieldset>
      </>}
      {draft.provider === "beehiiv" && <fieldset disabled={busy}><legend>Newsletter content preview</legend><div className="tagflow-fields"><TextField label="Publication ID" value={draft.beehiiv?.publicationId ?? ""} hint="The pub_ ID from beehiiv." onChange={(publicationId) => change({ beehiiv: { publicationId, offerId: draft.beehiiv?.offerId ?? "" } })} /><TextField label="Offer ID" value={draft.beehiiv?.offerId ?? ""} onChange={(offerId) => change({ beehiiv: { publicationId: draft.beehiiv?.publicationId ?? "", offerId } })} /></div></fieldset>}
      {draft.provider === "imprezia" && <fieldset disabled={busy}><legend>Approved Exchange inventory</legend><div className="tagflow-fields"><label className="tagflow-field"><span>Inventory type</span><select className="select" value={draft.imprezia?.kind ?? "app"} onChange={(event) => change({ imprezia: { kind: event.target.value as "app" | "site", id: "" } })}><option value="app">App bundle</option><option value="site">Website domain</option></select></label><TextField label={draft.imprezia?.kind === "site" ? "Approved website domain" : "Approved app bundle"} value={draft.imprezia?.id ?? ""} hint="Use the exact inventory provisioned by Imprezia. Tests never generate earnings." onChange={(id) => change({ imprezia: { kind: draft.imprezia?.kind ?? "app", id } })} /></div></fieldset>}
      {draft.provider === "http-json" && <fieldset disabled={busy}><legend>User payouts</legend><div className="tagflow-fields"><TextField label="Per verified view (USD)" type="number" value={viewPay} onChange={setViewPay} hint="Up to $10 per event, with at most six decimal places." /><TextField label="Per verified click (USD)" type="number" value={clickPay} onChange={setClickPay} /></div><p className="row-sub">Payout rates are saved with each ad delivery. Later rate changes apply to new deliveries.</p></fieldset>}
      <div className="ad-network-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save connection"}</button></div>
    </form>
    {notice && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

export function NetworkTestPreview({ result }: { result: TestView }) {
  if (result.advertisements) return <div className="ad-network-preview"><h4>Newsletter content preview</h4><p className="row-sub">Preview only. These advertisements haven&apos;t been delivered to desktop users.</p>{result.advertisements.length === 0 ? <p>No advertisements returned for this offer.</p> : result.advertisements.map((ad) => <article key={ad.id}><h5>{ad.headline || ad.name || "Untitled advertisement"}</h5><p>{ad.text || ad.description}</p></article>)}</div>;
  return <div className="ad-network-preview"><h4>Connection test</h4>{result.creative ? <article><p className="row-sub">{result.creative.advertiser}</p><h5>{result.creative.headline}</h5>{result.creative.body && <p>{result.creative.body}</p>}<p className="row-sub">{result.creative.clickUrl}</p></article> : <p>The provider connected, but returned no ad for this test.</p>}<p className="row-sub">This preview creates no user delivery or payout.</p></div>;
}

export function AdNetworksAdmin() {
  const { token } = useAuth();
  const [view, setView] = useState<NetworksView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [newNetwork, setNewNetwork] = useState<AdNetworkConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [test, setTest] = useState<{ id: string; name: string; value?: TestView; error?: string } | null>(null);
  const request = useCallback(async <T,>(path: string, method: "GET" | "PUT" | "POST" = "GET", body?: unknown): Promise<T> => {
    const idToken = await token();
    if (!idToken) throw new Error("Your session expired. Sign in again.");
    let response: Response;
    try { response = await fetch(`/v1${path}`, { method, headers: { authorization: `Bearer ${idToken}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
    catch { throw new Error("Couldn't reach the server. Check your connection and try again."); }
    let result: T & { error?: string | { message?: string }; message?: string };
    try { result = await response.json(); } catch { throw new Error("Couldn't read the server's reply. Please try again."); }
    if (!response.ok) {
      const errors: Record<string, string> = { "encryption-not-configured": "Encrypted key storage isn't configured. Configure server encryption before saving provider keys.", "documentation-required": "Imprezia's API documentation is needed before its connection can be tested.", "provider-unavailable": "The provider couldn't complete this test. Check its API key, endpoint and response mappings.", "bad-config": "The connection settings weren't accepted. Check the fields and try again.", "not-admin": "Administrator access is required." };
      throw new Error(typeof result.error === "string" ? result.message ?? errors[result.error] ?? "This request wasn't accepted. Check your settings and retry." : result.error?.message ?? "The request failed. Try again shortly.");
    }
    return result;
  }, [token]);
  const load = useCallback(async (): Promise<void> => {
    setLoading(true); setError("");
    try { setView(await request<NetworksView>("/admin/ad-networks")); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't load ad networks."); }
    finally { setLoading(false); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function save(config: AdNetworkConfig): Promise<void> {
    await request("/admin/ad-networks", "PUT", config);
    // Configuration saves are complete even if a subsequent list refresh fails.
    const existing = view?.networks.find((network) => network.id === config.id);
    const network: AdNetworkView = { ...config, keyConfigured: existing?.keyConfigured ?? false, readiness: adNetworkReadiness(config, existing?.keyConfigured ?? false) };
    setView((previous) => previous === null ? previous : { ...previous, networks: [...previous.networks.filter((network) => network.id !== config.id), network].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)) });
    setNewNetwork(null); setSelected(config.id);
  }
  async function testNetwork(network: AdNetworkView): Promise<void> {
    if (testing !== null) return;
    setTesting(network.id); setTest(null);
    try { setTest({ id: network.id, name: network.name, value: await request<TestView>(`/admin/ad-networks/${encodeURIComponent(network.id)}/test`, "POST", {}) }); }
    catch (error) { setTest({ id: network.id, name: network.name, error: error instanceof Error ? error.message : "The connection test failed." }); }
    finally { setTesting(null); }
  }
  const saved = selected === null ? undefined : view?.networks.find((network) => network.id === selected);
  const draft = newNetwork ?? saved;
  return <div className="admin-models ad-networks-admin">
    <section className="admin-models-provider"><header className="admin-card-head"><h3>Ad network connections</h3><button type="button" className="btn" disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh"}</button></header>
      <p className="row-sub">Connect provider inventory and set what users earn per verified view or click. Each provider keeps its own encrypted API key.</p>
      {error && <p className="notice" data-tone="error" role="alert">{error} Use Refresh to retry.</p>}
      {loading && view === null ? <p role="status">Loading ad networks…</p> : view !== null && <AdNetworkTable networks={view.networks} selected={selected} busy={testing} onEdit={(network) => { setSelected(network.id); setNewNetwork(null); }} onTest={(network) => void testNetwork(network)} />}
      {view !== null && <div className="ad-network-actions ad-network-add" aria-label="Add ad provider"><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("http-json")); }}>Add generic JSON API</button><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("imprezia")); }}>Add Imprezia</button><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("beehiiv")); }}>Add beehiiv preview</button></div>}
    </section>
    {test && <section className="admin-models-provider" aria-label={`Test result for ${test.name}`}><h3>{test.name}</h3>{test.error ? <p className="notice" data-tone="error" role="alert">{test.error}</p> : test.value && <NetworkTestPreview result={test.value} />}</section>}
    {draft && <NetworkEditor key={`${newNetwork ? "new" : "saved"}:${draft.provider}:${draft.id}`} initial={draft} saved={saved !== undefined && newNetwork === null} onSave={save} onCancel={() => { setSelected(null); setNewNetwork(null); }} />}
    {saved && newNetwork === null && view !== null && <section className="admin-models-provider"><SecretEditor key={saved.id} network={saved} manageable={view.credentialsManageable} request={request} onChange={(configured) => setView((previous) => previous === null ? previous : { ...previous, networks: previous.networks.map((network) => network.id !== saved.id ? network : { ...network, keyConfigured: configured, readiness: adNetworkReadiness(network, configured) }) })} /></section>}
  </div>;
}
