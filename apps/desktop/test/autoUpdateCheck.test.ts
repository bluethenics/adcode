import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (value: { version?: string; percent?: number }) => void>(),
  checkCalls: 0,
  quitAndInstall: [] as unknown[][],
  packaged: true,
}));

// debugLog.ts, which the updater logs through, imports these too.
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mock.packaged;
    },
    getPath: () => "unused",
    isReady: () => false,
    getVersion: () => "0.0.0",
    getLocale: () => "en",
    on: () => undefined,
  },
  ipcMain: {
    handle: (name: string, handler: Handler) => mock.handlers.set(name, handler),
    on: () => undefined,
  },
  BrowserWindow: { getAllWindows: () => [] },
  clipboard: {},
  dialog: {},
}));

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: (name: string, handler: (value: { version?: string; percent?: number }) => void) =>
      mock.listeners.set(name, handler),
    checkForUpdates: async () => {
      mock.checkCalls += 1;
      mock.listeners.get("checking-for-update")?.({});
      mock.listeners.get("update-available")?.({ version: "1.0.3" });
      mock.listeners.get("update-downloaded")?.({ version: "1.0.3" });
    },
    quitAndInstall: (...args: unknown[]) => mock.quitAndInstall.push(args),
  },
}));

/** The updater keeps module state, so every case gets a module of its own. */
async function fresh(): Promise<typeof import("../src/main/autoUpdate.ts")> {
  vi.resetModules();
  mock.handlers.clear();
  mock.listeners.clear();
  mock.checkCalls = 0;
  mock.quitAndInstall = [];
  return import("../src/main/autoUpdate.ts");
}

const call = (name: string, ...args: unknown[]): unknown => mock.handlers.get(name)?.({}, ...args);

beforeEach(() => {
  mock.packaged = true;
  delete process.env["ADCODE_UPDATE_SIMULATE"];
});

afterEach(() => vi.useRealTimers());

describe("manual update check", () => {
  it("checks even with automatic updates off and reports an already downloaded update", async () => {
    vi.useFakeTimers();
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => false);

    expect(await call("update:status")).toEqual({ state: "idle" });
    expect(await call("update:check")).toEqual({ state: "ready", version: "1.0.3" });
    expect(mock.checkCalls).toBe(1);

    // A second menu click must report the pending update, not start a new download.
    expect(await call("update:check")).toEqual({ state: "ready", version: "1.0.3" });
    expect(mock.checkCalls).toBe(1);
  });
});

describe("automatic check", () => {
  /* 45 seconds lost every short session: the download never finished before people closed it. */
  it("first checks ten seconds after launch", async () => {
    vi.useFakeTimers();
    const { startAutoUpdate } = await fresh();
    await startAutoUpdate(() => true);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(mock.checkCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.checkCalls).toBe(1);
  });
});

describe("restart to update", () => {
  it("does nothing until an update is ready", async () => {
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => false);

    expect(await call("update:install")).toEqual({ state: "idle" });
    expect(mock.quitAndInstall).toEqual([]);
  });

  it("installs silently and reopens ADCode once ready", async () => {
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => false);
    await call("update:check");

    expect(await call("update:install")).toEqual({ state: "ready", version: "1.0.3" });
    expect(mock.quitAndInstall).toEqual([[true, true]]);
  });
});

describe("the ready card", () => {
  /* Two windows are open at once; only the first to ask may announce the version. */
  it("is claimed once per version, and only for the version that is ready", async () => {
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => false);

    expect(await call("update:claim-notice", "1.0.3")).toBe(false);
    await call("update:check");
    expect(await call("update:claim-notice", "9.9.9")).toBe(false);
    expect(await call("update:claim-notice", "1.0.3")).toBe(true);
    expect(await call("update:claim-notice", "1.0.3")).toBe(false);
  });
});

describe("smoke simulation", () => {
  it("walks to ready on a check and never quits, in an unpackaged build", async () => {
    mock.packaged = false;
    process.env["ADCODE_UPDATE_SIMULATE"] = "1";
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => true);

    expect(await call("update:check")).toEqual({ state: "ready", version: "9.9.9" });
    expect(await call("update:install")).toEqual({ state: "ready", version: "9.9.9" });
    expect(mock.quitAndInstall).toEqual([]);
  });

  it("is ignored by a packaged build", async () => {
    process.env["ADCODE_UPDATE_SIMULATE"] = "1";
    const { registerUpdateIpc, startAutoUpdate } = await fresh();
    registerUpdateIpc();
    await startAutoUpdate(() => false);

    expect(await call("update:check")).toEqual({ state: "ready", version: "1.0.3" });
  });
});
