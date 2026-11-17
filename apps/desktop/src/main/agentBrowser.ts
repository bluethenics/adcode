import type { AgentBrowserView } from "../shared/api.ts";
/**
 * The agent's own browser: how `view_page` sees the running app.
 *
 * The model used to be able to start the live preview and nothing more - it could not open
 * a particular page, and it never saw one. So it claimed pages worked without having looked.
 * This gives it eyes: a real Chromium page, offscreen, that loads the app, runs the clicks
 * and keystrokes the model asks for, and reports what a person would see - the text, the
 * console, the requests that failed, and a screenshot.
 *
 * **Offscreen, in a window nobody sees.** A detached view never renders (no screenshot, no
 * layout), and a plain hidden window paints slowly; an offscreen window renders on demand.
 * It is still a `BrowserWindow`, so it must never keep the app alive: when the last other
 * window closes it goes too, and it closes itself after a few idle minutes.
 *
 * **Isolated browsing.** It opens local project servers and public HTTP(S) pages,
 * opens no popups, grants no permissions and downloads nothing.
 * Its session is in memory, so cookies and storage vanish with it. Pages may be local projects or public websites; everything they print is treated
 * as data, never as instructions.
 *
 * Driven through the DevTools protocol (`webContents.debugger`) rather than injected
 * scripts: real mouse and keyboard events reach the page exactly as a person's would, and
 * console output and network failures arrive as events instead of being scraped.
 */
import { BrowserWindow, session, type WebContents } from "electron";
import type { ImageBlock, ToolRunResult } from "@adcode/ai";
// Keep the browser distribution verbatim. Bundlers rewrite CommonJS guards in axe.source's
// function body, which can leave an unguarded `module.exports` inside the injected script.
import axeSource from "axe-core/axe.min.js?raw";
import { AXE_RUN_SCRIPT, MOTION_SCAN_SCRIPT, formatAccessibilityScan, formatMotionScan, type AccessibilityScan, type MotionScan } from "./pageAudit.ts";
import {
  focusForTypingScript,
  formatPageReport,
  isBrowserUrl,
  keyEvent,
  locateScript,
  presentScript,
  resolvePreviewPage,
  scrollScript,
  selectOptionScript,
  SNAPSHOT_SCRIPT,
  type PageAction,
  type PageSnapshot,
  type ViewPageRequest,
} from "./agentBrowserModel.ts";

/** In memory (no `persist:` prefix): nothing the agent's page stores outlives the app. */
export const AGENT_BROWSER_PARTITION = "adcode-agent-browser";

/**
 * What the agent's page is driven through. On the desktop it is the offscreen Electron window
 * below; the web version's sandbox has no Electron, so adcode-host supplies a headless Chromium
 * speaking the same DevTools protocol (`host/cdpBrowser.ts`). Everything after `openPage`
 * talks to this, never to a window.
 */
export interface PageTransport {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(listener: (method: string, params: Record<string, any>) => void): void;
  /** The address of the top document. */
  url(): string;
  closed(): boolean;
  close(): void;
  /** The desktop's offscreen window: it must never be the reason the app stays open. */
  readonly window?: BrowserWindow;
}

export type PageTransportFactory = () => Promise<PageTransport>;

let transportFactory: PageTransportFactory = () => electronTransport();

/** adcode-host's headless Chromium stands in for the offscreen window. The desktop never calls this. */
export function setAgentPageTransport(factory: PageTransportFactory): void {
  transportFactory = factory;
}

const IDLE_CLOSE_MS = 3 * 60_000;
const LOAD_TIMEOUT_MS = 20_000;
const QUIET_MS = 400;
const SCREENSHOT_MAX_WIDTH = 1280;
const MAX_LOG_LINES = 60;

/** Request types worth waiting for; EventSource and sockets never finish by design. */
const TRACKED_TYPES: ReadonlySet<string> = new Set(["Document", "Stylesheet", "Script", "Image", "Font", "XHR", "Fetch", "Media"]);

interface AgentPage {
  readonly transport: PageTransport;
  readonly send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => Promise<T>;
  readonly console: string[];
  readonly failed: string[];
  readonly inflight: Map<string, string>;
  readonly urls: Map<string, string>;
  lastNetwork: number;
  documentStatus: number | null;
  loadWaiters: Set<() => void>;
  /** The top document is loading. Frames inside it do not count: they have no load event here. */
  navigating: boolean;
  mainFrameId: string | null;
  viewport: { width: number; height: number };
}

