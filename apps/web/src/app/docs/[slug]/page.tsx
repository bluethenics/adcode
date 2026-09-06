import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { JsonLd } from "@/components/JsonLd";
import { ReadingProgress } from "@/components/ReadingProgress";
import { allDocs, getDoc, relatedPages } from "@/lib/docs";
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
      </section>
    </>
  );
}
