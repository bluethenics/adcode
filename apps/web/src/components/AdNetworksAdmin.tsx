"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useAuth } from "./AuthProvider";
import { adNetworkReadiness, parseAdNetworkConfig, type AdNetworkConfig, type AdNetworkProvider, type HttpAdNetworkConfig } from "@adcode/api/src/adNetworkConfig.ts";
import type { ServedCreative } from "@adcode/api/src/contract.ts";
import "./adNetworksAdmin.css";

export interface AdNetworkView extends AdNetworkConfig { keyConfigured: boolean; readiness: string }
interface NetworksView { networks: AdNetworkView[]; credentialsManageable: boolean }
interface TestView { sandbox?: boolean; sdk?: { endpoint: string; placementId: string }; creative?: ServedCreative | null; advertisements?: { id: string; name: string; headline: string; text: string; description: string }[] }
const ImpreziaSdkPreview = dynamic(() => import("./ImpreziaSdkPreview"), { ssr: false, loading: () => <p role="status">Loading Imprezia&apos;s SDK…</p> });
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

/** What users earn on, as the admin chose it: views, clicks, or both. */
export type PayoutBasis = "view" | "click" | "both";
export function payoutBasis(config: Pick<AdNetworkConfig, "viewPayoutMicros" | "clickPayoutMicros">): PayoutBasis {
  const views = config.viewPayoutMicros !== "0", clicks = config.clickPayoutMicros !== "0";
  return views && clicks ? "both" : clicks ? "click" : "view";
}
/** Turn the chosen basis and amounts into the two stored rates; the unchosen one pays nothing. */
export function payoutRates(basis: PayoutBasis, viewUsd: string, clickUsd: string): { viewPayoutMicros: string; clickPayoutMicros: string } | null {
  const views = basis === "click" ? "0" : payoutMicros(viewUsd), clicks = basis === "view" ? "0" : payoutMicros(clickUsd);
  return views === null || clicks === null ? null : { viewPayoutMicros: views, clickPayoutMicros: clicks };
}
const isChat = (config: AdNetworkConfig): boolean => config.provider === "imprezia" && config.imprezia?.kind === "chat";
const pays = (config: AdNetworkConfig): boolean => config.provider === "http-json";
const canDeliver = (config: AdNetworkConfig): boolean => pays(config) || isChat(config);
export function payoutSummary(config: Pick<AdNetworkConfig, "viewPayoutMicros" | "clickPayoutMicros">): string {
  const basis = payoutBasis(config);
  if (basis === "view" && config.viewPayoutMicros === "0") return "Nothing yet";
  const view = `$${usd(config.viewPayoutMicros)} per view`, click = `$${usd(config.clickPayoutMicros)} per click`;
  return basis === "both" ? `${view} + ${click}` : basis === "click" ? click : view;
}

export function newAdNetwork(provider: AdNetworkProvider): AdNetworkConfig {
  const config: AdNetworkConfig = { id: "", name: provider === "http-json" ? "" : providerName(provider), provider, enabled: false, priority: 50, viewPayoutMicros: "0", clickPayoutMicros: "0" };
  if (provider === "beehiiv") return { ...config, beehiiv: { publicationId: "", offerId: "" } };
  if (provider === "imprezia") return { ...config, imprezia: { kind: "chat", id: "" } };
  return { ...config, http: { serveUrl: "", verifyUrl: "", method: "POST", authHeader: "authorization", authPrefix: "Bearer ", requestTemplate: {}, creativePath: "", fields: { id: "", advertiser: "", headline: "", body: "", clickUrl: "", logoLight: "", logoDark: "" }, verifyTemplate: {}, verifiedPath: "", eventIdPath: "" } };
}

