import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { JsonLd } from "@/components/JsonLd";
import {
  type Landing,
  COMPARE_PREFIX,
  isComparison,
  landingPath,
  relatedLandings,
} from "@/lib/landings";
import { breadcrumbs, faqPage, landingArticle } from "@/lib/schema";
import { SITE } from "@/lib/site";

/**
 * One renderer for every landing page.
 *
 * The pages differ in what they say and not in how they are shaped, so a shared renderer
 * is what keeps the schema, the breadcrumbs, and the internal linking identical across
 * them. The alternative - a page file each - is how one page quietly ends up without its
 * FAQ markup while its questions are still on screen, which Google treats as a structured
 * data violation rather than an omission.
 *
 * Every question in `page.faq` is rendered *and* emitted as `FAQPage`. Neither happens
 * without the other, for the same reason `HomeFaq` and `faqPage()` read one array.
 */
export function LandingArticle({ page }: { page: Landing }) {
  const related = relatedLandings(page);
  const path = landingPath(page);
  const comparison = page.comparison;

  const trail = isComparison(page)
    ? [
        { name: "Home", path: "/" },
        { name: "Comparisons", path: COMPARE_PREFIX },
        { name: page.heading, path },
      ]
    : [
        { name: "Home", path: "/" },
        { name: page.heading, path },
      ];

  return (
    <>
      <JsonLd data={landingArticle(page)} />
      <JsonLd data={breadcrumbs(trail)} />
      <JsonLd data={faqPage(page.faq)} />

      <section className="docs-page band">
        <div className="wrap landing-wrap">
          <article className="landing">
            <Breadcrumbs
              items={trail.map((step, index) =>
                index === trail.length - 1
                  ? { name: step.name }
                  : { name: step.name, href: step.path },
              )}
            />

            <header className="docs-header">
              <h1>{page.heading}</h1>
              <p className="lede">{page.lede}</p>
            </header>

            <div className="prose">
              {page.sections.map((section) => (
                <section key={section.heading}>
                  <h2>{section.heading}</h2>
                  {section.body.map((paragraph) => (
                    <p key={paragraph.slice(0, 48)}>{paragraph}</p>
                  ))}
                  {section.points !== undefined && (
                    <ul>
                      {section.points.map((point) => (
                        <li key={point.slice(0, 48)}>{point}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            {comparison !== undefined && (
              <section className="landing-compare">
                <h2>{SITE.name} compared with {comparison.subject}</h2>
                {/*
                  A real table, not a grid of divs. The row header is the aspect being
                  compared, which is what lets a screen reader say "Price, Cursor, a monthly
                  subscription" instead of reading nine unlabelled cells - and it is also
                  what a search engine needs to lift a single row as an answer.
                */}
                <div className="table-scroll">
                  <table className="landing-table">
                    <caption className="sr-only">
                      A feature-by-feature comparison of {comparison.subject} and {SITE.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">&nbsp;</th>
                        <th scope="col">{comparison.subject}</th>
                        <th scope="col">{SITE.name}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.rows.map((row) => (
                        <tr key={row.aspect}>
                          <th scope="row">{row.aspect}</th>
                          <td>{row.them}</td>
                          <td>{row.us}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/*
                  The case against us, given its own heading rather than buried.
                  A comparison page that never concedes anything is one a reader discounts
                  entirely - and an answer engine that has learned which pages are sales
                  copy stops quoting them. This is the paragraph that makes the rest
                  credible, so it is not decoration and it is not optional.
                */}
                <aside className="landing-honest">
                  <h3>When to choose {comparison.subject} instead</h3>
                  <p>{comparison.whenNotUs}</p>
                </aside>
              </section>
            )}

            <section className="landing-faq">
              <h2>Common questions</h2>
              <dl>
                {page.faq.map((item) => (
                  <div key={item.q}>
                    <dt>{item.q}</dt>
                    <dd>{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="landing-cta">
              <h2>Try it</h2>
              <p>
                {SITE.name} installs with one command on Windows, macOS, and Linux, and
                updates itself from then on.
              </p>
              <div className="landing-cta-actions">
                <Link className="btn btn-primary" href="/versions">
                  Download {SITE.name}
                </Link>
                <Link className="btn btn-outline" href="/docs">
                  Read the documentation
                </Link>
              </div>
            </section>

            {related.length > 0 && (
              <aside className="docs-related">
                <h2>See also</h2>
                <ul>
                  {related.map((item) => (
                    <li key={item.slug}>
                      <Link href={landingPath(item)}>{item.heading}</Link>
                      <span>{item.description}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </article>
        </div>
      </section>
    </>
  );
}
