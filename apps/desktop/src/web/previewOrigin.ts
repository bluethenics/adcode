/**
 * Where the web version's live preview lives (2026-11-22).
 *
 * On the desktop a preview is served from `http://127.0.0.1:<port>` - an origin of its own, so
 * whatever script the project runs cannot touch the workbench. The web version has no server to
 * bind, so a Service Worker answers the preview from the files in the tab (browserHost/liveServer.ts).
 * It must still not answer on the app's own origin: a project from GitHub, or a script tag the
 * assistant added, would then run as ADCode itself, beside the sign-in and the saved model keys.
 *
 * So the preview has a sibling origin, `preview.<the app's host>`:
 *   web.bluethenics.com  ->  preview.web.bluethenics.com   (the Worker's `*.web` route; same site)
 *   localhost:5193       ->  preview.localhost:5193        (browsers resolve *.localhost to loopback)
 *
 * Three files are served there (vite.web.config.ts in development, apps/cloud/src/router.ts in
 * production): the Service Worker, and one small page + script that is both the bridge the app
 * frames invisibly and the "starting the preview" page a preview request sees before the worker
 * is installed. Everything else on that origin is the project.
 */

/** The Service Worker. At the root, because its scope is the whole preview origin. */
export const PREVIEW_WORKER_PATH = "/preview-sw.js";
/** The bridge page, and the page shown until the Service Worker answers. */
export const PREVIEW_BRIDGE_PATH = "/__preview/bridge.html";
export const PREVIEW_BRIDGE_SCRIPT_PATH = "/__preview/bridge.js";
/** Where an open project's preview starts: `/preview/<project folder name>/`. */
export const PREVIEW_PATH_PREFIX = "/preview/";
/** The channel the bridge tells preview pages to reload on (same origin, same tab partition). */
export const PREVIEW_RELOAD_CHANNEL = "adcode-preview";

/** Messages between the Service Worker, the bridge, the page and the browser host. */
export const PREVIEW_REQUEST = "adcode-preview-request";
export const PREVIEW_BRIDGE_READY = "adcode-preview-bridge-ready";
export const PREVIEW_RELOAD = "adcode-preview-reload";

/** The preview origin for the app at `appOrigin`. */
export function previewOriginFor(appOrigin: string): string {
  const url = new URL(appOrigin);
  return `${url.protocol}//preview.${url.host}`;
}

/** The app a preview origin belongs to, or null for anything that is not one. */
export function appOriginFor(previewOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(previewOrigin);
  } catch {
    return null;
  }
  if (!url.hostname.startsWith("preview.") || url.hostname === "preview.") return null;
  return `${url.protocol}//${url.host.slice("preview.".length)}`;
}

/** The address of a project's preview: its folder's name under `/preview/`. */
export function previewUrlFor(appOrigin: string, root: string): string {
  const name = root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
  return `${previewOriginFor(appOrigin)}${PREVIEW_PATH_PREFIX}${encodeURIComponent(name)}/`;
}

/** The bridge page: a status line and the one script. No inline script, for the origin's CSP. */
export const PREVIEW_BRIDGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Preview</title>
<style>body{font:14px system-ui,sans-serif;margin:2rem;color:#6c6c70}</style></head>
<body><p id="status">Starting the preview…</p><script src="${PREVIEW_BRIDGE_SCRIPT_PATH}"></script></body></html>
`;
