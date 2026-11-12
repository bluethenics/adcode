/*
 * The Worker's front door.
 *
 * Every request lands here first. A sandbox costs money from the moment it starts, so nothing
 * reaches a person's Durable Object without a verified sign-in from an allowed page. These tests
 * run the router against stand-in bindings and check who gets through, and what a refused
 * socket is told (a WebSocket close code is the only thing a browser can read from a refused
 * upgrade).
 */
import { describe, expect, it, vi } from "vitest";
import { route, type RouterDeps } from "../src/router.ts";
import type { Env } from "../src/env.ts";
import { INDEXABLE_LAUNCH_ROBOTS, LAUNCH_ROBOTS, LEGACY_WEB_APP_SCHEMA_CSP, WEB_APP_SCHEMA_CSP } from "../src/seo.ts";

function fakeEnv(): { env: Env; userFetch: ReturnType<typeof vi.fn>; assetsFetch: ReturnType<typeof vi.fn>; names: string[] } {
  const names: string[] = [];
  const userFetch = vi.fn(async (request: Request) => new Response(`user:${request.headers.get("x-adcode-uid")}`));
  const assetsFetch = vi.fn(async (_request: Request) => new Response("<!doctype html><title>ADCode</title>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  const env = {
    APP_HOST: "web.bluethenics.com",
    PREVIEW_SUFFIX: ".web.bluethenics.com",
    FIREBASE_PROJECT_ID: "adcode-test",
    FIREBASE_AUTH_DOMAIN: "adcode-test.firebaseapp.com",
    ALLOWED_ORIGINS: "https://web.bluethenics.com",
    ADMIN_UIDS: "admin-1",
    USER: { getByName: (name: string) => { names.push(name); return { fetch: userFetch }; } },
    PREVIEW: { getByName: () => ({ owner: async () => null }) },
    BUDGET: { getByName: () => ({ stats: async () => ({ spentUsd: 1 }) }) },
    ASSETS: { fetch: assetsFetch },
  } as unknown as Env;
  return { env, userFetch, assetsFetch, names };
}

const deps: RouterDeps = {
  verify: async (token) => (token === "good-token" ? { uid: "user-123", email: "sinan@example.com", exp: 0 } : null),
  refuseSocket: (code, reason) => new Response(`refused ${code} ${reason}`, { status: 299 }),
};

function socketRequest(headers: Record<string, string>): Request {
  return new Request("https://web.bluethenics.com/socket", { headers: { upgrade: "websocket", ...headers } });
}

describe("socket", () => {
  it("refuses a page from somewhere else", async () => {
    const { env, names } = fakeEnv();
    const response = await route(socketRequest({ origin: "https://evil.example", "sec-websocket-protocol": "adcode.v1, auth.good-token" }), env, deps);
    expect(response.status).toBe(403);
    expect(names).toEqual([]);
  });

  it("tells a tab without a valid sign-in to sign in again, without waking anything", async () => {
    const { env, names } = fakeEnv();
    for (const protocols of ["adcode.v1", "adcode.v1, auth.bad-token"]) {
      const response = await route(socketRequest({ origin: "https://web.bluethenics.com", "sec-websocket-protocol": protocols }), env, deps);
      expect(await response.text()).toBe("refused 4401 Signed out");
    }
    expect(names).toEqual([]);
  });

  it("sends a signed-in tab to that person's own sandbox", async () => {
    const { env, names, userFetch } = fakeEnv();
    const response = await route(socketRequest({ origin: "https://web.bluethenics.com", "sec-websocket-protocol": "adcode.v1, auth.good-token" }), env, deps);
    expect(names).toEqual(["user-123"]);
    expect(await response.text()).toBe("user:user-123");
    const forwarded = userFetch.mock.calls[0]![0] as Request;
    expect(new URL(forwarded.url).pathname).toBe("/socket");
    expect(forwarded.headers.get("x-adcode-email")).toBe("sinan@example.com");
  });

  it("needs an upgrade", async () => {
    const { env } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/socket"), env, deps)).status).toBe(426);
  });
});

describe("api", () => {
  it("uses separate lightweight storage for chats and GitHub without touching sandbox capacity", async () => {
    const { env, userFetch, names } = fakeEnv();
    const browserFetch = vi.fn(async (_request: Request) => Response.json({ chats: [] }));
    const browserNames: string[] = [];
    Object.assign(env, { BROWSER: { getByName: (name: string) => { browserNames.push(name); return { fetch: browserFetch }; } } });
    for (const path of ["/api/chats", "/api/chats/chat_1", "/api/github/status"]) {
      expect((await route(new Request(`https://web.bluethenics.com${path}`, {
        headers: { authorization: "Bearer good-token", "x-adcode-uid": "someone-else", "x-adcode-preview-port": "5173", cookie: "private=1" },
      }), env, deps)).status).toBe(200);
    }
    expect(browserNames).toEqual(["user-123", "user-123", "user-123"]);
    expect(userFetch).not.toHaveBeenCalled();
    expect(names).toEqual([]);
    const forwarded = browserFetch.mock.calls[0]![0] as unknown as Request;
    expect(new URL(forwarded.url).pathname).toBe("/chats");
    expect(forwarded.headers.get("x-adcode-uid")).toBe("user-123");
    for (const header of ["authorization", "cookie", "x-adcode-preview-port"]) expect(forwarded.headers.has(header)).toBe(false);
  });
  it("needs a bearer token", async () => {
    const { env, names } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/api/session"), env, deps)).status).toBe(401);
    expect(names).toEqual([]);
  });

  it("reads the session status for the signed-in person", async () => {
    const { env, userFetch } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/api/session", { headers: { authorization: "Bearer good-token" } }), env, deps);
    expect(response.status).toBe(200);
    expect(new URL((userFetch.mock.calls[0]![0] as Request).url).pathname).toBe("/status");
  });

  it("never passes on the headers only the Worker may set", async () => {
    const { env, userFetch } = fakeEnv();
    await route(new Request("https://web.bluethenics.com/api/session", {
      headers: { authorization: "Bearer good-token", "x-adcode-preview-port": "5173", "x-adcode-uid": "someone-else" },
    }), env, deps);
    const forwarded = userFetch.mock.calls[0]![0] as Request;
    expect(forwarded.headers.has("x-adcode-preview-port")).toBe(false);
    expect(forwarded.headers.get("x-adcode-uid")).toBe("user-123");
  });

  it("deletes only with POST", async () => {
    const { env } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/api/delete", { headers: { authorization: "Bearer good-token" } }), env, deps)).status).toBe(405);
  });

  it("shows spend only to admins", async () => {
    const { env } = fakeEnv();
    const stranger = await route(new Request("https://web.bluethenics.com/admin/stats", { headers: { authorization: "Bearer good-token" } }), env, deps);
    expect(stranger.status).toBe(403);
    const admin = await route(new Request("https://web.bluethenics.com/admin/stats", { headers: { authorization: "Bearer admin-token" } }), env, {
      ...deps,
      verify: async () => ({ uid: "admin-1", email: null, exp: 0 }),
    });
    expect(await admin.json()).toEqual({ spentUsd: 1 });
  });
});

describe("the page", () => {
  it("keeps the existing execution entry available only when explicitly requested", async () => {
    const { env, assetsFetch, names } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/?workspace=run"), env, deps);
    expect(response.status).toBe(200);
    expect(new URL((assetsFetch.mock.calls[0]![0] as unknown as Request).url).pathname).toBe("/legacy-workspace.html");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toContain(LEGACY_WEB_APP_SCHEMA_CSP);
    expect(names).toEqual([]);
  });
  it("serves Phone link's page at /phone/ as a real page, able to reach the relay", async () => {
    const { env, assetsFetch } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/phone/"), env, deps);
    expect(response.status).toBe(200);
    expect(new URL((assetsFetch.mock.calls[0]![0] as unknown as Request).url).pathname).toBe("/phone/index.html");
    expect(response.headers.get("content-security-policy")).toContain("wss://projects.bluethenics.com");
    const bare = await route(new Request("https://web.bluethenics.com/phone"), env, deps);
    expect(bare.status).toBe(308);
    expect(bare.headers.get("location")).toBe("https://web.bluethenics.com/phone/");
  });
  it("serves the app with a strict content security policy", async () => {
    const { env } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/"), env, deps);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src https://*.web.bluethenics.com https://adcode-test.firebaseapp.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(WEB_APP_SCHEMA_CSP);
    expect(csp).not.toContain(LEGACY_WEB_APP_SCHEMA_CSP);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not serve the app on a preview hostname", async () => {
    const { env, assetsFetch } = fakeEnv();
    const response = await route(new Request("https://p-5173-abcdefghij.web.bluethenics.com/index.html"), env, deps);
    expect(response.status).toBe(404);
    expect(assetsFetch).not.toHaveBeenCalled();
  });

  it("indexes only the complete public launch page on the production root", async () => {
    const { env, assetsFetch, names } = fakeEnv();
    assetsFetch.mockImplementation(async () => new Response(`<!doctype html><head>${LAUNCH_ROBOTS}</head><h1>ADCode Web</h1>`, { headers: { "content-type": "text/html", etag: '"old-build"', "content-length": "1" } }));
    const response = await route(new Request("https://web.bluethenics.com/"), env, deps);
    expect(response.headers.get("x-robots-tag")).toBe("index, follow, max-image-preview:large");
    expect(await response.text()).toContain(INDEXABLE_LAUNCH_ROBOTS);
    expect(response.headers.has("etag")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
    expect(names).toEqual([]);
  });

  it("keeps old builds, query URLs, alternate hosts and development deployments noindex", async () => {
    const { env } = fakeEnv();
    expect((await route(new Request("https://web.bluethenics.com/"), env, deps)).headers.get("x-robots-tag")).toContain("noindex");
    for (const url of ["https://web.bluethenics.com/?project=private", "https://staging.example/", "https://web.bluethenics.com/index.html"]) {
      const { env: built, assetsFetch } = fakeEnv();
      assetsFetch.mockImplementation(async () => new Response(`<head>${LAUNCH_ROBOTS}</head>`, { headers: { "content-type": "text/html" } }));
      const response = await route(new Request(url), built, deps);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(await response.text()).toContain(LAUNCH_ROBOTS);
    }
    const { env: dev, assetsFetch } = fakeEnv();
    assetsFetch.mockImplementation(async () => new Response(LAUNCH_ROBOTS, { headers: { "content-type": "text/html" } }));
    expect((await route(new Request("https://web.bluethenics.com/"), { ...dev, ALLOW_DEV_TOKEN: "1" }, deps)).headers.get("x-robots-tag")).toContain("noindex");
  });

  it("returns a real 404 for the HTML fallback and serves ordinary assets unchanged", async () => {
    const { env, assetsFetch } = fakeEnv();
    const missing = await route(new Request("https://web.bluethenics.com/does-not-exist"), env, deps);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-robots-tag")).toContain("noindex");
    assetsFetch.mockImplementation(async () => new Response("export {}", { headers: { "content-type": "text/javascript", etag: '"asset"' } }));
    const asset = await route(new Request("https://web.bluethenics.com/assets/app.js"), env, deps);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("etag")).toBe('"asset"');
    expect(await asset.text()).toBe("export {}");
  });
});

describe("crawler discovery", () => {
  it("serves real robots and sitemap responses without waking a workspace", async () => {
    const { env, assetsFetch, names } = fakeEnv();
    const robots = await route(new Request("https://web.bluethenics.com/robots.txt"), env, deps);
    expect(robots.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await robots.text()).toContain("Sitemap: https://web.bluethenics.com/sitemap.xml");
    const sitemap = await route(new Request("https://web.bluethenics.com/sitemap.xml"), env, deps);
    expect(sitemap.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const xml = await sitemap.text();
    expect(xml).toContain("<loc>https://web.bluethenics.com/</loc>");
    expect(xml.match(/<loc>/g)).toHaveLength(1);
    expect(xml).not.toMatch(/api|admin|preview/);
    expect(assetsFetch).not.toHaveBeenCalled();
    expect(names).toEqual([]);
  });

  it("blocks staging crawlers and advertises no staging URLs", async () => {
    const { env } = fakeEnv();
    const robots = await route(new Request("https://staging.example/robots.txt"), env, deps);
    expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
    const sitemap = await route(new Request("https://staging.example/sitemap.xml"), env, deps);
    expect(await sitemap.text()).not.toContain("<loc>");
  });

  it("does not expose the public sitemap from a private preview", async () => {
    const { env } = fakeEnv();
    const preview = vi.fn(async () => new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } }));
    const response = await route(new Request("https://p-5173-abcdefghij.web.bluethenics.com/sitemap.xml"), env, { ...deps, preview });
    expect(preview).toHaveBeenCalledOnce();
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<loc>");
  });

  it("supports HEAD discovery and rejects other methods", async () => {
    const { env } = fakeEnv();
    const head = await route(new Request("https://web.bluethenics.com/sitemap.xml", { method: "HEAD" }), env, deps);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await route(new Request("https://web.bluethenics.com/robots.txt", { method: "POST" }), env, deps);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });
});
