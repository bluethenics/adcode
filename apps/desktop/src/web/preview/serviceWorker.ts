/**
 * The preview origin's Service Worker, served at `/preview-sw.js` (web/previewOrigin.ts says why
 * the preview has an origin of its own).
 *
 * It answers every request on that origin - the project's pages, styles, scripts and images -
 * by asking the ADCode tab, whose browser host holds the files in memory. The way there is the
 * bridge: a hidden page of this origin inside the ADCode tab (bridge.ts), which hands the
 * question on to the app and the app to its worker. Only the bridge's own files pass through
 * to the network.
 *
 * A classic script, built on its own (vite.web.config.ts): no imports, so the names it shares
 * with previewOrigin.ts are restated, and test/webPreview.test.ts holds them equal.
 */
const BRIDGE_PATH = "/__preview/bridge.html";
const WORKER_PATH = "/preview-sw.js";
const OWN_FILES = "/__preview/";
const REQUEST = "adcode-preview-request";
/** A tab that is frozen in the background does not answer; the next one is asked. */
const ASK_TIMEOUT_MS = 8_000;

interface Reply { status: number; contentType: string; body: Uint8Array<ArrayBuffer>; location?: string; active: boolean }
interface WindowClient { url: string; postMessage(message: unknown, transfer: Transferable[]): void }
interface FetchEvent { request: Request; respondWith(response: Promise<Response>): void }
declare const self: {
  location: Location;
  clients: { matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClient[]>; claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: { waitUntil(promise: Promise<unknown>): void }) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
};

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === WORKER_PATH || url.pathname.startsWith(OWN_FILES)) return;
  event.respondWith(answer(event.request, url));
});

async function answer(request: Request, url: URL): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "The preview serves files; it does not take form posts or uploads.");
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const bridges = windows.filter((client) => new URL(client.url).pathname === BRIDGE_PATH);
  // Most recently focused first. A tab previewing this project wins over one that is not.
  let fallback: Reply | null = null;
  for (const bridge of bridges) {
    const reply = await ask(bridge, `${url.pathname}${url.search}`).catch(() => null);
    if (reply === null) continue;
    if (reply.active) return toResponse(reply, request);
    fallback ??= reply;
  }
  if (fallback !== null) return toResponse(fallback, request);
  return plain(503, "This preview's files are in an ADCode tab, and none is open. Open ADCode on the web and press Preview.");
}

function ask(bridge: WindowClient, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("The ADCode tab did not answer"));
    }, ASK_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent<Reply>) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    bridge.postMessage({ type: REQUEST, path }, [channel.port2]);
  });
}

function toResponse(reply: Reply, request: Request): Response {
  const headers = new Headers({ "content-type": reply.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" });
  if (reply.location !== undefined) headers.set("location", reply.location);
  const body = request.method === "HEAD" || reply.status === 301 ? null : reply.body;
  return new Response(body, { status: reply.status, headers });
}

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/* A module to the type checker, so its names stay its own; the build strips this line. */
export {};
