"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { money, when } from "@/components/money";
import { AdminSummary } from "@/components/AdminUI";
import { AdminLoader } from "@/components/AdminLoader";
import { apiFetch, MESSAGES } from "@/lib/api";

/*
 * Admin > Money > Earnings review (services/api earningReview.ts).
 *
 * Accounts that look like ad farming - a throwaway inbox, one mailbox behind several accounts,
 * a custom domain several accounts share or that earns fast, cards claimed faster than a
 * screen shows them - are held: no new card earns, nothing converts or pays out. Nothing is
 * taken away. Clear lets the account carry on where it was; "Clear and trust domain" also
 * clears everybody else held only for that domain and stops holding it again (a company or a
 * university). Block keeps it held for good; banning is still the Users page's switch.
 */

type Status = "review" | "cleared" | "blocked";

interface ReviewRow {
  uid: string;
  status: Status;
  reasons: string[];
  reasonLabels: string[];
  email: string | null;
  domain: string | null;
  flaggedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  note: string | null;
  availableMicros: string | null;
  lifetimeMicros: string | null;
}

const FILTERS: { id: Status; label: string }[] = [
  { id: "review", label: "Held" },
  { id: "cleared", label: "Cleared" },
  { id: "blocked", label: "Blocked" },
];

export function EarningReviews() {
  const { token } = useAuth();
  const [filter, setFilter] = useState<Status>("review");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const found = await apiFetch<{ reviews: ReviewRow[] }>({ path: `/admin/earning-reviews?status=${filter}`, token: await token() });
    if (found.ok) setRows(found.value.reviews);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [filter, token]);

  useEffect(() => void load(), [load]);

  const decide = async (row: ReviewRow, status: "cleared" | "blocked", trustDomain = false) => {
    setBusy(row.uid);
    const result = await apiFetch<unknown>({
      path: `/admin/earning-reviews/${encodeURIComponent(row.uid)}`,
      token: await token(),
      method: "POST",
      body: { status, trustDomain },
    });
    setBusy(null);
    if (result.ok) void load();
    else setError(MESSAGES[result.error]);
  };

  const heldMicros = rows.reduce((total, row) => total + BigInt(row.availableMicros ?? "0"), 0n);
  const domains = new Set(rows.map((row) => row.domain).filter((domain): domain is string => domain !== null));

  return (
    <>
      {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}

      <div className="admin-toolbar">
        <div className="admin-filters" role="group" aria-label="Filter by decision">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`btn btn-small ${filter === option.id ? "btn-primary" : "btn-outline"}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {filter === "review" && !loading && (
        <AdminSummary items={[
          { label: "Held", value: rows.length, hint: rows.length === 1 ? "account" : "accounts", ...(rows.length > 0 ? { tone: "warn" as const } : {}) },
          { label: "Their balances", value: <span className="money">{money(heldMicros.toString())}</span>, hint: "Cannot convert or pay out while held" },
          { label: "Domains", value: domains.size, hint: "Trust one to clear all of its people" },
        ]} />
      )}

      {loading ? (
        <AdminLoader label="Loading earnings reviews" />
      ) : rows.length === 0 ? (
        <div className="empty">
          <h3>Nothing here</h3>
          <p>{filter === "review" ? "No account is held. New ones appear here the moment they match a farming pattern." : "No account has this decision yet."}</p>
        </div>
      ) : (
        <div className="adm-stack-list">
          {rows.map((row) => (
            <article key={row.uid} className="card adm-row">
              <header className="adm-row-head">
                <strong>{row.email ?? row.uid}</strong>
                <span className="mono muted">{row.uid}</span>
              </header>
              <ul className="adm-row-reasons">
                {row.reasonLabels.map((label) => <li key={label}>{label}</li>)}
              </ul>
              <p className="muted">
                Held {when(row.flaggedAt)}
                {row.availableMicros !== null && <> · <span className="money">{money(row.availableMicros)}</span> available</>}
                {row.lifetimeMicros !== null && <> · <span className="money">{money(row.lifetimeMicros)}</span> earned in all</>}
                {row.decidedAt !== null && <> · decided {when(row.decidedAt)}</>}
                {row.note !== null && <> · {row.note}</>}
              </p>
              {row.status !== "cleared" && (
                <div className="adm-row-actions">
                  <button type="button" className="btn btn-small btn-primary" disabled={busy === row.uid} onClick={() => void decide(row, "cleared")}>Clear</button>
                  {row.domain !== null && (row.reasons.includes("custom-domain-shared") || row.reasons.includes("custom-domain-fast")) && (
                    <button type="button" className="btn btn-small btn-outline" disabled={busy === row.uid} onClick={() => void decide(row, "cleared", true)}>
                      Clear and trust {row.domain}
                    </button>
                  )}
                  {row.status !== "blocked" && (
                    <button type="button" className="btn btn-small btn-outline" disabled={busy === row.uid} onClick={() => void decide(row, "blocked")}>Block</button>
                  )}
                </div>
              )}
              {row.status === "cleared" && (
                <div className="adm-row-actions">
                  <button type="button" className="btn btn-small btn-outline" disabled={busy === row.uid} onClick={() => void decide(row, "blocked")}>Block after all</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
