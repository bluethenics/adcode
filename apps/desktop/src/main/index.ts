/**
 * Window lifecycle and the security posture.
 *
 * Brief §1: "Electron security posture is non-negotiable: contextIsolation: true,
 * nodeIntegration: false, sandbox: true, a strict CSP, and all privileged operations
 * behind an explicit contextBridge API. The renderer opens untrusted content (repo
 * files, model output, ad creatives) and must be treated as hostile."
 *
 * Everything below follows from treating the renderer as an attacker who has already
 * won: it cannot require Node, cannot navigate anywhere, cannot open a window, cannot
 * be granted a permission, and can only reach the disk through handlers that confine
 * every path to the opened workspace.
 */
import { join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { registerAppProtocol, registerSchemePrivileges, RENDERER_ORIGIN } from "./protocol.ts";
import { registerIpc } from "./ipc.ts";
import { registerSupportIpc } from "./supportIpc.ts";
import { onUpdateStatus, registerUpdateIpc, startAutoUpdate } from "./autoUpdate.ts";
import { installApplicationMenu } from "./menu.ts";
import { disposeAllTerminals } from "./terminal.ts";
import { shutdownAllServers } from "./lsp.ts";
import { stopPreview } from "./preview.ts";
import { getAdRuntime } from "./adRuntime.ts";
import { currentSettings, loadSettings } from "./settings.ts";
import { CHANNELS } from "../shared/api.ts";

/**
 * Whether to load from Vite's dev server.
 *
 * Keyed on the dev server actually being there, not on `app.isPackaged`: running a
 * production build unpackaged is a normal thing to do, and gating on packaging would
 * skip the `app://` registration and leave the window with nothing to load.
 */
const devUrl = process.env["ELECTRON_RENDERER_URL"];
const useDevServer = !app.isPackaged && devUrl !== undefined;

/** A single instance keeps one workspace lock and one set of pty children. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Must run before app-ready: Electron only accepts scheme privileges at this point, and
// without them `app://` is neither a secure context nor able to start module workers.
registerSchemePrivileges();

function hardenWebContents(contents: Electron.WebContents): void {
  // The renderer never opens a window. Anything that tries goes to the system browser,
  // which is also §1's rule for ad clicks: "never a webview, never in-editor navigation."
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Navigation away from our own origin is always a bug or an attack.
  contents.on("will-navigate", (event, url) => {
    const allowed = useDevServer ? devUrl : RENDERER_ORIGIN;
    if (allowed === undefined || !url.startsWith(allowed)) event.preventDefault();
  });

  contents.on("will-attach-webview", (event) => event.preventDefault());

  // No camera, microphone, geolocation, notifications, or anything else. An editor
  // needs none of it, and the renderer is hostile by assumption.
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    icon: join(import.meta.dirname, "../../../../build/icon.png"),
    minWidth: 680,
    minHeight: 420,
    // Painting the frame before the renderer is ready is what produces the white flash
    // every Electron app is recognised by. §7 budgets first paint under 1s; showing
    // late but correct beats showing early and blank.
    show: false,
    backgroundColor: "#1c1c1e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? { color: "#00000000", symbolColor: "#ffffff", height: 36 } : false,
    // §3: translucent chrome, backed by the platform's own material.
    ...(process.platform === "darwin" ? { vibrancy: "sidebar" as const } : {}),
    ...(process.platform === "win32" ? { backgroundMaterial: "mica" as const } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  hardenWebContents(window.webContents);

  window.once("ready-to-show", () => window.show());

  window.on("focus", () => {
    window.webContents.send("window:focus", true);
    getAdRuntime().setWindowFocused(true);
  });

  window.on("blur", () => {
    window.webContents.send("window:focus", false);
    getAdRuntime().setWindowFocused(false);
  });

  // §8.3: full-screen suppresses at render time - a second layer beneath the scheduler,
  // so a bug there still cannot put an ad over a demo.
  window.on("enter-full-screen", () => getAdRuntime().setSuppressed(true));
  window.on("leave-full-screen", () => getAdRuntime().setSuppressed(false));

  if (useDevServer && devUrl !== undefined) {
    void window.loadURL(devUrl);
  } else {
    void window.loadURL(`${RENDERER_ORIGIN}/index.html`);
  }

  return window;
}

void app.whenReady().then(() => {
  registerAppProtocol(useDevServer);
  registerIpc();
  registerSupportIpc();
  registerUpdateIpc();

  // Broadcast status to whatever window is open. Not awaited, and failures inside are
  // swallowed by the module: an update check must never delay first paint.
  onUpdateStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(CHANNELS.updateChanged, status);
    }
  });

  void startAutoUpdate(() => currentSettings()["adcode.updates.auto"] !== false);
  // Before the first window, so its accelerators are live from the first keystroke. Not
  // awaited: it reads the recents off disk, and a menu is not worth delaying a window for.
  void installApplicationMenu();

  createWindow();

  // Settings first, so the ad service's very first tick reads the user's real choices
  // rather than defaults. Still not awaited by window creation: §9 requires the ad
  // module never be on the critical path to first paint.
  void loadSettings()
    .then(() => getAdRuntime().start())
    .catch(() => undefined);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));

app.on("window-all-closed", () => {
  disposeAllTerminals();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  disposeAllTerminals();

  // Language servers and a project's dev server are both children that outlive us if
  // nobody says otherwise: an orphaned rust-analyzer keeps a core busy indexing a
  // workspace nobody has open, and an orphaned dev server keeps its port until reboot.
  void shutdownAllServers();
  void stopPreview();
});
