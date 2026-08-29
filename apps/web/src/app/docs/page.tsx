import Link from "next/link";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSidebar } from "@/components/DocsSidebar";
import { JsonLd } from "@/components/JsonLd";
import { docsBySection } from "@/lib/docs";
import { breadcrumbs } from "@/lib/schema";
import { url } from "@/lib/site";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Every ADCode feature explained in plain language: what it does, why you would use it, and how to start.",
  alternates: { canonical: url("/docs") },
  openGraph: { title: "ADCode Documentation", url: url("/docs"), type: "website" },
};

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
                {total} pages covering what ADCode does—the same explanations available
                behind each <strong>?</strong> in the editor, with steps for getting started.
              </p>
              <p className="docs-launch-note">
                <span>Start the complete editor from a terminal</span>
                <code>adcode open .</code>
              </p>
            </header>

            <div style={{ display: "grid", gap: 36 }}>
              {sections.map((section) => (
                <section key={section.title} className="rise">
                  <h2
                    style={{
                      color: "var(--faint)",
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      marginBottom: 14,
                      textTransform: "uppercase",
                    }}
                  >
                    {section.title}
                  </h2>
                  <ul style={{ display: "grid", gap: 2, listStyle: "none", margin: 0, padding: 0 }}>
                    {section.pages.map((page) => (
                      <li key={page.slug}>
                        <Link
                          href={`/docs/${page.slug}`}
                          className="docs-index-link"
                          style={{
                            borderRadius: "var(--radius-sm)",
                            display: "grid",
                            gap: 3,
                            margin: "0 -12px",
                            padding: "10px 12px",
                          }}
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
