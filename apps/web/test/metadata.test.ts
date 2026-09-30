import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";
import { metadata as layoutMetadata } from "../src/app/layout";
import { metadata as homeMetadata } from "../src/app/page";
import { metadata as versionsMetadata } from "../src/app/versions/page";
import { metadata as privacyMetadata } from "../src/app/privacy/page";
import { metadata as termsMetadata } from "../src/app/terms/page";
import { metadata as compareMetadata } from "../src/app/compare/page";
import { metadata as docsIndexMetadata } from "../src/app/docs/page";
import { metadata as portalMetadata } from "../src/app/portal/layout";
import { metadata as dashboardMetadata } from "../src/app/dashboard/layout";
import { metadata as adminMetadata } from "../src/app/admin/layout";
import { generateMetadata as docMetadata } from "../src/app/docs/[slug]/page";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import config from "../next.config";
import { allDocs } from "../src/lib/docs";
import { LANDINGS, landingMetadata, landingPath } from "../src/lib/landings";
import { installRoute } from "../src/lib/platform";
import { FAQ, softwareApplication } from "../src/lib/schema";
import {
  DESCRIPTION_LIMIT,
  SHARE_IMAGE,
  TITLE_LIMIT,
  docDescription,
  docTitle,
  metaDescription,
} from "../src/lib/seo";
import { url } from "../src/lib/site";

// next/font is a build-time transform; outside the compiler the loaders are not functions.
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "", className: "", style: {} });
  return { Inter_Tight: font, Inter: font, JetBrains_Mono: font };
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline in tests")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The fields every shareable, indexable page must state for itself. */
function expectCompleteHead(meta: Metadata, path: string): void {
  const canonical = url(path);
  expect(meta.alternates?.canonical, `${path} canonical`).toBe(canonical);

  const og = meta.openGraph as Record<string, unknown> | undefined;
  expect(og?.["url"], `${path} og:url`).toBe(canonical);
  expect(og?.["title"], `${path} og:title`).toEqual(expect.any(String));
  expect(og?.["images"], `${path} og:image`).toEqual([SHARE_IMAGE]);

  const twitter = meta.twitter as Record<string, unknown> | undefined;
  expect(twitter?.["card"], `${path} twitter:card`).toBe("summary_large_image");
  expect(twitter?.["images"], `${path} twitter:image`).toEqual([
    { url: SHARE_IMAGE.url, alt: SHARE_IMAGE.alt },
  ]);

  const description = meta.description ?? "";
  expect(description.length, `${path} description`).toBeGreaterThan(50);
  expect(description.length, `${path} description`).toBeLessThanOrEqual(DESCRIPTION_LIMIT);

  // The llms.txt and RSS links ride on `alternates`, which a page replaces wholesale.
  expect(Object.keys(meta.alternates?.types ?? {}), `${path} alternates`).toEqual([
    "text/plain",
    "application/rss+xml",
  ]);
}

/*
 * Next merges metadata shallowly, so a page that sets `openGraph` loses the layout's image
 * and a page that sets nothing inherits the homepage's URL. Both shipped: 120 of 126 pages
 * had no share image, and three pages told every unfurler they were the homepage.
 */
describe("every public page states its own head", () => {
  it("covers the fixed pages", () => {
    for (const [meta, path] of [
      [homeMetadata, "/"],
      [versionsMetadata, "/versions"],
      [privacyMetadata, "/privacy"],
      [termsMetadata, "/terms"],
      [compareMetadata, "/compare"],
      [docsIndexMetadata, "/docs"],
    ] as const) {
      expectCompleteHead(meta, path);
    }
  });

  it("covers every landing and comparison page", () => {
    for (const page of LANDINGS) expectCompleteHead(landingMetadata(page), landingPath(page));
  });

  it("covers every documentation page", async () => {
    for (const page of await allDocs()) {
      const meta = await docMetadata({ params: Promise.resolve({ slug: page.slug }) });
      expectCompleteHead(meta, `/docs/${page.slug}`);
      const title = meta.title as { absolute: string };
      expect(title.absolute.length, `/docs/${page.slug} title`).toBeLessThanOrEqual(
        Math.max(TITLE_LIMIT, page.title.length + " - ADCode".length),
      );
    }
  });

  it("leaves nothing in the layout that would be false when inherited", () => {
    expect(layoutMetadata.alternates?.canonical).toBeUndefined();
    expect((layoutMetadata.openGraph as Record<string, unknown>)["url"]).toBeUndefined();
    // The fallback for any page that says nothing is still an image, not a bare link.
    expect((layoutMetadata.openGraph as Record<string, unknown>)["images"]).toEqual([SHARE_IMAGE]);
  });
});

