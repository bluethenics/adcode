"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { Avatar } from "@/components/Avatar";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES, type LedgerPageView, type LedgerRowView } from "@/lib/api";
import { LedgerRows } from "@/components/LedgerRows";
import { statusLabel, tone, when } from "@/components/money";

interface UserRow {
  uid: string;
  status: string;
  createdAt: number;
  /**
   * All optional, and usually absent.
   *
   * First launch signs in anonymously with no UI, so most accounts have never told this
   * service a name or an address. They are captured from the verified token the moment
   * somebody signs in with Google or GitHub - see `identityOf` in `services/api/src/auth.ts`.
   */
  email?: string;
  displayName?: string;
  photoUrl?: string;
}

export default function AdminUsers() {
  return (
    <AdminShell title="People" subtitle="Every account, what it has earned, and whether it is allowed to.">
      <UsersBody />
    </AdminShell>
  );
}

function UsersBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerRowView[]>([]);

  const load = useCallback(async () => {
    const found = await apiFetch<{ rows: UserRow[]; nextCursor: string | null }>({
      path: "/admin/users?limit=50",
      token: await token(),
    });
    if (found.ok) {
      setRows(found.value.rows);
      setCursor(found.value.nextCursor);
    } else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (uid: string, status: "active" | "banned") => {
    setBusy(uid);
    setError(null);

    const result = await apiFetch<{ ok: boolean }>({
      path: `/admin/users/${encodeURIComponent(uid)}/status`,
      token: await token(),
      method: "POST",
      body: { status },
    });

    setBusy(null);
    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }
    setRows((current) => current.map((r) => (r.uid === uid ? { ...r, status } : r)));
  };

  const openLedger = async (uid: string) => {
    if (open === uid) {
      setOpen(null);
      return;
    }
    setOpen(uid);
    setLedger([]);

    const found = await apiFetch<LedgerPageView>({
      path: `/admin/users/${encodeURIComponent(uid)}/ledger?limit=25`,
      token: await token(),
    });
    if (found.ok) setLedger(found.value.rows);
    else setError(MESSAGES[found.error]);
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <div className="notice" data-tone="info">
        Names and addresses appear only for accounts that signed in with a provider.
        Opening someone&apos;s ledger is recorded — who looked, at whom, and when. So is
        every ban. You see exactly the rows and descriptions the user sees.
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          <h3>No users yet</h3>
          <p>Accounts appear here the first time someone opens ADCode.</p>
        </div>
      ) : (
        <div className="rows">
          <div className="row row-head">
            <span className="row-main">Person</span>
            <span className="row-num">Actions</span>
          </div>

          {rows.map((row) => (
            <div key={row.uid}>
              <div className="row">
                <span className="row-main user-row">
                  <Avatar photoUrl={row.photoUrl ?? null} label={row.displayName ?? row.email ?? row.uid} />
                  <span>
                    <span className="row-title">
                      {/* A name if they gave one, then an address, then the uid. An
                          anonymous account has only ever been a uid and saying so is
                          more useful than showing a bare identifier and hoping. */}
                      {row.displayName ?? row.email ?? "Anonymous"}
                    </span>
                    <span className="row-sub">
                      <span className="pill" data-tone={tone(row.status)}>
                        {row.status === "banned" ? "Banned" : "Active"}
                      </span>{" "}
                      {row.email !== undefined && row.displayName !== undefined ? `${row.email} · ` : ""}
                      joined {when(row.createdAt)}
                    </span>
                    <span className="row-uid mono">{row.uid}</span>
                  </span>
                </span>

                <span style={{ display: "flex", gap: 8, flex: "none" }}>
                  <button className="btn btn-outline btn-small" onClick={() => void openLedger(row.uid)}>
                    {open === row.uid ? "Hide ledger" : "Ledger"}
                  </button>
                  {row.status === "banned" ? (
                    <button
                      className="btn btn-outline btn-small"
                      disabled={busy === row.uid}
                      onClick={() => void setStatus(row.uid, "active")}
                    >
                      Unban
                    </button>
                  ) : (
                    <button
                      className="btn btn-outline btn-small"
                      disabled={busy === row.uid}
                      onClick={() => void setStatus(row.uid, "banned")}
                    >
                      Ban
                    </button>
                  )}
                </span>
              </div>

              {open === row.uid && (
                <div style={{ padding: "0 18px 18px" }}>
                  {ledger.length === 0 ? (
                    <p className="field-hint">No entries on this account.</p>
                  ) : (
                    <LedgerRows rows={ledger} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {cursor !== null && (
        <p className="field-hint" style={{ marginTop: 14 }}>
          Showing the 50 most recent accounts.
        </p>
      )}
    </>
  );
}
