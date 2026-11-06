"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AdminModelTabs } from "@/components/AdminModelTabs";
import { AdminSummary } from "@/components/AdminUI";
import { useAuth } from "@/components/AuthProvider";
import type { TagflowConfig, TagflowLimits, TagflowModel, TagflowUsage, TagflowUserPolicy } from "@adcode/api/src/tagflowTypes.ts";
import { MAX_CUSTOM_PROVIDERS, allowanceAccount, customProviderId, modelProvider, providerConnections, type CustomProvider, type IncludedProviderId } from "@adcode/api/src/includedProviders.ts";
import { MAX_TAGFLOW_MODELS, UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE } from "@adcode/api/src/tagflowConfig.ts";
import { DEFAULT_CREDIT_PLAN, MAX_CREDITS, MAX_CREDIT_RATE, modelCreditRate, type CreditPlan, type CreditsView } from "@adcode/api/src/credits.ts";
import { CustomProviderEditor } from "@/components/CustomProviderEditor";
import { PaidTokensActivity, PaidTokensSettings } from "@/components/PaidTokensAdmin";
import { PlansAdmin } from "@/components/PlansAdmin";
import "@/components/adminModels.css";
import "@/components/adminTagflow.css";

interface Saved { config: TagflowConfig; keyConfigured: boolean; updatedAt: number; updatedBy: string; connections: { id: IncludedProviderId; configured: boolean }[]; keysManageable?: boolean }
interface UserView { policy: TagflowUserPolicy | null; limits: TagflowLimits; usage: TagflowUsage; resetsAt: number; credits?: CreditsView }
const money = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

export default function TagflowPage() {
  return <AdminShell title="ADCode models" subtitle="Included models, their providers and keys, allowances, plans, and who is using them."><AdminModelTabs active="free" /><TagflowEditor /></AdminShell>;
}

/**
 * The page in five views rather than one scroll.
 *
 * It used to be every section stacked on one page: 59 models fully expanded, then providers,
 * limits, plans, people and usage. "Add model" appended an empty model below all 59, out of
 * sight, and Save went through the browser's validation of every field on the page - so one
 * stored price with more decimals than its field allowed made Save do nothing at all.
 */
const VIEWS = [
  ["models", "Models"],
  ["providers", "Providers & keys"],
  ["allowances", "Allowances & limits"],
  ["plans", "Plans & promos"],
  ["people", "People & usage"],
] as const;
type View = typeof VIEWS[number][0];
const isView = (value: string | null): value is View => VIEWS.some(([id]) => id === value);

/** Tokens are no longer a limit - credits are - so a day keeps only its request and spending ceilings. */
function LimitFields({ value, onChange, disabled = false }: { value: TagflowLimits; onChange: (next: TagflowLimits) => void; disabled?: boolean }) {
  return <div className="tagflow-fields">
    <RequestField label="Requests per day" value={value.dailyRequests} unlimited={UNLIMITED_DAILY_REQUESTS} fallback={50} disabled={disabled} onChange={(dailyRequests) => onChange({ ...value, dailyRequests })} />
    <NumberField label="Spending limit per day (USD)" value={value.dailyCostMicros / 1_000_000} max={1000} step="any" disabled={disabled} onChange={(amount) => onChange({ ...value, dailyCostMicros: Math.round(amount * 1_000_000) })} />
    <RequestField label="Requests per minute" value={value.requestsPerMinute} unlimited={UNLIMITED_REQUESTS_PER_MINUTE} fallback={10} disabled={disabled} onChange={(requestsPerMinute) => onChange({ ...value, requestsPerMinute })} />
  </div>;
}

function CreditFields({ value, onChange, disabled = false }: { value: CreditPlan; onChange: (next: CreditPlan) => void; disabled?: boolean }) {
  return <div className="tagflow-fields">
    <NumberField label="Credits per session window" value={value.sessionCredits} max={MAX_CREDITS} disabled={disabled} onChange={(sessionCredits) => onChange({ ...value, sessionCredits })} />
    <NumberField label="Session window (hours)" min={1} value={value.sessionHours} max={168} disabled={disabled} onChange={(sessionHours) => onChange({ ...value, sessionHours })} />
    <NumberField label="Credits per week" value={value.weeklyCredits} max={MAX_CREDITS} disabled={disabled} onChange={(weeklyCredits) => onChange({ ...value, weeklyCredits })} />
  </div>;
}

const windowLine = (label: string, view: CreditsView["session"]): string =>
  `${label}: ${view.used.toLocaleString()} of ${view.limit.toLocaleString()} credits used${view.held > 0 ? `, ${view.held.toLocaleString()} held` : ""}${view.resetsAt === null ? " (no window open)" : `, refills ${new Date(view.resetsAt).toLocaleString()}`}.`;

