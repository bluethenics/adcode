import { describe, expect, it } from "vitest";
import { effectiveWeeklyAllowance, hasActivePlan, hasUnlimitedPlan, requiresSubscription, parsePromo, planById, PLANS, ALLOWANCE_CHANGED_AT, planAllowance } from "../src/aiPlans.ts";

describe("AI plans", () => {
  it("prices and sizes the five plans", () => {
    expect(PLANS.map((p) => [p.id, p.priceCents, p.interval, p.weeklyTokens, p.invites])).toEqual([
      ["weekly", 300, "week", 3_080_000, 0], ["monthly", 900, "month", 2_200_000, 0], ["pro", 2900, "month", 7_150_000, 2], ["max", 9900, "month", 24_200_000, 0], ["unlimited", 29900, "month", 73_700_000, 0]]);
    expect(planById("pro")?.name).toBe("Pro");
    expect(planById("free")).toBeNull();
  });

  it("keeps a paid period bought before the change on its old allowance until it renews", () => {
    const pro = planById("pro")!, weekly = planById("weekly")!, day = 86_400_000;
    // Ends within a month of the change: it began before it, so it keeps 900 credits a day.
    expect(planAllowance(pro, ALLOWANCE_CHANGED_AT + 20 * day)).toBe(9_900_000);
    // The next period, bought after the change, gets the new allowance.
    expect(planAllowance(pro, ALLOWANCE_CHANGED_AT + 40 * day)).toBe(7_150_000);
    // Weekly went up, so every Weekly period gets the higher figure at once.
    expect(planAllowance(weekly, ALLOWANCE_CHANGED_AT + day)).toBe(3_080_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: ALLOWANCE_CHANGED_AT + 20 * day, source: "subscription" }, boostTokens: 0 }, 1_100_000, ALLOWANCE_CHANGED_AT)).toBe(9_900_000);
  });

  it("takes the best of plan, boost and the free allowance", () => {
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: 10, source: "subscription" }, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "monthly", endsAt: 10, source: "gift" }, boostTokens: 80_000_000 }, 10_000_000, 5)).toBe(80_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: 4, source: "subscription" }, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
  });

  it("never carries a cached boost past its known validity boundary", () => {
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 90_000_000, validUntil: 100 }, 10_000_000, 99)).toBe(90_000_000);
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 90_000_000, validUntil: 100 }, 10_000_000, 100)).toBe(10_000_000);
  });

  it("allows free Heabsy access and keeps active Pro metered", () => {
    const state = { plan: { id: "pro" as const, endsAt: 10, source: "subscription" as const }, boostTokens: 100_000_000 };
    expect(hasActivePlan(state, 9)).toBe(true);
    expect(hasUnlimitedPlan(state, 9)).toBe(false);
    expect(hasActivePlan(state, 10)).toBe(false);
    expect(hasUnlimitedPlan(state, 10)).toBe(false);
    expect(hasActivePlan({ plan: null, boostTokens: 100_000_000 }, 9)).toBe(false);
    expect(requiresSubscription({ provider: "custom-heabsy" })).toBe(false);
    expect(requiresSubscription({ provider: "tagflow" })).toBe(false);
  });

  it("parses promo codes and refuses bad ones", () => {
    expect(parsePromo({ code: "LAUNCH50", kind: "tokens", tokens: 50_000_000, maxRedemptions: 100, expiresAt: 9e12 })).toMatchObject({ code: "LAUNCH50" });
    expect(parsePromo({ code: "PRO7", kind: "plan", plan: "pro", days: 7, maxRedemptions: 10, expiresAt: 9e12 })).toMatchObject({ plan: "pro", days: 7 });
    expect(parsePromo({ code: "bad code", kind: "tokens", tokens: 1, maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
    expect(parsePromo({ code: "X1X", kind: "plan", plan: "free", days: 7, maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
    expect(parsePromo({ code: "X1X", kind: "tokens", maxRedemptions: 1, expiresAt: 9e12 })).toBeNull();
  });
});
