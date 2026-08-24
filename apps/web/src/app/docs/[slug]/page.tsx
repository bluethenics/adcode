import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allDocs, getDoc, relatedPages } from "@/lib/docs";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { ReadingProgress } from "@/components/ReadingProgress";import { breadcrumbs, techArticle } from "@/lib/schema";
import { url } from "@/lib/site";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Every page is known at build time, so each one is a static file. */
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

/**
 * One documentation page.
 *
 * The body is Markdown either way - a generated page is assembled from the help text into
 * the same three sections, so a page an admin has rewritten and one nobody has touched
 * read the same. Nothing on the page says which it is; a reader looking up how formatting
 * works does not care who typed it.
 *
 * The trail above the title - Home / Documentation / Section / This page - and the
 * unfolded section in the sidebar answer "where am I" before the reader has to.
 */
export default async function DocPage({ params }: Props) {
  const { slug } = await params;
  const page = await getDoc(slug);
  if (page === null) notFound();

  const related = await relatedPages(page);

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

      <section className="docs-page band">
        <div className="wrap docs-layout">
          <DocsSidebar currentDoc={page.slug} />
          <main className="docs-content">
            <Breadcrumbs
              items={[
                { name: "Home", href: "/" },
                { name: "Documentation", href: "/docs" },
                { name: page.section },
                { name: page.title },
              ]}
            />

            <header className="docs-header">
              <h1 style={{ fontSize: "clamp(30px, 4.2vw, 46px)" }}>{page.title}</h1>
              <p className="lede">{page.description}</p>
            </header>

            <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />

            {related.length > 0 && (
              <aside
                style={{
                  marginTop: 44,
                  paddingTop: 24,
                  borderTop: "1px solid var(--hairline)",
                }}
              >
                <h2
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--faint)",
                    marginBottom: 12,
                  }}
                >
                  See also
                </h2>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
                  {related.map((one) => (
                    <li key={one.slug}>
                      <Link href={`/docs/${one.slug}`} style={{ fontWeight: 600 }}>
                        {one.title}
                      </Link>
                      <span style={{ color: "var(--muted)" }}> — {one.description}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </main>
        </div>
      </section>
    </>
  );
}
