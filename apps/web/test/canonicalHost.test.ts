import { describe, expect, it } from "vitest";
import { config, middleware } from "../src/middleware";
import { SITE_ORIGIN } from "../src/lib/site";
import { NextRequest } from "next/server";

const OLD = "adcode.bluethenics01.workers.dev";
const canonicalHost = new URL(SITE_ORIGIN).host;

const request = (host: string, path: string): NextRequest =>
  new NextRequest(new URL(path, `https://${host}`), { headers: { host } });

/** Next compiles each matcher string to a path regex; this is the same test it applies. */
const matches = (path: string): boolean =>
  config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(path));

describe("one site, one host", () => {
  it("sends the workers.dev origin to the brand domain, permanently", () => {
    const response = middleware(request(OLD, "/docs/getting-started-with-adcode"));

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      `${SITE_ORIGIN}/docs/getting-started-with-adcode`,
    );
  });

  it("leaves a request that already arrived on the right host alone", () => {
    expect(middleware(request(canonicalHost, "/docs")).headers.get("location")).toBeNull();
  });

  /*
   * The bug this test exists for.
   *
   * "Redirect anything that is not canonical" sends every developer running `next dev` to
   * the production site, because `localhost:3000` is not canonical either.
   */
  it("does not bounce a developer off their own machine", () => {
    for (const host of ["localhost:3000", "127.0.0.1:3000", "adcode-preview.pages.dev"]) {
      expect(middleware(request(host, "/")).headers.get("location"), host).toBeNull();
    }
  });

  it("keeps the query string, so a shared link survives the hop", () => {
    const response = middleware(request(OLD, "/versions?from=email"));

    expect(response.headers.get("location")).toBe(`${SITE_ORIGIN}/versions?from=email`);
  });

  /*
   * The assertion that protects the money.
   *
   * Dodo's payment webhook POSTs to `/v1/webhooks/dodo` at the URL registered in their
   * dashboard, which is the workers.dev origin. Redirecting it would depend on the sender
   * replaying a POST with its body and signature intact after a 308 - and if it does not,
   * every payment notification fails silently. An SEO change must not be able to reach it.
   */
  it("never redirects the API, which is where the payment webhook lands", () => {
    expect(matches("/v1/webhooks/dodo")).toBe(false);
    expect(matches("/v1/health")).toBe(false);
    expect(matches("/v1/posts")).toBe(false);
  });

  it("does not spend a round trip rewriting build output or bare files", () => {
    for (const path of [
      "/_next/static/chunk.js",
      "/assets/logo.png",
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
      "/opengraph-image.png",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("does redirect the pages a search engine actually indexes", () => {
    for (const path of ["/", "/docs", "/docs/git-merge-conflict", "/versions", "/terms"]) {
      expect(matches(path), path).toBe(true);
    }
  });
});
