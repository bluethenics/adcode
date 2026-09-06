import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsSearch } from "@/components/DocsSearch";
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

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/*
 * `?q=` is read on the server and handed to the search field as its initial query.
 *
 * The client-side filter already existed; what this adds is that the *URL* performs the
 * search. That is the difference between a search box and a searchable site: a query can
 * be linked to, shared, and reopened, and - the reason it is here - `webSite()` can
 * declare a `SearchAction` pointing at this template without the claim being false. Google
 * checks that the URL a SearchAction constructs really returns filtered results, and a
 * page that only filters after hydration does not pass.
 *
 * The cost, stated because it is real: reading `searchParams` opts this one route out of
 * static rendering. It is not free and it is not much - the upstream `/v1/posts` fetch is
 * still revalidate-cached, so what a request pays for is a React render of an index page,
 * and the ~100 `/docs/<slug>` pages that make up the crawlable bulk are untouched.
 * `metadata.alternates.canonical` stays pinned to `/docs` so the parameterised URLs
 * consolidate onto one address rather than becoming a hundred thin near-duplicates.
 */
const firstParam = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

export default async function DocsIndex({ searchParams }: Props) {
  const query = firstParam((await searchParams)["q"]).slice(0, 120);
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

            <DocsSearch
              initialQuery={query}
              sections={sections.map((section) => ({
                title: section.title,
                pages: section.pages.map(({ slug, title, description }) => ({
                  slug,
                  title,
                  description,
                })),
              }))}
            />
          </main>
        </div>
      </section>
    </>
  );
}
