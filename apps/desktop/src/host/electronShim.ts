/**
 * `electron`, for a main process that runs in a cloud sandbox instead of Electron.
 *
 * adcode-host bundles `src/main` with the module specifier `electron` pointed here. Everything
 * the main process uses is covered, and nothing more:
 *
 * - `ipcMain` registrations go to the socket dispatcher.
 * - `BrowserWindow.getAllWindows()` is one window per connected tab, and `webContents.send`
 *   becomes an `evt` frame on that tab.
 * - Dialogs, opening a link and the clipboard become questions for the browser, which is
 *   where the person is.
 * - `app.getPath` points into the sandbox home.
 * - `safeStorage` seals with the per-user key the cloud passes in.
 *
 * Desktop-only surfaces (menus, the `app://` protocol, permission handlers) do nothing here,
 * because on the web the browser and the cloud Worker own them.
 */
import { EventEmitter } from "node:events";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { mkdir, rename } from "node:fs/promises";
import {
  Dispatcher,
  destroyWebContents,
  webContentsFor,
  type HostConnection,
  type ShimWebContents,
} from "./dispatcher.ts";
import { sealString, unsealString } from "../browserHost/seal.ts";

declare const __ADCODE_VERSION__: string | undefined;

/** The one dispatcher every `ipcMain` registration lands in. */
export const dispatcher = new Dispatcher();

/* ── Windows: one per connected tab ─────────────────────────────────────── */

const connections = new Map<number, HostConnection>();
const windows = new Map<number, ShimWindow>();

export class ShimWindow {
  readonly id: number;
  readonly webContents: ShimWebContents;
  private destroyed = false;

  constructor(connection: HostConnection) {
    this.id = connection.id;
    this.webContents = webContentsFor(connection);
  }

  static getAllWindows(): ShimWindow[] {
    return [...windows.values()];
  }

  static getFocusedWindow(): ShimWindow | null {
    for (const [id, connection] of connections) if (connection.focused) return windows.get(id) ?? null;
    return null;
  }

  static fromWebContents(contents: { id: number } | null | undefined): ShimWindow | null {
    return contents === null || contents === undefined ? null : windows.get(contents.id) ?? null;
  }

  static fromId(id: number): ShimWindow | null {
    return windows.get(id) ?? null;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** @internal Called when the tab disconnects. */
  markDestroyed(): void {
    this.destroyed = true;
  }

  isFocused(): boolean {
    return connections.get(this.id)?.focused === true;
  }

  isMinimized(): boolean { return false; }
  isFullScreen(): boolean { return false; }
  isVisible(): boolean { return !this.destroyed; }
  setFullScreen(): void {}
  show(): void {}
  focus(): void {}
  restore(): void {}
  close(): void {}
  destroy(): void {}
  setMenuBarVisibility(): void {}
  setTitle(): void {}
  on(): this { return this; }
  once(): this { return this; }
  removeListener(): this { return this; }
}

/** `new BrowserWindow()` has no meaning in a sandbox; only the agent's browser tries it, and the host replaces that. */
export const BrowserWindow = new Proxy(ShimWindow, {
  construct() {
    throw new Error("Windows are not available on the web");
  },
}) as unknown as typeof ShimWindow;

export function attachConnection(connection: HostConnection): ShimWindow {
  const window = new ShimWindow(connection);
  connections.set(connection.id, connection);
  windows.set(connection.id, window);
  return window;
}

export function detachConnection(id: number): void {
  const connection = connections.get(id);
  windows.get(id)?.markDestroyed();
  if (connection !== undefined) destroyWebContents(connection);
  connections.delete(id);
  windows.delete(id);
}

/** The tab a question should go to: the focused one, else the most recently connected. */
function askTarget(): HostConnection | null {
  let latest: HostConnection | null = null;
  for (const connection of connections.values()) {
    if (connection.focused) return connection;
    latest = connection;
  }
  return latest;
}

async function askBrowser(kind: Parameters<HostConnection["ask"]>[0], payload: unknown): Promise<unknown> {
  const target = askTarget();
  if (target === null) return null;
  try {
    return await target.ask(kind, payload);
  } catch {
    return null;
  }
}

export const webContents = {
  getAllWebContents: (): ShimWebContents[] => [...windows.values()].map((window) => window.webContents),
  fromId: (id: number): ShimWebContents | undefined => windows.get(id)?.webContents,
  getFocusedWebContents: (): ShimWebContents | null => ShimWindow.getFocusedWindow()?.webContents ?? null,
};

/* ── ipcMain ───────────────────────────────────────────────────────────── */

export const ipcMain = {
  handle: (channel: string, handler: Parameters<Dispatcher["handle"]>[1]): void => dispatcher.handle(channel, handler),
  handleOnce: (channel: string, handler: Parameters<Dispatcher["handle"]>[1]): void => dispatcher.handleOnce(channel, handler),
  removeHandler: (channel: string): void => dispatcher.removeHandler(channel),
  on: (channel: string, listener: Parameters<Dispatcher["on"]>[1]) => {
    dispatcher.on(channel, listener);
    return ipcMain;
  },
  once: (channel: string, listener: Parameters<Dispatcher["on"]>[1]) => {
    dispatcher.once(channel, listener);
    return ipcMain;
  },
  removeListener: (channel: string, listener: Parameters<Dispatcher["on"]>[1]) => {
    dispatcher.removeListener(channel, listener);
    return ipcMain;
  },
  off: (channel: string, listener: Parameters<Dispatcher["on"]>[1]) => {
    dispatcher.removeListener(channel, listener);
    return ipcMain;
  },
  removeAllListeners: (channel?: string) => {
    dispatcher.removeAllListeners(channel);
    return ipcMain;
  },
};

/* ── app ───────────────────────────────────────────────────────────────── */

const home = (): string => process.env["ADCODE_HOME"] ?? homedir();
const pathOverrides = new Map<string, string>();

class ShimApp extends EventEmitter {
  name = "ADCode";
  readonly isPackaged = process.env["ADCODE_CLOUD_DEV"] !== "1";

