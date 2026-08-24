import Link from "next/link";
import type { Metadata } from "next";
import { docsBySection } from "@/lib/docs";
import { JsonLd } from "@/components/JsonLd";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Every feature in ADCode, explained in plain language: what it does, when you would want it, and how to use it. The same explanations the editor shows behind each question mark.",
  alternates: { canonical: url("/docs") },
  openGraph: { title: "ADCode Documentation", url: url("/docs"), type: "website" },
};

/**
 * The documentation index.
 *
 * Every page listed on one screen, grouped, rather than a landing page that makes you
 * click twice to find out what exists. A reference is judged by how fast it answers a
 * question, and a table of contents you can search with Ctrl+F is hard to beat for that.
 */
export default async function DocsIndex() {
  const sections = await docsBySection();
  const total = sections.reduce((count, section) => count + section.pages.length, 0);

  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Documentation", path: "/docs" },
        ])}
      />

      <section className="docs-page band">
        <div className="wrap docs-layout">
          <DocsSidebar />
          <main className="docs-content">
            <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Documentation" }]} />

            <header className="docs-header">
              <h1>Every feature, explained</h1>
              <p className="lede">
                {total} pages covering what ADCode does — the same explanations the editor
                shows behind each <strong>?</strong>, written so they make sense before you
                have installed anything.
              </p>
            </header>

            <div style={{ display: "grid", gap: 36 }}>
              {sections.map((section) => (
                <section key={section.title} className="rise">
                  <h2
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--faint)",
                      marginBottom: 14,
                    }}
                  >
                    {section.title}
                  </h2>

                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                    {section.pages.map((page) => (
                      <li key={page.slug}>
                        <Link
                          href={`/docs/${page.slug}`}
                          style={{
                            display: "grid",
                            gap: 3,
                            padding: "10px 12px",
                            margin: "0 -12px",
                            borderRadius: "var(--radius-sm)",
                          }}
                          className="docs-index-link"
                        >
                          <span style={{ fontWeight: 600 }}>{page.title}</span>
                          <span style={{ color: "var(--muted)", fontSize: 14 }}>
                            {page.description}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </main>
        </div>
      </section>
    </>
  );
}