export function ProviderReadiness({ provider, chat = false }: { provider: AdNetworkProvider; chat?: boolean }) {
  if (provider === "imprezia" && chat) return <p className="notice">Imprezia&apos;s SDK displays sponsored cards under AI replies. People must switch them on in Settings; their message and reply then go through this site&apos;s relay. The publisher key stays encrypted on the server. The SDK handles ad requests, rendering, clicks and view measurement. Test previews the selected saved connection through the same SDK, even while delivery is off. A sandbox key (<code>api_pub_sandbox_…</code>) delivers test ads and never pays users. Imprezia&apos;s reports record provider revenue; these SDK cards do not automatically credit ADCode user balances.</p>;
  if (provider === "imprezia") return <p className="notice">Use an Exchange-enabled serving key and the app bundle or domain provisioned by Imprezia. Test requests a non-billable Native ad preview. No win, billing or tracking notices are sent. Delivery stays disabled. Live desktop delivery requires approved inventory, privacy and tracking support, and an agreed billing and reconciliation process; a notice acknowledgement does not confirm revenue.</p>;
  if (provider === "beehiiv") return <p className="notice">beehiiv provides newsletter advertisement content. Test fetches a content preview for your publication and offer. These creatives aren&apos;t delivered to the desktop, and this connection can&apos;t be enabled for desktop payouts.</p>;
  return <p className="row-sub">Connect a documented JSON ad API. Serve and event verification URLs must share an HTTPS origin. User payouts are credited only after the provider verifies each view or click.</p>;
}

/** A view row back to the config the server stores: the key and readiness are the server's to say. */
export function configOf(network: AdNetworkView): AdNetworkConfig {
  const { keyConfigured: _key, readiness: _readiness, ...config } = network;
  return config;
}

/**
 * One row per provider, with the three things an operator actually comes here to do on the
 * row itself: change its key, turn it on or off, and test it. Everything else is in Edit.
 */
export function AdNetworkTable({ networks, selected, busy, onEdit, onKey, onToggle, onTest }: { networks: readonly AdNetworkView[]; selected: string | null; busy: string | null; onEdit: (network: AdNetworkView) => void; onKey: (network: AdNetworkView) => void; onToggle: (network: AdNetworkView) => void; onTest: (network: AdNetworkView) => void }) {
  if (networks.length === 0) return <div className="ad-network-empty"><h4>No ad networks yet</h4><p className="row-sub">Add Imprezia Chat Ads for sponsored cards under AI replies, or connect a documented JSON ad API.</p></div>;
  return <div className="admin-models-scroll" role="region" aria-label="Ad network connections" tabIndex={0}><table className="admin-models-table ad-network-table">
    <thead><tr><th scope="col">Network</th><th scope="col">Status</th><th scope="col">API key</th><th scope="col">Users paid</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
    <tbody>{networks.map((network) => <tr key={network.id} aria-selected={selected === network.id}>
      <td><strong>{network.name}</strong><small>{providerName(network.provider)}{isChat(network) ? " Chat Ads" : ""} / {network.id}</small></td>
      <td><span className="ad-network-state" data-state={network.readiness}>{readinessLabel[network.readiness] ?? "Unknown"}</span></td>
      <td><button type="button" className="ad-network-key" data-set={network.keyConfigured} onClick={() => onKey(network)} aria-label={`${network.keyConfigured ? "Change" : "Add"} the API key for ${network.name}`}>{network.keyConfigured ? "Set · Change" : "Add key"}</button></td>
      <td>{pays(network) ? payoutSummary(network) : isChat(network) ? "Provider reports only" : "Preview only"}</td>
      <td><div className="ad-network-actions">
        {canDeliver(network) && <button type="button" className="btn btn-small" data-on={network.enabled} disabled={busy !== null || (!network.enabled && !network.keyConfigured)} title={!network.enabled && !network.keyConfigured ? "Add an API key first" : undefined} onClick={() => onToggle(network)}>{busy === `toggle:${network.id}` ? "Saving…" : network.enabled ? "Turn off" : "Turn on"}</button>}
        <button type="button" className="btn btn-small" disabled={busy !== null || !network.keyConfigured || ["documentation-required", "inventory-required"].includes(network.readiness)} onClick={() => onTest(network)}>{busy === network.id ? "Testing…" : "Test"}</button>
        <button type="button" className="btn btn-small" onClick={() => onEdit(network)}>Edit</button>
      </div></td>
    </tr>)}</tbody>
  </table></div>;
}

