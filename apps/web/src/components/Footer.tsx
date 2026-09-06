import Link from "next/link";
import { COMPARE_PREFIX, comparisons, guides, landingPath } from "@/lib/landings";
import { PARENT, SITE } from "@/lib/site";

/**
 * The footer, and the only route to the landing pages.
 *
 * Those pages are written to be arrived at from a search result, which means nothing on
 * the site links to them - and a page with no internal links is one a crawler discovers
 * from the sitemap, treats as unimportant because the site itself never points at it, and
 * recrawls rarely. A sitemap says a URL exists; an internal link says it matters. The
 * footer is where a site says that about pages that do not belong in the nav.
 *
 * The studio line is not decoration either. `schema.ts` asserts `parentOrganization` and
 * `bluethenics.com` asserts the matching `subOrganization`; a visible, followed link
 * between the two hosts is what stops that pair of claims being two sites talking to
 * themselves. It is deliberately not `rel="nofollow"` - the relationship is real and the
 * link is the evidence for it.
 */
export function Footer() {
  return (
    <footer className="marketplace-footer">
      <div className="marketplace-wrap footer-grid">
        <nav aria-label="Product">
          <h2>Product</h2>
          <Link href="/">Overview</Link>
          <Link href="/versions">Download</Link>
          <Link href="/docs">Documentation</Link>
          <Link href="/#advertise">Advertise</Link>
        </nav>

        <nav aria-label="Guides">
          <h2>Guides</h2>
          {guides().map((page) => (
            <Link key={page.slug} href={landingPath(page)}>
              {page.heading}
            </Link>
          ))}
        </nav>

        <nav aria-label="Comparisons">
          <h2>Compare</h2>
          <Link href={COMPARE_PREFIX}>All comparisons</Link>
          {comparisons().map((page) => (
            <Link key={page.slug} href={landingPath(page)}>
              {page.heading}
            </Link>
          ))}
        </nav>

        <nav aria-label="Company">
          <h2>Company</h2>
          <a href={PARENT.url}>{PARENT.name}</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="/llms.txt">For language models</a>
        </nav>
      </div>

      <div className="marketplace-wrap footer-base">
        <span>
          © {new Date().getFullYear()} {SITE.name}. A{" "}
          <a href={PARENT.url}>{PARENT.name}</a> product.
        </span>
        <span>{SITE.tagline}.</span>
      </div>
    </footer>
  );
}
