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
import { route, SANDBOX_RETIRED_CODE, type RouterDeps } from "../src/router.ts";
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
  // The web version runs in the person's tab now (2026-11-21): no request starts a sandbox.
  it("never starts a person's sandbox, whoever asks and however they are signed in", async () => {
    const { env, names, userFetch } = fakeEnv();
    for (const headers of [
      { origin: "https://web.bluethenics.com", "sec-websocket-protocol": "adcode.v1, auth.good-token" },
      { origin: "https://web.bluethenics.com", "sec-websocket-protocol": "adcode.v1" },
      { origin: "https://evil.example", "sec-websocket-protocol": "adcode.v1, auth.good-token" },
    ]) {
      const response = await route(socketRequest(headers), env, deps);
      expect(await response.text()).toBe(`refused ${SANDBOX_RETIRED_CODE} ADCode on the web runs in your browser now. Reload the page.`);
    }
    expect(names).toEqual([]);
    expect(userFetch).not.toHaveBeenCalled();
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
  it("serves the one web app for the old sandbox address too, and starts nothing", async () => {
    const { env, assetsFetch, names } = fakeEnv();
    const response = await route(new Request("https://web.bluethenics.com/?workspace=run"), env, deps);
    expect(response.status).toBe(200);
    expect(new URL((assetsFetch.mock.calls[0]![0] as unknown as Request).url).pathname).toBe("/");
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
    // The sponsored card under a reply on the /phone page, and no other ad origin.
    expect(csp).toMatch(/frame-src [^;]*https:\/\/adcode\.bluethenics\.com/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(WEB_APP_SCHEMA_CSP);
    // Cloudflare Web Analytics, which the zone injects: its script and its beacon, nothing broader.
    expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
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

describe("the live preview's origin", () => {
  // The web version's preview: a Service Worker on preview.<app host> answers from the person's
  // tab (apps/desktop/src/web/previewOrigin.ts). This Worker only serves that worker and its bridge.
  const preview = (path: string, init?: RequestInit) => new Request(`https://preview.web.bluethenics.com${path}`, init);
  const assets = (env: Env, files: Record<string, { type: string; body: string }>) => Object.assign(env, {
    ASSETS: {
      fetch: vi.fn(async (request: Request) => {
        const file = files[new URL(request.url).pathname];
        // The real binding answers a missing file with the app's index.html.
        return file === undefined
          ? new Response("<!doctype html><title>ADCode</title>", { headers: { "content-type": "text/html; charset=utf-8" } })
          : new Response(file.body, { headers: { "content-type": file.type } });
      }),
    },
  });
  const files = {
    "/preview-sw.js": { type: "text/javascript", body: "/* worker */" },
    "/__preview/bridge.js": { type: "text/javascript", body: "/* bridge */" },
    "/__preview/bridge.html": { type: "text/html; charset=utf-8", body: "<p id=status>Starting the preview…</p><script src=\"/__preview/bridge.js\"></script>" },
  };

  it("serves the Service Worker and the bridge, and the bridge as the starting page for every other address", async () => {
    const { env } = fakeEnv();
    assets(env, files);
    const worker = await route(preview("/preview-sw.js"), env, deps);
    expect(worker.status).toBe(200);
    expect(worker.headers.get("content-type")).toContain("text/javascript");
    expect(await worker.text()).toBe("/* worker */");

    for (const path of ["/__preview/bridge.html", "/preview/bakery/", "/style.css"]) {
      const page = await route(preview(path), env, deps);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Starting the preview");
      const csp = page.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors https://web.bluethenics.com");
      expect(page.headers.get("cache-control")).toContain("no-transform");
      expect(page.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect((await route(preview("/preview/bakery/", { method: "POST" }), env, deps)).status).toBe(405);
  });

  it("lets the browser keep built files whose names carry their hash, and nothing else", async () => {
    const { env } = fakeEnv();
    assets(env, {
      "/assets/main-DrpUcgbO.js": { type: "text/javascript", body: "/* app */" },
      "/browser-host.js": { type: "text/javascript", body: "/* host */" },
    });
    const hashed = await route(new Request("https://web.bluethenics.com/assets/main-DrpUcgbO.js"), env, deps);
    expect(hashed.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    // Same name every build: it must be asked for again.
    const host = await route(new Request("https://web.bluethenics.com/browser-host.js"), env, deps);
    expect(host.headers.get("cache-control") ?? "").not.toContain("immutable");
    // A missing file is the page's 404, never kept.
    const missing = await route(new Request("https://web.bluethenics.com/assets/gone-AbCdEf12.js"), env, deps);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-cache");
  });

  it("never serves the app there, even when the build lacks its files", async () => {
    const { env } = fakeEnv();
    assets(env, {});
    for (const path of ["/preview-sw.js", "/__preview/bridge.js", "/"]) {
      const response = await route(preview(path), env, deps);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("<title>ADCode</title>");
    }
  });

  it("is a frame the app may show, and its files are nothing on the app's own hostname", async () => {
    const { env } = fakeEnv();
    const csp = (await route(new Request("https://web.bluethenics.com/"), env, deps)).headers.get("content-security-policy") ?? "";
    // `https://*.web.bluethenics.com` covers preview.web.bluethenics.com.
    expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.web\.bluethenics\.com/);
    assets(env, files);
    for (const path of ["/preview-sw.js", "/__preview/bridge.html"]) expect((await route(new Request(`https://web.bluethenics.com${path}`), env, deps)).status).toBe(404);
  });
});
