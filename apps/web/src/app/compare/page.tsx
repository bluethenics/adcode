import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { COMPARE_PREFIX, comparisons, landingPath } from "@/lib/landings";
import { breadcrumbs } from "@/lib/schema";
import { SITE, url } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${SITE.name} compared with VS Code, Cursor, and Idlen` },
  description:
    "Straight comparisons of ADCode against the editors people actually weigh it against, including the cases where the other one is the better choice.",
  alternates: { canonical: url(COMPARE_PREFIX) },
  openGraph: {
    type: "website",
    title: `${SITE.name} comparisons`,
    url: url(COMPARE_PREFIX),
  },
};

export default function CompareIndex() {
  const pages = comparisons();

  return (
    <>
      <JsonLd
        data={breadcrumbs([
          { name: "Home", path: "/" },
          { name: "Comparisons", path: COMPARE_PREFIX },
        ])}
      />
      {/*
        An ItemList, so the set is stated rather than inferred from three links. It is what
        lets a result for "ADCode alternatives" carry the three names as sitelinks instead
        of a single blue link to a page whose contents a crawler has to guess at.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${SITE.name} comparisons`,
          itemListElement: pages.map((page, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: page.heading,
            url: url(landingPath(page)),
          })),
        }}
      />

      <section className="docs-page band">
        <div className="wrap landing-wrap">
          <article className="landing">
            <Breadcrumbs items={[{ name: "Home", href: "/" }, { name: "Comparisons" }]} />

            <header className="docs-header">
              <h1>How {SITE.name} compares</h1>
              <p className="lede">
                Three comparisons against the editors people genuinely weigh {SITE.name}{" "}
                against. Each one ends with the case for choosing the other, because a
                comparison that never concedes anything is one you should not trust.
              </p>
            </header>

            <div className="landing-index">
              {pages.map((page) => (
                <Link key={page.slug} href={landingPath(page)} className="landing-index-card">
                  <h2>{page.heading}</h2>
                  <p>{page.description}</p>
                  <span aria-hidden="true">Read the comparison →</span>
                </Link>
              ))}
            </div>

            <section className="landing-cta">
              <h2>Or just try it</h2>
              <p>
                {SITE.name} is free, installs with one command, and can sit alongside
                whatever you use now.
              </p>
              <div className="landing-cta-actions">
                <Link className="btn btn-primary" href="/versions">
                  Download {SITE.name}
                </Link>
                <Link className="btn btn-outline" href="/free-ai-code-editor">
                  What you get, in full
                </Link>
              </div>
            </section>
          </article>
        </div>
      </section>
    </>
  );
}
