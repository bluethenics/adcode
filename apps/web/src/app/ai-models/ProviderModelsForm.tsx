"use client";

import { useState, type FormEvent } from "react";
import { trackWebsiteEvent } from "@/lib/websiteAnalytics";

interface Row { upstreamModel: string; name: string; contextWindow: string; maxOutput: string; inputPrice: string; outputPrice: string; cacheInputPrice: string }
const EMPTY: Row = { upstreamModel: "", name: "", contextWindow: "131072", maxOutput: "8192", inputPrice: "", outputPrice: "", cacheInputPrice: "" };
const MAX_MODELS = 20;



/**
 * The provider fills in what the catalogue needs, exactly once: endpoint, key, and each model's
 * real limits and prices. Nothing goes live until an administrator approves it.
 */
export function ProviderModelsForm() {
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY }]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const edit = (index: number, patch: Partial<Row>): void => setRows((current) => current.map((row, at) => at === index ? { ...row, ...patch } : row));
  const number = (value: string): number => value.trim() === "" ? Number.NaN : Number(value);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string): string => String(form.get(name) ?? "");
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/v1/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: text("company"), contactName: text("contactName"), email: text("email"), website: text("website"),
          apiBase: text("apiBase"), apiKey: text("apiKey"), authentication: text("authentication") || "bearer", billing: "wallet", message: text("message"), url2: text("url2"),
          models: rows.map((row) => ({
            upstreamModel: row.upstreamModel.trim(), name: row.name.trim(), contextWindow: number(row.contextWindow), maxOutput: number(row.maxOutput),
            inputPrice: number(row.inputPrice), outputPrice: number(row.outputPrice), ...(row.cacheInputPrice.trim() === "" ? {} : { cacheInputPrice: number(row.cacheInputPrice) }),
          })),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error ?? "That did not send. Try again in a moment."); return; }
      setSent(true);
      trackWebsiteEvent("provider_models_submitted");
    } catch {
      setError("That did not send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="providers-sent glass-card" role="status">
        <h3>Submitted for review</h3>
        <p>We send one real request to each model with your key, then approve or reply to the email you gave. Once approved, your models appear in every ADCode model picker within five minutes.</p>
        <p>Your key is stored encrypted, used only by ADCode&apos;s servers, and deleted from the submission as soon as it is decided.</p>
      </div>
    );
  }

  return (
    <form className="providers-form glass-card provider-models-form" onSubmit={(event) => void submit(event)}>
      {error !== null && <div className="glass-notice" data-tone="error" role="alert">{error}</div>}

      <fieldset className="provider-models-group">
        <legend>About you</legend>
        <div className="support-fields">
          <label className="glass-field"><span>Company</span><input name="company" required maxLength={120} autoComplete="organization" /></label>
          <label className="glass-field"><span>Website</span><input name="website" required type="url" maxLength={300} placeholder="https://" pattern="https://.*" /></label>
          <label className="glass-field"><span>Your name</span><input name="contactName" required maxLength={120} autoComplete="name" /></label>
          <label className="glass-field"><span>Work email</span><input name="email" required type="email" maxLength={254} autoComplete="email" /></label>
        </div>
      </fieldset>

      <fieldset className="provider-models-group">
        <legend>Your API</legend>
        <div className="support-fields">
          <label className="glass-field glass-field-wide"><span>API base URL <small>OpenAI-compatible, without /chat/completions</small></span>
            <input name="apiBase" required type="url" maxLength={300} placeholder="https://api.yourcompany.ai/v1" pattern="https://.*" /></label>
          <label className="glass-field"><span>API key for ADCode <small>create one just for us</small></span>
            <input name="apiKey" required type="password" minLength={8} maxLength={4096} autoComplete="off" spellCheck={false} /></label>
          <label className="glass-field"><span>Key header</span>
            <select name="authentication" defaultValue="bearer"><option value="bearer">Authorization: Bearer</option><option value="x-api-key">x-api-key</option></select></label>
        </div>
      </fieldset>

      <fieldset className="provider-models-group">
        <legend>Your models <small>prices in USD per million tokens</small></legend>
        <ol className="provider-models-rows">
          {rows.map((row, index) => (
            <li key={index} className="provider-models-row">
              <div className="provider-models-row-head">
                <strong>{row.name.trim() || `Model ${index + 1}`}</strong>
                {rows.length > 1 && <button type="button" className="provider-models-remove" onClick={() => setRows((current) => current.filter((_, at) => at !== index))}>Remove</button>}
              </div>
              <div className="provider-models-cells">
                <label className="glass-field provider-models-wide"><span>Model ID in your API</span><input required maxLength={200} pattern="\S+" value={row.upstreamModel} onChange={(event) => edit(index, { upstreamModel: event.target.value })} placeholder="coder-32b-instruct" spellCheck={false} /></label>
                <label className="glass-field provider-models-wide"><span>Name developers see</span><input required maxLength={120} value={row.name} onChange={(event) => edit(index, { name: event.target.value })} placeholder="Coder 32B" /></label>
                <label className="glass-field"><span>Context (tokens)</span><input required type="number" min={1024} max={10000000} step={1} value={row.contextWindow} onChange={(event) => edit(index, { contextWindow: event.target.value })} /></label>
                <label className="glass-field"><span>Max output (tokens)</span><input required type="number" min={256} max={65536} step={1} value={row.maxOutput} onChange={(event) => edit(index, { maxOutput: event.target.value })} /></label>
                <label className="glass-field"><span>Input</span><input required type="number" min={0.000001} max={10000} step="any" value={row.inputPrice} onChange={(event) => edit(index, { inputPrice: event.target.value })} placeholder="0.20" /></label>
                <label className="glass-field"><span>Output</span><input required type="number" min={0.000001} max={10000} step="any" value={row.outputPrice} onChange={(event) => edit(index, { outputPrice: event.target.value })} placeholder="0.60" /></label>
                <label className="glass-field"><span>Cached input <small>optional</small></span><input type="number" min={0} max={10000} step="any" value={row.cacheInputPrice} onChange={(event) => edit(index, { cacheInputPrice: event.target.value })} placeholder="0.05" /></label>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-outline provider-models-add" disabled={rows.length >= MAX_MODELS} onClick={() => setRows((current) => [...current, { ...EMPTY }])}>Add another model</button>
      </fieldset>

      <p className="provider-models-billing-note">Developers pay from USD credits: your price per million tokens, plus ADCode&apos;s 35%. ADCode pays you your price for the tokens they use.</p>

      <label className="glass-field"><span>Anything we should know <small>optional</small></span>
        <textarea name="message" rows={3} maxLength={2000} placeholder="Rate limits, regions, which models support tool calls" /></label>
      {/* Hidden from people, filled only by scripts. */}
      <label className="providers-trap" aria-hidden="true">Leave empty<input name="url2" tabIndex={-1} autoComplete="off" /></label>

      <button type="submit" className="glass-submit" disabled={sending}>{sending ? "Submitting…" : `Submit ${rows.length === 1 ? "model" : `${rows.length} models`} for review`}</button>
    </form>
  );
}
