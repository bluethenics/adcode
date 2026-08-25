"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { Avatar } from "@/components/Avatar";
import { HelpNote } from "@/components/HelpNote";
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
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const found = await apiFetch<{ rows: UserRow[]; nextCursor: string | null }>({
      path: "/admin/users?limit=200",
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

  /*
   * Filtered here rather than on the server.
   *
   * The endpoint is a keyset paginator with no search, and adding one is a larger change
   * than this screen needs at its current size. The count beside the box says how many
   * accounts are being searched, so a list that has outgrown this is visible rather than
   * silently partial.
   */
  const needle = query.trim().toLowerCase();
  const matches =
    needle.length === 0
      ? rows
      : rows.filter((row) =>
          [row.email, row.displayName, row.uid]
            .filter((field): field is string => typeof field === "string")
            .some((field) => field.toLowerCase().includes(needle)),
        );

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}

      <HelpNote id="admin-users-audit">
        Names and addresses appear only for accounts that signed in with a provider —
        first launch signs in anonymously, so most accounts have none. Opening
        someone&apos;s ledger is recorded: who looked, at whom, and when. So is every ban.
        You see exactly the rows and descriptions the user sees.
      </HelpNote>

      <div className="admin-search">
        <input
          className="input"
          type="search"
          placeholder="Search by name, email, or account ID"
          aria-label="Search accounts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="field-hint">
          {matches.length === rows.length
            ? `${rows.length} account${rows.length === 1 ? "" : "s"}`
            : `${matches.length} of ${rows.length}`}
        </span>
      </div>

      {matches.length === 0 ? (
        <div className="empty">
          <h3>{rows.length === 0 ? "No accounts yet" : "Nothing matches that"}</h3>
          <p>
            {rows.length === 0
              ? "Accounts appear here the first time someone opens ADCode."
              : "Try part of a name, an email address, or an account ID."}
          </p>
        </div>
      ) : (
        <div className="rows">
          <div className="row row-head">
            <span className="row-main">Person</span>
            <span className="row-num">Actions</span>
          </div>

          {matches.map((row) => (
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
          Showing the {rows.length} most recent accounts. Older ones are not searched.
        </p>
      )}
    </>
  );
}
