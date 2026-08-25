"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { Avatar } from "./Avatar";
import { signOutNow } from "@/lib/firebase";

/**
 * The signed-in end of the nav: who you are, where your things are, and the way out.
 *
 * Sign-out lived nowhere before this. That is a worse bug than it sounds - on a shared or
 * borrowed machine the only way to leave was to clear site data, and a product that shows
 * someone their balance owes them a door.
 *
 * The menu is a real popover: it closes on Escape, on a click outside, and on navigation,
 * and the trigger carries `aria-expanded`. Anything less is a div that looks like a menu.
 */
export function AccountMenu() {
  const { user, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (user === null) return null;

  const label = user.email ?? user.uid;

  const signOut = async (): Promise<void> => {
    setLeaving(true);
    try {
      await signOutNow();
      setOpen(false);
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div className="account" ref={wrap}>
      <button
        type="button"
        className="account-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((was) => !was)}
      >
        <Avatar photoUrl={user.photoURL} label={label} />
        <span className="sr-only">Your account</span>
      </button>

      {open && (
        <div className="account-menu ios-sheet" role="menu">
          <div className="account-head">
            <Avatar photoUrl={user.photoURL} label={label} size="lg" />
            <div>
              <strong>{user.displayName ?? "Your account"}</strong>
              <span>{label}</span>
            </div>
          </div>

          <div className="ios-group">
            <Link href="/dashboard" role="menuitem" onClick={() => setOpen(false)}>
              Earnings
            </Link>
            <Link href="/portal" role="menuitem" onClick={() => setOpen(false)}>
              Advertiser portal
            </Link>
            {isAdmin && (
              <Link href="/admin" role="menuitem" onClick={() => setOpen(false)}>
                Admin
              </Link>
            )}
          </div>

          <div className="ios-group">
            <button
              type="button"
              role="menuitem"
              className="account-signout"
              disabled={leaving}
              onClick={() => void signOut()}
            >
              {leaving ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
