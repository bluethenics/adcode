import { INVITE_REWARD_TOKENS, PLANS, PLANS_ON_SALE, type PlanSpec } from "@adcode/api/src/aiPlans.ts";
import { WALLET_CUSTOM_MIN_CENTS, isWalletAmount } from "@adcode/api/src/modelWallet.ts";
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
export const pricePerDay = (cents: number, interval: "week" | "month" | "year"): string => `$${(cents / (interval === "week" ? 7 : interval === "year" ? 365 : 30) / 100).toFixed(2)}`;
/** What a yearly plan costs a month, rounded down to the cent so the page never overstates it. */
export const yearlyPerMonth = (yearlyCents: number): string => `$${(Math.floor(yearlyCents / 12) / 100).toFixed(2)}`;
/** What paying yearly saves against twelve monthly payments. */
export const yearlySavingsCents = (plan: { priceCents: number; yearlyCents?: number }): number => plan.yearlyCents === undefined ? 0 : plan.priceCents * 12 - plan.yearlyCents;
export { WALLET_CUSTOM_MAX_CENTS, WALLET_CUSTOM_MIN_CENTS, WALLET_TOPUPS_CENTS } from "@adcode/api/src/modelWallet.ts";
/** "A, B and C". */
const listed = (items: readonly string[]): string => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
/**
 * How AI is paid for, in one clause, for every page that says it. Plans came back on
 * 13 November 2026 next to pay-as-you-go credits; Tagflow's sponsored models stay free.
 * Built from the plan and wallet tables, so it cannot quote a price checkout does not charge.
 */
export const PAYG_SUMMARY = `Tagflow AI is free; ${listed(PLANS_ON_SALE.map((plan) => plan.name))} plans (${listed(PLANS_ON_SALE.map((plan) => price(plan.priceCents)))} a month) cover every hosted model with daily credits, or pay as you go with USD credits in any amount from ${price(WALLET_CUSTOM_MIN_CENTS)}, never expiring`;
export const topUpName = (id: string): string => ({ starter: "Starter", "50m": "Boost", "140m": "Plus", "300m": "Power" } as Record<string, string>)[id] ?? "AI top-up";
export const topUpDescription = (id: string): string => ({ starter: "A small first top-up to finish what you started.", "50m": "A little extra for your next task.", "140m": "More flexibility for a busy stretch.", "300m": "More room for your biggest projects." } as Record<string, string>)[id] ?? "Extra AI usage, whenever you need it.";

/** A plan's daily credits, from the plan table, so the copy cannot drift from what is enforced. */
export const planCredits = (id: PlanSpec["id"]): string => creditAmount(PLANS.find(plan => plan.id === id)?.weeklyTokens ?? 0);
export const PLAN_BENEFITS = {
  weekly: { audience: "For a focused week", allowance: `${planCredits("weekly")} credits a day`, description: "All included models with weekly billing. No longer offered to new subscribers." },
  monthly: { audience: "For evenings and side projects", allowance: `${planCredits("monthly")} credits a day`, description: "Four times the free allowance, every day, on every hosted model." },
  pro: { audience: "For coding every day", allowance: `${planCredits("pro")} credits a day`, description: "Twice Builder’s daily credits for twice the price, higher queue priority, and two friend invites." },
  max: { audience: "For building all day, on any model", allowance: `${planCredits("max")} credits a day`, description: "The biggest daily allowance, on every hosted model, premium ones included. No wallet, no overage bill." },
  unlimited: { audience: "Every hosted model, one plan", allowance: `${planCredits("unlimited")} daily credits · fair use`, description: "All hosted models within a daily fair-use allowance. No longer offered to new subscribers." },
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

/** A paid-credit model's price, USD per million tokens, with ADCode's markup already in it. */
export interface PaidModelRate {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

/**
 * A running price offer, as the public config reports it: N% off every paid model until a date.
 * The listed prices already include it; the regular price is shown struck through beside them.
 */
export interface PriceOffer { readonly name: string; readonly percent: number; readonly endsAt: number }

/** An offer from the live config, or null when there is none or it has already ended. */
export function parsePriceOffer(raw: unknown, now = Date.now()): PriceOffer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, percent, endsAt } = raw as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "" || typeof percent !== "number" || !Number.isInteger(percent) || percent < 1 || percent > 90) return null;
  return typeof endsAt === "number" && Number.isFinite(endsAt) && endsAt > now ? { name: name.trim(), percent, endsAt } : null;
}
/** The price before the offer: what a listed offer price returns to when the offer ends. */
export const regularPrice = (offerPrice: number, percent: number): number => offerPrice * 100 / (100 - percent);
/** "27 November", in UTC like every other date the service gives. */
export const offerEndDate = (endsAt: number): string => new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export interface PricingOffer {
  /** A running price offer; missing or null when there is none. */
  readonly offer?: PriceOffer | null;
  /** Every model paid from USD credits, offered right now; missing when the live list could not be read. */
  readonly paidModels?: readonly PaidModelRate[];
  /** Sponsored models anyone signed in can use free. */
  readonly freeModels?: readonly string[];
  readonly freeWeeklyTokens: number;
  readonly packs: readonly PaidPack[];
  /** Null means the current sale configuration could not be checked. */
  readonly available: boolean | null;
  /** Yearly billing can be bought: every yearly plan product is configured. Missing means monthly only. */
  readonly yearly?: boolean;
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

/** `amount=37` from a pricing link: whole dollars inside the custom range, or null. */
export function walletAmountFromQuery(search: string): number | null {
  const raw = new URLSearchParams(search).get("amount");
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  return isWalletAmount(Number(raw) * 100) ? Number(raw) : null;
}
