/**
 * The web version's entry point.
 *
 * The renderer is the desktop's, unchanged. What it needs from its surroundings is a
 * `window.adcode` that answers like the preload does, and that has to exist before the
 * renderer's first line runs - hence the dynamic import at the end, after the browser host
 * (the desktop's main process in a Web Worker, src/browserHost) has said hello.
 */
import "../renderer/styles/tokens.css";
import "../renderer/styles/webTheme.css";
import "./web.css";
import { CHANNELS, type PreviewStatus } from "../shared/api.ts";
import { mountPreviewBridge } from "./previewBridge.ts";
import { previewOriginFor } from "./previewOrigin.ts";
import { OPEN_FROM_GITHUB_EVENT, OPEN_WEB_ACCOUNT_EVENT, DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";
import { createAskHandler } from "./asks.ts";
import { gate, showWaking } from "./gate.ts";
import { uploadDialog } from "./projectActions.ts";
import { pickProjectFolder, type ProjectSummary } from "./projectPicker.ts";
import { createHostSocket, type HostSocket } from "./socket.ts";
import { mountStatusBar } from "./statusBar.ts";
import { startBrowserHost } from "./workerSocket.ts";
import { openFromGitHub } from "./githubRepoPicker.ts";
import { setFeatureSurface } from "@adcode/help";
import { createWebApi, type LocalOverrides } from "./webApi.ts";

declare const __ADCODE_WEB_DEV__: boolean;

/** The host asks for this when the sign-in token it holds is about to expire. */
const TOKEN_NEEDED_CHANNEL = "cloud:token-needed";
/** Firebase ID tokens last an hour; a fresh one goes over well before that. */
const TOKEN_REFRESH_MS = 50 * 60_000;
/** Activity is reported at most this often: enough to know the tab is in use, not a keystroke log. */
const INPUT_REPORT_MS = 30_000;

function download(name: string, contents: BlobPart, type = "text/plain"): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The browser host's script (vite.browserHost.config.ts), served beside the page. */
const BROWSER_HOST_URL = "/browser-host.js";

function localOverrides(socket: HostSocket, signOut: () => Promise<void>): LocalOverrides {
  return {
    // The web page's own sign-in is the account gate. The desktop's gate links a device through
    // a browser hand-off, which a cloud container cannot finish, so on the web it asked people who
    // had just signed in to sign in again and never let go (found 2026-11-21 by smoke:web-vibe).
    // Included AI still checks verification on the server, as it does for the desktop's "later".
    "platform.info": (() => socket.invoke(CHANNELS.platformInfo, []).then((info) => ({ ...(info as object), accountGate: false }))) as never,
    // The desktop opens only a loopback address in the system browser; here the preview origin opens in a tab.
    "preview.openExternal": (async () => {
      const status = (await socket.invoke(CHANNELS.previewStatus, [])) as PreviewStatus;
      if (status.url !== null && new URL(status.url).origin === previewOriginFor(location.origin)) window.open(status.url, "_blank", "noopener");
    }) as never,
    "clipboard.writeText": ((text: string) => navigator.clipboard.writeText(text).then(() => undefined)) as never,
    "clipboard.readText": (() => navigator.clipboard.readText().catch(() => "")) as never,
    "files.pathForDropped": (() => "") as never,
    "files.saveAs": (async (text: string, suggestedName: string) => {
      download(suggestedName, text);
      return suggestedName;
    }) as never,
    "debugLog.save": (async () => {
      const report = (await socket.invoke(CHANNELS.debugReport, [])) as string;
      const name = `adcode-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
      download(name, report);
      return name;
    }) as never,
    "window.toggleFullScreen": (() => {
      if (document.fullscreenElement === null) void document.documentElement.requestFullscreen().catch(() => undefined);
      else void document.exitFullscreen().catch(() => undefined);
    }) as never,
    "window.toggleDevTools": (() => undefined) as never,
    "window.zoom": (() => undefined) as never,
    "window.setZoom": (() => undefined) as never,
    // There is no second window on the web; the desktop app is where the full IDE lives.
    "window.openIde": (async () => {
      window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener");
    }) as never,
    "window.openVibe": (async () => undefined) as never,
    // A browser tab is one window: another project opens in another tab, from the web app itself.
    "window.openProject": (async () => false) as never,
    "account.signOut": (async () => {
      await signOut();
      return { state: "unavailable" };
    }) as never,
  };
}

function reportFocus(socket: HostSocket): void {
  const focused = (): boolean => document.visibilityState === "visible" && document.hasFocus();
  let last: boolean | null = null;
  const report = (): void => {
    const now = focused();
    if (now === last) return;
    last = now;
    socket.raw({ t: "focus", focused: now });
  };
  for (const name of ["focus", "blur"] as const) window.addEventListener(name, report);
  document.addEventListener("visibilitychange", report);
  socket.onStatus((state) => {
    if (state === "open") {
      last = null;
      report();
    }
  });
  report();
}

function reportInput(socket: HostSocket): void {
  let lastSent = 0;
  const note = (): void => {
    const now = Date.now();
    if (now - lastSent < INPUT_REPORT_MS) return;
    lastSent = now;
    socket.raw({ t: "input" });
  };
  for (const name of ["pointerdown", "keydown", "wheel", "touchstart"] as const) window.addEventListener(name, note, { passive: true, capture: true });
}

/**
 * On a phone, the page is the height of what is visible, so the message box rides above the
 * on-screen keyboard as it does in other chat apps. Chrome does this from the viewport meta
 * (interactive-widget=resizes-content); iOS Safari does not, and shrinks only the visual
 * viewport. Pinch-zoom also shrinks it, so the zoom is multiplied back out.
 */
function fitVisibleViewport(): void {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined || !window.matchMedia("(pointer: coarse)").matches) return;
  const fit = (): void => {
    document.documentElement.style.height = `${Math.round(viewport.height * viewport.scale)}px`;
    if (window.scrollY !== 0) window.scrollTo(0, 0);
  };
  viewport.addEventListener("resize", fit);
  fit();
}

async function boot(): Promise<void> {
  document.documentElement.dataset["surface"] = "web";
  fitVisibleViewport();
  // `#/ide` is how the desktop opens its Code window; the web is only ever Vibe.
  if (location.hash.length > 0) history.replaceState(null, "", location.pathname + location.search);

  /*
   * The web version's main process runs in this tab (2026-11-21): the desktop's own main-process
   * code in a Web Worker (src/browserHost), with projects from GitHub and nothing running on a
   * computer of the person's own. It starts now, while the person signs in, rather than after:
   * downloading and starting it takes a few seconds that the sign-in screen can hide. It needs
   * no account to start; the sign-in token goes to it as soon as there is one.
   */
  const browserHost = startBrowserHost(BROWSER_HOST_URL);
  // Preview answers from this tab's files, on an origin of its own (previewOrigin.ts).
  mountPreviewBridge(browserHost);
  // The worker writes its files to IndexedDB a moment after each change; going away, at once.
  window.addEventListener("pagehide", () => browserHost.flush());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") browserHost.flush(); });
  const socket = createHostSocket(() => browserHost.open());

  const session = await gate();
  const showAccount = (section: unknown = "overview"): void => {
    void import("./accountPanel.tsx").then(({ openAccountPanel }) => openAccountPanel(session, section))
      .catch(() => window.alert("Couldn't load your account. Please reload and try again."));
  };
  document.addEventListener(OPEN_WEB_ACCOUNT_EVENT, (event) => showAccount((event as CustomEvent<unknown>).detail));
  const requestedAccount = new URL(location.href).searchParams.get("account");
  if (requestedAccount !== null) showAccount(requestedAccount);

  document.body.dataset["webMode"] = "browser-host";
  showWaking();

  let token = session.token;

  const sendToken = async (force: boolean): Promise<void> => {
    const fresh = await session.refresh(force).catch(() => null);
    if (fresh === null) return;
    token = fresh;
    socket.raw({ t: "auth", token: fresh });
  };
  if (token !== null) {
    socket.raw({ t: "auth", token });
    setInterval(() => void sendToken(true), TOKEN_REFRESH_MS);
  }
  socket.subscribe(TOKEN_NEEDED_CHANNEL, () => void sendToken(true));

  // Connection state (and, if the worker stops, why), before waiting for it to say hello.
  const bar = mountStatusBar(socket, session);

  socket.onAsk(createAskHandler({
    openWindow: (url) => {
      window.open(url, "_blank", "noopener");
    },
    rewriteUrl: (url) => socket.previewUrl(url),
    pickFolder: () => pickProjectFolder({
      listProjects: () => socket.op("projects", []) as Promise<ProjectSummary[]>,
      // On the web, projects come from GitHub (browserHost/githubProjects.ts), or an upload.
      extras: [
        { label: "Open from GitHub", run: () => openFromGitHub(socket) },
        { label: "Upload a project", run: () => uploadDialog(socket) },
      ],
    }),
    pickFile: async () => null,
    confirm: async (message, detail, buttons) => {
      const accept = buttons.length > 1 ? buttons.length - 1 : 0;
      return window.confirm(detail.length > 0 ? `${message}\n\n${detail}` : message) ? accept : 0;
    },
    readClipboard: () => navigator.clipboard.readText(),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
  }));

  // Read-only in the renderer's typing, because there the preload owns it; here, this is the preload.
  Object.defineProperty(window, "adcode", { value: createWebApi(socket, localOverrides(socket, session.signOut)), configurable: false, writable: false });
  reportFocus(socket);
  reportInput(socket);
  // Open from GitHub, from the command palette and the Feature library (`github.openRepository`).
  document.addEventListener(OPEN_FROM_GITHUB_EVENT, (event) => {
    const open = (event as CustomEvent<{ open?: (root: string) => void }>).detail?.open;
    void openFromGitHub(socket).then((root) => { if (root !== null) open?.(root); });
  });
  // Every help surface (Feature library, search, guide, settings) offers only what the web can reach.
  setFeatureSurface("web");

  if (__ADCODE_WEB_DEV__) {
    (window as unknown as { __adcodeTestDrop?: () => void }).__adcodeTestDrop = () => socket.dropForTest();
    (window as unknown as { __adcodeTestOp?: HostSocket["op"] }).__adcodeTestOp = (name, args) => socket.op(name, args);
    // A sign-in for smokes: dev mode has none, and the browser host needs one to reach /api (smoke-web.mjs).
    (window as unknown as { __adcodeTestAuth?: (token: string) => void }).__adcodeTestAuth = (fake) => socket.raw({ t: "auth", token: fake });
  }

  // The renderer loads while the worker finishes starting: calls it makes before the worker says
  // hello wait in the socket and go out the moment it does (socket.ts), so neither waits on the other.
  await Promise.all([socket.ready(), import("../renderer/main.ts")]);
  // After the renderer's own sheets, so the frame's layout wins without fighting specificity.
  // It is the same file the desktop's Vibe window loads - see `styles/webFrame.css`.
  await import("../renderer/styles/webFrame.css");
  document.body.dataset["shell"] = "ready";
  bar.rendererLoaded();
}

void boot().catch((error: unknown) => {
  console.error("[adcode] the web version failed to start", error);
  showWaking("ADCode couldn't start.", "Reload the page to try again. If it keeps happening, the desktop app works offline.");
});
