"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
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

export default function AdminAdvertisers() {
  return (
    <AdminShell title="Advertisers" subtitle="Balances, campaigns, and who is allowed to serve.">
      <AdvertisersBody />
    </AdminShell>
  );
}

function AdvertisersBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdvertiserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <p className="lede">Loading…</p>;

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

      {rows.length === 0 ? (
        <div className="empty">
          <h3>No advertisers yet</h3>
          <p>Accounts appear here when someone signs up in the portal.</p>
        </div>
      ) : (
        <div className="rows">
          <div className="row row-head">
            <span className="row-main">Advertiser</span>
            <span className="row-num">Funded</span>
            <span className="row-num">Actions</span>
          </div>

          {rows.map((row) => (
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
