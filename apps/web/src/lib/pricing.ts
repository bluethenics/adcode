import { INVITE_REWARD_TOKENS, PLANS, PLANS_ON_SALE } from "@adcode/api/src/aiPlans.ts";
import { PROJECT_PLANS, type ProjectPlan } from "../../../../packages/collab/src/projects.ts";
export { PROJECT_PLANS };
export function projectPlanBenefits(plan: ProjectPlan) {
  const limits=PROJECT_PLANS[plan];
  const priority={free:"Standard queue priority",weekly:"Priority queue access",monthly:"Enhanced queue priority",pro:"High queue priority",max:"Highest queue priority",unlimited:"Highest queue priority"}[plan];
  return { ...limits, priority, summary:`${limits.projects} owned projects · ${limits.members} people per project` };
}
import { COST_PAID_CONFIG, type PaidPack } from "@adcode/api/src/paidTokens.ts";

import { creditAmount } from "@adcode/api/src/aiEconomics.ts";
export { creditAmount };
export { INVITE_REWARD_TOKENS, PLANS, PLANS_ON_SALE };
export const FREE_WEEKLY_TOKENS = COST_PAID_CONFIG.freeWeeklyTokens;
export const tokenAmount = (tokens: number): string => `${Number((tokens / 1_000_000).toFixed(2))}M`;
export const price = (cents: number): string => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
/**
 * Credits are abstract; work is not. One uncached DeepSeek agent step (10,000 input and 2,000
 * output tokens) costs 6.8 credits - see aiEconomics.includedCharge. Caching usually halves it,
 * so these counts are a floor, never a promise inflated to sell a plan.
 */
export const CREDITS_PER_AGENT_STEP = 6.8;
export const agentStepsPerDay = (units: number): number => Math.floor(units / 11_000 / CREDITS_PER_AGENT_STEP);
/** A plan's price spread over its days, so a monthly figure reads at the scale it is used. */
export const pricePerDay = (cents: number, interval: "week" | "month"): string => `$${(cents / (interval === "week" ? 7 : 30) / 100).toFixed(2)}`;
export const PLAN_SUMMARY = PLANS_ON_SALE.map(plan => `${plan.name} ${price(plan.priceCents)}/${plan.interval}`).join(", ");
export const topUpName = (id: string): string => ({ "50m": "Boost", "140m": "Plus", "300m": "Power" } as Record<string, string>)[id] ?? "AI top-up";
export const topUpDescription = (id: string): string => ({ "50m": "A little extra for your next task.", "140m": "More flexibility for a busy stretch.", "300m": "More room for your biggest projects." } as Record<string, string>)[id] ?? "Extra AI usage, whenever you need it.";
export const PACK_SUMMARY = COST_PAID_CONFIG.packs.map(pack => `${topUpName(pack.id)} ${price(pack.priceCents)} once`).join(", ");
export const PLAN_BENEFITS = {
  weekly: { audience: "For a focused week", allowance: "225 credits a day", description: "All included models with weekly billing. No longer offered to new subscribers." },
  monthly: { audience: "For side projects and evenings", allowance: "225 credits a day", description: "More than twice the free allowance, every day, for less than a lunch." },
  pro: { audience: "For coding every day", allowance: "900 credits a day", description: "4× Builder’s daily credits, higher queue priority, and two friend invites." },
  max: { audience: "For building all day, on any model", allowance: "1,330 credits a day · fair use", description: "Every hosted model, premium ones included, inside a fair-use allowance priced from each model’s cost. No wallet, no overage bill." },
  unlimited: { audience: "Every hosted model, one plan", allowance: "7,500 daily credits · fair use", description: "All hosted models within a daily fair-use allowance. No longer offered to new subscribers." },
} as const;

/**
 * What a month of a plan's daily credits would cost as the cheapest-per-credit top-up pack.
 * An upper bound - daily credits do not roll over - so the page says "up to", never "worth".
 */
export function monthlyPackValueCents(dailyUnits: number, packs: readonly { priceCents: number; tokens: number }[] = COST_PAID_CONFIG.packs): number {
  const best = Math.min(...packs.map((pack) => pack.priceCents / pack.tokens));
  return Number.isFinite(best) ? Math.round((dailyUnits * 30 * best) / 100) * 100 : 0;
}
/** Daily credits per dollar of the monthly price: the figure that makes a bigger plan the better deal. */
export const creditsPerDollar = (plan: { priceCents: number; weeklyTokens: number }): number => Math.round(plan.weeklyTokens / 11_000 / (plan.priceCents / 100) * 30);

/** One included model's rates in credits per 1,000 tokens (equal to USD per million). */
export interface IncludedModelRate {
  readonly name: string;
  readonly input: number;
  readonly cached: number;
  readonly output: number;
  /** "YYYY-MM-DD" it joined ADCode, when the service says. */
  readonly releaseDate?: string;
}

export interface PricingOffer {
  readonly freeWeeklyTokens: number;
  readonly packs: readonly PaidPack[];
  /** Null means the current sale configuration could not be checked. */
  readonly available: boolean | null;
  /** The included models offered right now; missing when the live list could not be read. */
  readonly models?: readonly IncludedModelRate[];
}

/** Days a model is marked New after it joins, the same window as the desktop's model list. */
export const NEW_MODEL_DAYS = 45;
export const isNewModel = (model: Pick<IncludedModelRate, "releaseDate">, now: number): boolean => {
  const joined = model.releaseDate === undefined ? Number.NaN : Date.parse(`${model.releaseDate}T00:00:00Z`);
  return Number.isFinite(joined) && now >= joined && now - joined < NEW_MODEL_DAYS * 86_400_000;
};

export const STANDARD_PRICING: PricingOffer = {
  freeWeeklyTokens: FREE_WEEKLY_TOKENS,
  packs: COST_PAID_CONFIG.packs,
  available: null,
};
