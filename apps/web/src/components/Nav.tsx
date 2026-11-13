"use client";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";

import Link from "@/components/IntentLink";
import { NavDotField } from "@/components/NavDotField";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutNow } from "@/lib/firebase";
import { Mark } from "./Mark";
import { useAuth } from "./AuthProvider";
import { HeaderStatus } from "./HeaderStatus";
import { PortalActions } from "./PortalActions";
import { ThemePicker } from "./ThemeProvider";
import { TEAM, WEB_VERSION_URL } from "@/lib/site";

export function Nav() {
  const pathname = usePathname();
  const { user, loading, isAdmin, adminError } = useAuth();
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

  /*
   * Keep the door visible when the answer is unknown.
   *
   * An administrator whose `/v1/me` check failed is still an administrator. Hiding the
   * link on `isAdmin: false` left her with no route back to the gate that offers the
   * retry - the exact outage that showed the false "Not an admin account" screen.
   * During an outage a signed-in non-admin sees the link too, lands on the same honest
   * retry, and is refused once the server can answer again.
   */
  const adminLink = isAdmin || (user !== null && adminError !== null) ? (
    <Link
      href="/admin"
      className="glass-nav-link"
      title={isAdmin ? "Admin panel" : "Admin access couldn't be verified yet"}
    >
      Admin
    </Link>
  ) : null;

  const authControl = !loading && (user === null ? (
    <a href={WEB_VERSION_URL} className="glass-auth-control">Sign in</a>
  ) : (
    <button type="button" className="glass-auth-control" disabled={leaving} onClick={() => void signOut()}>
      {leaving ? "Signing out…" : "Log out"}
    </button>
  ));

  /*
   * Compare and Support are the two destinations that answer a question a visitor
   * already has, and both were only reachable from the phone sheet or the footer.
   * Search Console had every comparison page as "discovered, not crawled", so the
   * link that says they matter now sits in the desktop bar too. About us stays in
   * the sheet: it is the one link here that is a story, not a way in.
   */
  const desktopLinks = (
    <>
      <Link href="/#product" className="glass-nav-link">Product</Link>
      <Link href="/pricing" className="glass-nav-link" aria-current={pathname === "/pricing" ? "page" : undefined}>Pricing</Link>
      <Link href="/ai-models" className="glass-nav-link" aria-current={pathname === "/ai-models" ? "page" : undefined}>AI models</Link>
      <Link
        href="/compare"
        className="glass-nav-link"
        aria-current={pathname === "/compare" || pathname.startsWith("/compare/") ? "page" : undefined}
      >
        Compare
      </Link>
      <Link href="/support" className="glass-nav-link" aria-current={pathname === "/support" ? "page" : undefined}>Support</Link>
      <Link
        href="/docs"
        className="glass-nav-link"
        aria-current={pathname === "/docs" || pathname.startsWith("/docs/") ? "page" : undefined}
      >
        Docs
      </Link>
      {adminLink}
    </>
  );

  const mobileLinks = (
    <>
      <Link href="/#product" className="glass-nav-link">Product</Link>
      <Link href="/pricing" className="glass-nav-link" aria-current={pathname === "/pricing" ? "page" : undefined}>Pricing</Link>
      <Link href="/ai-models" className="glass-nav-link" aria-current={pathname === "/ai-models" ? "page" : undefined}>AI models</Link>
      <a href="/#about" className="glass-nav-link">About us</a>
      <Link href="/advertisers" className="glass-nav-link" aria-current={pathname === "/advertisers" ? "page" : undefined}>Advertise</Link>
      <Link
        href="/docs"
        className="glass-nav-link"
        aria-current={pathname === "/docs" || pathname.startsWith("/docs/") ? "page" : undefined}
      >
        Docs
      </Link>
      <Link
        href="/compare"
        className="glass-nav-link"
        aria-current={pathname === "/compare" || pathname.startsWith("/compare/") ? "page" : undefined}
      >
        Compare
      </Link>
      <Link href="/support" className="glass-nav-link" aria-current={pathname === "/support" ? "page" : undefined}>Support</Link>
      <a href={TEAM.bookingUrl} className="glass-nav-link nav-team" target="_blank" rel="noopener noreferrer">Talk to the team <Icon node={ArrowUpRight} /></a>
      {/* The desktop bar has its own Download button; a second "Download" beside it split one action in two. Phones hide that button, so the sheet keeps this. */}
      <Link href="/versions" className="glass-nav-link" aria-current={pathname === "/versions" ? "page" : undefined}>Download</Link>
      {adminLink}
      {authControl}
    </>
  );

  return (
    <header className="marketplace-nav" data-home={pathname === "/" ? "true" : undefined}>
      <NavDotField />
      <div className="marketplace-wrap marketplace-nav-inner">
        <Link href="/" className="marketplace-brand" aria-label="ADCode home"><Mark /><span>ADCode</span></Link>
        <nav className="glass-nav" aria-label="Main navigation">
          <span className="glass-nav-secondary">{desktopLinks}</span>
          <HeaderStatus />
          <ThemePicker />
          <a href={TEAM.bookingUrl} className="glass-nav-link nav-team nav-team-action" target="_blank" rel="noopener noreferrer">Talk to the team <Icon node={ArrowUpRight} /></a>
          <PortalActions />
          {/* The primary action on every page: most visitors came to get the editor. */}
          <a href={WEB_VERSION_URL} className="nav-download">
            <span className="nav-download-full">Open in browser</span>
            <span className="nav-download-short">Open</span>
          </a>
          <div className="glass-nav-mobile" ref={menu}>
            <button type="button" className="glass-menu-trigger" aria-label="Open navigation menu" aria-controls="glass-mobile-navigation" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
              <span /><span />
            </button>
            {open && <div className="glass-mobile-sheet" id="glass-mobile-navigation" onClick={(event) => { if ((event.target as Element).closest("a")) setOpen(false); }}>{mobileLinks}</div>}
          </div>
        </nav>
      </div>
    </header>
  );
}
