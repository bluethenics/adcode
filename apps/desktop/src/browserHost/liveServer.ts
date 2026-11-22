/**
 * The web version's live preview: main/liveServer.ts with no server (2026-11-22).
 *
 * On the desktop, Preview binds a loopback HTTP server over the open folder. In the browser host
 * there is nothing to bind, so the same three exports (`startLiveServer`, `stopLiveServer`,
 * `liveServerStatus`) hand out an address on the preview origin instead (web/previewOrigin.ts),
 * and a Service Worker there asks this worker for each file (`answerPreviewRequest`), through the
 * page. The files come straight from memory, so the preview shows an edit the moment it is made,
 * with no wait for the write-behind to IndexedDB. vite.browserHost.config.ts swaps this file in for
 * main/liveServer.ts wherever main/preview.ts imports it, so the Preview button, the status bar and
 * the assistant's "open the preview" all reach it unchanged.
 *
 * Static sites only, as on the desktop: a project that needs its dev server still goes through
 * main/devServer.ts, which fails with "needs the desktop app" because there is no program to run.
 */
import { contentTypeFor, directoryListing, injectAdcodeScripts } from "../main/liveServer.ts";
import type { PreviewStatus } from "../shared/api.ts";
import { PREVIEW_PATH_PREFIX, PREVIEW_RELOAD_CHANNEL, previewUrlFor } from "../web/previewOrigin.ts";
import { normalizePath, onFileChange, readFileSync, readdirSync, statSync } from "./shims/vfs.ts";

/** One reload for a burst of writes - the assistant writing three files - not three. */
const RELOAD_DEBOUNCE_MS = 120;

const STOPPED: PreviewStatus = { running: false, url: null, root: null, error: null, mode: "static", label: null, starting: false };

let status: PreviewStatus = STOPPED;
let unwatch: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let reloadSink: (root: string) => void = () => undefined;
/** The page's own origin: a worker's `location` is the script's, which is the page's. */
let appOrigin: string = typeof location === "undefined" ? "http://localhost" : location.origin;

/** worker.ts says where a "reload now" goes (the page, then the bridge, then every preview page). */
export function setPreviewReloadSink(sink: (root: string) => void): void {
  reloadSink = sink;
}

/** For tests: the app origin the preview address is built from. */
export function setPreviewAppOrigin(origin: string): void {
  appOrigin = origin;
}

export function liveServerStatus(): PreviewStatus {
  return status;
}

export async function startLiveServer(root: string | null): Promise<PreviewStatus> {
  if (root === null) {
    status = { ...STOPPED, error: "Open a folder first - there is nothing to serve yet." };
    return status;
  }
  await stopLiveServer();
  const at = normalizePath(root);
  unwatch = onFileChange((path) => {
    if (path === at || path.startsWith(`${at}/`)) scheduleReload(at);
  });
  status = { ...STOPPED, running: true, url: previewUrlFor(appOrigin, at), root: at };
  return status;
}

export async function stopLiveServer(): Promise<PreviewStatus> {
  if (reloadTimer !== null) clearTimeout(reloadTimer);
  reloadTimer = null;
  unwatch?.();
  unwatch = null;
  status = STOPPED;
  return status;
}

function scheduleReload(root: string): void {
  if (reloadTimer !== null) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    reloadSink(root);
  }, RELOAD_DEBOUNCE_MS);
}

/**
 * The reload half of the desktop's injected script, on a BroadcastChannel instead of an
 * EventSource: the bridge frame (same preview origin, same tab) posts on it when files change.
 * The address report to the Preview bar is the desktop's, unchanged.
 */
export const WEB_RELOAD_SCRIPT = `<script>
(function () {
  try {
    var channel = new BroadcastChannel(${JSON.stringify(PREVIEW_RELOAD_CHANNEL)});
    channel.onmessage = function (event) { if (event.data && event.data.type === "reload") location.reload(); };
  } catch (e) {}
  if (window.parent !== window) {
    var report = function () {
      try { window.parent.postMessage({ source: "adcode-preview-page", href: location.href }, "*"); } catch (e) {}
    };
    report();
    window.addEventListener("hashchange", report);
    window.addEventListener("popstate", report);
  }
})();
</script>`;

/** What the Service Worker turns into a Response. `active`: this tab is previewing that project. */
export interface PreviewReply {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly location?: string;
  readonly active: boolean;
}

const encoder = new TextEncoder();
const text = (code: number, message: string, active: boolean): PreviewReply => ({ status: code, contentType: "text/plain; charset=utf-8", body: encoder.encode(message), active });
const html = (body: string): PreviewReply => ({ status: 200, contentType: "text/html; charset=utf-8", body: encoder.encode(body), active: true });

/**
 * A preview origin path (`/preview/<folder>/css/site.css?v=2`) to a file of the project being
 * previewed. A path outside `/preview/` is a root-relative link (`href="/style.css"`), which on the
 * desktop resolves against the project's root, so here it does too.
 *
 * Refused: anything once the preview is stopped, another project's folder, a path that climbs
 * out of the project, and hidden files and folders (`.env`, `.git`): the preview origin is a
 * public address, and nothing a page needs lives in them.
 */
export function answerPreviewRequest(requestPath: string): PreviewReply {
  const root = status.running ? status.root : null;
  if (root === null) return text(404, "Nothing is being previewed. Press Preview in ADCode.", false);

  const raw = requestPath.split(/[?#]/)[0] ?? "/";
  let pathname: string;
  try {
    pathname = decodeURIComponent(raw);
  } catch {
    return text(400, "That address is not a path.", true);
  }
  if (pathname.includes("\0")) return text(400, "That address is not a path.", true);

  const name = root.slice(root.lastIndexOf("/") + 1);
  const prefix = `${PREVIEW_PATH_PREFIX}${name}/`;
  let relative: string;
  if (pathname === prefix.slice(0, -1)) return { ...text(301, "Moved", true), location: `${raw}/` };
  if (pathname.startsWith(prefix)) relative = pathname.slice(prefix.length - 1);
  else if (pathname.startsWith(PREVIEW_PATH_PREFIX)) return text(404, "That is another project's preview. Open it in ADCode and press Preview.", false);
  else relative = pathname;

  if (relative.split("/").some((part) => part.startsWith(".") && part !== ".well-known" && part !== "." && part !== "..")) {
    return text(404, `Not found: ${relative}`, true);
  }
  const target = normalizePath(`${root}/${relative}`);
  if (target !== root && !target.startsWith(`${root}/`)) return text(403, "Outside the open folder.", true);

  const info = statSync(target, { throwIfNoEntry: false });
  if (info === undefined) return text(404, `Not found: ${relative}`, true);
  if (info.isDirectory()) {
    if (!raw.endsWith("/")) return { ...text(301, "Moved", true), location: `${raw}/` };
    const index = `${target === "/" ? "" : target}/index.html`;
    if (statSync(index, { throwIfNoEntry: false })?.isFile() === true) return serveFile(index);
    const names = (readdirSync(target) as string[]).filter((entry) => !entry.startsWith("."));
    return html(directoryListing(pathname, names, WEB_RELOAD_SCRIPT));
  }
  return serveFile(target);
}

function serveFile(path: string): PreviewReply {
  const contentType = contentTypeFor(path);
  if (contentType.startsWith("text/html")) return html(injectAdcodeScripts(readFileSync(path, "utf8") as string, WEB_RELOAD_SCRIPT));
  // A copy: the reply's buffer is handed (transferred) to the page, and the file must stay.
  const bytes = readFileSync(path) as Uint8Array;
  return { status: 200, contentType, body: new Uint8Array(bytes), active: true };
}