let page: AgentPage | null = null;
let opening: Promise<AgentPage> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** One call at a time: two chats driving one page would read each other's clicks. */
let queue: Promise<unknown> = Promise.resolve();
let browserView: AgentBrowserView | null = null;
let browserSink: ((view: AgentBrowserView) => void) | null = null;
export function setAgentBrowserSink(sink: (view: AgentBrowserView) => void): void { browserSink = sink; }
export function readAgentBrowser(): AgentBrowserView | null { return browserView; }

/** Made the first time the browser opens, so no other window ever creates it by asking. */
let agentSession: Electron.Session | null = null;

/** The session the agent's pages live in, locked down once: nothing asked for is granted, nothing downloads. */
function lockedSession(): Electron.Session {
  if (agentSession !== null) return agentSession;
  const created = session.fromPartition(AGENT_BROWSER_PARTITION);
  created.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  created.setPermissionCheckHandler(() => false);
  created.on("will-download", (event) => event.preventDefault());
  agentSession = created;
  return created;
}

export function isAgentBrowserContents(contents: WebContents): boolean {
  return agentSession !== null && contents.session === agentSession;
}

/** The agent browser's own rules, applied instead of the workbench's when its contents are created. */
export function hardenAgentBrowser(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  const stayLocal = (event: Electron.Event, url: string): void => {
    if (!isBrowserUrl(url) && url !== "about:blank") event.preventDefault();
  };
  contents.on("will-navigate", stayLocal);
  contents.on("will-redirect", stayLocal);
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

export function isAgentBrowserWindow(window: BrowserWindow): boolean {
  return page !== null && page.transport.window === window;
}

export function closeAgentBrowser(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  const current = page;
  page = null;
  opening = null;
  if (current !== null && !current.transport.closed()) current.transport.close();
}

function touch(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeAgentBrowser, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s.`)), ms);
    }),
  ]);
}

function remember(lines: string[], line: string): void {
  lines.push(line.length > 500 ? `${line.slice(0, 500)}…` : line);
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
}

function describeArgument(arg: { type?: string; value?: unknown; description?: string; unserializableValue?: string }): string {
  if (arg.value !== undefined) return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
  return arg.unserializableValue ?? arg.description ?? arg.type ?? "";
}

function where(url: string | undefined, line: number | undefined): string {
  if (url === undefined || url.length === 0) return "";
  const short = url.replace(/^https?:\/\/[^/]+/, "");
  return ` (${short || "/"}${line === undefined ? "" : `:${line + 1}`})`;
}

/** The desktop's page: an offscreen window in the locked session, driven through its debugger. */
async function electronTransport(): Promise<PageTransport> {
  // Before the window: its contents are recognised by this session as they are created.
  const locked = lockedSession();
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: locked,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const contents = window.webContents;
  contents.setAudioMuted(true);
  contents.setFrameRate(15);
  // The debugger needs a document to attach to.
  await contents.loadURL("about:blank");
  contents.debugger.attach("1.3");
  // It must never be the reason the app stays open.
  window.on("closed", () => {
    if (page?.transport.window === window) page = null;
  });
  return {
    window,
    send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => contents.debugger.sendCommand(method, params) as Promise<T>,
    onEvent: (listener) => {
      contents.debugger.on("message", (_event, method: string, params: Record<string, any>) => listener(method, params));
    },
    url: () => (window.isDestroyed() ? "" : contents.getURL()),
    closed: () => window.isDestroyed(),
    close: () => {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

async function openPage(): Promise<AgentPage> {
  const transport = await transportFactory();
  const send = <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T> =>
    withTimeout(transport.send<T>(method, params), 30_000, method);

  const created: AgentPage = {
    transport,
    send,
    console: [],
    failed: [],
    inflight: new Map(),
    urls: new Map(),
    lastNetwork: Date.now(),
    documentStatus: null,
    loadWaiters: new Set(),
    navigating: false,
    mainFrameId: null,
    viewport: { width: 1280, height: 800 },
  };
  const loaded = (): void => {
    created.navigating = false;
    for (const waiter of created.loadWaiters) waiter();
    created.loadWaiters.clear();
  };

  transport.onEvent((method, params) => {
    switch (method) {
      case "Runtime.consoleAPICalled": {
        const type = params["type"] === "warning" ? "warning" : String(params["type"] ?? "log");
        const text = ((params["args"] ?? []) as Parameters<typeof describeArgument>[0][]).map(describeArgument).join(" ");
        const frame = params["stackTrace"]?.callFrames?.[0];
        remember(created.console, `${type}: ${text}${where(frame?.url, frame?.lineNumber)}`);
        break;
      }
      case "Runtime.exceptionThrown": {
        const details = params["exceptionDetails"] ?? {};
        const description = String(details.exception?.description ?? details.text ?? "Uncaught error").split("\n")[0];
        remember(created.console, `exception: ${description}${where(details.url, details.lineNumber)}`);
        break;
      }
      case "Log.entryAdded": {
        const entry = params["entry"] ?? {};
        // Network failures arrive as Network events too, with the address; this would repeat them.
        if (entry.source === "network" || (entry.level !== "error" && entry.level !== "warning")) break;
        remember(created.console, `${entry.level === "error" ? "error" : "warning"}: ${entry.text}${where(entry.url, entry.lineNumber)}`);
        break;
      }
      case "Network.requestWillBeSent": {
        const id = String(params["requestId"]);
        const url = String(params["request"]?.url ?? "");
        created.urls.set(id, url);
        if (TRACKED_TYPES.has(String(params["type"] ?? ""))) created.inflight.set(id, url);
        created.lastNetwork = Date.now();
        break;
      }
      case "Network.responseReceived": {
        const response = params["response"] ?? {};
        const status = Number(response.status ?? 0);
        if (params["type"] === "Document" && created.documentStatus === null) created.documentStatus = status;
        if (status >= 400 && !String(response.url ?? "").includes("/__adcode/")) remember(created.failed, `${status} ${response.url}`);
        break;
      }
      case "Network.loadingFinished":
        created.inflight.delete(String(params["requestId"]));
        created.lastNetwork = Date.now();
        break;
      case "Network.loadingFailed": {
        const id = String(params["requestId"]);
        created.inflight.delete(id);
        created.lastNetwork = Date.now();
        const url = created.urls.get(id) ?? "";
        if (params["canceled"] !== true && !url.includes("/__adcode/")) remember(created.failed, `${params["errorText"] ?? "failed"} ${url}`);
        break;
      }
      case "Page.frameStartedLoading":
        if (params["frameId"] === created.mainFrameId) created.navigating = true;
        break;
      // Stopped covers what load does not: a navigation that was refused or cancelled.
      case "Page.frameStoppedLoading":
        if (params["frameId"] === created.mainFrameId) loaded();
        break;
      case "Page.loadEventFired":
        loaded();
        break;
    }
  });

  await send("Page.enable");
  const tree = await send<{ frameTree?: { frame?: { id?: string } } }>("Page.getFrameTree");
  created.mainFrameId = tree.frameTree?.frame?.id ?? null;
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  return created;
}

async function ensurePage(): Promise<AgentPage> {
  if (page !== null && !page.transport.closed()) return page;
  opening ??= openPage().then((created) => {
    page = created;
    opening = null;
    return created;
  }, (error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** Close the agent's browser when it is the only window left. Call once, at startup. */
export function closeAgentBrowserWithLastWindow(app: Electron.App): void {
  app.on("browser-window-created", (_event, window) => {
    window.on("closed", () => {
      const others = BrowserWindow.getAllWindows().filter((other) => !other.isDestroyed() && !isAgentBrowserWindow(other));
      if (others.length === 0) closeAgentBrowser();
    });
  });
}

async function waitForLoad(target: AgentPage, timeoutMs: number): Promise<boolean> {
  if (!target.navigating) return true;
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      target.loadWaiters.delete(done);
      resolve(false);
    }, timeoutMs);
    target.loadWaiters.add(done);
  });
}

/** Until nothing the page needs is still loading, or `maxMs` has passed. */
async function waitForQuiet(target: AgentPage, maxMs: number): Promise<void> {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    if (target.inflight.size === 0 && Date.now() - target.lastNetwork >= QUIET_MS && !target.navigating) return;
    await delay(80);
  }
}

async function evaluate<T>(target: AgentPage, expression: string): Promise<T> {
  const result = await target.send<{ result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
  );
  if (result.exceptionDetails !== undefined) {
    throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "The script threw.").split("\n")[0]);
  }
  return result.result?.value as T;
}

async function navigate(target: AgentPage, url: string): Promise<string | null> {
  target.documentStatus = null;
  target.navigating = true;
  const result = await target.send<{ errorText?: string; loaderId?: string }>("Page.navigate", { url });
  if (typeof result.errorText === "string" && result.errorText.length > 0) {
    target.navigating = false;
    return result.errorText;
  }
  // No loader means the same document (a #hash on the page already open): nothing will load.
  if (result.loaderId === undefined) target.navigating = false;
  await waitForLoad(target, LOAD_TIMEOUT_MS);
  await waitForQuiet(target, 4_000);
  return null;
}

async function mouse(target: AgentPage, type: "mouseMoved" | "mousePressed" | "mouseReleased", x: number, y: number): Promise<void> {
  await target.send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: type === "mouseMoved" ? "none" : "left",
    buttons: type === "mousePressed" ? 1 : 0,
    clickCount: type === "mouseMoved" ? 0 : 1,
  });
}

async function press(target: AgentPage, name: string): Promise<boolean> {
  const key = keyEvent(name);
  if (key === null) return false;
  const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
  await target.send("Input.dispatchKeyEvent", { type: key.text === undefined ? "rawKeyDown" : "keyDown", ...base, ...(key.text === undefined ? {} : { text: key.text, unmodifiedText: key.text }) });
  await target.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  return true;
}

interface Located {
  readonly ok: boolean;
  readonly error?: string;
  readonly x?: number;
  readonly y?: number;
  readonly selector?: string | null;
  readonly label?: string;
}

const describeTarget = (action: PageAction, found?: Located): string => {
  const named = found?.label ? `"${found.label}"` : action.text !== undefined ? `"${action.text}"` : "";
  const selector = found?.selector ?? action.selector;
  return [named, selector ? `[${selector}]` : ""].filter(Boolean).join(" ");
};

/** After something that may navigate or fetch: let it land before the next step reads the page. */
async function settle(target: AgentPage, before: string): Promise<string> {
  await delay(120);
  if (target.navigating) await waitForLoad(target, LOAD_TIMEOUT_MS);
  await waitForQuiet(target, 2_500);
  const after = target.transport.url();
  return after !== before ? `, now on ${after}` : "";
}

/** Run one step; the line for the report, and whether to carry on. */
async function runAction(target: AgentPage, action: PageAction): Promise<{ line: string; ok: boolean }> {
  const before = target.transport.url();
  switch (action.type) {
    case "click":
    case "hover": {
      const found = await evaluate<Located>(target, locateScript(action.selector, action.text));
      if (!found.ok || found.x === undefined || found.y === undefined) return { line: `${action.type}: ${found.error ?? "not found"}`, ok: false };
      await mouse(target, "mouseMoved", found.x, found.y);
      if (action.type === "hover") return { line: `hover ${describeTarget(action, found)} - done`, ok: true };
      await mouse(target, "mousePressed", found.x, found.y);
      await mouse(target, "mouseReleased", found.x, found.y);
      return { line: `click ${describeTarget(action, found)} - done${await settle(target, before)}`, ok: true };
    }
    case "type": {
      const focused = await evaluate<Located>(target, focusForTypingScript(action.selector, action.text));
      if (!focused.ok) return { line: `type: ${focused.error ?? "no field"}`, ok: false };
      await target.send("Input.insertText", { text: action.value ?? "" });
      let line = `type ${JSON.stringify((action.value ?? "").slice(0, 60))} into ${focused.selector ?? "the focused field"} - done`;
      if (action.submit === true) {
        await press(target, "Enter");
        line += `, pressed Enter${await settle(target, before)}`;
      }
      return { line, ok: true };
    }
    case "press": {
      if (!(await press(target, action.key ?? ""))) return { line: `press: ${JSON.stringify(action.key)} is not a key name; try Enter, Tab, Escape or ArrowDown.`, ok: false };
      return { line: `press ${action.key} - done${await settle(target, before)}`, ok: true };
    }
    case "select": {
      const chose = await evaluate<{ ok: boolean; error?: string; chose?: string }>(target, selectOptionScript(action.selector ?? "", action.value ?? ""));
      if (!chose.ok) return { line: `select: ${chose.error ?? "failed"}`, ok: false };
      return { line: `select "${chose.chose}" in ${action.selector} - done${await settle(target, before)}`, ok: true };
    }
    case "scroll": {
      const scrolled = await evaluate<{ ok: boolean; error?: string; y?: number }>(target, scrollScript(action));
      if (!scrolled.ok) return { line: `scroll: ${scrolled.error ?? "failed"}`, ok: false };
      await waitForQuiet(target, 1_500);
      return { line: `scroll - now at y=${scrolled.y}`, ok: true };
    }
    case "wait": {
      if (action.selector === undefined && action.text === undefined) {
        await delay(action.ms ?? 1_000);
        return { line: `wait ${action.ms ?? 1_000}ms - done`, ok: true };
      }
      const until = Date.now() + (action.ms ?? 5_000);
      while (Date.now() < until) {
        if (await evaluate<boolean>(target, presentScript(action.selector, action.text))) {
          return { line: `wait for ${describeTarget(action)} - it appeared`, ok: true };
        }
        await delay(150);
      }
      return { line: `wait for ${describeTarget(action)} - it did not appear within ${action.ms ?? 5_000}ms`, ok: false };
    }
    case "eval": {
      try {
        const value = await withTimeout(evaluate<unknown>(target, action.expression ?? "undefined"), 10_000, "The expression");
        const shown = value === undefined ? "undefined" : JSON.stringify(value) ?? String(value);
        return { line: `eval ${JSON.stringify((action.expression ?? "").slice(0, 80))} = ${shown.length > 2_000 ? `${shown.slice(0, 2_000)}…` : shown}`, ok: true };
      } catch (error) {
        return { line: `eval threw: ${error instanceof Error ? error.message : String(error)}`, ok: false };
      }
    }
  }
}

async function screenshot(target: AgentPage, snapshot: PageSnapshot, fullPage: boolean): Promise<ImageBlock | null> {
  const width = target.viewport.width;
  // 3,000 px, not 8,000: a 1280 x 8000 shot decodes to ~41 MB of bitmap that the transcript keeps
  // for the life of the window, and vision models scale a page that tall down to a smear anyway.
  const height = fullPage ? Math.min(snapshot.scroll.height, target.viewport.height * 4, 3_000) : target.viewport.height;
  // Big enough to read, small enough to send: wide screens are scaled down to 1280, and the
  // protocol does the scaling and the JPEG, so no image library is needed on either surface.
  const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / Math.max(1, width));
  const shot = await target.send<{ data: string }>("Page.captureScreenshot", {
    format: "jpeg",
    quality: 72,
    ...(fullPage ? { captureBeyondViewport: true } : {}),
    clip: { x: 0, y: fullPage ? 0 : snapshot.scroll.y, width, height, scale },
  });
  if (typeof shot.data !== "string" || shot.data.length === 0) return null;
  return { type: "image", mediaType: "image/jpeg", data: shot.data };
}

export interface ViewPageDeps {
  /** The live preview's address, starting it when it is not running. */
  readonly previewUrl: () => Promise<string>;
}

async function view(request: ViewPageRequest, deps: ViewPageDeps, signal: AbortSignal): Promise<ToolRunResult> {
  if (signal.aborted) return { content: "Stopped before inspecting the page.", isError: true };
  const target = await ensurePage();
  touch();
  target.console.length = 0;
  target.failed.length = 0;
  // Always set it: an audit's media preference must not leak into a later normal screenshot.
  await target.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: request.reducedMotion === true ? "reduce" : "no-preference" }] });

  if (target.viewport.width !== request.width || target.viewport.height !== request.height) {
    await target.send("Emulation.setDeviceMetricsOverride", {
      width: request.width,
      height: request.height,
      deviceScaleFactor: 1,
      // Phone widths get a phone's layout rules: the viewport meta tag, touch-sized defaults.
      mobile: request.width < 768,
    });
    await target.send("Emulation.setTouchEmulationEnabled", { enabled: request.width < 768 });
    target.viewport = { width: request.width, height: request.height };
  }

  let address: string | null = null;
  const current = target.transport.url();
  if (request.target.kind === "url") address = request.target.url;
  else if (request.target.kind === "preview" || !isBrowserUrl(current)) {
    const root = await deps.previewUrl();
    const path = request.target.kind === "preview" ? request.target.path : "/";
    address = resolvePreviewPage(root, path);
    if (address === null) return { content: `"${path}" is not a page of the preview at ${root}. Pass a path such as about.html or /docs/, or a local address as url.`, isError: true };
  }

  let status: number | null = null;
  if (address !== null) {
    const failure = await navigate(target, address);
    if (failure !== null) {
      return {
        content: `Could not open ${address}: ${failure}.${/REFUSED|ADDRESS_UNREACHABLE/i.test(failure) ? " Nothing is answering there - start the server first (open_preview, or run_command with background: true), then try again." : ""}`,
        isError: true,
      };
    }
    status = target.documentStatus;
  }

  const actions: string[] = [];
  for (const action of request.actions) {
    if (signal.aborted) return { content: "Stopped.", isError: true };
    let outcome: { line: string; ok: boolean };
    try {
      outcome = await runAction(target, action);
    } catch (error) {
      outcome = { line: `${action.type} failed: ${error instanceof Error ? error.message : String(error)}`, ok: false };
    }
    actions.push(outcome.line);
    if (!outcome.ok) {
      actions.push("Stopped here; the remaining actions were not run.");
      break;
    }
  }

  // The report describes the page once it has had a moment to react to the last step.
  await waitForQuiet(target, 1_500);
  const snapshot = await evaluate<PageSnapshot>(target, SNAPSHOT_SCRIPT);
  const audit: string[] = [];
  let auditFailed = false;
  if (request.audit) {
    if (signal.aborted) return { content: "Audit cancelled; this page is unverified.", isError: true };
    try {
      await evaluate(target, `${axeSource}\n;true;`);
      const scan = await withTimeout(evaluate<AccessibilityScan>(target, AXE_RUN_SCRIPT), 15_000, "The accessibility scan");
      audit.push(formatAccessibilityScan(scan));
    } catch (error) {
      auditFailed = true;
      audit.push(`Accessibility scan did not finish: ${error instanceof Error ? error.message : String(error)}. Accessibility is unverified.`);
    }
    audit.push(formatMotionScan(await evaluate<MotionScan>(target, MOTION_SCAN_SCRIPT)));
  }
  let image: ImageBlock | null = null;
  let shot: "attached" | "skipped" | "failed" = "skipped";
  if (request.screenshot) {
    try {
      image = await withTimeout(screenshot(target, snapshot, request.fullPage), 15_000, "The screenshot");
      shot = image === null ? "failed" : "attached";
    } catch {
      shot = "failed";
    }
  }
  touch();
  const reportedSnapshot = request.audit ? { ...snapshot, text: snapshot.text.slice(0, 1000), links: snapshot.links.slice(0, 8), buttons: snapshot.buttons.slice(0, 8), fields: snapshot.fields.slice(0, 8) } : snapshot;
  const content = [...audit, formatPageReport({ snapshot: reportedSnapshot, status, actions, console: [...target.console], failedRequests: [...target.failed], screenshot: shot, fullPage: request.fullPage })].join("\n\n");
  return { content, isError: auditFailed, ...(image === null ? {} : { images: [image] }) };
}

/** Load, act on and report a page. Calls queue, so two chats never share a half-finished one. */
export function viewPage(request: ViewPageRequest, deps: ViewPageDeps, signal: AbortSignal, expectedUpdatedAt?: number): Promise<ToolRunResult> {
  const run = queue.then(async () => {
    if (expectedUpdatedAt !== undefined && browserView?.updatedAt !== expectedUpdatedAt) return { content: "The agent changed the page. Refresh or follow the agent before interacting.", isError: true };
    const result = await view(request, deps, signal);
    // The shared UI always gets the current viewport, even when an agent asked only for text
    // or a full-page capture. It must never invite clicks on an unrelated or stale image.
    let shot = result.images?.[0];
    if (page && (!request.screenshot || request.fullPage)) {
      try { shot = await screenshot(page, await evaluate<PageSnapshot>(page, SNAPSHOT_SCRIPT), false) ?? undefined; } catch { shot = undefined; }
    }
    browserView = { url: page?.transport.url() ?? "", report: result.content, error: result.isError,
      image: shot ? `data:${shot.mediaType};base64,${shot.data}` : null, width: request.width, height: request.height, updatedAt: Date.now() };
    browserSink?.(browserView);
    return result;
  }).catch((error: unknown) => {
    // A page that crashed the browser should not wedge the next call.
    closeAgentBrowser();
    return { content: `The page could not be inspected: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  });
  queue = run.catch(() => undefined);
  return run;
}
