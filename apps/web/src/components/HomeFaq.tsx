import { FAQ } from "@/lib/schema";

/**
 * The questions people actually type, answered on the page.
 *
 * The answers already existed - `FAQ` in `lib/schema.ts` has been feeding `/llms.txt` for
 * as long as that file has existed - but no page printed them and no page emitted the
 * `FAQPage` structured data that goes with them. So the site could answer "how much does
 * ADCode cost" to an assistant reading a text file and not to a search engine reading the
 * homepage.
 *
 * Rendered from the same constant `faqPage()` serialises, deliberately. Google treats
 * FAQPage data whose questions are not visible on the page as a structured-data violation,
 * and the usual way sites earn one is by letting a hand-written section drift away from a
 * hand-written schema. Two consumers of one array cannot drift.
 *
 * `<details>` rather than a scripted accordion: it is open to a crawler, keyboard-operable
 * for free, and needs no JavaScript on a page that otherwise ships very little.
 */
export function HomeFaq() {
  return (
    <section className="marketplace-faq" id="faq" aria-labelledby="faq-heading">
      <div className="marketplace-wrap">
        <header className="marketplace-faq-intro">
          <p className="marketplace-eyebrow">
            <span /> Questions
          </p>
          <h2 id="faq-heading">
            The things
            <br />
            people ask first.
          </h2>
        </header>

        <div className="marketplace-faq-list">
          {FAQ.map((item, index) => (
            <details key={item.q} name="marketplace-faq" open={index === 0}>
              <summary>
                <h3>{item.q}</h3>
                <span aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
