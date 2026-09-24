import { afterEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, () => Promise<unknown>>(),
  listeners: new Map<string, (value: { version?: string; percent?: number }) => void>(),
  checkCalls: 0,
}));

vi.mock("electron", () => ({
  app: { isPackaged: true },
  ipcMain: { handle: (name: string, handler: () => Promise<unknown>) => mock.handlers.set(name, handler) },
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
  },
}));

import { registerUpdateIpc, startAutoUpdate } from "../src/main/autoUpdate.ts";

afterEach(() => vi.useRealTimers());

describe("manual update check", () => {
  it("checks even with automatic updates off and reports an already downloaded update", async () => {
    vi.useFakeTimers();
    registerUpdateIpc();
    await startAutoUpdate(() => false);

    const status = mock.handlers.get("update:status");
    const check = mock.handlers.get("update:check");
    expect(await status?.()).toEqual({ state: "idle" });
    expect(await check?.()).toEqual({ state: "ready", version: "1.0.3" });
    expect(mock.checkCalls).toBe(1);

    // A second menu click must report the pending update, not start a new download.
    expect(await check?.()).toEqual({ state: "ready", version: "1.0.3" });
    expect(mock.checkCalls).toBe(1);
  });
});
