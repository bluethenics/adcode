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
import { ADDON_CSP, ADDON_SCHEME, addonDocument, parseAddonUrl, type PluginAddon } from "@adcode/community";

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
  /*
   * `application/wasm` is not decoration.
   *
   * `WebAssembly.instantiateStreaming` refuses any other content type outright, so a
   * grammar served as `application/octet-stream` fails to compile, falls back to the slow
   * non-streaming path, and prints an error per file per load. Serving the right type is
   * the whole fix.
   */
  ".wasm": "application/wasm",
};

/**
 * §1 requires a strict CSP. Notable choices:
 *
 * - `default-src 'none'` then allowlist, so anything not thought about is denied.
 * - `worker-src 'self'` because Monaco's language services are workers.
 * - No `'unsafe-eval'`: Monaco does not need it once bundled rather than AMD-loaded.
 * - `'wasm-unsafe-eval'` in `script-src`, which is a narrower thing than its name suggests:
 *   it permits compiling WebAssembly and nothing else. It does *not* re-admit `eval` or
 *   `new Function`, which is the reason this directive exists separately at all. Tree-sitter
 *   is WebAssembly, and without it every grammar load fails with a CSP violation. The bytes
 *   compiled are the grammars this app ships, served from its own `app://` protocol - the
 *   policy still forbids fetching wasm from anywhere else, because `default-src 'none'` and
 *   `connect-src 'self'` are unchanged.
 * - `img-src` allows `data:` for inline icons and `https:` for ad creatives, which are
 *   fetched and cached by us and therefore always come from the allowlisted host.
 * - `connect-src 'self'` keeps the renderer from talking to the network directly; the
 *   ad client's HTTP work happens in the main process.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  // The one widening in this policy, and deliberately the narrowest that works: the live
  // preview renders the user's own site in an iframe, and only the loopback server this
  // process bound can answer. `http:` is required because a self-signed certificate on
  // 127.0.0.1 costs a browser warning for no security gained over a loopback socket.
  //
  // The frame is cross-origin - `http://127.0.0.1:port` against the renderer's
  // `app://adcode` - so same-origin policy already keeps the previewed page out of the
  // workbench's DOM. Nothing else in this list moves to accommodate it.
  //
  // ADCode's own site is the second and last: the opt-in sponsored cards under AI replies
  // (renderer/ai/sponsoredReply.ts) live there, cross-origin and sandboxed, so the ad SDK and
  // its measurement scripts never run in this window. Only that origin, never `https:`.
  //
  // `adcode-addon:` is the third: plugin add-ons, served by this process from installed
  // plugins with a policy of their own that allows no network at all (see registerAddonProtocol).
  "frame-src http://127.0.0.1:* http://localhost:* https://adcode.bluethenics.com adcode-addon:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    // Add-ons: a real, secure origin of their own, so the sandboxed frame is cross-origin to the app.
    { scheme: ADDON_SCHEME, privileges: { standard: true, secure: true } },
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

/**
 * Plugin add-ons, served sealed.
 *
 * Only an enabled, installed plugin's declared add-on is served, rebuilt from its manifest on
 * every request, with a policy that denies the network, frames, forms and navigation. The
 * renderer frames it with `sandbox="allow-scripts"`, so it also has an opaque origin: no
 * cookies, no storage, no reaching into the app's page.
 */
export function registerAddonProtocol(find: (pluginId: string, addonId: string) => Promise<PluginAddon | null>): void {
  protocol.handle(ADDON_SCHEME, async (request) => {
    const target = parseAddonUrl(request.url);
    const addon = target === null ? null : await find(target.pluginId, target.addonId).catch(() => null);
    if (addon === null) return new Response("not found", { status: 404, headers: { "content-security-policy": "default-src 'none'" } });
    return new Response(addonDocument(addon), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": ADDON_CSP,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  });
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
