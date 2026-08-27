"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpNote } from "@/components/HelpNote";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { money, when } from "@/components/money";

interface AdvertiserRow {
  advertiserId: string;
  name: string;
  status: string;
  fundedMicros: string;
  reservedMicros: string;
  ownerUids: string[];
  createdAt: number;
}

export function AdvertisersBody({ initialQuery = "" }: { initialQuery?: string }) {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdvertiserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);

  const load = useCallback(async () => {
    const found = await apiFetch<{ advertisers: AdvertiserRow[] }>({
      path: "/admin/advertisers",
      token: await token(),
    });
    if (found.ok) setRows(found.value.advertisers);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (advertiserId: string, status: "active" | "suspended") => {
    setBusy(advertiserId);
    setError(null);

    const result = await apiFetch<{ ok: boolean; status: string }>({
      path: `/admin/advertisers/${encodeURIComponent(advertiserId)}/status`,
      token: await token(),
      method: "POST",
      body: { status },
    });

    setBusy(null);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setRows((current) => current.map((r) => (r.advertiserId === advertiserId ? { ...r, status } : r)));
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return rows;
    return rows.filter((row) =>
      [row.advertiserId, row.name, ...row.ownerUids].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [rows, query]);

  if (loading) return <div className="skeleton skeleton-card" />;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <HelpNote id="admin-advertisers">
        Suspending locks an advertiser out of the portal — no new campaigns, no funding, no
        changes. It does <strong>not</strong> stop campaigns already live, because that
        money is committed and halting paid delivery is a refund question, not a
        moderation one. Pause those explicitly if that&apos;s what you mean.
      </HelpNote>

      <div className="admin-toolbar">
        <input
          className="input admin-toolbar-search"
          type="search"
          value={query}
          placeholder="Filter by name, owner uid or id"
          aria-label="Filter advertisers"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>{rows.length === 0 ? "No advertisers yet" : "Nothing matches"}</h3>
          <p>Accounts appear here when someone signs up in the portal.</p>
        </div>
      ) : (
        <div className="rows">
          <div className="row row-head">
            <span className="row-main">Advertiser</span>
            <span className="row-num">Funded</span>
            <span className="row-num">Actions</span>
          </div>

          {shown.map((row) => (
            <div className="row" key={row.advertiserId}>
              <span className="row-main">
                <span className="row-title">{row.name}</span>
                <span className="row-sub">
                  <span className="pill" data-tone={row.status === "suspended" ? "ended" : "live"}>
                    {row.status === "suspended" ? "Suspended" : "Active"}
                  </span>{" "}
                  joined {when(row.createdAt)} ·{" "}
                  <span className="mono" style={{ fontSize: 12 }}>
                    {row.ownerUids[0] ?? "—"}
                  </span>
                </span>
              </span>

              <span className="row-num mono">{money(row.fundedMicros)}</span>

              <span style={{ flex: "none" }}>
                {row.status === "suspended" ? (
                  <button
                    className="btn btn-outline btn-small"
                    disabled={busy === row.advertiserId}
                    onClick={() => void setStatus(row.advertiserId, "active")}
                  >
                    Reinstate
                  </button>
                ) : (
                  <button
                    className="btn btn-outline btn-small"
                    disabled={busy === row.advertiserId}
                    onClick={() => void setStatus(row.advertiserId, "suspended")}
                  >
                    Suspend
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
