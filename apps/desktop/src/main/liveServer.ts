/**
 * A static web server over the open folder, with reload on save.
 *
 * **What this is not.** It does not run `npm run dev`, bundle anything, resolve bare module
 * specifiers, or know what a framework is. "A live server that runs your project" is an
 * unbounded promise across every toolchain in existence; "a static server over your folder"
 * is one that can actually be kept. A beginner with `index.html`, `style.css` and
 * `script.js` gets a working preview from one click, which is the case this exists for. A
 * Vite project is already served by Vite, from the terminal that already ships.
 *
 * No `electron` import: this file is plain Node, so its behaviour is testable without
 * launching a window. `main/index.ts` owns the wiring.
 *
 * Security posture, which is not optional even for a loopback server:
 *
 * - Bound to `127.0.0.1`, never `0.0.0.0`. Publishing a beginner's project folder to every
 *   device on their network is not a default anybody asked for.
 * - Every request path goes through the same `isInsideWorkspace` check an IPC handler uses.
 *   Anything on the loopback interface can talk to this server - a browser tab on a hostile
 *   page included - so `GET /../../../../etc/passwd` is a real request, not a theoretical
 *   one, and it is refused before a byte is read.
 */
import { createReadStream } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { isInsideWorkspace } from "./pathSafety.ts";
import type { PreviewStatus } from "../shared/api.ts";

/** The reload channel. Prefixed so it cannot collide with a real file in the workspace. */
export const RELOAD_PATH = "/__adcode/reload";

/** A change storm - a build writing forty files - should cost one reload, not forty. */
const RELOAD_DEBOUNCE_MS = 120;

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

export function contentTypeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The four lines that make it live.
 *
 * Server-Sent Events rather than a WebSocket: the traffic is one-directional, there is no
 * handshake to get wrong, no dependency to add, and the client is small enough to read in
 * full. `EventSource` reconnects on its own, so a restarted server heals without the page
 * needing to know a server ever went away.
 */
const RELOAD_SCRIPT = `<script>
(function () {
  var source = new EventSource(${JSON.stringify(RELOAD_PATH)});
  source.addEventListener("reload", function () { location.reload(); });
})();
</script>`;

/**
 * Put the reload script in the page.
 *
 * Before `</body>` when there is one, appended when there is not - a fragment with no body
 * tag is still perfectly good HTML to a browser, and half-written markup is the normal
 * state of a file someone is learning on. This must never be the reason a page fails to
 * render.
 */
export function injectReloadScript(html: string): string {
  const index = html.toLowerCase().lastIndexOf("</body>");
  if (index === -1) return `${html}\n${RELOAD_SCRIPT}`;

  return `${html.slice(0, index)}${RELOAD_SCRIPT}\n${html.slice(index)}`;
}

export function escapeHtml(value: string): string {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

/**
 * Turn a request URL into a path inside the workspace, or `null`.
 *
 * `null` is the only failure mode on purpose: a caller cannot accidentally distinguish
 * "escaped the root" from "does not exist" and leak which one it was.
 */
export function resolveRequestPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    // A malformed percent-escape is not a path. Refusing beats guessing at an intent.
    return null;
  }

  // A NUL byte can truncate a path inside a native syscall, so a request for
  // `ok.html<NUL>.png` may open `ok.html` while passing any check that only looked at the
  // whole string. The same guard `pathSafety.ts` carries, for the same reason.
  if (/\0/.test(decoded)) return null;

  // Normalise before joining, and check after: `normalize` is what collapses `..`, and a
  // check performed before it would be checking a string the filesystem never sees.
  const relative = normalize(decoded).replace(/^[\\/]+/, "");
  const candidate = resolve(join(root, relative));

  if (!isInsideWorkspace(root, candidate)) return null;
  return candidate;
}

export function directoryListing(urlPath: string, names: readonly string[]): string {
  const rows = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const href = `${urlPath.endsWith("/") ? urlPath : `${urlPath}/`}${encodeURIComponent(name)}`;
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></li>`;
    })
    .join("\n");

  // Deliberately plain. This page is scaffolding shown when a folder has no index.html; a
  // designed one would compete for attention with the project it is listing.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title>
<style>body{font:14px system-ui;margin:2rem;color:#1c1c1e}a{color:#007aff;text-decoration:none}
a:hover{text-decoration:underline}li{margin:.25rem 0}h1{font-size:1rem;color:#6c6c70;font-weight:600}</style>
</head><body><h1>${escapeHtml(urlPath)}</h1><ul>${rows}</ul>
<p style="color:#a1a1a6;margin-top:2rem">No <code>index.html</code> in this folder, so ADCode listed it instead.</p>
${RELOAD_SCRIPT}</body></html>`;
}

