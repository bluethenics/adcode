import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsFrameTopbar } from "@/components/DocsFrameTopbar";
import { DocsSidebar } from "@/components/DocsSidebar";
import { JsonLd } from "@/components/JsonLd";
import { ReadingProgress } from "@/components/ReadingProgress";
import { allDocs, docsBySection, getDoc, relatedPages } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbs, techArticle } from "@/lib/schema";
import { url } from "@/lib/site";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await allDocs()).map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await getDoc(slug);
  if (page === null) return { title: "Not found" };

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url(`/docs/${page.slug}`) },
    openGraph: {
      type: "article",
      title: page.title,
      description: page.description,
      url: url(`/docs/${page.slug}`),
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description },
  };
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
      <section className="docs-stage">
        <div className="docs-frame docs-frame-in">
          <DocsFrameTopbar />
          <div className="docs-frame-body">
            <DocsSidebar currentDoc={page.slug} />
            <main className="docs-main">
              <Breadcrumbs
                items={[
                  { name: "Home", href: "/" },
                  { name: "Documentation", href: "/docs" },
                  { name: page.section },
                  { name: page.title },
                ]}
              />
              <header className="docs-hero docs-hero--compact">
                <div className="docs-hero-art" aria-hidden="true">
                  <i className="docs-blob docs-blob-a" />
                  <i className="docs-blob docs-blob-b" />
                  <i className="docs-blob docs-blob-c" />
                  <i className="docs-hero-sheen" />
                </div>
                <div className="docs-hero-copy">
                  <p className="docs-hero-eyebrow">{page.section}</p>
                  <h1>{page.title}</h1>
                  <p className="docs-hero-version mono">
                    <span aria-hidden="true">#</span> {page.section} · {minutes} min read
                    {page.authored && page.published !== undefined ? ` · ${page.published}` : ""}
                  </p>
                  <p className="lede docs-hero-lede">{page.description}</p>
                </div>
              </header>
              <div className="prose docs-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />

              {(previous !== undefined || next !== undefined) && (
                <nav className="docs-pager" aria-label="More in this section">
                  {previous !== undefined ? (
                    <Link href={`/docs/${previous.slug}`} className="docs-pager-link" rel="prev">
                      <small>Previous</small>
                      <strong>{previous.title}</strong>
                    </Link>
                  ) : (
                    <span />
                  )}
                  {next !== undefined && (
                    <Link href={`/docs/${next.slug}`} className="docs-pager-link docs-pager-next" rel="next">
                      <small>Next</small>
                      <strong>{next.title}</strong>
                    </Link>
                  )}
                </nav>
              )}

              {related.length > 0 && (
                <aside className="docs-related">
                  <h2>See also</h2>
                  <ul>
                    {related.map((item) => (
                      <li key={item.slug}>
                        <Link href={`/docs/${item.slug}`}>
                          <strong>{item.title}</strong>
                          <span>{item.description}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </aside>
              )}
            </main>
          </div>
        </div>
      </section>
    </>
  );
}
