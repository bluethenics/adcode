import { describe, expect, it, vi } from "vitest";
import { createAiPlanCache } from "../adapters/aiPlanCache.ts";
import type { AiPlanState } from "../src/aiPlans.ts";

describe("plan snapshots", () => {
  it("refreshes at a boost expiry inside the normal TTL, using the exact request clock", async () => {
    let clock = 1_000;
    const load = vi.fn(async (_uid: string, now: number): Promise<AiPlanState> => ({ plan: null, boostTokens: now < 1_500 ? 90_000_000 : 0, validUntil: now < 1_500 ? 1_500 : null }));
    const cache = createAiPlanCache(load, () => clock);
    expect((await cache.get("u", clock)).boostTokens).toBe(90_000_000);
    clock = 1_499;
    expect((await cache.get("u", clock)).boostTokens).toBe(90_000_000);
    expect(load).toHaveBeenCalledTimes(1);
    clock = 1_500;
    expect((await cache.get("u", clock)).boostTokens).toBe(0);
    expect(load).toHaveBeenLastCalledWith("u", 1_500);
  });
  it("allows a stale fallback only until its next entitlement change", async () => {
    let clock = 1_000;
    const load = vi.fn(async (): Promise<AiPlanState> => ({ plan: null, boostTokens: 90_000_000, validUntil: 90_000 }));
    const cache = createAiPlanCache(load, () => clock);
    await cache.get("u", clock);
    load.mockRejectedValue(new Error("offline"));
    clock = 40_000;
    expect((await cache.get("u", clock)).boostTokens).toBe(90_000_000);
    clock = 90_000;
    await expect(cache.get("u", clock)).rejects.toThrow("offline");
  });
  it("does not refill an invalidated entry from a read that started before a write", async () => {
    let finish!: (state: AiPlanState) => void;
    const load = vi.fn(() => new Promise<AiPlanState>((resolve) => { finish = resolve; }));
    const cache = createAiPlanCache(load, () => 1_000);
    const pending = cache.get("u", 1_000);
    cache.forget("u");
    finish({ plan: null, boostTokens: 100, validUntil: null });
    await pending;
    load.mockResolvedValue({ plan: null, boostTokens: 200, validUntil: null });
    expect((await cache.get("u", 1_000)).boostTokens).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
