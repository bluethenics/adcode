"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutNow } from "@/lib/firebase";
import { Mark } from "./Mark";
import { useAuth } from "./AuthProvider";
import { PortalActions } from "./PortalActions";

export function Nav() {
  const pathname = usePathname();
  const { user, loading, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: MouseEvent): void => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const signOut = async (): Promise<void> => {
    setLeaving(true);
    try {
      await signOutNow();
    } finally {
      setLeaving(false);
    }
  };

  const secondaryLinks = (
    <>
      <Link href="/support" className="glass-nav-link" aria-current={pathname === "/support" ? "page" : undefined}>Support</Link>
      <Link href="/versions" className="glass-nav-link" aria-current={pathname === "/versions" ? "page" : undefined}>Versions</Link>
      {isAdmin && <Link href="/admin" className="glass-nav-link">Admin</Link>}
      {!loading && (user === null ? (
        <Link href="/dashboard" className="glass-auth-control">Sign in</Link>
      ) : (
        <button type="button" className="glass-auth-control" disabled={leaving} onClick={() => void signOut()}>
          {leaving ? "Signing out…" : "Log out"}
        </button>
      ))}
    </>
  );

  return (
    <header className="marketplace-nav">
      <div className="marketplace-wrap marketplace-nav-inner">
        <Link href="/" className="marketplace-brand" aria-label="ADCode home"><Mark /><span>ADCode</span></Link>
        <nav className="glass-nav" aria-label="Main navigation">
          <span className="glass-nav-secondary">{secondaryLinks}</span>
          <PortalActions />
          <div className="glass-nav-mobile" ref={menu}>
            <button type="button" className="glass-menu-trigger" aria-label="Open navigation menu" aria-controls="glass-mobile-navigation" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
              <span /><span />
            </button>
            {open && <div className="glass-mobile-sheet" id="glass-mobile-navigation">{secondaryLinks}</div>}
          </div>
        </nav>
      </div>
    </header>
  );
}
