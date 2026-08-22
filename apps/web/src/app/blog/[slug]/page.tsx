import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { allPosts, getPost } from "@/lib/posts";
import { renderMarkdown } from "@/lib/markdown";
import { JsonLd } from "@/components/JsonLd";
import { blogPosting, breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";
import { DocsSidebar } from "@/components/DocsSidebar";

interface Props {
  params: Promise<{ slug: string }>;
}

/** Every post is known at build time, so each one is a static file. */
export function generateStaticParams(): { slug: string }[] {
  return allPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (post === null) return { title: "Not found" };

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: url(`/blog/${post.slug}`) },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: url(`/blog/${post.slug}`),
      publishedTime: post.published,
      ...(post.updated === undefined ? {} : { modifiedTime: post.updated }),
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.description },
  };
}

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPost(slug);
  if (post === null) notFound();

  const html = renderMarkdown(post.body);

  return (
    <>
      <JsonLd data={blogPosting(post)} />
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />

      <article className="docs-page band">
        <div className="wrap docs-layout">
          <DocsSidebar />
          <main className="docs-content"><Link href="/blog" className="docs-back">
            ← All posts
          </Link>

          <header className="docs-header" style={{ marginTop: 22 }}>
            <div className="mono" style={{ fontSize: 12, color: "var(--faint)", marginBottom: 12 }}>
              <time dateTime={post.published}>{dateLabel(post.published)}</time> ·{" "}
              {post.readingMinutes} min read
            </div>
            <h1 style={{ fontSize: "clamp(30px, 4.4vw, 48px)" }}>{post.title}</h1>
            <p className="lede" style={{ marginTop: 16 }}>
              {post.description}
            </p>
          </header>

          {/* Rendered by `markdown.ts`, which escapes before it marks up. */}
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} /></main>
        </div>
      </article>
    </>
  );
}
