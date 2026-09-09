"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { SignInCard } from "./SignInCard";

/**
 * The gate and chrome shared by the portal, dashboard, and admin areas.
 *
 * The gate is a convenience, not a control: it decides what to render, while the API
 * re-checks the token and the admin claim on every single request. Someone who edits
 * their way past this component reaches endpoints that refuse them anyway.
 *
 * The header is an iOS large title - the name of the place, big, with a line of
 * explanation under it. The email that used to sit opposite it moved into the nav's
 * account menu, where the sign-out is: two places saying who you are was one too many.
 *
 * When `sidebar` is given, the page is a split view: an iOS-style rail on the left, the
 * content on the right. On a laptop the rail is always on screen; on a phone a sidebar
 * icon opens it as a sheet with the same spring the rest of the site uses. Items are
 * either routes or on-page anchors (`/portal#credits`), and the rail marks whichever the
 * address bar currently points at.
 */
export interface Tab {
  href: string;
  label: string;
}

export type SideNavIcon =
  | "grid"
  | "target"
  | "card"
  | "plus"
  | "chart"
  | "send"
  | "clock"
  | "list"
  | "bubble"
  | "globe"
  | "person"
  | "shield"
  | "doc"
  | "tag"
  | "bell"
  | "wrench";

export interface SideNavItem {
  /** A path, or a path with an on-page anchor: `/portal` or `/portal#credits`. */
  href: string;
  label: string;
  icon: SideNavIcon;
}

export interface SideNavGroup {
  label: string;
  items: SideNavItem[];
}

/**
 * The strokes an iOS sidebar row leads with. 15px, 1.5 stroke, round caps. Exported so
 * the admin panel's rail draws from the same set rather than growing its own.
 */
export function SideIcon({ name }: { name: SideNavIcon }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="4.6" height="4.6" rx="1.2" />
          <rect x="9.4" y="2" width="4.6" height="4.6" rx="1.2" />
          <rect x="2" y="9.4" width="4.6" height="4.6" rx="1.2" />
          <rect x="9.4" y="9.4" width="4.6" height="4.6" rx="1.2" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
          <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="1.8" y="3.4" width="12.4" height="9.2" rx="2" />
          <path d="M1.8 6.6h12.4" />
          <path d="M4.4 9.9h3.2" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5.4v5.2M5.4 8h5.2" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M2.6 12.8h10.8" />
          <path d="M4.4 10.6V7.6M8 10.6V3.8M11.6 10.6V6" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M4.6 11.4 11.4 4.6" />
          <path d="M6.2 4.6h5.2v5.2" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="M8 5v3l2 1.3" />
        </svg>
      );
    case "list":
      return (
        <svg {...common}>
          <path d="M6.2 4h7M6.2 8h7M6.2 12h7" />
          <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
          <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bubble":
      return (
        <svg {...common}>
          <rect x="2.2" y="2.2" width="11.6" height="7.8" rx="1.9" />
          <path d="M5.4 9.9v2.7l2.3-2.7" />
          <path d="M5.2 5h5.6M5.2 7.4h3.4" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.8" />
          <path d="M2.2 8h11.6M8 2.2c1.7 1.5 2.6 3.5 2.6 5.8s-0.9 4.3-2.6 5.8c-1.7-1.5-2.6-3.5-2.6-5.8s0.9-4.3 2.6-5.8Z" />
        </svg>
      );
    case "person":
      return (
        <svg {...common}>
          <circle cx="8" cy="5.4" r="2.6" />
          <path d="M3.2 13.4c0.7-2.3 2.6-3.5 4.8-3.5s4.1 1.2 4.8 3.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M8 2.2 3.4 4.1v3.7c0 3 2 5 4.6 6 2.6-1 4.6-3 4.6-6V4.1L8 2.2Z" />
          <path d="M6.1 7.9l1.3 1.3 2.5-2.6" />
        </svg>
      );
    case "doc":
      return (
        <svg {...common}>
          <path d="M4.4 2.4h4.4l2.8 2.8v8a1.4 1.4 0 0 1-1.4 1.4H4.4a1.4 1.4 0 0 1-1.4-1.4V3.8a1.4 1.4 0 0 1 1.4-1.4Z" />
          <path d="M8.8 2.4v2.8h2.8" />
          <path d="M5.4 8.6h5.2M5.4 11h3.6" />
        </svg>
      );
    case "tag":
      return (
        <svg {...common}>
          <path d="M2.4 2.4h5L13.2 8.2a1.7 1.7 0 0 1 0 2.4l-2.6 2.6a1.7 1.7 0 0 1-2.4 0L2.4 7.4V2.4Z" />
          <circle cx="5.4" cy="5.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M8 2.4c2.4 0 3.8 1.7 3.8 4.1v2l1.3 2.2H2.9L4.2 8.5v-2c0-2.4 1.4-4.1 3.8-4.1Z" />
          <path d="M6.4 13.2a1.7 1.7 0 0 0 3.2 0" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...common}>
          <path d="M9.9 2.5a3.2 3.2 0 0 0-4.2 4L3 9.2a1.9 1.9 0 1 0 2.6 2.6l2.7-2.7a3.2 3.2 0 0 0 4-4.2l-1.8 1.8-1.7-0.4-0.4-1.7 1.5-2.1Z" />
        </svg>
      );
  }
}

