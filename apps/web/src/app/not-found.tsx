import Link from "next/link";
import type { Metadata } from "next";

/**
 * The 404.
 *
 * Next serves a bare unstyled page without this file, which is a poor answer twice over: a
 * reader who mistyped a docs slug gets nothing to click, and a crawler that follows a stale
 * link learns only that the URL is gone rather than where the site actually is. The links
 * below are the four surfaces that survived the single-page restructure, so a visitor
 * arriving from an old `/blog/…` bookmark still lands somewhere useful.
 *
 * `noindex` is deliberate. Next returns a real 404 status here, but a soft-404 that gets
 * indexed dilutes the site for its own brand terms.
 */
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="notfound band">
      <div className="wrap notfound-wrap">
        <p className="notfound-code">404</p>
        <h1>That page is not here.</h1>
        <p className="notfound-lead">
          It may have moved when the site was reorganised, or the address may have a typo in
          it. These are the places worth trying.
        </p>

        <nav className="notfound-links" aria-label="Where to go instead">
          <Link href="/">
            <strong>Home</strong>
            <span>What ADCode is, and what it pays.</span>
          </Link>
          <Link href="/docs">
            <strong>Documentation</strong>
            <span>Every feature, and the guides that explain them.</span>
          </Link>
          <Link href="/versions">
            <strong>Download</strong>
            <span>The current release for Windows, macOS and Linux.</span>
          </Link>
          <Link href="/support">
            <strong>Support</strong>
            <span>Tell us what went wrong.</span>
          </Link>
        </nav>
      </div>
    </section>
  );
}
