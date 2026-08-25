"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { apiFetch } from "@/lib/api";

/**
 * Choosing an account, by anything you actually know about it.
 *
 * Test delivery had a text field for a uid and defaulted it to whoever was signed into
 * the website. That is a sensible-looking default and it was the bug: the person driving
 * admin is signed in on the *web*, their editor is signed in as something else - often an
 * anonymous account created silently on first launch - and nobody knows a 28-character
 * Firebase uid by heart. So the card was queued to an account that never asks for one and
 * waited there forever, while the admin screen said "Queued."
 *
 * Searching by name or address is the fix, because those are the things a person knows.
 * The uid is still shown on every row and still accepted in the box, since it is what an
 * anonymous account has instead of a name.
 */
export interface PickedUser {
  uid: string;
  email?: string;
  displayName?: string;
  photoUrl?: string;
  status: string;
}

/**
 * How many accounts to hold for searching.
 *
 * The endpoint is a keyset paginator and this deliberately does not follow it. Searching
 * across everything would mean either a server-side query that does not exist yet or
 * paging the whole table into a browser; holding the most recent few hundred covers
 * "find the editor I just launched", which is what this is for. The count is shown, so
 * nobody has to guess whether the list is complete.
 */
const HOLD = 200;

export function UserPicker({
  value,
  onChange,
  label = "Send to which account",
  hint,
}: {
  value: string;
  onChange: (uid: string) => void;
  label?: string;
  hint?: string;
}) {
  const { token } = useAuth();
  const [users, setUsers] = useState<PickedUser[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const found = await apiFetch<{ rows: PickedUser[] }>({
        path: `/admin/users?limit=${HOLD}`,
        token: await token(),
      });
      if (found.ok) setUsers(found.value.rows);
      setLoading(false);
    })();
  }, [token]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return users.slice(0, 12);

    return users
      .filter((user) =>
        [user.email, user.displayName, user.uid]
          .filter((field): field is string => typeof field === "string")
          .some((field) => field.toLowerCase().includes(needle)),
      )
      .slice(0, 12);
  }, [users, query]);

  const selected = users.find((user) => user.uid === value) ?? null;

  return (
    <div className="field" ref={wrap}>
      <label htmlFor="user-picker">{label}</label>
      {hint !== undefined && <span className="field-hint">{hint}</span>}

      <div className="user-picker">
        <input
          id="user-picker"
          className="input"
          autoComplete="off"
          placeholder={loading ? "Loading accounts…" : "Search by name, email, or paste a uid"}
          value={open ? query : (selected?.email ?? selected?.displayName ?? value)}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            // A pasted uid is a valid answer on its own: an anonymous account has no
            // other name, and this is the one place somebody might have one to hand.
            if (event.target.value.trim().length > 20) onChange(event.target.value.trim());
          }}
        />

        {open && (
          <div className="user-picker-list" role="listbox">
            {matches.length === 0 ? (
              <p className="field-hint" style={{ padding: "10px 12px" }}>
                {users.length === 0 ? "No accounts yet." : "Nothing matches that."}
              </p>
            ) : (
              matches.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  role="option"
                  aria-selected={user.uid === value}
                  className="user-picker-row"
                  onClick={() => {
                    onChange(user.uid);
                    setOpen(false);
                  }}
                >
                  <Avatar
                    photoUrl={user.photoUrl ?? null}
                    label={user.displayName ?? user.email ?? user.uid}
                  />
                  <span>
                    <strong>{user.displayName ?? user.email ?? "Anonymous"}</strong>
                    <small className="mono">{user.uid}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {selected !== null && !open && (
        <span className="field-hint" style={{ marginTop: 6 }}>
          Sending to <strong>{selected.displayName ?? selected.email ?? "an anonymous account"}</strong>
          {" · "}
          <code className="mono">{selected.uid}</code>
        </span>
      )}
    </div>
  );
}
