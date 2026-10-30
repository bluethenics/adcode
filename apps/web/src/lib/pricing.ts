import { INVITE_REWARD_TOKENS, PLANS } from "@adcode/api/src/aiPlans.ts";
import { DEFAULT_PAID_CONFIG, type PaidPack } from "@adcode/api/src/paidTokens.ts";

export { INVITE_REWARD_TOKENS, PLANS };
export const FREE_WEEKLY_TOKENS = DEFAULT_PAID_CONFIG.freeWeeklyTokens;
export const tokenAmount = (tokens: number): string => `${Number((tokens / 1_000_000).toFixed(2))}M`;
export const price = (cents: number): string => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
export const PLAN_SUMMARY = PLANS.map(plan => `${plan.name} ${price(plan.priceCents)}/${plan.interval}`).join(", ");
export const topUpName = (id: string): string => ({ "50m": "Boost", "140m": "Plus", "300m": "Max" } as Record<string, string>)[id] ?? "AI top-up";
export const topUpDescription = (id: string): string => ({ "50m": "A little extra for your next task.", "140m": "More flexibility for a busy stretch.", "300m": "More room for your biggest projects." } as Record<string, string>)[id] ?? "Extra AI usage, whenever you need it.";
export const PACK_SUMMARY = DEFAULT_PAID_CONFIG.packs.map(pack => `${topUpName(pack.id)} ${price(pack.priceCents)} once`).join(", ");
export const PLAN_BENEFITS = {
  weekly: { audience: "For a focused project", allowance: "20M tokens a day", description: "All Heabsy models with the flexibility of weekly billing." },
  monthly: { audience: "For your everyday workflow", allowance: "100M tokens a day", description: "Keep your momentum with a daily refill and one monthly payment." },
  pro: { audience: "For ambitious builds", allowance: "Unlimited tokens", description: "Unlimited tokens on all Heabsy models, plus rewards when friends join." },
} as const;

export interface PricingOffer {
  readonly freeWeeklyTokens: number;
  readonly packs: readonly PaidPack[];
  /** Null means the current sale configuration could not be checked. */
  readonly available: boolean | null;
}

export const STANDARD_PRICING: PricingOffer = {
  freeWeeklyTokens: FREE_WEEKLY_TOKENS,
  packs: DEFAULT_PAID_CONFIG.packs,
  available: null,
};
