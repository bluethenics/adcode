"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AdminModelTabs } from "@/components/AdminModelTabs";
import { useAuth } from "@/components/AuthProvider";
import type { ProviderModelSubmission, SubmissionStatus } from "@adcode/api/src/providerModels.ts";
import "@/components/adminModels.css";

interface TestResult { ok: boolean; status: number; model: string; reply: string; ms: number }
const price = (value: number): string => `$${Number(value.toFixed(6))}`;
const tokens = (value: number): string => value >= 1_000_000 ? `${Number((value / 1_048_576).toFixed(2))}M` : `${Math.round(value / 1024)}k`;

/** Models providers submitted on /providers/models. Approve puts them live; nothing is retyped. */
export default function ProviderModelSubmissionsPage() {
  return (
    <AdminShell title="Model submissions" subtitle="Models providers submitted from the website with their own endpoint and key. Test one, then approve to put it in the model picker, or decline.">
      <AdminModelTabs active="submissions" />
      <Submissions />
    </AdminShell>
  );
}

function Submissions() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ProviderModelSubmission[] | null>(null);
  const [keysManageable, setKeysManageable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SubmissionStatus | "all">("pending");

  const call = useCallback(async <T,>(path: string, body?: unknown): Promise<T> => {
    const idToken = await token();
    if (idToken === null) throw new Error("Sign in again to review submissions.");
    const response = await fetch(`/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "That did not work. Reload and try again.");
    return result;
  }, [token]);

  const load = useCallback(async () => {
    try {
      const found = await call<{ submissions: ProviderModelSubmission[]; keysManageable: boolean }>("/admin/tagflow/submissions");
      setRows(found.submissions); setKeysManageable(found.keysManageable);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load submissions."); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);

  if (rows === null) return error !== null ? <div className="notice" data-tone="error" role="alert">{error}</div> : <p className="lede">Loading…</p>;
  const shown = rows.filter((row) => filter === "all" || row.status === filter);
  return (
    <>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      {!keysManageable && <div className="notice" data-tone="warning" role="status">Key saving is not set up on this server (CLOUDFLARE_SECRETS_TOKEN), so approving a new provider will fail. Approving more models for a provider that already has a key still works.</div>}
      <p className="row-sub">Providers submit at <a href="/providers/models" target="_blank" rel="noopener">/providers/models</a>. Approved models appear under <Link href="/admin/tagflow">ADCode models</Link>, where you can edit or hide them like any other.</p>
      <nav className="admin-tabs" aria-label="Status">
        {(["pending", "approved", "declined", "all"] as const).map((one) => (
          <button key={one} type="button" className="admin-tab" aria-current={filter === one ? "page" : undefined} onClick={() => setFilter(one)}>
            {one === "all" ? "All" : one[0]!.toUpperCase() + one.slice(1)} ({one === "all" ? rows.length : rows.filter((row) => row.status === one).length})
          </button>
        ))}
      </nav>
      {shown.length === 0 && <p className="lede">No submissions here.</p>}
      {shown.map((row) => <Submission key={row.id} row={row} call={call} onDecided={(next) => setRows((current) => current?.map((one) => one.id === row.id ? next : one) ?? null)} />)}
    </>
  );
}

function Submission({ row, call, onDecided }: { row: ProviderModelSubmission; call: <T>(path: string, body?: unknown) => Promise<T>; onDecided: (next: ProviderModelSubmission) => void }) {
  const [note, setNote] = useState(row.note);
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const test = async (model: string): Promise<void> => {
    setBusy(`test:${model}`); setMessage(null);
    try { const result = await call<TestResult>("/admin/tagflow/submissions/test", { id: row.id, model }); setTests((current) => ({ ...current, [model]: result })); }
    catch (failure) { setMessage({ tone: "error", text: failure instanceof Error ? failure.message : "The test failed." }); }
    finally { setBusy(null); }
  };
  const decide = async (decision: "approve" | "decline"): Promise<void> => {
    if (decision === "approve" && !window.confirm(`Put ${row.models.length === 1 ? "this model" : `these ${row.models.length} models`} from ${row.company} live in the model picker now?`)) return;
    setBusy(decision); setMessage(null);
    try {
      const result = await call<{ status: "approved" | "declined"; providerId?: string; modelIds?: string[]; keySaved?: boolean }>("/admin/tagflow/submissions/decide", { id: row.id, decision, note });
      onDecided({ ...row, status: result.status, note, hasKey: false, providerId: result.providerId ?? "", decidedAt: Date.now() });
      setMessage({ tone: "success", text: result.status === "approved"
        ? `Approved. ${result.modelIds?.length ?? 0} model${result.modelIds?.length === 1 ? "" : "s"} added under ${result.providerId}${result.keySaved ? ", and its key was saved as a server secret" : "; the provider's existing key was kept"}. Editors see them within five minutes.`
        : "Declined. The submitted key was deleted." });
    } catch (failure) { setMessage({ tone: "error", text: failure instanceof Error ? failure.message : "Nothing was changed." }); }
    finally { setBusy(null); }
  };

  return (
    <article className="glass-card" style={{ padding: 20, marginTop: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong>{row.company}</strong>
        <span className="lede">{row.status === "pending" ? "Pending" : row.status === "approved" ? `Approved${row.providerId ? ` as ${row.providerId}` : ""}` : "Declined"}, received {new Date(row.receivedAt).toLocaleString()}</span>
      </div>
      <p>{row.contactName}, <a href={`mailto:${row.email}`}>{row.email}</a>, <a href={row.website} target="_blank" rel="noopener noreferrer">{row.website}</a></p>
      <p><strong>API:</strong> <code>{row.apiBase}</code> with {row.authentication === "bearer" ? "Authorization: Bearer" : "x-api-key"} {row.hasKey ? <>key <code>{row.keyHint}</code></> : <>(key deleted)</>}. <strong>Billing:</strong> {row.billing === "wallet" ? "Paid USD credits, provider price + 35%" : "Included in plans (AI credits)"}</p>
      <div className="admin-models-scroll">
        <table className="admin-models-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Context / output</th><th scope="col">Input / output / cached per 1M</th>{row.status === "pending" && <th scope="col">Connection</th>}</tr></thead>
          <tbody>
            {row.models.map((model) => {
              const result = tests[model.upstreamModel];
              return (
                <tr key={model.upstreamModel}>
                  <td>{model.name}<br /><code>{model.upstreamModel}</code></td>
                  <td>{tokens(model.contextWindow)} / {tokens(model.maxOutput)}</td>
                  <td>{price(model.inputPrice)} / {price(model.outputPrice)} / {model.cacheInputPrice === undefined ? "not set" : price(model.cacheInputPrice)}</td>
                  {row.status === "pending" && <td>
                    <button type="button" className="btn btn-small" disabled={busy !== null || !row.hasKey} onClick={() => void test(model.upstreamModel)}>{busy === `test:${model.upstreamModel}` ? "Testing…" : "Test"}</button>
                    {result !== undefined && <small style={{ display: "block", marginTop: 6 }}>{result.ok ? "Answered" : `Failed (HTTP ${result.status || "none"})`} in {(result.ms / 1000).toFixed(1)} s: {result.reply}</small>}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {row.message && <p style={{ whiteSpace: "pre-line" }}>{row.message}</p>}
      {message !== null && <div className="notice" data-tone={message.tone} role="status">{message.text}</div>}
      {row.status === "pending" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label htmlFor={`note-${row.id}`}>Note</label>
            <input id={`note-${row.id}`} className="input" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="What you checked, what you told them" />
          </div>
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void decide("approve")}>{busy === "approve" ? "Approving…" : "Approve and go live"}</button>
          <button type="button" className="btn btn-outline" disabled={busy !== null} onClick={() => void decide("decline")}>{busy === "decline" ? "Declining…" : "Decline"}</button>
        </div>
      ) : row.note && <p className="row-sub">Note: {row.note}</p>}
    </article>
  );
}
