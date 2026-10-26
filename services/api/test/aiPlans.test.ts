import { describe, expect, it } from "vitest";
import { effectiveWeeklyAllowance, parsePromo, planById, PLANS } from "../src/aiPlans.ts";

describe("AI plans", () => {
  it("prices and sizes the three plans", () => {
    expect(PLANS.map((p) => [p.id, p.priceCents, p.interval, p.weeklyTokens, p.invites])).toEqual([
      ["weekly", 300, "week", 60_000_000, 0], ["monthly", 900, "month", 60_000_000, 0], ["pro", 1900, "month", 150_000_000, 2]]);
    expect(planById("pro")?.name).toBe("Pro");
    expect(planById("free")).toBeNull();
  });

  it("takes the best of plan, boost and the free allowance", () => {
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: 10, source: "subscription" }, boostTokens: 0 }, 10_000_000, 5)).toBe(150_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "monthly", endsAt: 10, source: "gift" }, boostTokens: 80_000_000 }, 10_000_000, 5)).toBe(80_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: 4, source: "subscription" }, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
  });

  it("never carries a cached boost past its known validity boundary", () => {
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 90_000_000, validUntil: 100 }, 10_000_000, 99)).toBe(90_000_000);
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 90_000_000, validUntil: 100 }, 10_000_000, 100)).toBe(10_000_000);
  });

  it("parses promo codes and refuses bad ones", () => {
    expect(parsePromo({ code: "LAUNCH50", kind: "tokens", tokens: 50_000_000, maxRedemptions: 100, expiresAt: 9e12 })).toMatchObject({ code: "LAUNCH50" });
    expect(parsePromo({ code: "PRO7", kind: "plan", plan: "pro", days: 7, maxRedemptions: 10, expiresAt: 9e12 })).toMatchObject({ plan: "pro", days: 7 });
    expect(parsePromo({ code: "bad code", kind: "tokens", tokens: 1, maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
    expect(parsePromo({ code: "X1X", kind: "plan", plan: "free", days: 7, maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
    expect(parsePromo({ code: "X1X", kind: "tokens", maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
  });
});
