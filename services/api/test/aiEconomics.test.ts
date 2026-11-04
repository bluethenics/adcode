import { describe, expect, it } from "vitest";
import { CREDIT_UNITS, HEABSY_PRICES, includedCharge, PARTNER_DISCOUNT } from "../src/aiEconomics.ts";
import { COST_PAID_CONFIG, holdTokens, chargeTokens } from "../src/paidTokens.ts";
import { PLANS, hasUnlimitedPlan } from "../src/aiPlans.ts";

describe("cost-based credits", () => {
  const deepseek = { inputPrice: .4, cacheInputPrice: .04, outputPrice: 1.4 };
  it("prices input, output and cached input separately without applying the private discount to credits", () => {
    expect(includedCharge(deepseek, 10_000, 2_000) / CREDIT_UNITS).toBe(6.8);
    expect(includedCharge(deepseek, 10_000, 2_000, 8_000) / CREDIT_UNITS).toBe(3.92);
    expect(HEABSY_PRICES).toHaveLength(37);
  });
  it("preserves purchased pack units and gives bounded daily allowances", () => {
    expect(COST_PAID_CONFIG.packs.map(p => p.tokens / CREDIT_UNITS)).toEqual([5000, 14000, 30000]);
    expect(COST_PAID_CONFIG.freeWeeklyTokens / CREDIT_UNITS).toBe(100);
    expect(PLANS.map(p => p.weeklyTokens / CREDIT_UNITS)).toEqual([225, 225, 900, 1330, 7500]);
    expect(hasUnlimitedPlan({ plan: { id: "pro", endsAt: 10, source: "subscription" }, boostTokens: 0 }, 1)).toBe(false);
  });
  it("keeps positive contribution even at 31 days of full subscription usage without the discount", () => {
    for (const plan of PLANS) {
      const days = plan.interval === "week" ? 7 : 31;
      const listCost = plan.weeklyTokens / CREDIT_UNITS / 1000 * days;
      expect(listCost).toBeLessThan(plan.priceCents / 100);
      expect(listCost * (1 - PARTNER_DISCOUNT)).toBeLessThan(plan.priceCents / 100);
    }
  });
  it("requires the full quote and counts concurrent reservations", () => {
    const none = { purchased: 0, reserved: 0 };
    expect(holdTokens(null, none, 100, 101, 1, true).ok).toBe(false);
    const first = holdTokens(null, none, 100, 60, 1, true);
    if (!first.ok) throw new Error("expected reservation");
    expect(holdTokens(first.window, first.balance, 100, 60, 1, true).ok).toBe(false);
    const done = chargeTokens(first.window, first.balance, first.hold, 40);
    expect(done.window?.usedTokens).toBe(40);
    expect(done.window?.reservedTokens).toBe(0);
    expect(done.balance.purchased).toBe(0);
  });
});
