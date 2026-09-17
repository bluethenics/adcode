import Link from "next/link";
import { docsBySection } from "@/lib/docs";

interface Props {
  /**
   * The slug of the doc page currently open, if any. Its section stays expanded and the
   * page itself is marked `aria-current="page"`, so a reader who arrived from search can
   * see exactly where they landed.
   */
  currentDoc?: string;
  /** Which reading surface is open - marks Releases in the sidebar. */
  reading?: "changelog";
}

/**
 * Navigation for the written parts of the site.
 *
 * Primer-shaped: grouped sections with a count, a chevron, and the pages
 * underneath. Every group is a native `<details>` so expanding needs no
 * JavaScript, stays keyboard-accessible, and animates with the same spring
 * as the rest of the docs. The open group is the one holding the current
 * page; on the index every group starts open so the whole manual is visible.
 *
 * Deliberately no `name` attribute: a shared name makes the groups a native
 * exclusive accordion, and the browser then closes all but the first one while
 * parsing the server HTML - which hydrates as a mismatch on every docs page.
 * Independent groups stay exactly as rendered.
 */
export async function DocsSidebar({ currentDoc, reading }: Props) {
  const sections = (await docsBySection()).filter((section) => section.pages.length > 0);
  const onIndex = currentDoc === undefined && reading === undefined;

  return (
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      <div className="docs-sidebar-primary">
        <h2>Documentation</h2>
        <Link href="/docs" aria-current={onIndex ? "page" : undefined} className="docs-nav-all">
          All pages
        </Link>
        {sections.map((section) => {
          const here = currentDoc !== undefined && section.pages.some((page) => page.slug === currentDoc);
          return (
            <details key={section.title} className="docs-nav-group" open={onIndex || here}>
              <summary className={here ? "is-here" : undefined}>
                <span className="docs-nav-title">{section.title}</span>
                <span className="docs-nav-count" aria-label={`${section.pages.length} pages`}>
                  {section.pages.length}
                </span>
                <svg aria-hidden="true" viewBox="0 0 12 12" className="docs-nav-chevron">
                  <path d="M4.2 2.4 7.8 6l-3.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </summary>
              <nav className="docs-sub" aria-label={`${section.title} pages`}>
                {section.pages.map((page) => (
                  <Link
                    href={`/docs/${page.slug}`}
                    key={page.slug}
                    aria-current={page.slug === currentDoc ? "page" : undefined}
                    title={page.description}
                  >
                    {page.title}
                  </Link>
                ))}
              </nav>
            </details>
          );
        })}
      </div>

      {/*
        Straight to the destination, not through a redirect.

        /blog, /changelog, /download and /advertise are redirect stubs left by the
        single-page restructure. Linking a reader - or a crawler - at a 307 costs a
        round trip and splits the link equity between two URLs for one page. The essays
        the Blog row used to point at are now sections in this very sidebar.
      */}
      <section className="docs-sidebar-secondary">
        <h2>Reading</h2>
        <Link href="/versions" aria-current={reading === "changelog" ? "page" : undefined}>
          Releases
        </Link>
        <Link href="/feed.xml">RSS</Link>
      </section>

      <section className="docs-sidebar-secondary">
        <h2>The product</h2>
        <Link href="/versions">Download</Link>
        <Link href="/#advertise">Advertise</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </section>
    </aside>
  );
}
