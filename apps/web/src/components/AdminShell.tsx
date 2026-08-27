"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { SignInCard } from "./SignInCard";
import { apiFetch, type AdminOverviewView } from "@/lib/api";

/**
 * The admin panel's own chrome.
 *
 * This is the third shape it has had, and each change was the same complaint: it took too
 * much room to say too little. Nine destinations in a top tab strip pushed three off the
 * right edge. Nine in a sidebar fitted, but a 232px column of headings and hint text is a
 * quarter of a laptop screen spent on navigation - and on a phone it became a horizontal
 * scroller, which is a gesture nobody makes on a page they have just opened.
 *
 * So: **six destinations, not nine.** The pages that were split by data type are now
 * grouped by job and switch with a control inside the page - creatives and feedback are
 * both "things people sent that need a decision", users and administrators are both
 * "people". Nothing was removed; the second level moved inside.
 *
 * The rail is 172px of labels with a count beside the two that can block somebody, so
 * "what needs me" is answered from wherever you happen to be. Under 900px it collapses
 * into a drawer behind a button in a sticky bar, and the content gets the whole width.
 *
 * The gate is the same convenience the rest of the app uses. It decides what renders; the
 * API re-checks the admin claim on every `/v1/admin/*` request, so editing your way past
 * this reaches endpoints that refuse you.
 */
export interface AdminNavItem {
  href: string;
  label: string;
  hint: string;
  /** Which overview count belongs beside it, if any. */
  badge?: (counts: AdminOverviewView) => number;
}

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", hint: "What is waiting for you" },
  {
    href: "/admin/review",
    label: "Review",
    hint: "Creatives and feedback awaiting a decision",
    badge: (c) => c.creativesWaiting + c.reportsOpen,
  },
  {
    href: "/admin/money",
    label: "Money",
    hint: "Withdrawals to pay, advertisers to watch",
    badge: (c) => c.withdrawalsPending,
  },
  { href: "/admin/people", label: "People", hint: "Accounts, ledgers, administrators" },
  { href: "/admin/content", label: "Content", hint: "Blog, docs, releases, notices" },
  { href: "/admin/tools", label: "Tools", hint: "Test delivery and repairs" },
];

/**
 * Where a pasted identifier should land.
 *
 * Every id in this system carries its own prefix, so the box can route on the value
 * rather than making somebody choose a category first - which is the step that makes a
 * search box slower than opening the page and using ctrl-F.
 */
export function jumpTarget(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  const query = `q=${encodeURIComponent(value)}`;
  if (value.startsWith("wd-")) return `/admin/money?${query}`;
  if (value.startsWith("rep-")) return `/admin/review?tab=feedback&${query}`;
  if (value.startsWith("adv-") || value.startsWith("camp-")) {
    return `/admin/money?tab=advertisers&${query}`;
  }
  // A uid, an address, or a name. People is also the right home for anything unrecognised:
  // almost every question that starts with a pasted string is a question about a person.
  return `/admin/people?${query}`;
}

