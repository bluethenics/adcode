import Link from "next/link";
import { docsBySection } from "@/lib/docs";

interface Props {
  /**
   * The slug of the doc page currently open, if any. Its section stays expanded and the
   * page itself is marked `aria-current="page"`, so a reader who arrived from search can
   * see exactly where they landed.
   */
  currentDoc?: string;
  /** Which reading surface is open - marks Blog or Changelog in the sidebar. */
  reading?: "blog" | "changelog";
}

/**
 * Navigation for the written parts of the site.
 *
 * This used to be a hardcoded list of six links, three of which went to `/blog`. It now
 * reads the real documentation sections, so a page an admin files under a new section
 * appears here without anyone editing this file.
 *
 * Sections are listed rather than every page: a sidebar with seventy entries is a wall,
 * and `/docs` is itself a full index. A section links to its first page, which is what a
 * reader clicking "Editing" wants. The one exception is where you already are - the
 * section holding the open page unfolds its pages beneath it.
 */
export async function DocsSidebar({ currentDoc, reading }: Props) {
  const sections = (await docsBySection()).filter((section) => section.pages.length > 0);

  return (
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      <section>
        <h2>Documentation</h2>
        <Link href="/docs" aria-current={currentDoc === undefined && reading === undefined ? "page" : undefined}>
          All pages
        </Link>
        {sections.map((section) => {
          const here = currentDoc !== undefined && section.pages.some((page) => page.slug === currentDoc);
          return (
            <span key={section.title} style={{ display: "contents" }}>
              <Link
                href={`/docs/${section.pages[0]?.slug ?? ""}`}
                className={here ? "is-here" : undefined}
              >
                {section.title}
              </Link>
              {here && (
                <nav className="docs-sub" aria-label={`${section.title} pages`}>
                  {section.pages.map((page) => (
                    <Link
                      href={`/docs/${page.slug}`}
                      key={page.slug}
                      aria-current={page.slug === currentDoc ? "page" : undefined}
                    >
                      {page.title}
                    </Link>
                  ))}
                </nav>
              )}
            </span>
          );
        })}
      </section>

      <section>
        <h2>Reading</h2>
        <Link href="/blog" aria-current={reading === "blog" ? "page" : undefined}>
          Blog
        </Link>
        <Link href="/changelog" aria-current={reading === "changelog" ? "page" : undefined}>
          Changelog
        </Link>
        <Link href="/feed.xml">RSS</Link>
      </section>

      <section>
        <h2>The product</h2>
        <Link href="/download">Download</Link>
        <Link href="/advertise">Advertise</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </section>
    </aside>
  );
}
