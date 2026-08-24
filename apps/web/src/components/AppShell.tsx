"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 */
export interface Tab {
  href: string;
  label: string;
}

export function AppShell({
  title,
  subtitle,
  tabs,
  requireAdmin = false,
  children,
}: {
  title: string;
  subtitle?: string;
  tabs?: Tab[];
  requireAdmin?: boolean;
  children: React.ReactNode;
}) {
  const { user, loading, configured, isAdmin } = useAuth();
  const pathname = usePathname();

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
    return (
      <section className="band">
        <div className="wrap">
          <div className="empty">
            <h3>Not an admin account</h3>
            <p>
              You&apos;re signed in, but this area needs an admin role. If that&apos;s
              wrong, sign out and back in — role changes apply on your next sign-in.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="app">
      <div className="wrap">
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
      </div>
    </section>
  );
}
