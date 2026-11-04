/**
 * AI plans: a subscription raises the shared daily allowance on every included model.
 * Purchased tokens still top up beyond any plan.
 * Spec: docs/superpowers/specs/2026-10-24-ai-plans-design.md. Pure.
 */
export type PlanId = "weekly" | "monthly" | "pro" | "max" | "unlimited";

export interface PlanSpec { id: PlanId; name: string; priceCents: number; interval: "week" | "month"; weeklyTokens: number; unlimited?: boolean; invites: number }

export const PLANS: readonly PlanSpec[] = [
  { id: "weekly", name: "Weekly", priceCents: 300, interval: "week", weeklyTokens: 2_475_000, invites: 0 },
  { id: "monthly", name: "Monthly", priceCents: 900, interval: "month", weeklyTokens: 2_475_000, invites: 0 },
  { id: "pro", name: "Pro", priceCents: 2900, interval: "month", weeklyTokens: 9_900_000, invites: 2 },
  { id: "max", name: "Max", priceCents: 9900, interval: "month", weeklyTokens: 33_000_000, invites: 0 },
  { id: "unlimited", name: "Unlimited", priceCents: 29900, interval: "month", weeklyTokens: 82_500_000, invites: 0 },
];

export const LEGACY_PLANS: readonly PlanSpec[] = [
 { ...PLANS[0]!, weeklyTokens: 20_000_000 }, { ...PLANS[1]!, weeklyTokens: 100_000_000 }, { ...PLANS[2]!, weeklyTokens: 0, unlimited: true },
];

/** What a Pro subscriber and their invitee each get when the invitee first subscribes. */
export const INVITE_REWARD_TOKENS = 1_100_000;
/** Dodo hosted sessions last 24h. Keep an extra hour for uncertain/late provider creation. */
export const PLAN_CHECKOUT_GUARD_MS = 25 * 60 * 60 * 1000;
/** Billing can recover even while model access is suspended. Resolve that subscription in the portal. */
export function subscriptionBlocksCheckout(status: string, periodEnd: number, now: number): boolean {
  return periodEnd > now || ["active", "pending", "on_hold", "paused", "past_due"].includes(status);
}

export const planById = (id: string): PlanSpec | null => PLANS.find((plan) => plan.id === id) ?? null;

/** An account's best live plan (subscription or gift) and its best live boost. */
export interface AiPlanState { plan: { id: PlanId; endsAt: number; source: "subscription" | "gift" } | null; boostTokens: number; legacyUntil?: number; /** Earliest known change in this snapshot; never serve it stale across this time. */ validUntil?: number | null }

export const hasActivePlan = (state: AiPlanState, now: number): boolean => state.plan !== null && state.plan.endsAt > now && planById(state.plan.id) !== null;
export const hasUnlimitedPlan = (state: AiPlanState, now: number, costCredits = true): boolean => !costCredits && hasActivePlan(state, now) && state.plan!.id === "pro";
/** Unlimited means access to every hosted model, with an explicit daily fair-use budget. */
export const hasAllModelAccess = (state: AiPlanState, now: number): boolean => hasActivePlan(state, now) && state.plan!.id === "unlimited";
export const isPlanId = (id: string): id is PlanId => planById(id) !== null;
export const planRank = (id: PlanId): number => PLANS.findIndex(p => p.id === id) + 1;
export const hasLegacyAllowance = (state: AiPlanState, now: number): boolean => hasActivePlan(state, now) && (state.legacyUntil ?? 0) > now;
export const LEGACY_MODEL_IDS = ["tagflow-code-27b", "heabsy-qwen38", "heabsy-glm53-flash-unc", "heabsy-mimo-v26-flash", "deepseek-v4.1-flash-unc"];
/** All included providers, including Heabsy, are available without a subscription. */
export const requiresSubscription = (_model: { provider?: string }): boolean => false;

/** The daily allowance on paid models: the best of plan, boost and everyone's allowance. */
export function effectiveWeeklyAllowance(state: AiPlanState, freeWeekly: number, now: number, costCredits = true): number {
  if (costCredits && hasAllModelAccess(state, now)) return planById("unlimited")!.weeklyTokens;
  const plan = state.plan !== null && state.plan.endsAt > now ? (costCredits ? PLANS : LEGACY_PLANS).find(p => p.id === state.plan!.id)?.weeklyTokens ?? 0 : 0;
  return Math.max(plan, state.validUntil !== undefined && state.validUntil !== null && state.validUntil <= now ? 0 : state.boostTokens, freeWeekly);
}

export interface PromoInput { code: string; kind: "tokens" | "plan"; tokens?: number; plan?: PlanId; days?: number; maxRedemptions: number; expiresAt: number }

const whole = (raw: unknown, min: number, max: number): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max;

export function parsePromo(raw: unknown): PromoInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { code, maxRedemptions, expiresAt } = r;
  if (typeof code !== "string" || !/^[A-Z0-9]{3,24}$/.test(code) || !whole(maxRedemptions, 1, 1_000_000) || !whole(expiresAt, 1, 9_000_000_000_000)) return null;
  if (r["kind"] === "tokens") return whole(r["tokens"], 1, 10_000_000_000) ? { code, kind: "tokens", tokens: r["tokens"], maxRedemptions, expiresAt } : null;
  if (r["kind"] === "plan") {
    const plan = typeof r["plan"] === "string" ? planById(r["plan"]) : null;
    return plan !== null && whole(r["days"], 1, 366) ? { code, kind: "plan", plan: plan.id, days: r["days"], maxRedemptions, expiresAt } : null;
  }
  return null;
}