function TextField({ label, value, onChange, required = true, hint, pattern, type = "text", disabled = false }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; hint?: string; pattern?: string; type?: string; disabled?: boolean }) {
  return <label className="tagflow-field"><span>{label}</span><input className="input" type={type} required={required} maxLength={type === "url" ? 2048 : 200} {...(type === "number" ? { min: 0, max: 10, step: "0.000001" } : {})} {...(pattern === undefined ? {} : { pattern })} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />{hint && <small>{hint}</small>}</label>;
}

function SecretEditor({ network, manageable, request, onChange, focus = 0 }: { network: AdNetworkView; manageable: boolean; request: Request; onChange: (configured: boolean) => void; focus?: number }) {
  const [secret, setSecret] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // Arriving from a row's key button: the box is where the eye and the cursor already are.
  useEffect(() => { if (focus === 0) return; field.current?.scrollIntoView({ block: "center" }); field.current?.focus(); }, [focus]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  async function save(remove = false): Promise<void> {
    if (busy || (!remove && secret.trim() === "")) return;
    setBusy(true); setNotice(null);
    try {
      const result = await request<{ keyConfigured: boolean }>(`/admin/ad-networks/${encodeURIComponent(network.id)}/key`, "PUT", { key: remove ? null : secret.trim() });
      setSecret(""); onChange(result.keyConfigured ?? !remove); setNotice({ text: remove ? "API key removed. Delivery from this network stops until a new key is saved." : "New API key saved and used from the next ad. Press Test to check it.", error: false });
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "The key wasn't saved. Try again.", error: true }); }
    finally { setBusy(false); }
  }
  return <section className="ad-network-secret" aria-label="Provider API key">
    <h4>API key</h4><p className="row-sub">{network.keyConfigured ? "A key is configured. Enter a replacement to rotate it." : "No key is configured."} Keys are encrypted on the server and are never returned to this page.</p>
    {!manageable && <p className="notice" role="alert">Encrypted key storage isn&apos;t configured on the server. Configure server encryption before saving provider keys.</p>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="tagflow-field"><span>{network.keyConfigured ? "Replacement API key" : "Provider API key"}</span><input ref={field} className="input" type="password" required autoComplete="new-password" spellCheck={false} maxLength={8192} disabled={busy || !manageable} value={secret} onChange={(event) => setSecret(event.target.value)} /></label>
      <div className="ad-network-actions"><button className="btn" disabled={busy || !manageable || secret.trim() === ""}>{busy ? "Saving…" : "Save API key"}</button>{network.keyConfigured && <button type="button" className="btn" disabled={busy || !manageable} onClick={() => void save(true)}>Remove API key</button>}</div>
    </form>
    {notice && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

function NetworkEditor({ initial, saved, onSave, onCancel }: { initial: AdNetworkConfig; saved: boolean; onSave: (config: AdNetworkConfig) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [basis, setBasis] = useState<PayoutBasis>(payoutBasis(initial));
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
    const rates = pays(draft) ? payoutRates(basis, viewPay, clickPay) : isChat(draft) ? { viewPayoutMicros: initial.viewPayoutMicros, clickPayoutMicros: initial.clickPayoutMicros } : { viewPayoutMicros: "0", clickPayoutMicros: "0" };
    if (rates === null) { setNotice({ text: "Use a payout from $0 to $10, with at most six decimal places.", error: true }); return; }
    let configured = { ...draft, id: draft.id.trim(), name: draft.name.trim(), ...rates };
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
    <ProviderReadiness provider={draft.provider} chat={isChat(draft)} />
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} aria-label="Ad network settings">
      <fieldset disabled={busy}>
        <legend>Connection</legend><div className="tagflow-fields">
          <TextField label="Network ID" value={draft.id} pattern="[a-z][a-z0-9-]{1,39}" disabled={saved} hint="2–40 lowercase letters, numbers or hyphens. Starts with a letter." onChange={(id) => change({ id })} />
          <TextField label="Display name" value={draft.name} onChange={(name) => change({ name })} />
          <label className="tagflow-field"><span>Priority</span><input className="input" type="number" required min={0} max={100} step={1} value={draft.priority} onChange={(event) => change({ priority: event.target.valueAsNumber })} /><small>Lower numbers are tried first.</small></label>
          <label className="admin-models-check"><input type="checkbox" checked={draft.enabled} disabled={!canDeliver(draft)} onChange={(event) => change({ enabled: event.target.checked })} /> {isChat(draft) ? "Enable sponsored chat cards" : "Enable desktop delivery"}</label>
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
      {draft.provider === "imprezia" && <fieldset disabled={busy}><legend>{isChat(draft) ? "Imprezia Chat Ads" : "Approved Exchange inventory"}</legend><div className="tagflow-fields"><label className="tagflow-field"><span>Integration</span><select className="select" value={draft.imprezia?.kind ?? "chat"} onChange={(event) => { const kind = event.target.value as "app" | "site" | "chat"; change({ imprezia: { kind, id: "" }, ...(kind === "chat" ? {} : { enabled: false }) }); }}><option value="chat">Chat Ads (publisher API key)</option><option value="app">Exchange preview: app bundle</option><option value="site">Exchange preview: website domain</option></select></label>{isChat(draft)
        ? <TextField label="Placement ID (optional)" value={draft.imprezia?.id ?? ""} required={false} pattern="[A-Za-z0-9_-]{1,64}" hint="A label Imprezia registered for this slot, such as editor_sponsored_card. Leave blank for the default." onChange={(id) => change({ imprezia: { kind: "chat", id } })} />
        : <TextField label={draft.imprezia?.kind === "site" ? "Approved website domain" : "Approved app bundle"} value={draft.imprezia?.id ?? ""} hint="Use the exact inventory provisioned by Imprezia. Tests never generate earnings." onChange={(id) => change({ imprezia: { kind: draft.imprezia?.kind ?? "app", id } })} />}</div></fieldset>}
      {pays(draft) && <fieldset disabled={busy}><legend>User payouts</legend><div className="tagflow-fields">
        <label className="tagflow-field"><span>Pay users per</span><select className="select" aria-label="Pay users per" value={basis} onChange={(event) => setBasis(event.target.value as PayoutBasis)}><option value="view">View</option><option value="click">Click</option><option value="both">View and click</option></select><small>Users earn only on what you choose here.</small></label>
        {basis !== "click" && <TextField label="Per view (USD)" type="number" value={viewPay} onChange={setViewPay} hint="Up to $10 per event, with at most six decimal places." />}
        {basis !== "view" && <TextField label="Per click (USD)" type="number" value={clickPay} onChange={setClickPay} hint="Up to $10 per event, with at most six decimal places." />}
      </div><p className="row-sub">{isChat(draft) ? "A view counts once the card has been on screen; a click once it is opened. Imprezia reconciles what it pays ADCode in its own reports." : "User payouts are credited only after the provider verifies each view or click."} Payout rates are saved with each ad delivery, so a change applies to new deliveries.</p></fieldset>}
      <div className="ad-network-actions"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save connection"}</button></div>
    </form>
    {notice && <p className="notice" data-tone={notice.error ? "error" : "success"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

export function NetworkTestPreview({ result }: { result: TestView }) {
  if (result.sdk) return <div className="ad-network-preview"><h4>SDK connection test</h4>{result.sandbox && <p className="notice">Sandbox key: this is an Imprezia test ad. Sandbox deliveries never pay users.</p>}<ImpreziaSdkPreview key={result.sdk.endpoint} endpoint={result.sdk.endpoint} placementId={result.sdk.placementId} /><p className="row-sub">This preview uses a sample conversation and creates no ADCode user payout. Imprezia&apos;s SDK handles its view measurement.</p></div>;
  if (result.advertisements) return <div className="ad-network-preview"><h4>Newsletter content preview</h4><p className="row-sub">Preview only. These advertisements haven&apos;t been delivered to desktop users.</p>{result.advertisements.length === 0 ? <p>No advertisements returned for this offer.</p> : result.advertisements.map((ad) => <article key={ad.id}><h5>{ad.headline || ad.name || "Untitled advertisement"}</h5><p>{ad.text || ad.description}</p></article>)}</div>;
  return <div className="ad-network-preview"><h4>Connection test</h4>{result.sandbox && <p className="notice">Sandbox key: this is an Imprezia test ad. Sandbox deliveries never pay users.</p>}{result.creative ? <article><p className="row-sub">{result.creative.advertiser}</p><h5>{result.creative.headline}</h5>{result.creative.body && <p>{result.creative.body}</p>}<p className="row-sub">{result.creative.clickUrl}</p></article> : <p>The provider connected, but returned no ad for this test.</p>}<p className="row-sub">This preview creates no user delivery or payout.</p></div>;
}

export function AdNetworksAdmin() {
  const { token } = useAuth();
  const [view, setView] = useState<NetworksView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [keyFocus, setKeyFocus] = useState(0);
  const [toggling, setToggling] = useState<string | null>(null);
  const [newNetwork, setNewNetwork] = useState<AdNetworkConfig | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [test, setTest] = useState<{ id: string; name: string; value?: TestView; error?: string } | null>(null);
  const request = useCallback(async <T,>(path: string, method: "GET" | "PUT" | "POST" = "GET", body?: unknown): Promise<T> => {
    // The admin panel's made-up data while building it (adminPreview.ts). Dead code in a production build.
    if (process.env["NODE_ENV"] === "development") {
      const preview = (await import("@/lib/adminFixtures")).previewResponse<T>(path, method);
      if (preview !== null && preview.ok) return preview.value;
    }
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
  async function toggle(network: AdNetworkView): Promise<void> {
    if (toggling !== null) return;
    setToggling(network.id); setError("");
    try { await save({ ...configOf(network), enabled: !network.enabled }); setSelected(null); }
    catch (error) { setError(error instanceof Error ? error.message : "That change wasn't saved."); }
    finally { setToggling(null); }
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
      <p className="row-sub">Connect ad providers with encrypted API keys. Generic JSON APIs can pay users per view or click; Imprezia uses its SDK for sponsored chat cards.</p>
      {error && <p className="notice" data-tone="error" role="alert">{error} Use Refresh to retry.</p>}
      {loading && view === null ? <p role="status">Loading ad networks…</p> : view !== null && <AdNetworkTable networks={view.networks} selected={selected} busy={toggling !== null ? `toggle:${toggling}` : testing} onEdit={(network) => { setSelected(network.id); setNewNetwork(null); setKeyFocus(0); }} onKey={(network) => { setSelected(network.id); setNewNetwork(null); setKeyFocus((count) => count + 1); }} onToggle={(network) => void toggle(network)} onTest={(network) => void testNetwork(network)} />}
      {view !== null && <div className="ad-network-actions ad-network-add" aria-label="Add ad provider"><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("http-json")); }}>Add generic JSON API</button><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("imprezia")); }}>Add Imprezia Chat Ads</button><button type="button" className="btn" onClick={() => { setSelected(null); setNewNetwork(newAdNetwork("beehiiv")); }}>Add beehiiv preview</button></div>}
    </section>
    {test && <section className="admin-models-provider" aria-label={`Test result for ${test.name}`}><h3>{test.name}</h3>{test.error ? <p className="notice" data-tone="error" role="alert">{test.error}</p> : test.value && <NetworkTestPreview result={test.value} />}</section>}
    {/* The key first: rotating it is the most common reason to open a network. */}
    {saved && newNetwork === null && view !== null && <section className="admin-models-provider"><SecretEditor key={saved.id} focus={keyFocus} network={saved} manageable={view.credentialsManageable} request={request} onChange={(configured) => setView((previous) => previous === null ? previous : { ...previous, networks: previous.networks.map((network) => network.id !== saved.id ? network : { ...network, keyConfigured: configured, readiness: adNetworkReadiness(network, configured) }) })} /></section>}
    {draft && <NetworkEditor key={`${newNetwork ? "new" : "saved"}:${draft.provider}:${draft.id}`} initial={draft} saved={saved !== undefined && newNetwork === null} onSave={save} onCancel={() => { setSelected(null); setNewNetwork(null); }} />}
  </div>;
}