/** SF Symbols' `sidebar.left`: the toggle the mobile bar leads with. Shared with the admin panel. */
export function SidebarGlyph() {
  return (
    <svg
      width="19"
      height="15"
      viewBox="0 0 20 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="16.5" height="12.5" rx="3.2" />
      <path d="M7.4 2.6v10.8" />
    </svg>
  );
}

export function AppShell({
  title,
  subtitle,
  tabs,
  sidebar,
  requireAdmin = false,
  children,
}: {
  title: string;
  subtitle?: string;
  tabs?: Tab[];
  /** Sections of this workspace. When present, the page gains the split-view rail. */
  sidebar?: SideNavGroup[];
  requireAdmin?: boolean;
  children: React.ReactNode;
}) {
  const { user, loading, configured, isAdmin } = useAuth();
  const pathname = usePathname();

  const [drawer, setDrawer] = useState(false);
  const [hash, setHash] = useState("");

  /* The rail's current marker follows the address bar: an anchor item is current when
     it is the hash, a plain route when nothing follows the path. */
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  /* The drawer is navigation: arriving anywhere - a new page or a new anchor - closes
     it, or the sheet would sit over the very destination it was opened to reach. */
  useEffect(() => setDrawer(false), [pathname, hash]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const isCurrent = (href: string): boolean => {
    const anchorAt = href.indexOf("#");
    const path = anchorAt === -1 ? href : href.slice(0, anchorAt);
    if (path !== pathname) return false;
    return anchorAt === -1 ? hash === "" : hash === href.slice(anchorAt);
  };

  if (!configured) {
    return (
      <section className="band">
        <div className="wrap">
          <div className="notice" data-tone="info">
            Sign-in isn&apos;t configured on this deployment yet. Set the{" "}
            <code className="mono">NEXT_PUBLIC_FIREBASE_*</code> environment variables to
            enable it.
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="band">
        <div className="wrap">
          {/* A shaped placeholder rather than the word "Loading": the page that arrives
              lands in the same boxes, so nothing jumps when it does. */}
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-card" />
          <span className="sr-only">Checking your session…</span>
        </div>
      </section>
    );
  }

  if (user === null) {
    return (
      <section className="band">
        <div className="wrap">
          <SignInCard heading={`Sign in to ${title.toLowerCase()}`} />
        </div>
      </section>
    );
  }

  if (requireAdmin && !isAdmin) {
    /*
     * Say which of the two reasons it is.
     *
     * An administrator is an email address in a table, and the API honours it only when
     * the token says the provider *verified* that address - otherwise anyone who knew an
     * admin's address could register it with a password and take the site. So the
     * common way to be refused here is to be the right person signed in the wrong way,
     * and "not an admin account" sends that person hunting in the database rather than
     * pressing the Google button. `emailVerified` is on the Firebase user already, so
     * the page can tell the two apart without asking the server anything.
     */
    const unverified = user.email !== null && !user.emailVerified;

    return (
      <section className="band">
        <div className="wrap">
          <div className="empty">
            <h3>{unverified ? "This address isn't verified" : "Not an admin account"}</h3>
            {unverified ? (
              <p>
                You&apos;re signed in as <strong>{user.email}</strong>, but that account was
                created with a password and nobody has confirmed the address belongs to you.
                Administrators have to sign in with a provider that verifies it. Sign out
                and use <strong>Continue with Google</strong> or{" "}
                <strong>Continue with GitHub</strong> instead.
              </p>
            ) : (
              <p>
                You&apos;re signed in as <strong>{user.email ?? user.uid}</strong>, and that
                address isn&apos;t on the administrator list. If it should be, an existing
                admin can add it from the Admins tab.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  const body = (
    <>
      <div className="app-head">
        <h1 className="large-title">{title}</h1>
        {subtitle !== undefined && <p className="large-title-sub">{subtitle}</p>}
      </div>

      {tabs !== undefined && tabs.length > 0 && (
        <nav className="app-tabs" aria-label={title}>
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="app-tab"
              aria-current={pathname === tab.href ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      )}

      {children}
    </>
  );

  if (sidebar === undefined || sidebar.length === 0) {
    return (
      <section className="app">
        <div className="wrap">{body}</div>
      </section>
    );
  }

  const rail = (
    <nav className="app-side-nav" aria-label={title}>
      {sidebar.map((group) => (
        <div className="app-side-group" key={group.label}>
          <h2>{group.label}</h2>
          {group.items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="app-side-item"
              aria-current={isCurrent(item.href) ? "page" : undefined}
              onClick={() => setDrawer(false)}
            >
              <SideIcon name={item.icon} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <section className="app app-side">
      {/* The phone's chrome: one slim bar, one icon, never on a laptop. */}
      <div className="app-bar">
        <button
          type="button"
          className="app-bar-toggle"
          aria-label="Open the sidebar"
          aria-expanded={drawer}
          onClick={() => setDrawer((open) => !open)}
        >
          <SidebarGlyph />
        </button>
        <strong>{title}</strong>
      </div>

      {drawer && (
        <div className="app-drawer">
          {/* The gesture people already try: a tap off the sheet dismisses it. */}
          <button
            type="button"
            className="app-drawer-scrim"
            aria-label="Close the sidebar"
            onClick={() => setDrawer(false)}
          />
          <div className="app-drawer-panel">{rail}</div>
        </div>
      )}

      <div className="app-layout">
        <aside className="app-rail">{rail}</aside>
        <div className="app-content">{body}</div>
      </div>
    </section>
  );
}