  getPath(name: string): string {
    const override = pathOverrides.get(name);
    if (override !== undefined) return override;
    switch (name) {
      case "userData":
      case "appData":
        return process.env["ADCODE_USER_DATA_DIR"] ?? join(home(), ".adcode");
      case "temp":
        return tmpdir();
      case "logs":
        return join(process.env["ADCODE_USER_DATA_DIR"] ?? join(home(), ".adcode"), "logs");
      default:
        return home();
    }
  }

  setPath(name: string, path: string): void {
    pathOverrides.set(name, path);
  }

  getVersion(): string {
    return typeof __ADCODE_VERSION__ === "string" ? __ADCODE_VERSION__ : "0.0.0-web";
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
  }

  getLocale(): string {
    return process.env["LANG"]?.split(/[._]/)[0]?.replace("_", "-") ?? "en-US";
  }

  getAppPath(): string {
    return process.env["ADCODE_APP_PATH"] ?? process.cwd();
  }

  isReady(): boolean {
    return true;
  }

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  requestSingleInstanceLock(): boolean {
    return true;
  }

  setAppUserModelId(): void {}

  quit(): void {
    this.emit("before-quit");
    this.emit("will-quit");
  }

  exit(code = 0): void {
    process.exit(code);
  }
}

export const app = new ShimApp();

/* ── shell, dialog, clipboard ──────────────────────────────────────────── */

export const shell = {
  openExternal: async (url: string): Promise<void> => {
    await askBrowser("openExternal", { url });
  },
  /** A sandbox has no recycle bin, so "trash" moves the file into one inside the user's data. */
  trashItem: async (path: string): Promise<void> => {
    const bin = join(app.getPath("userData"), "trash");
    await mkdir(bin, { recursive: true });
    await rename(path, join(bin, `${Date.now()}-${basename(path)}`));
  },
  showItemInFolder: (): void => {},
  openPath: async (): Promise<string> => "Opening folders is not available on the web",
  beep: (): void => {},
};

interface OpenDialogOptions {
  readonly properties?: readonly string[];
  readonly title?: string;
}

export const dialog = {
  showOpenDialog: async (...args: unknown[]): Promise<{ canceled: boolean; filePaths: string[] }> => {
    const options = (args.length > 1 ? args[1] : args[0]) as OpenDialogOptions | undefined;
    const wantsFolder = options?.properties?.includes("openDirectory") === true;
    const answer = (await askBrowser(wantsFolder ? "pickFolder" : "pickFile", { title: options?.title ?? null })) as { path?: unknown } | null;
    const path = answer?.path;
    return typeof path === "string" && path.length > 0 ? { canceled: false, filePaths: [path] } : { canceled: true, filePaths: [] };
  },
  /** Saving goes through a browser download on the web; the bridge handles the two callers before they get here. */
  showSaveDialog: async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true }),
  showMessageBox: async (...args: unknown[]): Promise<{ response: number; checkboxChecked: boolean }> => {
    const options = (args.length > 1 ? args[1] : args[0]) as { message?: string; detail?: string; buttons?: string[] } | undefined;
    const answer = (await askBrowser("confirm", { message: options?.message ?? "", detail: options?.detail ?? "", buttons: options?.buttons ?? [] })) as { response?: unknown } | null;
    return { response: typeof answer?.response === "number" ? answer.response : 0, checkboxChecked: false };
  },
  showErrorBox: (): void => {},
};

