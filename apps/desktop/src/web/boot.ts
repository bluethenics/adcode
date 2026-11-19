/**
 * The web version's entry point: open browser chat first; compute is an explicit action.
 *
 * The renderer is the desktop's, unchanged. What it needs from its surroundings is a
 * `window.adcode` that answers like the preload does, and that has to exist before the
 * renderer's first line runs - hence the dynamic import at the end, after the socket is up
 * and the sandbox has said hello.
 */
import "../renderer/styles/tokens.css";
import "../renderer/styles/webTheme.css";
import "./web.css";
import { CHANNELS, type PreviewStatus } from "../shared/api.ts";
import { createPreviewResolver, primePreviewCookie, rewriteStatus } from "./previewUrl.ts";
import { OPEN_WEB_ACCOUNT_EVENT, DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";
import { createAskHandler } from "./asks.ts";
import { gate, hideGate, showWaking } from "./gate.ts";
import { connectGitHub, needsGitHub } from "./githubConnect.ts";
import { importFromGitHub, uploadDialog } from "./projectActions.ts";
import { pickProjectFolder, type ProjectSummary } from "./projectPicker.ts";
import { createHostSocket, type HostSocket, type WebSocketLike } from "./socket.ts";
import { mountStatusBar, OPEN_CLOUD_WORKSPACE_EVENT } from "./statusBar.ts";
import { openCloudPanel } from "./cloudPanel.ts";
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

function socketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/socket`;
}

function localOverrides(socket: HostSocket, signOut: () => Promise<void>): LocalOverrides {
  // The sandbox's dev server says `localhost:5173`; the Preview pane is given the public address.
  const resolvePreview = createPreviewResolver(socket, primePreviewCookie);
  const rewrite = (status: unknown) => rewriteStatus(status as PreviewStatus, resolvePreview);
  // A push, pull or fetch that fails for want of GitHub credentials offers to connect, then tries once more.
  const withGitHub = (channel: string) => (async () => {
    const first = (await socket.invoke(channel, [])) as { ok: boolean; message?: string };
    if (!needsGitHub(first) || !(await connectGitHub(socket))) return first;
    return socket.invoke(channel, []);
  }) as never;
  return {
    "git.push": withGitHub(CHANNELS.gitPush),
    "git.pull": withGitHub(CHANNELS.gitPull),
    "git.fetch": withGitHub(CHANNELS.gitFetch),
    "preview.status": (() => socket.invoke(CHANNELS.previewStatus, []).then(rewrite)) as never,
    "preview.start": ((mode?: unknown) => socket.invoke(CHANNELS.previewStart, [mode]).then(rewrite)) as never,
    "preview.stop": (() => socket.invoke(CHANNELS.previewStop, []).then(rewrite)) as never,
    "preview.onChange": ((listener: (status: PreviewStatus) => void) =>
      socket.subscribe(CHANNELS.previewChanged, (status) => void rewrite(status).then(listener))) as never,
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

async function boot(): Promise<void> {
  document.documentElement.dataset["surface"] = "web";
  // `#/ide` is how the desktop opens its Code window; the web is only ever Vibe.
  if (location.hash.length > 0) history.replaceState(null, "", location.pathname + location.search);

  const session = await gate();
  const showAccount = (section: unknown = "overview"): void => {
    void import("./accountPanel.tsx").then(({ openAccountPanel }) => openAccountPanel(session, section))
      .catch(() => window.alert("Couldn't load your account. Please reload and try again."));
  };
  document.addEventListener(OPEN_WEB_ACCOUNT_EVENT, (event) => showAccount((event as CustomEvent<unknown>).detail));
  const requestedAccount = new URL(location.href).searchParams.get("account");
  if (requestedAccount !== null) showAccount(requestedAccount);

  const params = new URL(location.href).searchParams;
  // Local host smoke tests keep their existing development workbench. Production opens
  // chat without even constructing a socket, regardless of available runtime capacity.
  const runtimeRequested = params.get("workspace") === "run" || (__ADCODE_WEB_DEV__ && params.get("browser") !== "1");
  if (!runtimeRequested) {
    for (const child of document.body.children) {
      if (child instanceof HTMLElement && child.id !== "web-gate" && !["SCRIPT", "STYLE"].includes(child.tagName) && !child.classList.contains("web-account-dialog")) child.dataset["webDesktopRoot"] = "true";
    }
    document.body.dataset["webMode"] = "browser";
    const { mountBrowserWorkspace } = await import("./browserWorkspace.ts");
    const workspace = mountBrowserWorkspace({
      session,
      onAccount: showAccount,
      onRunPreview: async () => {
        const target = new URL(location.href);
        target.searchParams.delete("account");
        target.searchParams.set("workspace", "run");
        location.assign(target.href);
      },
    });
    let stopAds: (() => void) | undefined;
    let leaving = false;
    window.addEventListener("pagehide", () => { leaving = true; workspace.dispose(); stopAds?.(); }, { once: true });
    void import("./browserAds.ts").then(({ mountBrowserAds }) => {
      if (!leaving) stopAds = mountBrowserAds(session).dispose;
    }).catch(() => undefined);
    hideGate();
    return;
  }
  document.body.dataset["webMode"] = "runtime";
  showWaking();

  let token = session.token;
  const socket = createHostSocket(() => {
    const protocols = token === null ? ["adcode.v1"] : ["adcode.v1", `auth.${token}`];
    return new WebSocket(socketUrl(), protocols) as unknown as WebSocketLike;
  });

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

  // Before waiting for the sandbox: if the cloud refuses (no time left, the month is full, signed
  // out), the sandbox never says hello, and only the status bar can tell the person why.
  const bar = mountStatusBar(socket, session);

  await socket.ready();

  socket.onAsk(createAskHandler({
    openWindow: (url) => {
      window.open(url, "_blank", "noopener");
    },
    rewriteUrl: (url) => socket.previewUrl(url),
    pickFolder: () => pickProjectFolder({
      listProjects: () => socket.op("projects", []) as Promise<ProjectSummary[]>,
      extras: [
        { label: "Import from GitHub", run: () => importFromGitHub(socket) },
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
  document.addEventListener(OPEN_CLOUD_WORKSPACE_EVENT, () => openCloudPanel({
    socket,
    status: bar.status,
    token: () => session.refresh(false),
    signOut: session.signOut,
  }));
  // Every help surface (Feature library, search, guide, settings) offers only what the web can reach.
  setFeatureSurface("web");

  if (__ADCODE_WEB_DEV__) {
    (window as unknown as { __adcodeTestDrop?: () => void }).__adcodeTestDrop = () => socket.dropForTest();
    (window as unknown as { __adcodeTestOp?: HostSocket["op"] }).__adcodeTestOp = (name, args) => socket.op(name, args);
  }

  await import("../renderer/main.ts");
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