describe("snippet-sized text", () => {
  it("keeps a description that already fits", () => {
    expect(metaDescription("Short and complete.")).toBe("Short and complete.");
  });

  it("cuts at a sentence when a whole one fits", () => {
    const first = "A".repeat(100) + ".";
    const text = `${first} ${"B".repeat(100)}.`;
    expect(metaDescription(text)).toBe(first);
  });

  it("cuts at a word with an ellipsis only when no sentence fits", () => {
    const text = `${"word ".repeat(60)}end.`;
    const out = metaDescription(text);
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("drops markdown backticks, which a snippet shows literally", () => {
    expect(metaDescription("Uses `lang:rust` tags.")).toBe("Uses lang:rust tags.");
  });

  it("names the category on a generated page's title, where it fits", () => {
    expect(docTitle({ title: "Race mode", authored: false })).toEqual({
      absolute: "Race mode - ADCode, the free AI code editor",
    });
    // Too long for the category: the plain form rather than a truncated result.
    const long = "Open IDE in a separate window with every panel restored";
    expect(docTitle({ title: long, authored: false })).toEqual({ absolute: `${long} - ADCode` });
    // Authored articles are already sentences.
    expect(docTitle({ title: "Why the ledger is append-only", authored: true })).toEqual({
      absolute: "Why the ledger is append-only - ADCode",
    });
  });

  it("gives a tooltip-length description enough to be worth a snippet", () => {
    const out = docDescription("Which company's AI you want to use.");
    expect(out.startsWith("Which company's AI you want to use.")).toBe(true);
    expect(out).toContain("AI code editor");
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
  });
});

describe("what is kept out of the index, and how", () => {
  it("marks every signed-in area noindex", () => {
    for (const meta of [portalMetadata, dashboardMetadata, adminMetadata]) {
      expect(meta.robots).toEqual({ index: false, follow: false });
    }
  });

  it("lets crawlers reach the linked private pages, so their noindex is read", () => {
    const rules = robots().rules;
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      rule.disallow === undefined ? [] : Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow],
    );
    for (const linked of ["/portal", "/dashboard", "/support"]) {
      expect(disallowed.some((prefix) => linked.startsWith(prefix)), linked).toBe(false);
    }
    // Public pages fetch live figures from the API while Google renders them.
    expect(disallowed.some((prefix) => "/v1/public".startsWith(prefix))).toBe(false);
  });
});

describe("retired routes", () => {
  it("move permanently, and a post lands on the post rather than the homepage", async () => {
    const redirects = await config.redirects?.();
    const find = (source: string) => redirects?.find((one) => one.source === source);

    for (const source of ["/blog", "/blog/:slug", "/changelog", "/download", "/advertise"]) {
      expect(find(source)?.permanent, source).toBe(true);
    }
    expect(find("/blog/:slug")?.destination).toBe("/docs/:slug");
  });
});

describe("where a post written in the admin panel ends up", () => {
  it("gives a blog-only post a real page, since /blog/<slug> redirects to /docs/<slug>", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          posts: [
            {
              slug: "a-blog-only-note",
              title: "A blog-only note",
              description: "Written for the blog surface alone.",
              body: "Hello.",
              surface: "blog",
              publishedAt: Date.UTC(2026, 8, 30),
              updatedAt: Date.UTC(2026, 8, 30),
            },
          ],
        }),
      ),
    );

    const docs = await allDocs();
    expect(docs.map((page) => page.slug)).toContain("a-blog-only-note");
  });
});

describe("claims the structured data makes", () => {
  it("names only the operating systems that can actually install today", () => {
    const os = String(softwareApplication()["operatingSystem"]);
    expect(installRoute("macos")).toBe("soon");
    expect(os).not.toMatch(/mac/i);
    expect(os).toMatch(/Windows/);
    expect(os).toMatch(/Linux/);
    for (const item of FAQ) expect(item.a, item.q).not.toMatch(/Windows, macOS, and Linux/);
  });
});

describe("sitemap dates", () => {
  it("says when each page changed, not when the crawler asked", async () => {
    const entries = await sitemap();

    // A day the page changed is a calendar day; the time of a request never lands on midnight.
    for (const entry of entries) {
      expect((entry.lastModified as Date).toISOString(), entry.url).toMatch(/T00:00:00\.000Z$/);
    }
    const privacy = entries.find((entry) => entry.url === url("/privacy"));
    expect((privacy?.lastModified as Date).toISOString().slice(0, 10)).toBe("2026-09-13");
    for (const page of LANDINGS) {
      const entry = entries.find((one) => one.url === url(landingPath(page)));
      expect((entry?.lastModified as Date).toISOString().slice(0, 10), page.slug).toBe(page.updated);
    }
  });
});
