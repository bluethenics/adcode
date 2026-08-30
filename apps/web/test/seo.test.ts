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

  it("claims no sitelinks searchbox, because the site has no search", () => {
    // A SearchAction has to point at a URL that really performs a search. There is no
    // such page here, and declaring one would be a claim a crawler can check and find
    // false. If site search is ever built, this is the test that says to add it.
    expect((webSite() as Record<string, unknown>)["potentialAction"]).toBeUndefined();
  });
});

describe("crawling", () => {
  it("lists every public page and nothing that redirects or is private", async () => {
    const entries = await sitemap();
    const paths = entries.map((entry) => new URL(entry.url).pathname);

    for (const wanted of ["/", "/docs", "/versions", "/privacy", "/terms"]) {
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
