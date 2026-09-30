import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import { COMPARE_PREFIX, comparisons, landingPath } from "@/lib/landings";
import { breadcrumbs } from "@/lib/schema";
import { pageMetadata } from "@/lib/seo";
import { SITE, url } from "@/lib/site";

export const metadata: Metadata = pageMetadata({
  path: COMPARE_PREFIX,
  title: { absolute: `${SITE.name} vs Cursor, Copilot, Windsurf and VS Code compared` },
  socialTitle: `${SITE.name} comparisons`,
  description:
    "Straight comparisons of ADCode with Cursor, GitHub Copilot, Windsurf, VS Code and Idlen - including the cases where the other one is the better choice.",
});

/** The first sentence of the concession: the short answer to "when should I pick them". */
const firstSentence = (text: string): string => text.split(/(?<=[.!?])\s+/)[0] ?? text;

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
        An ItemList, so the set is stated rather than inferred from the links. It is what
        lets a result for "ADCode alternatives" carry the names as sitelinks instead
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
                Comparisons against the editors and assistants people genuinely weigh{" "}
                {SITE.name} against. Each one ends with the case for choosing the other,
                because a comparison that never concedes anything is one you should not
                trust.
              </p>
            </header>

            {/*
              The short answer to every page below, on one screen. Built from each page's
              own concession rather than written again here, so the summary cannot claim
              something its page does not.
            */}
            <section className="landing-compare" aria-labelledby="compare-glance">
              <h2 id="compare-glance">At a glance</h2>
              <div className="table-scroll">
                <table className="landing-table">
                  <thead>
                    <tr>
                      <th scope="col">Instead of {SITE.name}</th>
                      <th scope="col">Pick it when</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.map((page) => (
                      <tr key={page.slug}>
                        <th scope="row">
                          <Link href={landingPath(page)}>{page.comparison?.subject}</Link>
                        </th>
                        <td>{firstSentence(page.comparison?.whenNotUs ?? "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

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
