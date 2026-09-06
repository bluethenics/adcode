import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sitemap from "../src/app/sitemap";
import robots from "../src/app/robots";
import { organisation, softwareApplication, webSite } from "../src/lib/schema";
import { SITE_ORIGIN, url } from "../src/lib/site";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline in tests")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/*
 * Structured data is how a search engine answers *with* this site rather than linking to
 * it, and how an answer engine quotes it without guessing. These assert the properties
 * that actually unlock something - a knowledge panel needs a logo, a sitelinks searchbox
 * needs a SearchAction - rather than that the objects merely exist.
 */
describe("structured data", () => {
  it("gives the organisation a logo and the profiles that confirm it", () => {
    const node = organisation() as Record<string, unknown>;

    expect(node["@type"]).toBe("Organization");
    expect(node["logo"]).toBe(url("/icon.svg"));
    expect(node["sameAs"]).toContain("https://github.com/bluethenics/adcode");
  });

  /*
   * `adcode.bluethenics.com` is a subdomain, and a search engine treats a hostname as its
   * own entity unless something says otherwise. Unexplained, the brand looks like a
   * subdomain of a company that never mentions it: the parent's authority does not carry
   * and the child has none. The matching `subOrganization` lives in `bluethenics-web`, and
   * `scripts/seo-audit.mjs` is what checks both ends are actually deployed.
   */
  it("names the studio that publishes it, so the subdomain is not an orphan", () => {
    const node = organisation() as Record<string, unknown>;
    const parent = node["parentOrganization"] as Record<string, unknown>;

    expect(parent["name"]).toBe("Bluethenics");
    expect(parent["@id"]).toBe("https://bluethenics.com/#organization");
    expect(node["sameAs"]).toContain("https://bluethenics.com/");
  });

  it("claims the spellings people actually type", () => {
    // "ADCode" is one word to us and two to everybody else, and it collides with "ad code"
    // in the advertising sense - an older, far better-linked meaning of those characters.
    expect(organisation()["alternateName"]).toContain("AdCode");
  });

  it("describes the app as something installable, with a version and a way to get it", () => {
    const node = softwareApplication() as Record<string, unknown>;

    expect(node["softwareVersion"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(node["downloadUrl"]).toBe(url("/versions"));
    expect(node["screenshot"]).toBe(url("/opengraph-image.png"));
    // A free product has to say so as data, or the price sits only in prose.
    expect(node["offers"]).toMatchObject({ price: "0", priceCurrency: "USD" });
  });

  it("claims no rating it has not earned", () => {
    const node = softwareApplication() as Record<string, unknown>;

    // Inventing aggregateRating is the single most common way a software page earns a
    // manual action. There is no review corpus, so there is no rating.
    expect(node["aggregateRating"]).toBeUndefined();
    expect(node["review"]).toBeUndefined();
  });

  it("names the site as an entity and ties it to its publisher", () => {
    const node = webSite() as Record<string, unknown>;

    expect(node["@type"]).toBe("WebSite");
    expect(node["name"]).toBe("ADCode");
    expect(node["publisher"]).toEqual({ "@id": url("/#organization") });
  });

  /*
   * This test used to assert the opposite, and the comment under it said "if site search
   * is ever built, this is the test that says to add it". It was built - `DocsSearch` on
   * `/docs` - and `/docs?q=` is now read on the server, so the URL this template
   * constructs really does return filtered results rather than an unfiltered page that
   * filters itself after hydration. That is the condition the claim has to meet.
   */
  it("declares a searchbox that points at a URL which really searches", () => {
    const action = (webSite() as Record<string, unknown>)["potentialAction"] as Record<
      string,
      unknown
    >;

    expect(action["@type"]).toBe("SearchAction");
    expect((action["target"] as Record<string, unknown>)["urlTemplate"]).toBe(
      `${url("/docs")}?q={search_term_string}`,
    );
    expect(action["query-input"]).toBe("required name=search_term_string");
  });
});

describe("crawling", () => {
  it("lists every public page and nothing that redirects or is private", async () => {
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    for (const wanted of [
      "/",
      "/docs",
      "/versions",
      "/privacy",
      "/terms",
      // The pages written to be entry points. Missing here means the only route in is the
      // footer, which is exactly the state the landing work was meant to leave behind.
      "/free-ai-code-editor",
      "/earn-while-you-code",
      "/compare",
      "/compare/vscode",
      "/compare/cursor",
      "/compare/idlen",
    ]) {
      expect(paths, wanted).toContain(wanted);
    }

    // The redirect stubs left by the single-page restructure, and the signed-in areas.
    for (const banned of ["/blog", "/changelog", "/download", "/advertise", "/portal", "/admin"]) {
      expect(paths, banned).not.toContain(banned);
    }
  });

  it("carries every documentation page, including the authored articles", async () => {
    const paths = (await sitemap()).map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain("/docs/why-the-ledger-is-append-only");
    expect(paths).toContain("/docs/getting-started-with-adcode");
    expect(paths.filter((path) => path.startsWith("/docs/")).length).toBeGreaterThan(50);
  });

  it("dates every entry, so a crawler can tell what moved", async () => {
    for (const entry of await sitemap()) {
      expect(entry.lastModified, entry.url).toBeInstanceOf(Date);
      expect(Number.isNaN(Number(entry.lastModified)), entry.url).toBe(false);
    }
  });

  it("welcomes the answer engines by name, since being quoted is the point", () => {
    const rules = robots().rules;
    const agents = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent ?? ""],
    );

    for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
      expect(agents, bot).toContain(bot);
    }
  });

  it("keeps the sitemap and the canonical host the same one", async () => {
    const entries = await sitemap();
    for (const entry of entries) {
      expect(entry.url.startsWith(SITE_ORIGIN), entry.url).toBe(true);
    }
  });
});
