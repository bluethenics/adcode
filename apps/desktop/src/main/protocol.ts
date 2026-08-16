/**
 * Serve the renderer from a custom `app://` scheme rather than `file://`.
 *
 * This is not cosmetic. A `file://` document has an opaque origin, and browsers refuse
 * to start module workers from one - which would break Monaco's language services, since
 * every one of them runs in a worker. A registered scheme gives the renderer a real,
 * secure origin, so workers load, and a Content-Security-Policy has something to bind to.
 *
 * The scheme is registered as standard + secure + supportFetchAPI *before* app ready,
 * which is the only point Electron allows it.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { protocol } from "electron";

export const RENDERER_SCHEME = "app";
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://adcode`;

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

/**
 * §1 requires a strict CSP. Notable choices:
 *
 * - `default-src 'none'` then allowlist, so anything not thought about is denied.
 * - `worker-src 'self'` because Monaco's language services are workers.
 * - No `'unsafe-eval'`: Monaco does not need it once bundled rather than AMD-loaded.
 * - `img-src` allows `data:` for inline icons and `https:` for ad creatives, which are
 *   fetched and cached by us and therefore always come from the allowlisted host.
 * - `connect-src 'self'` keeps the renderer from talking to the network directly; the
 *   ad client's HTTP work happens in the main process.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function registerAppProtocol(useDevServer: boolean): void {
  const rendererRoot = join(import.meta.dirname, "../renderer");

  if (useDevServer) {
    // In development the renderer is served by Vite over http://localhost, which has a
    // real origin already. The CSP is relaxed there because HMR needs inline styles and
    // a websocket; the shipped app gets the strict policy below.
    return;
  }

  protocol.handle(RENDERER_SCHEME, async (request) => {
    const url = new URL(request.url);
    const requested = url.pathname === "/" ? "/index.html" : url.pathname;

    // Confine to the bundled renderer directory: the path comes off a URL and must not
    // be able to climb out of it.
    const resolved = join(rendererRoot, normalize(decodeURIComponent(requested)));
    if (!resolved.startsWith(rendererRoot + sep) && resolved !== rendererRoot) {
      return new Response("forbidden", { status: 403 });
    }

    try {
      const info = await stat(resolved);
      if (!info.isFile()) return new Response("not found", { status: 404 });
    } catch {
      return new Response("not found", { status: 404 });
    }

    const type = MIME[extname(resolved).toLowerCase()] ?? "application/octet-stream";
    const stream = Readable.toWeb(createReadStream(resolved)) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": type,
        "content-security-policy": CSP,
        "x-content-type-options": "nosniff",
      },
    });
  });
}
