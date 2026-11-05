"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { AdminModelTabs } from "@/components/AdminModelTabs";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";

type Status = "new" | "contacted" | "accepted" | "declined";
interface Application {
  id: string; company: string; contactName: string; email: string; website: string; models: string[]; apiBase: string;
  offers: ("free" | "paid" | "byok")[]; pricing: string; message: string; status: Status; note: string; receivedAt: number;
}

const OFFER: Record<Application["offers"][number], string> = { free: "Free, sponsored", paid: "Paid credits", byok: "Own key" };
const STATUSES: readonly Status[] = ["new", "contacted", "accepted", "declined"];

/** Applications from the public /providers page, newest first, each with a status and a note. */
export default function ProviderApplicationsPage() {
  return (
    <AdminShell title="Provider applications" subtitle="Model providers who applied on the website to be offered in ADCode. Reply by email, then set where each one stands.">
      <AdminModelTabs active="applications" />
      <Applications />
    </AdminShell>
  );
}

function Applications() {
  const { token } = useAuth();
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | "all">("new");

  const load = useCallback(async () => {
    const found = await apiFetch<{ applications: Application[] }>({ path: "/admin/provider-applications", token: await token() });
    if (found.ok) setRows(found.value.applications); else setError(MESSAGES[found.error]);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const update = async (row: Application, status: Status, note: string): Promise<void> => {
    const result = await apiFetch<{ ok: true }>({ path: "/admin/provider-applications/status", token: await token(), method: "POST", body: { id: row.id, status, note } });
    if (!result.ok) { setError(MESSAGES[result.error]); return; }
    setRows((current) => current?.map((one) => (one.id === row.id ? { ...one, status, note } : one)) ?? null);
  };

  if (rows === null) return error !== null ? <div className="notice" data-tone="error" role="alert">{error}</div> : <p className="lede">Loading…</p>;
  const shown = rows.filter((row) => filter === "all" || row.status === filter);
  return (
    <>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
      <nav className="admin-tabs" aria-label="Status">
        {(["new", "contacted", "accepted", "declined", "all"] as const).map((one) => (
          <button key={one} type="button" className="admin-tab" aria-current={filter === one ? "page" : undefined} onClick={() => setFilter(one)}>
            {one === "all" ? "All" : one[0]!.toUpperCase() + one.slice(1)} ({one === "all" ? rows.length : rows.filter((row) => row.status === one).length})
          </button>
        ))}
      </nav>
      {shown.length === 0 && <p className="lede">No applications here.</p>}
      {shown.map((row) => (
        <article key={row.id} className="glass-card" style={{ padding: 20, marginTop: 12, display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong>{row.company}</strong>
            <span className="lede">{new Date(row.receivedAt).toLocaleString()}</span>
          </div>
          <p>{row.contactName} · <a href={`mailto:${row.email}`}>{row.email}</a> · <a href={row.website} target="_blank" rel="noopener noreferrer">{row.website}</a></p>
          <p><strong>Models:</strong> {row.models.join(", ")}</p>
          <p><strong>Offer:</strong> {row.offers.map((offer) => OFFER[offer]).join(", ")}{row.pricing && <> · <strong>Pricing:</strong> {row.pricing}</>}{row.apiBase && <> · <strong>API:</strong> <code>{row.apiBase}</code></>}</p>
          {row.message && <p style={{ whiteSpace: "pre-line" }}>{row.message}</p>}
          <StatusEditor row={row} onSave={(status, note) => void update(row, status, note)} />
        </article>
      ))}
    </>
  );
}

function StatusEditor({ row, onSave }: { row: Application; onSave: (status: Status, note: string) => void }) {
  const [status, setStatus] = useState<Status>(row.status);
  const [note, setNote] = useState(row.note);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
      <div className="field">
        <label htmlFor={`status-${row.id}`}>Status</label>
        <select id={`status-${row.id}`} className="select" value={status} onChange={(event) => setStatus(event.target.value as Status)}>
          {STATUSES.map((one) => <option key={one} value={one}>{one}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: 1, minWidth: 220 }}>
        <label htmlFor={`note-${row.id}`}>Note</label>
        <input id={`note-${row.id}`} className="input" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Who replied, what was agreed" />
      </div>
      <button type="button" className="btn btn-outline" onClick={() => onSave(status, note)}>Save</button>
    </div>
  );
}
