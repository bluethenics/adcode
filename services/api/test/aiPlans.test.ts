import { describe, expect, it } from "vitest";
import { effectiveWeeklyAllowance, hasActivePlan, hasAllModelAccess, PLANS_ON_SALE, hasUnlimitedPlan, requiresSubscription, parsePromo, planById, PLANS, ALLOWANCE_CHANGED_AT, planAllowance, OLD_PRICE_PERIODS_END, planChargeCents, planOrderBilling } from "../src/aiPlans.ts";

describe("AI plans", () => {
  it("prices and sizes the five plans, three on sale again since 13 November 2026", () => {
    expect(PLANS.map((p) => [p.id, p.priceCents, p.yearlyCents, p.interval, p.weeklyTokens, p.invites])).toEqual([
      ["weekly", 300, undefined, "week", 4_620_000, 0], ["monthly", 1900, 19000, "month", 6_380_000, 0], ["pro", 3900, 39000, "month", 13_090_000, 2], ["max", 14900, 149000, "month", 49_500_000, 0], ["unlimited", 29900, undefined, "month", 110_550_000, 0]]);
    expect(PLANS_ON_SALE.map((p) => p.name)).toEqual(["Builder", "Pro", "Max"]);
    // Every plan covers every model.
    expect(PLANS.filter((p) => p.onSale).map((p) => p.name)).toEqual(["Builder", "Pro", "Max"]);
    expect(PLANS.every((p) => p.allModels === true)).toBe(true);
    expect(planById("pro")?.name).toBe("Pro");
    expect(planById("free")).toBeNull();
  });

  it("keeps a paid period bought before the change on its old allowance until it renews", () => {
    const pro = planById("pro")!, weekly = planById("weekly")!, day = 86_400_000;
    // Ends within a month of the change: it gets the better of old and new - since 4 November, the new 975.
    expect(planAllowance(pro, ALLOWANCE_CHANGED_AT + 20 * day)).toBe(10_725_000);
    // A period sold at the old $29 before sales closed on 6 November keeps 975, up to 8 December.
    expect(planAllowance(pro, OLD_PRICE_PERIODS_END)).toBe(10_725_000);
    expect(planAllowance(planById("max")!, OLD_PRICE_PERIODS_END - day)).toBe(22_000_000);
    // A period sold at the new $39 gets the new 1,190.
    expect(planAllowance(pro, OLD_PRICE_PERIODS_END + day)).toBe(13_090_000);
    expect(planAllowance(pro, OLD_PRICE_PERIODS_END + 365 * day)).toBe(13_090_000);
    // Weekly went up, so every Weekly period gets the higher figure at once.
    expect(planAllowance(weekly, ALLOWANCE_CHANGED_AT + day)).toBe(4_620_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: ALLOWANCE_CHANGED_AT + 20 * day, source: "subscription" }, boostTokens: 0 }, 1_100_000, ALLOWANCE_CHANGED_AT)).toBe(10_725_000);
  });

  it("loses no money at full daily use, on the yearly price too", () => {
    // A credit costs at most $0.00085 (85% of a $0.001 list credit); payment fees take about 5%.
    for (const plan of PLANS_ON_SALE) {
      const credits = plan.weeklyTokens / 11_000;
      expect(credits * 30 * 0.085 + plan.priceCents * 0.05).toBeLessThan(plan.priceCents);
      expect(credits * 365 * 0.085 + plan.yearlyCents! * 0.05).toBeLessThan(plan.yearlyCents!);
      expect(plan.yearlyCents).toBe(plan.priceCents * 10);
      expect(planChargeCents(plan, "year")).toBe(plan.yearlyCents);
    }
    expect(planChargeCents(planById("weekly")!, "year")).toBeNull();
    expect(planOrderBilling("aip_y0123abcd")).toBe("year");
    expect(planOrderBilling("aip_0123abcd")).toBe("month");
  });

  it("gives every paid plan every hosted model inside its own fair-use allowance", () => {
    const now = ALLOWANCE_CHANGED_AT + 2 * 86_400_000;
    const max = { plan: { id: "max" as const, endsAt: now + 30 * 86_400_000, source: "subscription" as const }, boostTokens: 0 };
    expect(hasAllModelAccess(max, now)).toBe(true);
    expect(effectiveWeeklyAllowance(max, 1_100_000, now)).toBe(22_000_000);
    // A Max period ending soon after the 3 November change gets no old $99 allowance either.
    expect(planAllowance(planById("max")!, ALLOWANCE_CHANGED_AT + 86_400_000)).toBe(22_000_000);
    expect(hasAllModelAccess({ ...max, plan: { ...max.plan, id: "pro" } }, now)).toBe(true);
    expect(hasAllModelAccess({ ...max, plan: { ...max.plan, endsAt: now } }, now)).toBe(false);
  });

  it("takes the best of plan, boost and the free allowance", () => {
    expect(effectiveWeeklyAllowance({ plan: null, boostTokens: 0 }, 10_000_000, 5)).toBe(10_000_000);
    expect(effectiveWeeklyAllowance({ plan: { id: "pro", endsAt: 10, source: "subscription" }, boostTokens: 0 }, 10_000_000, 5)).toBe(10_725_000);
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
