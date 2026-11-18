import Link from "@/components/IntentLink";
import { ChevronRight } from "lucide";
import { docsBySection } from "@/lib/docs";
import { DocsNavigation } from "./DocsNavigation";
import { DocsSearchPill } from "./DocsSearchPill";
import { Icon } from "./Icon";

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
 * Grouped sections with a chevron, a count, and the pages underneath. Every group is a
 * native `<details>` so expanding needs no JavaScript and stays keyboard-accessible. The
 * open group is the one holding the current page; on the index every group starts open
 * so the whole manual is visible.
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
    <aside className="dx-sidebar" aria-label="Documentation navigation">
      <DocsNavigation>
        <div className="dx-nav">
          <DocsSearchPill searchOnPage={onIndex} />
          <Link href="/docs" aria-current={onIndex ? "page" : undefined} className="dx-nav-all">
            All pages
          </Link>
          {sections.map((section) => {
            const here = currentDoc !== undefined && section.pages.some((page) => page.slug === currentDoc);
            return (
              <details key={section.title} className="dx-nav-group" open={onIndex || here}>
                <summary className={here ? "is-here" : undefined}>
                  <Icon node={ChevronRight} className="dx-nav-chevron" />
                  <span className="dx-nav-title">{section.title}</span>
                  <span className="dx-nav-count" aria-label={`${section.pages.length} pages`}>
                    {section.pages.length}
                  </span>
                </summary>
                <nav className="dx-nav-pages" aria-label={`${section.title} pages`}>
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
        <section className="dx-nav-more">
          <h2>Reading</h2>
          <Link href="/versions" aria-current={reading === "changelog" ? "page" : undefined}>
            Releases
          </Link>
          <Link href="/feed.xml">RSS</Link>
        </section>

        <section className="dx-nav-more">
          <h2>The product</h2>
          <Link href="/versions">Download</Link>
          <Link href="/#advertise">Advertise</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </section>
      </DocsNavigation>
    </aside>
  );
}
