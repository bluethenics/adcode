/**
 * The preview origin's one script, served at `/__preview/bridge.js` beside bridge.html.
 *
 * Two jobs, by where the page is:
 *
 * - **The bridge** - bridge.html, framed invisibly by the ADCode tab (web/previewBridge.ts).
 *   It installs the Service Worker, then hands each question the worker asks on to the app,
 *   with the worker's reply port, and passes the app's "files changed" to every preview page of
 *   this origin in the tab, on a BroadcastChannel.
 * - **The starting page** - what any other address on this origin shows when the request reached
 *   the network because the Service Worker was not installed yet. It installs it, then loads the
 *   address again, which the worker now answers.
 *
 * A classic script, built on its own (vite.web.config.ts): its names are restated from
 * previewOrigin.ts, and test/webPreview.test.ts holds them equal.
 */
const BRIDGE_PATH = "/__preview/bridge.html";
const WORKER_PATH = "/preview-sw.js";
const RELOAD_CHANNEL = "adcode-preview";
const REQUEST = "adcode-preview-request";
const READY = "adcode-preview-bridge-ready";
const RELOAD = "adcode-preview-reload";

/** The app this origin belongs to: `preview.<app host>`. */
const app = location.hostname.startsWith("preview.") ? `${location.protocol}//${location.host.slice("preview.".length)}` : null;
const statusLine = document.getElementById("status");
const say = (text: string): void => {
  if (statusLine !== null) statusLine.textContent = text;
};

async function install(): Promise<void> {
  await navigator.serviceWorker.register(WORKER_PATH, { scope: "/" });
  await navigator.serviceWorker.ready;
}

function runBridge(appOrigin: string): void {
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; path?: unknown } | null;
    const port = event.ports[0];
    if (data === null || typeof data !== "object" || data.type !== REQUEST || typeof data.path !== "string" || port === undefined) return;
    window.parent.postMessage({ type: REQUEST, path: data.path }, appOrigin, [port]);
  });
  navigator.serviceWorker.startMessages();

  const pages = new BroadcastChannel(RELOAD_CHANNEL);
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== appOrigin) return;
    const data = event.data as { type?: unknown; root?: unknown } | null;
    if (data !== null && typeof data === "object" && data.type === RELOAD) pages.postMessage({ type: "reload", root: data.root });
  });

  install()
    .then(() => window.parent.postMessage({ type: READY }, appOrigin))
    .catch((error: unknown) => window.parent.postMessage({ type: READY, error: error instanceof Error ? error.message : String(error) }, appOrigin));
}

async function runStartingPage(): Promise<void> {
  // Controlled already, and still here: the worker passed this address through, so reloading would loop.
  if (navigator.serviceWorker.controller !== null) {
    say("This address is part of ADCode's preview, not of your project.");
    return;
  }
  try {
    await install();
    if (navigator.serviceWorker.controller === null) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
    }
    location.reload();
  } catch {
    say("This browser could not start the preview. Reload to try again, or open the project in the ADCode desktop app.");
  }
}

if (!("serviceWorker" in navigator)) {
  // Private windows in some browsers turn service workers off.
  say("This browser has service workers turned off, so it cannot show the preview. A normal window, or the ADCode desktop app, can.");
  if (app !== null && window.parent !== window) window.parent.postMessage({ type: READY, error: "no service workers" }, app);
} else if (location.pathname === BRIDGE_PATH && window.parent !== window && app !== null) {
  runBridge(app);
} else if (location.pathname === BRIDGE_PATH) {
  say("This page is part of ADCode's preview. Open ADCode on the web to use it.");
} else {
  void runStartingPage();
}

/* A module to the type checker, so its names stay its own; the build strips this line. */
export {};
