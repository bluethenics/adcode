import Link from "@/components/IntentLink";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { JsonLd } from "@/components/JsonLd";
import { DocsToc } from "@/components/DocsToc";
import { Icon } from "@/components/Icon";
import { ReadingProgress } from "@/components/ReadingProgress";
import { allDocs, docsBySection, getDoc, relatedPages } from "@/lib/docs";
import { outlineDoc } from "@/lib/docsToc";
import { renderMarkdown } from "@/lib/markdown";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide";
import { breadcrumbs, techArticle } from "@/lib/schema";
import { docDescription, docTitle, pageMetadata } from "@/lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Kept rendered, and re-rendered at most once a minute so admin-panel publishing shows up. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await allDocs()).map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getDoc(slug);
  if (page === null) return { title: "Not found" };

  return pageMetadata({
    path: `/docs/${page.slug}`,
    title: docTitle(page),
    socialTitle: page.title,
    description: docDescription(page.description),
    type: "article",
    section: page.section,
    ...(page.published === undefined ? {} : { publishedTime: page.published }),
    ...(page.updated === undefined ? {} : { modifiedTime: page.updated }),
  });
}

/** Rough reading estimate so the hero meta line is honest, not decorative. */
function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const page = await getDoc(slug);
  if (page === null) notFound();
  const related = await relatedPages(page);
  const minutes = readingMinutes(page.body);

  /*
   * Previous / next inside the same section, in sidebar order. A reference
   * manual is read sideways as often as it is searched, and the frame should
   * offer the next page rather than a dead end.
   */
  const sections = await docsBySection();
  const section = sections.find((one) => one.title === page.section);
  const siblings = section?.pages ?? [];
  const position = siblings.findIndex((one) => one.slug === page.slug);
  const previous = position > 0 ? siblings[position - 1] : undefined;
  const next = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : undefined;

  const { html, outline } = outlineDoc(renderMarkdown(page.body));

  return (
    <>
      <ReadingProgress />
      <JsonLd data={techArticle(page)} />
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Documentation", path: "/docs" },
          { name: page.title, path: `/docs/${page.slug}` },
        ])}
      />
      <div className="dx">
        <DocsSidebar currentDoc={page.slug} />
        <main className="dx-main dx-main--doc">
          <article className="dx-article">
            <Breadcrumbs
              items={[
                { name: "Home", href: "/" },
                { name: "Documentation", href: "/docs" },
                { name: page.section },
                { name: page.title },
              ]}
            />
            <header className="dx-doc-head">
              <p className="dx-eyebrow">{page.section}</p>
              <h1>{page.title}</h1>
              <p className="dx-lede">{page.description}</p>
              <p className="dx-doc-meta">
                <span>{minutes} min read</span>
                {page.authored && page.published !== undefined && (
                  <time dateTime={page.published}>{page.published}</time>
                )}
              </p>
            </header>
            <div className="prose dx-prose" dangerouslySetInnerHTML={{ __html: html }} />

            {(previous !== undefined || next !== undefined) && (
              <nav className="dx-pager" aria-label="More in this section">
                {previous !== undefined ? (
                  <Link href={`/docs/${previous.slug}`} className="dx-pager-link" rel="prev">
                    <small><Icon node={ArrowLeft} className="dx-pager-arrow" /> Previous</small>
                    <strong>{previous.title}</strong>
                  </Link>
                ) : (
                  <span />
                )}
                {next !== undefined && (
                  <Link href={`/docs/${next.slug}`} className="dx-pager-link dx-pager-next" rel="next">
                    <small>Next <Icon node={ArrowRight} className="dx-pager-arrow" /></small>
                    <strong>{next.title}</strong>
                  </Link>
                )}
              </nav>
            )}

            {related.length > 0 && (
              <aside className="dx-related">
                <h2>See also</h2>
                <ul className="dx-cards">
                  {related.map((item, index) => (
                    <li key={item.slug} className="dx-item" style={{ ["--i" as string]: index }}>
                      <Link href={`/docs/${item.slug}`} className="dx-card">
                        <span className="dx-card-title">
                          {item.title}
                          <Icon node={ArrowUpRight} className="dx-card-arrow" />
                        </span>
                        <span className="dx-card-text">{item.description}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </article>
          <div className="dx-rail">
            <DocsToc items={outline} />
          </div>
        </main>
      </div>
    </>
  );
}
