/**
 * The Worker's front door: who may reach which sandbox.
 *
 * A sandbox costs money from the moment it starts, so nothing reaches a person's `UserSession`
 * without a verified Firebase sign-in from an allowed page. Kept apart from the Durable Object
 * classes so it can be tested with stand-in bindings.
 *
 * - `/socket` (WebSocket): the tab's connection to its sandbox. The token travels in the
 *   subprotocol header. A refused sign-in is still accepted and closed with code 4401, because
 *   a close code is the only thing a browser can read from a refused upgrade.
 * - `/api/*` (Bearer token): session status, project download, deleting the cloud workspace.
 * - `/admin/stats`: spend and use, for admins.
 * - Preview hostnames go to `previewRoute` in `preview.ts`.
 * - Everything else is the web app's static files, with strict security headers.
 */
import { tokenFromProtocols, verifyIdToken, type Verified } from "./auth.ts";
import { forwardAccountApi, forwardAdAsset } from "./accountApi.ts";
import type { Env } from "./env.ts";
import { parsePreviewHost } from "./previewAuth.ts";
import { INDEXABLE_LAUNCH_ROBOTS, LAUNCH_ROBOTS, LEGACY_WEB_APP_SCHEMA_CSP, publicAppHost, robots, sitemap, WEB_APP_SCHEMA_CSP } from "./seo.ts";

export interface RouterDeps {
  readonly verify: (token: string) => Promise<Verified | null>;
  /** Accept a WebSocket only to close it with a code the tab can read. */
  readonly refuseSocket: (code: number, reason: string) => Response;
  /** Hands a preview hostname's request on; absent in tests that do not exercise previews. */
  readonly preview?: (request: Request, port: number, previewId: string) => Promise<Response>;
}

export const DEV_UID = "web-dev-user";

export function defaultDeps(env: Env): RouterDeps {
  return {
    verify: async (token) => {
      if (env.ALLOW_DEV_TOKEN === "1" && token === "dev") return { uid: DEV_UID, email: "dev@localhost", exp: Number.MAX_SAFE_INTEGER };
      return verifyIdToken(token, env.FIREBASE_PROJECT_ID);
    },
    refuseSocket: (code, reason) => {
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client, headers: { "sec-websocket-protocol": "adcode.v1" } });
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() || null : null;
}

/** Forwards to the person's Durable Object at `path`, carrying who they are. */
function toUser(env: Env, request: Request, who: Verified, path: string): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(path, "https://user.session");
  target.search = url.search;
  const forwarded = new Request(target, request);
  // Only the Worker says who someone is, or that a request is a preview.
  for (const name of ["x-adcode-uid", "x-adcode-email", "x-adcode-preview-port"]) forwarded.headers.delete(name);
  forwarded.headers.set("x-adcode-uid", who.uid);
  if (who.email !== null) forwarded.headers.set("x-adcode-email", who.email);
  return env.USER.getByName(who.uid).fetch(forwarded);
}

/** Normal chat and GitHub requests use storage, without reserving coding capacity. */
function toBrowser(env: Env, request: Request, who: Verified): Promise<Response> {
  const url = new URL(request.url);
  url.hostname = "browser.session";
  url.pathname = url.pathname.slice("/api".length);
  const headers = new Headers(request.headers);
  for (const name of ["cookie", "authorization", "x-adcode-uid", "x-adcode-email", "x-adcode-preview-port"]) headers.delete(name);
  headers.set("x-adcode-uid", who.uid);
  return env.BROWSER.getByName(who.uid).fetch(new Request(url, new Request(request, { headers })));
}

/** Where Phone link's relay lives; the phone page connects to it and nowhere else new. */
export function relayOrigin(env: Env): string {
  return env.PHONE_RELAY_ORIGIN ?? "https://projects.bluethenics.com";
}

/** ADCode Remote, the Phone link page: its own small app under /phone/, never a soft 404. */
export function isPhonePage(pathname: string): boolean {
  return pathname === "/phone/" || pathname === "/phone/index.html";
}

