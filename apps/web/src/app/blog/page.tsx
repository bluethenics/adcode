import Link from "next/link";
import type { Metadata } from "next";
import { allPosts } from "@/lib/posts";
import { JsonLd } from "@/components/JsonLd";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";
import { DocsSidebar } from "@/components/DocsSidebar";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "How ADCode works, written out: the append-only ledger, what an ad-supported editor owes you, and how targeting reaches Rust developers without reading Rust.",
  alternates: { canonical: url("/blog") },
  openGraph: { title: "ADCode Blog", url: url("/blog"), type: "website" },
};

const dateLabel = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export default function BlogIndex() {
  const posts = allPosts();

  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
        ])}
      />

      <section className="docs-page band">
        <div className="wrap docs-layout">
          <DocsSidebar />
          <main className="docs-content"><div className="docs-header">
            <p className="eyebrow">Blog</p>
            <h1>Documentation &amp; notes</h1>
            <p className="lede">
              Fewer announcements, more explanations. Mostly about money, targeting, and the
              parts of an ad-supported editor that deserve to be argued with.
            </p>
          </div>

          <ul className="docs-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {posts.map((post) => (
              <li key={post.slug} style={{ borderBottom: "1px solid var(--hairline)" }}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="docs-list-link"
                >
                  <div
                    className="mono"
                    style={{ fontSize: 12, color: "var(--faint)", marginBottom: 8 }}
                  >
                    {dateLabel(post.published)} · {post.readingMinutes} min read
                  </div>
                  <h3 style={{ fontSize: "clamp(20px, 2.2vw, 26px)", marginBottom: 8 }}>
                    {post.title}
                  </h3>
                  <p style={{ color: "var(--muted)", fontSize: 16, maxWidth: "68ch" }}>
                    {post.description}
                  </p>
                </Link>
              </li>
            ))}
          </ul></main>
        </div>
      </section>
    </>
  );
}
