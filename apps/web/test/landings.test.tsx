import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LandingArticle } from "../src/components/LandingArticle";
import { Footer } from "../src/components/Footer";
import {
  LANDINGS,
  comparisons,
  getLanding,
  guides,
  landingIndex,
  landingMetadata,
  landingPath,
  landingPlainText,
  relatedLandings,
} from "../src/lib/landings";
import { landingArticle } from "../src/lib/schema";
import { url } from "../src/lib/site";

/**
 * These pages exist to be arrived at from a search result, which makes their failure mode
 * quiet: a page with a broken internal link, a missing canonical, or FAQ markup that does
 * not match the visible text does not look broken to anybody browsing the site. It just
 * never ranks, or - in the FAQ case - earns a structured data penalty.
 */
describe("landing pages", () => {
  it("gives every page a unique path", () => {
    const paths = LANDINGS.map(landingPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("puts comparisons under /compare and guides at the root", () => {
    for (const page of comparisons()) expect(landingPath(page)).toBe(`/compare/${page.slug}`);
    for (const page of guides()) expect(landingPath(page)).toBe(`/${page.slug}`);
  });

  it("resolves every related slug, so no internal link dangles", () => {
    for (const page of LANDINGS) {
      // A dangling slug is dropped rather than thrown, so only a test catches the typo.
      expect(relatedLandings(page).length, page.slug).toBe(page.related.length);
      expect(page.related, page.slug).not.toContain(page.slug);
    }
  });

  it("writes a title that fits a search result and a description that fits a snippet", () => {
    for (const page of LANDINGS) {
      expect(page.title.length, `${page.slug} title`).toBeLessThanOrEqual(70);
      expect(page.description.length, `${page.slug} description`).toBeGreaterThan(70);
      expect(page.description.length, `${page.slug} description`).toBeLessThanOrEqual(200);
    }
  });

  it("canonicalises each page to its own URL and never to the homepage", () => {
    for (const page of LANDINGS) {
      const meta = landingMetadata(page);
      expect(meta.alternates?.canonical, page.slug).toBe(url(landingPath(page)));
      // The layout template appends " - ADCode"; these titles are already full sentences.
      expect(meta.title, page.slug).toEqual({ absolute: page.title });
    }
  });

  /*
   * The rule `HomeFaq` and `faqPage()` already follow, applied to the new pages. Google
   * treats FAQPage data whose questions are not visible on the page as a structured data
   * violation rather than as extra credit, so the renderer must print every question it
   * marks up. Rendering the real component is the only way to assert that.
   */
  it("renders every question it marks up as FAQPage", () => {
    for (const page of LANDINGS) {
      const markup = renderToStaticMarkup(<LandingArticle page={page} />);
      for (const item of page.faq) {
        expect(markup, `${page.slug}: ${item.q}`).toContain(item.q);
        expect(markup, `${page.slug}: answer to ${item.q}`).toContain(item.a.slice(0, 60));
      }
      expect(markup).toContain('"@type":"FAQPage"');
    }
  });

  it("prints the case for the competitor on every comparison", () => {
    for (const page of comparisons()) {
      const comparison = page.comparison;
      expect(comparison, page.slug).toBeDefined();
      if (comparison === undefined) continue;

      // Not a nicety. A comparison page that only flatters the product is one readers
      // discount and answer engines learn to stop quoting.
      expect(comparison.whenNotUs.length, page.slug).toBeGreaterThan(120);

      const markup = renderToStaticMarkup(<LandingArticle page={page} />);
      expect(markup, page.slug).toContain(comparison.whenNotUs.slice(0, 60));
      expect(markup, page.slug).toContain(`When to choose ${comparison.subject} instead`);
    }
  });

  it("names both products as entities on a comparison", () => {
    for (const page of comparisons()) {
      const graph = landingArticle(page) as { "@graph": Record<string, unknown>[] };
      const article = graph["@graph"][0];
      expect(article, page.slug).toBeDefined();
      const about = article?.["about"] as Record<string, unknown>[];

      expect(about[0], page.slug).toEqual({ "@id": url("/#app") });
      expect(about[1]?.["name"], page.slug).toBe(page.comparison?.subject);
    }
  });

  it("dates every page, so a comparison cannot look undated", () => {
    for (const page of LANDINGS) {
      expect(page.updated, page.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(page.updated)), page.slug).toBe(false);
    }
  });

  it("flattens to plain text carrying the comparison and the concession", () => {
    for (const page of comparisons()) {
      const text = landingPlainText(page);
      expect(text, page.slug).toContain(page.heading);
      expect(text, page.slug).toContain("When not to choose");
      for (const row of page.comparison?.rows ?? []) {
        expect(text, `${page.slug}: ${row.aspect}`).toContain(row.aspect);
      }
    }
  });

  it("indexes every page for llms.txt with a real path", () => {
    const index = landingIndex();
    expect(index.length).toBe(LANDINGS.length);
    for (const entry of index) {
      expect(entry.path.startsWith("/"), entry.path).toBe(true);
      expect(getLanding(entry.path.split("/").pop() ?? ""), entry.path).not.toBeNull();
    }
  });

  /*
   * The footer is the only route into these pages from anywhere on the site. A sitemap
   * says a URL exists; an internal link is the site saying it matters, and a page nothing
   * links to is recrawled rarely no matter what the sitemap claims.
   */
  it("links every landing page from the footer", () => {
    const markup = renderToStaticMarkup(<Footer />);
    for (const page of LANDINGS) {
      expect(markup, page.slug).toContain(`href="${landingPath(page)}"`);
    }
    expect(markup).toContain("/compare");
    expect(markup).toContain("https://bluethenics.com/");
  });
});