export function contentSecurityPolicy(env: Env, includeLegacySchema = false): string {
  const previews = `https://*${env.PREVIEW_SUFFIX}`;
  return [
    "default-src 'none'",
    // 'wasm-unsafe-eval' compiles the bundled syntax grammars; apis.google.com is Firebase's sign-in popup helper.
    `script-src 'self' 'wasm-unsafe-eval' https://apis.google.com ${WEB_APP_SCHEMA_CSP}${includeLegacySchema ? ` ${LEGACY_WEB_APP_SCHEMA_CSP}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https:",
    "worker-src 'self' blob:",
    // The relay is Phone link's: the /phone page talks to the person's own computer through it.
    `connect-src 'self' wss://${env.APP_HOST} ${relayOrigin(env)} ${relayOrigin(env).replace(/^https:/, "wss:")} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://apis.google.com`,
    `frame-src ${previews} https://${env.FIREBASE_AUTH_DOMAIN} https://accounts.google.com`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function servePage(request: Request, env: Env, assetPath?: string): Promise<Response> {
  const assetUrl = new URL(request.url);
  if (assetPath !== undefined) assetUrl.pathname = assetPath;
  const response = await env.ASSETS.fetch(assetPath === undefined ? request : new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  const url = new URL(request.url);
  let body = response.body;
  let status = response.status;
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if ((headers.get("content-type") ?? "").includes("text/html")) {
    headers.set("content-security-policy", contentSecurityPolicy(env, assetPath === "/legacy-workspace.html"));
    headers.set("cache-control", "no-cache");
    headers.set("x-robots-tag", "noindex, nofollow");
    const publicRoot = publicAppHost(url.hostname, env.APP_HOST, env.ALLOW_DEV_TOKEN) && url.pathname === "/" && url.search === "" && status === 200;
    if (publicRoot && request.method === "GET") {
      const html = await response.text();
      // An old build without the public introduction must remain noindex.
      const indexable = html.includes(LAUNCH_ROBOTS);
      body = new Response(indexable ? html.replace(LAUNCH_ROBOTS, INDEXABLE_LAUNCH_ROBOTS) : html).body;
      if (indexable) headers.set("x-robots-tag", "index, follow, max-image-preview:large");
      headers.delete("content-length");
      headers.delete("etag");
    } else if (publicRoot && request.method === "HEAD") {
      // Crawlers learn indexing from GET; HEAD has no HTML to verify the launch marker.
      headers.delete("x-robots-tag");
    }
    // The asset binding's SPA fallback otherwise makes every nonexistent path a soft 404.
    if (url.pathname !== "/" && url.pathname !== "/index.html" && !isPhonePage(url.pathname) && status === 200) status = 404;
  }
  return new Response(request.method === "HEAD" ? null : body, { status, headers });
}

export async function route(request: Request, env: Env, deps: RouterDeps = defaultDeps(env)): Promise<Response> {
  const url = new URL(request.url);

  const preview = parsePreviewHost(url.hostname, env.PREVIEW_SUFFIX);
  if (preview !== null) {
    return deps.preview === undefined ? new Response("Not found", { status: 404 }) : deps.preview(request, preview.port, preview.previewId);
  }
  // A hostname under the preview suffix that is not a well-formed preview is nothing at all.
  if (url.hostname.endsWith(env.PREVIEW_SUFFIX)) return new Response("Not found", { status: 404 });

  if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
    const headers = new Headers({ "content-type": url.pathname === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-robots-tag": "noindex" });
    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("allow", "GET, HEAD");
      return new Response("Method not allowed", { status: 405, headers });
    }
    const publicHost = publicAppHost(url.hostname, env.APP_HOST, env.ALLOW_DEV_TOKEN);
    const body = url.pathname === "/robots.txt" ? robots(publicHost) : sitemap(publicHost);
    return new Response(request.method === "HEAD" ? null : body, { headers });
  }

  if (url.pathname.startsWith("/v1/")) {
    const token = bearer(request);
    if (token === null || token === "dev" || await deps.verify(token) === null) return json({ error: "unauthenticated" }, 401);
    return forwardAccountApi(request, env);
  }

  if (url.pathname === "/socket") {
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const allowed = env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter((origin) => origin.length > 0);
    if (!allowed.includes(request.headers.get("origin") ?? "")) return new Response("Forbidden", { status: 403 });
    const token = tokenFromProtocols(request.headers.get("sec-websocket-protocol"));
    const who = token === null ? null : await deps.verify(token);
    if (who === null) return deps.refuseSocket(4401, "Signed out");
    return toUser(env, request, who, "/socket");
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) {
    const token = bearer(request);
    const who = token === null ? null : await deps.verify(token);
    if (who === null) return json({ ok: false, error: "Sign in first" }, 401);

    if (url.pathname.startsWith("/api/ad-assets/")) return forwardAdAsset(request, env, url.pathname.slice("/api/ad-assets/".length));

    if (url.pathname === "/api/chats" || url.pathname.startsWith("/api/chats/") || url.pathname.startsWith("/api/github/")) {
      return toBrowser(env, request, who);
    }

    switch (url.pathname) {
      case "/api/session":
        return toUser(env, request, who, "/status");
      case "/api/download":
        return toUser(env, request, who, "/download");
      case "/api/delete":
        if (request.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);
        return toUser(env, request, who, "/delete");
      case "/admin/stats": {
        const admins = env.ADMIN_UIDS.split(",").map((uid) => uid.trim()).filter((uid) => uid.length > 0);
        if (!admins.includes(who.uid)) return json({ ok: false }, 403);
        return json(await env.BUDGET.getByName("global").stats());
      }
      default:
        return json({ ok: false, error: "Not found" }, 404);
    }
  }

  if (url.pathname === "/phone") return Response.redirect(new URL("/phone/", url).toString(), 308);
  if (isPhonePage(url.pathname)) return servePage(request, env, "/phone/index.html");

  // Releases can retain the prior execution UI while the browser-first entry changes.
  // Fresh builds without this optional asset fall back to the normal SPA index.
  if (url.pathname === "/" && url.searchParams.get("workspace") === "run") {
    return servePage(request, env, "/legacy-workspace.html");
  }
  return servePage(request, env);
}