const CLIPBOARD_TIMEOUT_MS = 3_000;

export const clipboard = {
  /** Synchronous in Electron; the web can only answer asynchronously, so callers that await get the text. */
  readText: (): string => {
    void askBrowser("clipboardRead", null);
    return "";
  },
  writeText: (text: string): void => {
    void askBrowser("clipboardWrite", { text });
  },
};

/** The asynchronous read the host uses where it needs the clipboard's contents. */
export async function readClipboardText(): Promise<string> {
  const answer = (await Promise.race([
    askBrowser("clipboardRead", null),
    new Promise((resolve) => setTimeout(() => resolve(null), CLIPBOARD_TIMEOUT_MS)),
  ])) as { text?: unknown } | null;
  return typeof answer?.text === "string" ? answer.text : "";
}

/* ── safeStorage ───────────────────────────────────────────────────────── */

export const safeStorage = {
  isEncryptionAvailable: (): boolean => typeof process.env["ADCODE_SEAL_KEY"] === "string" && process.env["ADCODE_SEAL_KEY"].length > 0,
  encryptString: (plain: string): Buffer => {
    const key = process.env["ADCODE_SEAL_KEY"];
    if (key === undefined || key.length === 0) throw new Error("Encryption is not available");
    return sealString(plain, key);
  },
  decryptString: (sealed: Buffer): string => {
    const key = process.env["ADCODE_SEAL_KEY"];
    if (key === undefined || key.length === 0) throw new Error("Encryption is not available");
    return unsealString(Buffer.from(sealed), key);
  },
};

/* ── Desktop-only surfaces that do nothing here ────────────────────────── */

const inertSession = {
  setPermissionRequestHandler: (): void => {},
  setPermissionCheckHandler: (): void => {},
  setUserAgent: (): void => {},
  clearCache: async (): Promise<void> => {},
  clearStorageData: async (): Promise<void> => {},
  on: (): void => {},
  protocol: { handle: (): void => {} },
  webRequest: { onBeforeRequest: (): void => {}, onHeadersReceived: (): void => {} },
};

export const session = {
  defaultSession: inertSession,
  fromPartition: () => inertSession,
};

export const protocol = {
  registerSchemesAsPrivileged: (): void => {},
  handle: (): void => {},
  unhandle: (): void => {},
};

export const Menu = {
  buildFromTemplate: () => ({ popup: (): void => {}, items: [] }),
  setApplicationMenu: (): void => {},
  getApplicationMenu: () => null,
};

export const nativeImage = {
  createFromBuffer: (buffer: Buffer) => ({
    toPNG: (): Buffer => buffer,
    toJPEG: (): Buffer => buffer,
    toDataURL: (): string => `data:image/png;base64,${buffer.toString("base64")}`,
    isEmpty: (): boolean => buffer.length === 0,
    getSize: () => ({ width: 0, height: 0 }),
    resize: function resize() {
      return this;
    },
  }),
  createFromPath: () => nativeImage.createFromBuffer(Buffer.alloc(0)),
  createEmpty: () => nativeImage.createFromBuffer(Buffer.alloc(0)),
};

export const webUtils = {
  getPathForFile: (): string => "",
};

export const nativeTheme = { shouldUseDarkColors: true, themeSource: "system", on: (): void => {} };

export const powerMonitor = { on: (): void => {}, getSystemIdleTime: (): number => 0 };

/** A sandbox is kept running by the cloud's own rules while a chat works, not by a blocker. */
export const powerSaveBlocker = { start: (_type?: string): number => 0, stop: (_id?: number): void => {}, isStarted: (_id?: number): boolean => false };

/** No desktop to notify: the browser tab marks a chat that finished while nobody looked. */
export class Notification {
  static isSupported(): boolean {
    return false;
  }
  constructor(_options?: unknown) {}
  show(): void {}
  on(_event: string, _listener: () => void): this {
    return this;
  }
}

export default {
  app,
  ipcMain,
  BrowserWindow,
  webContents,
  shell,
  dialog,
  clipboard,
  safeStorage,
  session,
  protocol,
  Menu,
  nativeImage,
  webUtils,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  Notification,
};