export function AdminShell({
  title,
  subtitle,
  actions,
  singlePage = false,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Buttons that belong to this page, shown beside its title. */
  actions?: React.ReactNode;
  singlePage?: boolean;
  children: React.ReactNode;
}) {
  const { user, loading, configured, isAdmin, token } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [drawer, setDrawer] = useState(false);
  const [counts, setCounts] = useState<AdminOverviewView | null>(null);
  const [jump, setJump] = useState("");

  const loadCounts = useCallback(async () => {
    const found = await apiFetch<AdminOverviewView>({
      path: "/admin/overview",
      token: await token(),
    });
    if (found.ok) setCounts(found.value);
  }, [token]);

  useEffect(() => {
    if (isAdmin) void loadCounts();
  }, [isAdmin, loadCounts]);

  // The drawer is navigation, so arriving somewhere closes it. Without this, following a
  // link on a phone leaves the panel sitting over the page you asked for.
  useEffect(() => setDrawer(false), [pathname]);

  if (!configured) {
    return (
      <section className="band">
        <div className="wrap">
          <div className="notice" data-tone="info">
            Sign-in isn&apos;t configured on this deployment yet.
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="band">
        <div className="wrap">
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-card" />
        </div>
      </section>
    );
  }

  if (user === null) {
    return (
      <section className="band">
        <div className="wrap">
          <SignInCard heading="Sign in to the admin panel" />
        </div>
      </section>
    );
  }

  if (!isAdmin) {
    // The likeliest way to see this is to be the right person signed in the wrong way:
    // an administrator is an address in a table, honoured only when the token says the
    // provider verified it. See `AppShell` for the same distinction.
    const unverified = user.email !== null && !user.emailVerified;

    return (
      <section className="band">
        <div className="wrap">
          <div className="empty">
            <h3>{unverified ? "This address isn't verified" : "Not an admin account"}</h3>
            <p>
              {unverified ? (
                <>
                  You&apos;re signed in as <strong>{user.email}</strong> with a password, and
                  nobody has confirmed the address belongs to you. Sign out and use{" "}
                  <strong>Continue with Google</strong> instead.
                </>
              ) : (
                <>
                  <strong>{user.email ?? user.uid}</strong> isn&apos;t on the administrator
                  list.
                </>
              )}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (singlePage) {
    return (
      <section className="admin admin-single">
        <div className="wrap">
          <header className="admin-head">
            <div><h1>{title}</h1>{subtitle !== undefined && <p>{subtitle}</p>}</div>
            {actions !== undefined && <div className="admin-head-actions">{actions}</div>}
          </header>
          {children}
        </div>
      </section>
    );
  }

  const nav = (
    <nav className="admin-nav" aria-label="Admin">
      {ADMIN_NAV.map((item) => {
        const count = counts === null || item.badge === undefined ? 0 : item.badge(counts);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="admin-nav-item"
            title={item.hint}
            // `/admin` is a prefix of every other route here, so an exact match is the
            // only thing that marks the overview correctly.
            aria-current={pathname === item.href ? "page" : undefined}
          >
            <span>{item.label}</span>
            {count > 0 && (
              <b className="admin-badge" aria-label={`${count} waiting`}>
                {count > 99 ? "99+" : count}
              </b>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const search = (
    <form
      className="admin-jump"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const target = jumpTarget(jump);
        if (target !== null) router.push(target);
      }}
    >
      <input
        className="input"
        type="search"
        value={jump}
        placeholder="Jump to a uid, email or id"
        aria-label="Jump to a uid, email or id"
        onChange={(event) => setJump(event.target.value)}
      />
    </form>
  );

  return (
    <section className="admin">
      {/* The phone's chrome: one bar, always reachable, and never on a desktop. */}
      <div className="admin-bar">
        <button
          type="button"
          className="admin-bar-toggle"
          aria-expanded={drawer}
          onClick={() => setDrawer((open) => !open)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <strong>{title}</strong>
      </div>

      {drawer && (
        <div className="admin-drawer">
          {/* A click anywhere off the panel closes it - the gesture people already try. */}
          <button
            type="button"
            className="admin-drawer-scrim"
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
          />
          <div className="admin-drawer-panel">
            {search}
            {nav}
          </div>
        </div>
      )}

      <div className="admin-layout">
        <div className="admin-rail">
          {search}
          {nav}
        </div>

        <div className="admin-content">
          <header className="admin-head">
            <div>
              <h1>{title}</h1>
              {subtitle !== undefined && <p>{subtitle}</p>}
            </div>
            {actions !== undefined && <div className="admin-head-actions">{actions}</div>}
          </header>

          {children}
        </div>
      </div>
    </section>
  );
}

/**
 * The second level, inside a page.
 *
 * Rendered as links with a `?tab=` rather than as component state, so a section can be
 * linked to - which is what makes the jump box able to land on feedback rather than on
 * the page that contains it.
 */
export function AdminTabs({
  tabs,
  active,
  base,
}: {
  tabs: { id: string; label: string; count?: number }[];
  active: string;
  base: string;
}) {
  return (
    <nav className="admin-tabs" aria-label="Section">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={`${base}?tab=${tab.id}`}
          className="admin-tab"
          aria-current={tab.id === active ? "page" : undefined}
          scroll={false}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <b className="admin-badge">{tab.count > 99 ? "99+" : tab.count}</b>
          )}
        </Link>
      ))}
    </nav>
  );
}
