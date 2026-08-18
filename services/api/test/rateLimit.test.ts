import { describe, it, expect, beforeEach } from "vitest";
import { windowStartFor, checkRate } from "../src/rateLimit.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

describe("windowStartFor", () => {
  it("floors the time to the window boundary", () => {
    expect(windowStartFor(0, 60_000)).toBe(0);
    expect(windowStartFor(59_999, 60_000)).toBe(0);
    expect(windowStartFor(60_000, 60_000)).toBe(60_000);
    expect(windowStartFor(60_001, 60_000)).toBe(60_000);
  });

  it("puts two times in the same window when they belong together", () => {
    expect(windowStartFor(1_000, 60_000)).toBe(windowStartFor(2_000, 60_000));
  });
});

describe("checkRate", () => {
  const config = { ...DEFAULT_CONFIG, rateWindowMs: 60_000, requestsPerWindow: 3 };

  it("allows requests up to the ceiling", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await checkRate(store, config, "u-1", 1_000)).toBe(true);
    }
  });

  it("refuses the one over the ceiling", async () => {
    for (let i = 0; i < 3; i++) await checkRate(store, config, "u-1", 1_000);
    expect(await checkRate(store, config, "u-1", 1_000)).toBe(false);
  });

  it("counts each user separately", async () => {
    for (let i = 0; i < 3; i++) await checkRate(store, config, "u-1", 1_000);
    expect(await checkRate(store, config, "u-2", 1_000)).toBe(true);
  });

  it("forgives once the window rolls over", async () => {
    for (let i = 0; i < 3; i++) await checkRate(store, config, "u-1", 1_000);
    expect(await checkRate(store, config, "u-1", 1_000)).toBe(false);
    expect(await checkRate(store, config, "u-1", 61_000)).toBe(true);
  });

  it("treats a ceiling of zero as unlimited, so the limiter can be switched off", async () => {
    const off = { ...config, requestsPerWindow: 0 };
    for (let i = 0; i < 50; i++) {
      expect(await checkRate(store, off, "u-1", 1_000)).toBe(true);
    }
  });
});
