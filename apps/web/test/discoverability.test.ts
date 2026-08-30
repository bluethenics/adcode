import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allDocs, docsBySection } from "../src/lib/docs";
import { allPosts } from "../src/lib/posts";
import { FAQ, faqPage } from "../src/lib/schema";
import { DOC_SECTIONS } from "../src/lib/docsSeed";

/*
 * No network.
 *
 * These read `allPosts`, which asks the live posts API first and falls back to the writing
 * bundled with the build. Left unstubbed the suite reaches the production worker: slow,
 * flaky under a parallel run, and a test whose result depends on what an admin published
 * this morning. Refusing the fetch exercises the fallback, which is also the path that has
 * to be right - the bundled articles must be reachable whatever the API is doing.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline in tests")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * The site restructure collapsed /blog, /changelog, /download and /advertise into the
 * single-page home and left them as redirect stubs. Three machine-readable files went on
 * advertising the old URLs, so every article an answer engine or an RSS reader followed
 * landed on the homepage instead of the writing it was promised.
 */
describe("nothing advertises a route that redirects", () => {
  const RETIRED = ["/blog/", "/changelog"];

  it("keeps every written article reachable at a URL that resolves", async () => {
    const posts = await allPosts();
    const docs = await allDocs();
    const slugs = new Set(docs.map((page) => page.slug));

    expect(posts.length).toBeGreaterThan(0);
    expect(posts.filter((post) => !slugs.has(post.slug)).map((post) => post.slug)).toEqual([]);
  });

  it("files the long-form writing ahead of the generated reference", async () => {
    const sections = (await docsBySection()).map((section) => section.title);

    // Authored narrative first: it is what somebody arriving from a search result wants,
    // and burying it under fifty generated feature pages is how good writing goes unread.
    expect(sections[0]).toBe("Start here");
    expect(sections).toContain("How ADCode works");
    expect(sections).toContain("Earning and advertising");
    expect(DOC_SECTIONS.indexOf("Start here")).toBeLessThan(DOC_SECTIONS.indexOf("Editing"));
  });

  it("names no retired route in the seeded documentation", () => {
    const offenders: string[] = [];
    for (const section of DOC_SECTIONS) {
      for (const retired of RETIRED) {
        if (section.includes(retired)) offenders.push(section);
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("FAQ structured data", () => {
  it("describes the questions the site actually answers", () => {
    const node = faqPage(FAQ) as {
      "@type": string;
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };

    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity.length).toBe(FAQ.length);
    expect(node.mainEntity[0]?.name).toBe(FAQ[0]?.q);
    expect(node.mainEntity[0]?.acceptedAnswer.text).toBe(FAQ[0]?.a);
  });

  /*
   * Google treats FAQPage data whose questions are not on the page as a structured-data
   * violation, so the schema and the visible section have to carry the same text. Rendering
   * the section from the same constant the schema uses is what makes them impossible to
   * disagree; this is the test that keeps it that way.
   */
  it("prints on the page every question the schema claims", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { HomeFaq } = await import("../src/components/HomeFaq");
    const markup = renderToStaticMarkup(HomeFaq());

    for (const item of FAQ) {
      expect(markup, item.q).toContain(item.q);
    }
  });
});
