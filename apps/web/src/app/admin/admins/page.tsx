"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { HelpNote } from "@/components/HelpNote";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, MESSAGES } from "@/lib/api";
import { when } from "@/components/money";

interface AdminRow {
  email: string;
  addedBy: string;
  addedAt: number;
}

/**
 * Who can get into this panel.
 *
 * An administrator is an email address in a table, and it only counts once a sign-in
 * provider has confirmed the person holds that address. So appointing someone is safe
 * before they have ever signed in: the row waits for them, and grants nothing to anybody
 * who merely types the address into a sign-up form.
 */
export default function AdminAdmins() {
  return (
    <AdminShell title="Administrators" subtitle="Who else can see any of this.">
      <AdminsBody />
    </AdminShell>
  );
}

function AdminsBody() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await apiFetch<{ admins: AdminRow[] }>({
      path: "/admin/admins",
      token: await token(),
    });
    if (found.ok) setRows(found.value.admins);
    else setError(MESSAGES[found.error]);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    const wanted = email.trim().toLowerCase();
    if (wanted.length === 0) {
      setError("Type the email address of the account to appoint.");
      return;
    }

    setBusy(true);
    setError(null);
    setDone(null);

    const result = await apiFetch<{ admins: AdminRow[] }>({
      path: "/admin/admins",
      token: await token(),
      method: "POST",
      body: { email: wanted },
    });
    setBusy(false);

    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setRows(result.value.admins);
    setEmail("");
    setDone(`${wanted} is now an administrator.`);
  };

  const remove = async (wanted: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);

    const result = await apiFetch<{ admins: AdminRow[] }>({
      path: "/admin/admins/remove",
      token: await token(),
      method: "POST",
      body: { email: wanted },
    });
    setBusy(false);

    if (!result.ok) {
      setError(MESSAGES[result.error]);
      return;
    }

    setRows(result.value.admins);
    setDone(`${wanted} is no longer an administrator.`);
  };

  if (loading) return <p className="lede">Loading…</p>;

  return (
    <>
      {error !== null && (
        <div className="notice" data-tone="error" role="alert">
          {error}
        </div>
      )}
      {done !== null && (
        <div className="notice" data-tone="ok">
          {done}
        </div>
      )}

      <HelpNote id="admin-admins">
        An administrator can read every account, move money, approve ads and appoint more
        administrators. Only the address matters — whoever signs in with it, using any
        method, gets everything on these tabs. Appoint accordingly.
      </HelpNote>

      <form onSubmit={add} style={{ maxWidth: 560, marginBottom: 34 }}>
        <h3 style={{ fontSize: 18, marginBottom: 12 }}>Appoint an administrator</h3>

        <div className="field">
          <label htmlFor="a-email">Email address</label>
          <span className="field-hint">
            The address they sign in with. They do not need an account yet — the
            appointment waits for them, and takes effect the first time they sign in with a
            method that confirms the address is theirs.
          </span>
          <input
            id="a-email"
            className="input"
            type="email"
            autoComplete="off"
            placeholder="someone@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Appoint
          </button>
        </div>
      </form>

      <h3 style={{ fontSize: 18, marginBottom: 12 }}>Administrators</h3>

      <div className="rows">
        {rows.map((row) => (
          <div className="row" key={row.email}>
            <span className="row-main">
              <span className="row-title">{row.email}</span>
              <span className="row-sub">
                {row.addedBy === "setup" ? (
                  <>
                    <span className="pill" data-tone="live">
                      Founding
                    </span>{" "}
                    created with the site
                  </>
                ) : (
                  <>appointed {when(row.addedAt)}</>
                )}
              </span>
            </span>
            <button
              className="btn btn-outline btn-small"
              disabled={busy || rows.length === 1}
              onClick={() => void remove(row.email)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <p className="field-hint" style={{ marginTop: 18, maxWidth: "64ch" }}>
        The last administrator cannot be removed. Nothing else in the system can appoint
        one, so an empty list would lock everybody out of this panel for good — the only way
        back would be editing the database by hand. Removing yourself is fine as long as
        somebody else is left.
      </p>
    </>
  );
}
