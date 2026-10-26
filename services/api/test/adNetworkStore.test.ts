import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheAdNetworkSettings } from "../adapters/adNetworkStore.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { AdNetworkConfig } from "../src/adNetworkConfig.ts";

const config: AdNetworkConfig = { id: "test-network", name: "Test", provider: "imprezia", enabled: false, priority: 1, viewPayoutMicros: "0", clickPayoutMicros: "0" };
afterEach(() => vi.useRealTimers());
describe("ad network settings cache", () => {
  it("reuses completed reads and refreshes after configuration changes", async () => {
    const store = createMemoryStore().adNetworks!;
    const list = vi.spyOn(store, "list"), get = vi.spyOn(store, "get");
    const cached = cacheAdNetworkSettings(store);
    expect(await cached.list()).toEqual([]);
    await cached.list(); expect(list).toHaveBeenCalledTimes(1);
    await cached.put(config, "admin", 1);
    expect(await cached.list()).toEqual([config]); expect(list).toHaveBeenCalledTimes(2);
    await cached.get(config.id); await cached.get(config.id); expect(get).toHaveBeenCalledTimes(1);
    await cached.put({ ...config, name: "Updated" }, "admin", 2);
    expect((await cached.get(config.id))?.name).toBe("Updated");
  });
  it("invalidates replaced and removed credentials immediately", async () => {
    const store = createMemoryStore().adNetworks!;
    const key = vi.spyOn(store, "key"); const cached = cacheAdNetworkSettings(store);
    await cached.put(config, "admin", 1);
    expect(await cached.key(config.id)).toBeNull(); await cached.key(config.id);
    expect(key).toHaveBeenCalledTimes(1);
    const encrypted = { version: 1 as const, nonce: "n", ciphertext: "c", tag: "t" };
    await cached.putKey(config.id, encrypted); expect(await cached.key(config.id)).toEqual(encrypted);
    await cached.putKey(config.id, null); expect(await cached.key(config.id)).toBeNull();
  });
  it("expires settings after 30 seconds and never serves stale credentials on failure", async () => {
    vi.useFakeTimers(); const store = createMemoryStore().adNetworks!;
    const key = vi.spyOn(store, "key"); const cached = cacheAdNetworkSettings(store);
    await cached.key(config.id); vi.advanceTimersByTime(30_001);
    key.mockRejectedValueOnce(new Error("offline"));
    await expect(cached.key(config.id)).rejects.toThrow("offline");
    expect(key).toHaveBeenCalledTimes(2);
  });
});
