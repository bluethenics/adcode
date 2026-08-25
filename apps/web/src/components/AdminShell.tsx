"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { SignInCard } from "./SignInCard";

/**
 * The admin panel's own chrome.
 *
 * Admin used the same top-tab strip as the portal, and nine tabs do not fit in one: on a
 * laptop the last three were off the right edge behind a scrollbar, so "Notices",
 * "Releases" and "Admins" were effectively hidden behind a gesture nobody makes on a
 * page they have just opened.
 *
 * A sidebar fits nine and would fit fifteen, and it lets them be *grouped* - which is the
 * part a tab strip cannot do at all. The three groups are the three jobs: deciding about
 * other people's things, writing this site's words, and running the machine.
 *
 * The gate is the same convenience the rest of the app uses. `requireAdmin` decides what
 * renders; the API re-checks the admin claim on every `/v1/admin/*` request, so editing
 * your way past this reaches endpoints that refuse you.
 */
export interface AdminSection {
  label: string;
  items: { href: string; label: string; hint: string }[];
}

export const ADMIN_NAV: AdminSection[] = [
  {
    label: "Moderation",
    items: [
      { href: "/admin", label: "Review queue", hint: "Cards waiting to be approved" },
      { href: "/admin/users", label: "People", hint: "Accounts, ledgers, bans" },
      { href: "/admin/advertisers", label: "Advertisers", hint: "Balances and suspensions" },
      { href: "/admin/reports", label: "Feedback", hint: "Bugs and requests from the editor" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/blog", label: "Blog & docs", hint: "Everything the site says" },
      { href: "/admin/releases", label: "Releases", hint: "What shipped, and what it says" },
      { href: "/admin/notices", label: "Notices", hint: "Messages to everyone running ADCode" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/ads", label: "Test delivery", hint: "Send a card to your own editor" },
      { href: "/admin/admins", label: "Administrators", hint: "Who else can see this" },
    ],
  },
];

export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Buttons that belong to this page, shown beside its title. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, loading, configured, isAdmin } = useAuth();
  const pathname = usePathname();

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

  return (
    <section className="admin">
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Admin">
          {ADMIN_NAV.map((section) => (
            <div className="admin-nav-group" key={section.label}>
              <h2>{section.label}</h2>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="admin-nav-item"
                  // `/admin` is a prefix of every other route here, so an exact match is
                  // the only thing that marks the review queue correctly.
                  aria-current={pathname === item.href ? "page" : undefined}
                >
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </Link>
              ))}
            </div>
          ))}
        </nav>

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