function RequestField({ label, value, unlimited, fallback, disabled, onChange }: { label: string; value: number; unlimited: number; fallback: number; disabled: boolean; onChange: (value: number) => void }) {
  const unbounded = value === unlimited;
  return <div className="tagflow-field"><label className="admin-models-check"><input type="checkbox" disabled={disabled} checked={unbounded} onChange={(event) => onChange(event.target.checked ? unlimited : fallback)} /> Unlimited {label.toLowerCase()}</label><NumberField label={label} value={unbounded ? fallback : value} max={unlimited - 1} disabled={disabled || unbounded} onChange={onChange} /></div>;
}

/** Prices pass `step="any"`: provider prices carry more decimals than any fixed step allows. */
function NumberField({ label, value, onChange, min = 0, max, step = "1", disabled = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max: number; step?: string; disabled?: boolean }) {
  return <label className="tagflow-field"><span>{label}</span><input className="input" type="number" required min={min} max={max} step={step} disabled={disabled} value={Number.isFinite(value) ? value : ""} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

const priceLabel = (value: number): string => value === 0 ? "free" : `$${Number(value.toFixed(4))}`;

function TagflowEditor() {
  const { token } = useAuth();
  const [view, setView] = useState<View>("models");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState<TagflowConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<TagflowUsage[]>([]);
  const [usageError, setUsageError] = useState("");
  const [uid, setUid] = useState("");
  const [loadedUid, setLoadedUid] = useState("");
  const [user, setUser] = useState<UserView | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userNotice, setUserNotice] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [userLimits, setUserLimits] = useState<TagflowLimits | null>(null);
  const [inheritCredits, setInheritCredits] = useState(true);
  const [userCredits, setUserCredits] = useState<CreditPlan>(DEFAULT_CREDIT_PLAN);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFilter, setModelFilter] = useState<"all" | "offered" | "hidden" | "wallet">("all");
  /** Models open for editing, by their position in the catalogue. */
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  /** Models added since the last save, shown first so a new one is never out of sight. */
  const [added, setAdded] = useState<ReadonlySet<number>>(new Set());
  const [keyProvider, setKeyProvider] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNotice, setKeyNotice] = useState("");

  // The view lives in the address, so a link or the back button lands on it.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("view");
    if (isView(asked)) setView(asked);
  }, []);
  const choose = (next: View): void => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  };

  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    // The admin panel's made-up data for building it (adminPreview.ts). Dead code in a production build.
    if (process.env["NODE_ENV"] === "development") {
      const preview = (await import("@/lib/adminFixtures")).previewResponse<T>(path, body === undefined ? "GET" : "POST");
      if (preview !== null) { if (preview.ok) return preview.value; throw new Error("Preview data has no answer for this request."); }
    }
    const idToken = await token();
    if (idToken === null) throw new Error("Sign in again to manage included AI.");
    const response = await fetch(`/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json", ...(path === "/ai/tagflow/chat/completions" ? { "x-adcode-ai-source": "admin-test" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as T & { error?: { message?: string } | string; result?: string };
    if (!response.ok) {
      const messages: Record<string, string> = { "code-exists": "That promo code already exists. Choose a different code.", "bad-promo": "Check the promo code, reward, redemption limit and future expiry date.", "bad-boost": "Choose a whole number of tokens and a future end date.", "bad-gift": "Choose a valid plan and between 1 and 366 gift days." };
      throw new Error(result.result === "busy" ? "This account has an AI request in progress. Try resetting its week again in a minute." : typeof result.error === "string" ? messages[result.error] ?? "Could not load or save. Check the server setup and try again." : result.error?.message ?? "Could not load or save. Check the server setup and try again.");
    }
    return result;
  }, [token]);
  useEffect(() => {
    let active = true;
    void call<Saved>("/admin/tagflow").then((value) => { if (active) { setSaved(value); setDraft(value.config); } }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (view !== "people") return;
    let active = true;
    setUsageError("");
    void call<{ rows: TagflowUsage[] }>(`/admin/tagflow/usage?day=${encodeURIComponent(day)}`).then((value) => { if (active) setRows(value.rows); }).catch(() => { if (active) { setRows([]); setUsageError("Could not read usage for this date. Try Refresh."); } });
    return () => { active = false; };
  }, [token, day, view]);

  if (loadError) return <p className="notice" data-tone="error" role="alert">Could not load included AI. Apply the Tagflow database migration and reload this page.</p>;
  if (draft === null || saved === null) return <p className="lede">Loading included AI…</p>;
  const change = (patch: Partial<TagflowConfig>): void => setDraft({ ...draft, ...patch });
  const editModel = (index: number, patch: Partial<TagflowModel>): void => change({ models: draft.models.map((model, at) => at === index ? { ...model, ...patch } : model) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);
  const customProviders = draft.providers ?? [];
  const savedProviderIds = (saved.config.providers ?? []).map((provider) => provider.id);
  const keyStatus = (id: IncludedProviderId): boolean | undefined => saved.connections?.find((connection) => connection.id === id)?.configured;
  const setProviders = (providers: CustomProvider[], models = draft.models): void => {
    const next: TagflowConfig = { ...draft, models };
    if (providers.length > 0) next.providers = providers; else delete next.providers;
    setDraft(next);
  };
  // A provider's ID names its Cloudflare secret and its report history, so it follows the
  // name only until the first save, carrying any models that already point at it.
  const editProvider = (index: number, value: CustomProvider): void => {
    const before = customProviders[index]!;
    const id = savedProviderIds.includes(before.id) ? before.id : customProviderId(value.name, customProviders.filter((_, at) => at !== index).map((provider) => provider.id));
    setProviders(customProviders.map((provider, at) => at === index ? { ...value, id } : provider),
      draft.models.map((model) => model.provider === before.id ? { ...model, provider: id } : model));
  };
  const providerName = (model: TagflowModel): string => providerConnections(customProviders).find((provider) => provider.id === modelProvider(model))?.name ?? modelProvider(model);

  function addModel(): void {
    if (draft === null || draft.models.length >= MAX_TAGFLOW_MODELS) return;
    const index = draft.models.length;
    change({ models: [...draft.models, { id: "", name: "", contextWindow: 32_768, maxOutput: 4096, inputPrice: 0, outputPrice: 0 }] });
    setOpen((current) => new Set(current).add(index));
    setAdded((current) => new Set(current).add(index));
    setModelSearch(""); setModelFilter("all");
    window.setTimeout(() => document.getElementById(`model-${index}-name`)?.focus(), 50);
  }
  function removeModel(index: number): void {
    if (draft === null) return;
    const model = draft.models[index]!;
    change({ models: draft.models.filter((_, at) => at !== index), defaultModel: draft.defaultModel === model.id ? "" : draft.defaultModel });
    // Positions after the removed one shift down by one.
    const shift = (set: ReadonlySet<number>): Set<number> => new Set([...set].filter((at) => at !== index).map((at) => at > index ? at - 1 : at));
    setOpen(shift); setAdded(shift);
  }
  const toggle = (index: number): void => setOpen((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; });

  async function save(): Promise<void> {
    setBusy(true); setNotice("");
    try { const result = await call<Saved>("/admin/tagflow", draft); setSaved(result); setDraft(result.config); setAdded(new Set()); setNotice("Saved. Limits apply to new requests immediately. Editors refresh the model list within five minutes."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Nothing was saved."); }
    finally { setBusy(false); }
  }
  async function testModel(model: TagflowModel): Promise<void> {
    setTestingModel(model.id); setNotice("");
    try {
      const result = await call<{ choices?: { message?: { content?: string } }[] }>("/ai/tagflow/chat/completions", { model: model.id, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 32, stream: false });
      const answer = result.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error("The model answered without text. Check its chat and tool-call support.");
      setNotice(`${model.name} connected. Test reply: ${answer.slice(0, 120)}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The model test failed. Check its ID and server key."); }
    finally { setTestingModel(null); }
  }
  async function loadUser(selected = uid.trim()): Promise<void> {
    if (!selected) return;
    setUserBusy(true); setUserNotice(""); setUser(null); setLoadedUid("");
    try {
      const result = await call<UserView>(`/admin/tagflow/users/${encodeURIComponent(selected)}`);
      setUid(selected); setLoadedUid(selected); setUser(result); setBlocked(result.policy?.blocked === true); setInherit(result.policy?.limits == null); setUserLimits(result.limits);
      setInheritCredits(result.policy?.credits == null); setUserCredits(result.policy?.credits ?? result.credits?.plan ?? DEFAULT_CREDIT_PLAN);
    } catch (error) { setUserNotice(error instanceof Error ? error.message : "Could not load this user."); }
    finally { setUserBusy(false); }
  }
  async function saveUser(): Promise<void> {
    if (!loadedUid) return;
    setUserBusy(true); setUserNotice("");
    try {
      const result = await call<UserView>(`/admin/tagflow/users/${encodeURIComponent(loadedUid)}`, { blocked, limits: inherit ? null : userLimits, credits: inheritCredits ? null : userCredits });
      setUser(result); setUserLimits(result.limits); setUserNotice("Saved for this account. Usage already spent remains counted.");
    } catch (error) { setUserNotice(error instanceof Error ? error.message : "Nothing was saved."); }
    finally { setUserBusy(false); }
  }
  // Writes the key straight into Cloudflare as the provider's own secret; the page never keeps it.
  const keyTargets = providerConnections(saved.config.providers);
  const keyTarget = keyProvider || (saved.config.providers?.[0]?.id ?? "tagflow");
  async function saveKey(remove: boolean): Promise<void> {
    const provider = keyTargets.find((one) => one.id === keyTarget);
    if (provider === undefined) return;
    if (remove && !window.confirm(`Remove the ${provider.name} key? Its models stop working until a key is added again.`)) return;
    setKeyBusy(true); setKeyNotice("");
    try {
      await call("/admin/tagflow/keys", { provider: provider.id, key: remove ? null : keyValue });
      setKeyValue("");
      setKeyNotice(remove ? `${provider.name} key removed. Its models are hidden within a minute.` : `${provider.name} key saved to Cloudflare. It takes effect within a minute: reload this page to see Configured, then use Test model.`);
    } catch (error) { setKeyNotice(error instanceof Error ? error.message : "The key was not saved."); }
    finally { setKeyBusy(false); }
  }
  async function refreshUsage(): Promise<void> {
    setUsageError("");
    try { const result = await call<{ rows: TagflowUsage[] }>(`/admin/tagflow/usage?day=${encodeURIComponent(day)}`); setRows(result.rows); }
    catch { setRows([]); setUsageError("Could not read usage. Try again."); }
  }
  async function checkHeabsyAccess(): Promise<void> {
    setBusy(true); setNotice("");
    try { const result = await call<{ models: string[] }>("/admin/tagflow/heabsy-models"); setNotice(`Heabsy account access: ${result.models.length} models. ${result.models.join(", ")}`); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not check Heabsy model access."); }
    finally { setBusy(false); }
  }

  const offered = draft.models.filter((model) => model.enabled !== false).length;
  const configuredKeys = providerConnections(customProviders).filter((provider) => keyStatus(provider.id) === true).length;
  const search = modelSearch.trim().toLowerCase();
  const visible = draft.models
    .map((model, index) => ({ model, index }))
    .filter(({ model, index }) => added.has(index) || (
      (search === "" || `${model.name} ${model.id} ${model.upstreamModel ?? ""} ${providerName(model)}`.toLowerCase().includes(search)) &&
      (modelFilter === "all" || (modelFilter === "offered" ? model.enabled !== false : modelFilter === "hidden" ? model.enabled === false : model.billing === "wallet"))))
    .sort((a, b) => Number(added.has(b.index)) - Number(added.has(a.index)));
  const configView = view === "models" || view === "providers" || view === "allowances";

  return <div className="admin-models tagflow-admin">
    <AdminSummary items={[
      { label: "Included AI", value: draft.enabled ? "On" : "Off", tone: draft.enabled ? "ok" : "warn", hint: draft.enabled ? "Offered to signed-in users" : "Nobody can use included models" },
      { label: "Models offered", value: `${offered} of ${draft.models.length}`, hint: draft.defaultModel ? `Default: ${draft.models.find((model) => model.id === draft.defaultModel)?.name ?? draft.defaultModel}` : "No default model", ...(draft.defaultModel ? {} : { tone: "warn" as const }) },
      { label: "Provider keys", value: `${configuredKeys} of ${providerConnections(customProviders).length}`, hint: "Configured in Cloudflare" },
    ]} />

    <div className="tagflow-bar" data-dirty={dirty}>
      <nav className="admin-filters tagflow-views" aria-label="Included AI sections">
        {VIEWS.map(([id, label]) => <button key={id} type="button" className={`btn btn-small ${view === id ? "btn-primary" : ""}`} aria-pressed={view === id} onClick={() => choose(id)}>{label}</button>)}
      </nav>
      <div className="tagflow-save">
        <label className="admin-models-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => change({ enabled: event.target.checked })} /> Included AI on</label>
        {dirty && <span className="tagflow-dirty" role="status">Unsaved changes</span>}
        <button type="button" className="btn btn-small" disabled={!dirty || busy} onClick={() => { setDraft(saved.config); setAdded(new Set()); }}>Discard</button>
        <button type="submit" form="tagflow-config" className="btn btn-small btn-primary" disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
    {notice && <p className="notice" role="status">{notice}</p>}

    <form id="tagflow-config" hidden={!configView} onSubmit={(event) => { event.preventDefault(); void save(); }} className="admin-models">
      {view === "models" && <section className="admin-models-provider tagflow-models">
        <header className="admin-card-head"><div><h3>Models offered to users</h3><p className="row-sub">Open a model to edit it. New models appear at the top until you save. Save before using Test.</p></div>
          <button type="button" className="btn btn-primary" disabled={draft.models.length >= MAX_TAGFLOW_MODELS} onClick={addModel}>Add model</button></header>
        <div className="tagflow-model-tools">
          <label className="tagflow-field"><span>Find a model</span><input className="input" type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Name, ID or provider" /></label>
          <label className="tagflow-field"><span>Show</span><select className="select" value={modelFilter} onChange={(event) => setModelFilter(event.target.value as typeof modelFilter)}><option value="all">All models</option><option value="offered">Offered</option><option value="hidden">Hidden</option><option value="wallet">Paid USD credits</option></select></label>
          <label className="tagflow-field"><span>Default model</span><select className="select" value={draft.defaultModel} onChange={(event) => change({ defaultModel: event.target.value })}><option value="">Choose a model</option>{draft.models.filter((model) => model.id && model.enabled !== false).map((model, index) => <option key={index} value={model.id}>{model.name || model.id}</option>)}</select></label>
          <button type="button" className="btn" disabled={busy} onClick={() => void checkHeabsyAccess()}>Check Heabsy access</button>
        </div>
        <p className="row-sub">{visible.length === draft.models.length ? `${draft.models.length} models` : `Showing ${visible.length} of ${draft.models.length} models`} · up to {MAX_TAGFLOW_MODELS}</p>
        <ul className="tagflow-model-list">
          {visible.map(({ model, index }) => {
            const expanded = open.has(index);
            return <li key={index} className="tagflow-model-row" data-open={expanded} data-hidden={model.enabled === false} data-new={added.has(index)}>
              <div className="tagflow-model-summary">
                <button type="button" className="tagflow-model-name" aria-expanded={expanded} onClick={() => toggle(index)}>
                  <strong>{model.name || "New model"}</strong>
                  <span>{model.id || "No ID yet"} · {providerName(model)}</span>
                </button>
                <span className="tagflow-model-meta">{model.billing === "wallet" ? "Paid USD" : "Included"} · {priceLabel(model.inputPrice)} in · {priceLabel(model.outputPrice)} out</span>
                <label className="admin-models-check"><input type="checkbox" checked={model.enabled !== false} onChange={(event) => { const enabled = event.target.checked; change({ models: draft.models.map((one, at) => at === index ? { ...one, enabled } : one), defaultModel: !enabled && draft.defaultModel === model.id ? "" : draft.defaultModel }); }} /> Offer</label>
                <div className="admin-row-actions">
                  <button type="button" className="btn btn-small" onClick={() => toggle(index)}>{expanded ? "Close" : "Edit"}</button>
                  <button type="button" className="btn btn-small" disabled={dirty || busy || testingModel !== null || !draft.enabled || model.enabled === false || !model.id} onClick={() => void testModel(model)}>{testingModel === model.id ? "Testing…" : "Test"}</button>
                  {model.id && <Link className="btn btn-small" href={`/admin/tagflow/reports?model=${encodeURIComponent(model.id)}`}>Report</Link>}
                </div>
              </div>
              {expanded && <fieldset className="tagflow-model">
                <legend className="sr-only">{model.name || `Model ${index + 1}`}</legend>
                <label className="tagflow-field"><span>Charge from</span><select className="select" value={model.billing ?? "included"} onChange={event => { const next = { ...model }; if (event.target.value === "wallet") next.billing = "wallet"; else delete next.billing; change({ models: draft.models.map((one, at) => at === index ? next : one) }); }}><option value="included">Included tokens / subscription</option><option value="wallet">Paid USD credits — provider cost + 35%</option></select></label>
                {model.billing === "wallet" && <p className="row-sub">Uses purchased dollar credits only. User input / output prices: ${Number((model.inputPrice * 1.35).toFixed(5))} / ${Number((model.outputPrice * 1.35).toFixed(5))} per million tokens. Admin tests use your provider account without charging user credits.</p>}
                <div className="tagflow-fields">
                  <label className="tagflow-field"><span>Display name</span><input id={`model-${index}-name`} className="input" required maxLength={120} value={model.name} onChange={(event) => editModel(index, { name: event.target.value })} /></label>
                  <label className="tagflow-field"><span>Provider</span><select className="select" value={modelProvider(model)} onChange={(event) => editModel(index, { provider: event.target.value as IncludedProviderId })}>{providerConnections(customProviders).map((provider) => <option key={provider.id} value={provider.id}>{provider.name || "New provider"}</option>)}</select></label>
                  <label className="tagflow-field"><span>Model ID in ADCode</span><input className="input" required maxLength={200} value={model.id} onChange={(event) => { const id = event.target.value; change({ models: draft.models.map((one, at) => at === index ? { ...one, id } : one), defaultModel: draft.defaultModel === model.id && model.id !== "" ? id : draft.defaultModel }); }} /></label>
                  <label className="tagflow-field"><span>Exact provider model ID (optional)</span><input className="input" maxLength={200} value={model.upstreamModel ?? ""} placeholder="Same as Model ID in ADCode" onChange={(event) => { const upstreamModel = event.target.value; const next = { ...model }; if (upstreamModel) next.upstreamModel = upstreamModel; else delete next.upstreamModel; change({ models: draft.models.map((one, at) => at === index ? next : one) }); }} /></label>
                  <NumberField label="Context tokens" min={1} max={10_000_000} value={model.contextWindow} onChange={(contextWindow) => editModel(index, { contextWindow })} />
                  <NumberField label="Maximum output tokens" min={1} max={65_536} value={model.maxOutput} onChange={(maxOutput) => editModel(index, { maxOutput })} />
                  <NumberField label="Input price (USD per 1M tokens)" max={10_000} step="any" value={model.inputPrice} onChange={(inputPrice) => editModel(index, { inputPrice })} />
                  {model.billing === "wallet" && <NumberField label="Cached input price (USD per 1M tokens)" max={10_000} step="any" value={model.cacheInputPrice ?? model.inputPrice} onChange={cacheInputPrice => editModel(index, { cacheInputPrice })} />}
                  <NumberField label="Output price (USD per 1M tokens)" max={10_000} step="any" value={model.outputPrice} onChange={(outputPrice) => editModel(index, { outputPrice })} />
                  <label className="tagflow-field"><span>Credits per 1,000 tokens</span><input className="input" type="number" min={0} max={MAX_CREDIT_RATE} step="any" value={model.creditRate ?? ""} placeholder={`${modelCreditRate(model.provider === undefined ? {} : { provider: model.provider }, draft)} (default)`} onChange={(event) => { const next = { ...model }; if (event.target.value === "") delete next.creditRate; else next.creditRate = event.currentTarget.valueAsNumber; change({ models: draft.models.map((one, at) => at === index ? next : one) }); }} /><small>Lower for models that cost less to serve. Zero never uses credits.</small></label>
                </div>
                <div className="admin-models-actions"><button type="button" className="btn" onClick={() => removeModel(index)}>Remove model</button></div>
              </fieldset>}
            </li>;
          })}
        </ul>
        {visible.length === 0 && <p className="row-sub">No models match. Clear the search or choose All models.</p>}
        <p className="row-sub">Use unique ADCode IDs; set an optional provider ID when you need an alias. Enter your actual upstream prices for spending limits. A Tagflow model priced at zero is sponsored and free to everyone; on any other provider a zero price counts as missing, and the model stays hidden until you enter one. Offer models that support text chat and tool calls. Paid USD models use the dollar wallet with a fixed 35% markup and never draw on included tokens or Heabsy plans.</p>
      </section>}

      {view === "providers" && <>
        <section className="admin-models-provider"><h3>Server connections</h3><p className="row-sub">You supply these provider connections. Paid models charge purchased USD credits at your upstream rates plus 35%; included models use their existing allowance. Keys stay on your server.</p><div className="admin-models-scroll"><table className="admin-models-table"><thead><tr><th scope="col">Provider</th><th scope="col">Server key</th><th scope="col">Cloudflare secret name</th></tr></thead><tbody>{providerConnections(customProviders).map((provider) => <tr key={provider.id}><td>{provider.docs ? <a href={provider.docs} target="_blank" rel="noreferrer">{provider.name}</a> : <>{provider.name || "New provider"} <small>(custom)</small></>}</td><td>{keyStatus(provider.id) === undefined ? "Save to check" : keyStatus(provider.id) ? "Configured" : "Not configured"}</td><td><code>{provider.secretName}</code>{provider.id === "tagflow" && <small> (your existing tagflow-api is also accepted)</small>}</td></tr>)}</tbody></table></div><p className="row-sub">Models with a missing server key are hidden from users. Reload this page after adding a key. The default must have a configured key before you save an enabled catalog.</p>
          <div className="tagflow-key">
            <h4>Add or replace a key</h4>
            {saved.keysManageable ? <>
              <div className="tagflow-fields">
                <label className="tagflow-field"><span>Provider</span><select className="select" value={keyTarget} onChange={(event) => { setKeyProvider(event.target.value); setKeyNotice(""); }}>{keyTargets.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
                <label className="tagflow-field"><span>API key</span><input className="input" type="password" autoComplete="off" spellCheck={false} maxLength={4096} value={keyValue} placeholder="Paste the key from the provider" onChange={(event) => setKeyValue(event.target.value)} /></label>
              </div>
              <div className="admin-models-actions"><button type="button" className="btn btn-primary" disabled={keyBusy || keyValue.trim().length < 8} onClick={() => void saveKey(false)}>{keyBusy ? "Saving…" : "Save key"}</button><button type="button" className="btn" disabled={keyBusy} onClick={() => void saveKey(true)}>Remove key</button></div>
              <p className="row-sub">Saved straight to Cloudflare as that provider's encrypted secret. It is never stored in the database or shown again, and it can only fill a provider's own key.</p>
            </> : <p className="row-sub">To save keys here instead of in Cloudflare, set this up once: in Cloudflare, open My Profile → API Tokens and create a token with Account → Workers Scripts → Edit for this account. Then run <code>npx wrangler secret put CLOUDFLARE_SECRETS_TOKEN</code> in apps/web, paste the token, and reload this page.</p>}
            {keyNotice && <p className="notice" role="status">{keyNotice}</p>}
          </div></section>
        <section className="admin-models-provider"><header className="admin-card-head"><div><h3>Custom providers</h3><p className="row-sub">Offer models from any provider with an OpenAI-compatible chat API, such as Together AI, Fireworks, DeepInfra, Mistral, DeepSeek or your own vLLM server on a public HTTPS address. Add the provider and save, add its key as the Cloudflare secret it shows, reload, then add models that use it. Users' prompts, code and tool results for those models go to the address you register.</p></div><button type="button" className="btn" disabled={customProviders.length >= MAX_CUSTOM_PROVIDERS} onClick={() => setProviders([...customProviders, { id: customProviderId("", customProviders.map((provider) => provider.id)), name: "", baseUrl: "" }])}>Add provider</button></header>
          {customProviders.map((provider, index) => <CustomProviderEditor key={index} value={provider} keyStatus={savedProviderIds.includes(provider.id) ? keyStatus(provider.id) : undefined} inUse={draft.models.some((model) => model.provider === provider.id)} onChange={(value) => editProvider(index, value)} onRemove={() => setProviders(customProviders.filter((_, at) => at !== index))} />)}
          {customProviders.length === 0 && <p className="row-sub">No custom providers yet.</p>}
        </section>
        <section className="admin-models-provider"><h3>Tagflow connection</h3>
          <label className="tagflow-field"><span>API base URL supplied by Tagflow (including /v1 when required)</span><input className="input" type="url" maxLength={500} value={draft.baseUrl} placeholder="https://your-deployment.tagflow-ai.com/v1" onChange={(event) => change({ baseUrl: event.target.value })} /></label>
          <p className="row-sub">Only HTTPS addresses on tagflow-ai.com or its subdomains are accepted. Get your exact deployment URL and model IDs from Tagflow.</p>
        </section>
      </>}

      {view === "allowances" && <>
        <section className="admin-models-provider"><h3>Paid tokens and the free daily allowance</h3><p className="row-sub">Tagflow AI and all other included models share one daily allowance per person; after it they draw on purchased tokens. Plans raise the allowance; their daily credits are set in code.</p><PaidTokensSettings value={draft.paid} onChange={(paid) => change({ paid })} /><PaidTokensActivity call={call} /></section>
        <section className="admin-models-provider"><h3>Daily safety ceilings per person</h3><p className="row-sub">Behind the credits: what ADCode will spend on one account in a UTC day, and how many requests it may send. Requests are unlimited when the controls below are checked. Zero blocks that type of usage.</p><LimitFields value={draft.limits} onChange={(limits) => change({ limits })} /><div className="tagflow-fields"><NumberField label="Maximum input tokens per request" min={1} max={10_000_000} value={draft.maxInputTokens} onChange={(maxInputTokens) => change({ maxInputTokens })} /><NumberField label="Maximum output tokens per request" min={1} max={65_536} value={draft.maxOutputTokens} onChange={(maxOutputTokens) => change({ maxOutputTokens })} /></div><p className="row-sub">A request reserves its maximum response before it starts. Without provider token counts, usage is estimated conservatively. Spending uses the prices you enter on each model.</p></section>
        <section className="admin-models-provider"><h3>Legacy credit windows</h3><p className="row-sub">The session and weekly credit windows from before daily credits. Kept for accounts still on them; a credit is about 1,000 tokens on a model with rate 1.</p><CreditFields value={draft.credits ?? DEFAULT_CREDIT_PLAN} onChange={(credits) => change({ credits })} /></section>
      </>}
    </form>

    {view === "plans" && <PlansAdmin call={call} />}

    {view === "people" && <>
      <section className="admin-models-provider"><h3>One person's allowance</h3><form className="admin-toolbar" onSubmit={(event) => { event.preventDefault(); void loadUser(); }}><label className="tagflow-field"><span>User ID from People</span><input className="input" required maxLength={128} value={uid} onChange={(event) => setUid(event.target.value)} /></label><button className="btn" disabled={userBusy}>Load user</button></form>
        {userNotice && <p role="status" className="notice">{userNotice}</p>}
        {user !== null && userLimits !== null && <form onSubmit={(event) => { event.preventDefault(); void saveUser(); }}><p className="row-sub">Account: {loadedUid}. Today: {user.usage.requests} requests, {(user.usage.inputTokens + user.usage.outputTokens).toLocaleString()} tokens, {money(user.usage.costMicros)} estimated spend.</p>{user.credits && <><p className="row-sub">{windowLine("Session", user.credits.session)}</p><p className="row-sub">{windowLine("Week", user.credits.weekly)}</p></>}<div className="tagflow-checks"><label><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} /> Block included AI for this person</label><label><input type="checkbox" checked={inheritCredits} onChange={(event) => setInheritCredits(event.target.checked)} /> Default credits</label><label><input type="checkbox" checked={inherit} onChange={(event) => setInherit(event.target.checked)} /> Default daily ceilings</label></div><CreditFields value={inheritCredits ? saved.config.credits ?? DEFAULT_CREDIT_PLAN : userCredits} disabled={inheritCredits} onChange={setUserCredits} /><LimitFields value={inherit ? saved.config.limits : userLimits} disabled={inherit} onChange={setUserLimits} /><button className="btn btn-primary" disabled={userBusy}>{userBusy ? "Saving…" : "Save user allowance"}</button></form>}
      </section>
      <section className="admin-models-provider"><header className="admin-card-head"><div><h3>Usage by account</h3><p className="row-sub">Up to 200 accounts with the highest spend on this UTC date. Only counts are stored; prompts and responses are never stored in these tables.</p></div><div className="admin-models-actions"><input className="input" type="date" value={day} aria-label="Usage date (UTC)" onChange={(event) => { if (event.target.value) setDay(event.target.value); }} /><button className="btn" type="button" onClick={() => void refreshUsage()}>Refresh</button></div></header>
        {usageError && <p className="notice" role="alert">{usageError}</p>}<div className="admin-models-scroll"><table className="admin-models-table"><thead><tr><th scope="col">Account</th><th scope="col">Requests</th><th scope="col">Tokens in / out</th><th scope="col">Estimated spend</th><th scope="col">Reserved tokens / spend</th><th scope="col">Estimated requests</th><th scope="col">Quick actions</th></tr></thead><tbody>{rows.map((row) => { const { uid: account, pool } = allowanceAccount(row.uid); return <tr key={row.uid}><td><button className="btn btn-small" onClick={() => void loadUser(account)}>{account}</button>{pool !== null && <small> · {providerConnections(customProviders).find((provider) => provider.id === pool)?.name ?? pool} allowance</small>}</td><td>{row.requests}</td><td>{row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}</td><td>{money(row.costMicros)}</td><td>{row.reservedTokens.toLocaleString()} / {money(row.reservedCostMicros)}</td><td>{row.estimatedRequests}</td><td><RowActions uid={account} call={call} /></td></tr>; })}</tbody></table></div>{rows.length === 0 && !usageError && <p className="row-sub">No included AI usage on this date.</p>}
      </section>
    </>}
  </div>;
}

/** Reset this person's week, or gift them a week of Pro, straight from their usage row. */
function RowActions({ uid, call }: { uid: string; call: <T>(path: string, body?: unknown) => Promise<T> }) {
  const [state, setState] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const run = async (label: string, path: string, body: unknown): Promise<void> => {
    if (state.busy) return;
    setState({ busy: true, note: null });
    try { await call(path, body); setState({ busy: false, note: label }); }
    catch (error) { setState({ busy: false, note: error instanceof Error ? error.message : "That did not work. Try again." }); }
  };
  return <div className="admin-row-actions">
    <button type="button" className="btn btn-small" disabled={state.busy} onClick={() => void run("Week reset", "/admin/ai-plans/reset", { uid })}>Reset week</button>
    <button type="button" className="btn btn-small" disabled={state.busy} onClick={() => void run("Pro for 7 days gifted", "/admin/ai-plans/gift", { uid, plan: "pro", days: 7, note: "admin quick gift" })}>Gift Pro 7d</button>
    {state.note !== null && <small role="status" className="admin-row-note">{state.note}</small>}
  </div>;
}
