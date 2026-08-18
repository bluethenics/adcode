import { describe, it, expect, beforeEach } from "vitest";
import { handleConfig } from "../src/config.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

describe("handleConfig", () => {
  it("reports the kill switch and caps", async () => {
    const res = await handleConfig(store);
    expect(res.killSwitch).toBe(false);
    expect(res.caps.dailyCap).toBe(12);
  });

  it("computes a projection for every cadence the client knows", async () => {
    const res = await handleConfig(store);
    for (const preset of ["off", "light", "standard", "max"] as const) {
      expect(typeof res.projections[preset]).toBe("string");
    }
  });

  it("projects nothing for the off cadence", async () => {
    expect((await handleConfig(store)).projections.off).toBe("0");
  });

  it("projects more for a busier cadence", async () => {
    const p = (await handleConfig(store)).projections;
    expect(BigInt(p.max) > BigInt(p.standard)).toBe(true);
    expect(BigInt(p.standard) > BigInt(p.light)).toBe(true);
  });

  it("reports zero projections when the kill switch is on, since nothing will be served", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    expect((await handleConfig(store)).projections.standard).toBe("0");
  });

  it("tracks a change to the revenue share without a client release", async () => {
    const before = BigInt((await handleConfig(store)).projections.standard);
    await store.putConfig({ ...DEFAULT_CONFIG, revSharePercent: 100n });
    const after = BigInt((await handleConfig(store)).projections.standard);
    expect(after).toBe(before * 2n);
  });
});
