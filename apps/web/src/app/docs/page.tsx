import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DocsFrameTopbar } from "@/components/DocsFrameTopbar";
import { DocsSearch } from "@/components/DocsSearch";
import { DocsSidebar } from "@/components/DocsSidebar";
import { JsonLd } from "@/components/JsonLd";
import { docsBySection, recentDocs } from "@/lib/docs";
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

/*
 * "Sep 16, 2026". Pinned to UTC so the shelf reads the same on every server and every
 * reader - the stored value is a bare ISO day with no zone to interpret.
 */
const formatDay = (isoDay: string): string =>
  new Date(`${isoDay}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default async function DocsIndex({ searchParams }: Props) {
  const query = firstParam((await searchParams)["q"]).slice(0, 120);
  const sections = await docsBySection();
  const total = sections.reduce((count, section) => count + section.pages.length, 0);

  /*
   * The shelf of newest writing, ahead of the reference. It is a first-class search
   * section rather than a separate block so it filters, counts, and clears with
   * everything else - a second list with its own rules would drift from the first.
   */
  const fresh = await recentDocs(4);
  const shelf =
    fresh.length === 0
      ? []
      : [
          {
            title: "New in the docs",
            pages: fresh.map((page) => ({
              slug: page.slug,
              title: page.title,
              description: page.description,
              meta: formatDay(page.published),
            })),
          },
        ];

  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Documentation", path: "/docs" },
        ])}
      />
      <section className="docs-stage">
        <div className="docs-frame docs-frame-in">
          <DocsFrameTopbar searchOnPage />
          <div className="docs-frame-body">
            <DocsSidebar />
            <main className="docs-main">
              <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Documentation" }]} />
              <header className="docs-hero">
                <div className="docs-hero-art" aria-hidden="true">
                  <i className="docs-blob docs-blob-a" />
                  <i className="docs-blob docs-blob-b" />
                  <i className="docs-blob docs-blob-c" />
                  <i className="docs-hero-sheen" />
                </div>
                <div className="docs-hero-copy">
                  <p className="docs-hero-eyebrow">ADCode Docs · {total} pages</p>
                  <h1>
                    Every feature,
                    <br />
                    explained
                  </h1>
                  <p className="docs-hero-version mono">
                    <span aria-hidden="true">#</span> Same source as the editor&rsquo;s <strong>?</strong> help
                  </p>
                  <p className="lede docs-hero-lede">
                    What ADCode does, why you would use it, and how to start — in plain
                    language, with steps for getting going.
                  </p>
                  <p className="docs-launch-note">
                    <span>Already installed? Open your project</span>
                    <code>adcode open .</code>
                  </p>
                  <div className="docs-start-actions">
                    <Link className="btn btn-primary" href="/versions">Install ADCode <span aria-hidden="true">↓</span></Link>
                    <Link href="/docs/installing-adcode">Read the installation guide <span aria-hidden="true">→</span></Link>
                  </div>
                </div>
              </header>

              {!query.trim() && <nav className="docs-quickstart" aria-label="Getting started">
                <Link href="/docs/getting-started-with-adcode"><span>01</span><strong>Open your first project</strong><small>Get familiar with the editor.</small></Link>
                <Link href="/docs/ai-connect"><span>02</span><strong>Connect your AI provider</strong><small>Set up your key and choose a model.</small></Link>
                <Link href="/docs/first-commit-name-and-email"><span>03</span><strong>Make your first commit</strong><small>Set your Git name and email.</small></Link>
              </nav>}

              <DocsSearch
                initialQuery={query}
                sections={[
                  ...shelf,
                  ...sections.map((section) => ({
                    title: section.title,
                    pages: section.pages.map(({ slug, title, description }) => ({
                      slug,
                      title,
                      description,
                    })),
                  })),
                ]}
              />
            </main>
          </div>
        </div>
      </section>
    </>
  );
}
