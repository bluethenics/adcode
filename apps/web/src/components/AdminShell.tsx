"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { SignInCard } from "./SignInCard";
import { SideIcon, SidebarGlyph, type SideNavIcon } from "./AppShell";
import { apiFetch, type AdminOverviewView } from "@/lib/api";
import { Mark } from "./Mark";

/**
 * The admin panel's chrome.
 *
 * Fourth shape. The third put everything on one page behind eleven disclosures -
 * a "+" to unfold for every queue - which read as one enormous screen of collapsed
 * questions and made every job start with a scroll. This one goes the other way:
 * thirteen destinations in a grouped rail, one page per job, and the second level
 * (creatives vs feedback, payouts vs advertisers) is a real URL again, so a link,
 * the jump box, or the browser's back button lands exactly on the thing.
 *
 * The rail borrows the portal's iOS sidebar whole - same rows, same icons, same
 * sheet on a phone - with two additions of its own: a jump box for pasted ids, and
 * a count beside each queue that can block somebody, so "what needs me" is answered
 * without opening anything. Under 900px the rail leaves the layout and opens as a
 * sheet from the sidebar icon in the bar. The content fades in on every destination
 * change, which costs nothing and makes the panel feel like pages rather than swaps.
 *
 * The gate is the same convenience the rest of the app uses. It decides what renders;
 * the API re-checks the admin claim on every `/v1/admin/*` request, so editing your
 * way past this reaches endpoints that refuse you.
 */
export interface AdminNavItem {
  href: string;
  label: string;
  hint: string;
  icon: SideNavIcon;
  /** The `?tab=` this destination stands for. Absent means the page has a single view. */
  tab?: string;
  /** Which overview count belongs beside it, if any. */
  badge?: (counts: AdminOverviewView) => number;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Now",
    items: [
      { href: "/admin", label: "Overview", hint: "Every queue, at a glance", icon: "grid" },
      { href: "/admin/analytics", label: "Analytics", hint: "Website traffic and conversions", icon: "globe" },
    ],
  },
  {
    label: "Queues",
    items: [
      {
        href: "/admin/review",
        label: "Creatives",
        hint: "Ads waiting on a decision",
        tab: "creatives",
        icon: "target",
        badge: (c) => c.creativesWaiting,
      },
      {
        href: "/admin/review?tab=feedback",
        label: "Feedback",
        hint: "Reports and questions from inside ADCode",
        tab: "feedback",
        icon: "bubble",
        badge: (c) => c.reportsOpen,
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        href: "/admin/money",
        label: "Payouts",
        hint: "Withdrawals to review and pay",
        tab: "payouts",
        icon: "send",
        badge: (c) => c.withdrawalsPending,
      },
      {
        href: "/admin/money?tab=advertisers",
        label: "Advertisers",
        hint: "Funding, campaigns, delivery",
        tab: "advertisers",
        icon: "card",
      },
      {
        href: "/admin/money?tab=countries",
        label: "Countries",
        hint: "Where payouts can go",
        tab: "countries",
        icon: "globe",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        href: "/admin/people",
        label: "Users",
        hint: "Accounts, balances, activity",
        tab: "users",
        icon: "person",
      },
      {
        href: "/admin/people?tab=admins",
        label: "Administrators",
        hint: "Who can operate this panel",
        tab: "admins",
        icon: "shield",
      },
    ],
  },
  {
    label: "Publishing",
    items: [
      {
        href: "/admin/content",
        label: "Blog and docs",
        hint: "Words on the site",
        tab: "writing",
        icon: "doc",
      },
      {
        href: "/admin/content?tab=releases",
        label: "Releases",
        hint: "Desktop versions and notes",
        tab: "releases",
        icon: "tag",
      },
      {
        href: "/admin/content?tab=notices",
        label: "Notices",
        hint: "Messages inside the editor",
        tab: "notices",
        icon: "bell",
      },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/admin/tools", label: "Delivery", hint: "Test ads, no money moves", icon: "wrench" },
    ],
  },
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
  tab,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Which `?tab=` of this page is showing; matches rail items to their destination. */
  tab?: string;
  /** Buttons that belong to this page, shown beside its title. */
  actions?: React.ReactNode;
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

  /* The drawer is navigation: arriving anywhere - a new page or a new tab - closes it. */
  useEffect(() => setDrawer(false), [pathname, tab]);

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
      <section className="auth-screen">
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

  const isCurrent = (item: AdminNavItem): boolean =>
    pathname === item.href.split("?")[0] && item.tab === tab;

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

  const rail = (
    <>
      {search}
      <nav className="app-side-nav" aria-label="Admin">
        {ADMIN_NAV.map((group) => (
          <div className="app-side-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => {
              const count = counts === null || item.badge === undefined ? 0 : item.badge(counts);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="app-side-item"
                  title={item.hint}
                  aria-current={isCurrent(item) ? "page" : undefined}
                  onClick={() => setDrawer(false)}
                >
                  <SideIcon name={item.icon} />
                  <span>{item.label}</span>
                  {count > 0 && (
                    <b className="admin-badge" aria-label={`${count} waiting`}>
                      {count > 99 ? "99+" : count}
                    </b>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <section className="admin">
      {/* The phone's chrome: one slim bar, one icon, never on a laptop. */}
      <div className="app-bar">
        <button
          type="button"
          className="app-bar-toggle"
          aria-label="Open the admin menu"
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
            aria-label="Close the menu"
            onClick={() => setDrawer(false)}
          />
          <div className="app-drawer-panel">{rail}</div>
        </div>
      )}

      <div className="admin-layout">
        <aside className="admin-rail"><Link href="/" className="workspace-brand"><Mark size={28} /><span>ADCode<small>Administration</small></span></Link>{rail}</aside>

        {/*
          Keyed on the destination, so turning a page replays the entrance rather than
          repainting in place. The motion is subtle; the "this is a new page" read is not.
        */}
        <div className="admin-content admin-page-in" key={`${pathname}#${tab ?? ""}`}>
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