/**
 * The state the renderer sees, defined in `shared/api.ts` so main, preload and renderer
 * cannot drift apart about it.
 */
export type LiveServerStatus = PreviewStatus;

const STOPPED: LiveServerStatus = {
  running: false,
  url: null,
  root: null,
  error: null,
  mode: "static",
  // Neither applies to a file server: there is no command being run and nothing to wait
  // for. They exist on the shared status so the renderer draws one shape either way.
  label: null,
  starting: false,
};

let server: Server | null = null;
let watcher: FSWatcher | null = null;
let clients: ServerResponse[] = [];
let status: LiveServerStatus = STOPPED;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export function liveServerStatus(): LiveServerStatus {
  return status;
}

function broadcastReload(): void {
  if (reloadTimer !== null) clearTimeout(reloadTimer);

  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    for (const client of clients) {
      // A stream can end between the debounce firing and this line - a page navigating
      // away is exactly that - and writing to an ended response throws.
      if (!client.writableEnded) client.write("event: reload\ndata: 1\n\n");
    }
  }, RELOAD_DEBOUNCE_MS);
}

async function handle(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = request.url ?? "/";

  if (url === RELOAD_PATH) {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");

    clients.push(response);
    request.on("close", () => {
      clients = clients.filter((client) => client !== response);
    });
    return;
  }

  const pathname = url.split("?")[0] ?? "/";
  const resolved = resolveRequestPath(root, pathname);

  if (resolved === null) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Outside the open folder.");
    return;
  }

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Not found: ${pathname}`);
    return;
  }

  if (info.isDirectory()) {
    const index = join(resolved, "index.html");

    try {
      await stat(index);
      await sendFile(index, response);
      return;
    } catch {
      const names = await readdir(resolved);
      const body = directoryListing(pathname, names);

      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }
  }

  await sendFile(resolved, response);
}

async function sendFile(path: string, response: ServerResponse): Promise<void> {
  const type = contentTypeFor(path);

  // `no-store` throughout. A cached asset is the single most common reason a beginner
  // concludes that their edit "did nothing", and this server exists to make edits visible.
  if (type.startsWith("text/html")) {
    const html = await readFile(path, "utf8");

    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(injectReloadScript(html));
    return;
  }

  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  createReadStream(path).pipe(response);
}

function startWatching(root: string): void {
  /*
   * Recursive watching is supported on Windows and macOS but not on Linux, where the flag
   * is silently useless or throws depending on the kernel. Falling back to a shallow watch
   * means a Linux user still gets reloads for files in the folder they opened, which is
   * where a beginner's index.html lives, rather than getting an error about inotify.
   */
  try {
    watcher = watch(root, { recursive: true }, () => broadcastReload());
  } catch {
    try {
      watcher = watch(root, () => broadcastReload());
    } catch {
      watcher = null;
    }
  }
}

export async function startLiveServer(root: string | null): Promise<LiveServerStatus> {
  if (root === null) {
    status = { ...STOPPED, error: "Open a folder first - there is nothing to serve yet." };
    return status;
  }

  await stopLiveServer();

  return new Promise<LiveServerStatus>((settle) => {
    const created = createServer((request, response) => {
      void handle(root, request, response).catch(() => {
        // A failed request must never take the server with it: the user is mid-edit, and
        // a preview that dies on one bad path is worse than one that 500s on it.
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    });

    created.on("error", (error: NodeJS.ErrnoException) => {
      server = null;
      status = {
        ...STOPPED,
        error:
          error.code === "EADDRINUSE"
            ? "That port is already in use."
            : `The preview server could not start: ${error.message}`,
      };
      settle(status);
    });

    // Port 0 asks the OS for a free one. A fixed port would collide with whatever else the
    // user has running, and the failure would look like ADCode being broken.
    created.listen(0, "127.0.0.1", () => {
      const address = created.address();
      if (address === null || typeof address === "string") {
        status = { ...STOPPED, error: "The preview server started but reported no address." };
        settle(status);
        return;
      }

      server = created;
      startWatching(root);

      status = {
        ...STOPPED,
        running: true,
        url: `http://127.0.0.1:${address.port}/`,
        root,
      };
      settle(status);
    });
  });
}

export async function stopLiveServer(): Promise<LiveServerStatus> {
  if (reloadTimer !== null) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }

  watcher?.close();
  watcher = null;

  for (const client of clients) client.end();
  clients = [];

  const running = server;
  server = null;
  status = STOPPED;

  if (running === null) return status;

  await new Promise<void>((done) => {
    running.close(() => done());
    // An open SSE stream keeps a socket alive, and `close` waits for every one of them.
    // The streams are already ended above; this is the belt for the braces.
    running.closeAllConnections?.();
  });

  return status;
}
