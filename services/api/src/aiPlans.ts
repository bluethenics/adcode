/**
 * AI plans: a subscription raises the free weekly allowance on paid-provider (Heabsy) models.
 * Tagflow stays free; purchased tokens still top up beyond any plan.
 * Spec: docs/superpowers/specs/2026-10-24-ai-plans-design.md. Pure.
 */
export type PlanId = "weekly" | "monthly" | "pro";

export interface PlanSpec { id: PlanId; name: string; priceCents: number; interval: "week" | "month"; weeklyTokens: number; invites: number }

export const PLANS: readonly PlanSpec[] = [
  { id: "weekly", name: "Weekly", priceCents: 300, interval: "week", weeklyTokens: 60_000_000, invites: 0 },
  { id: "monthly", name: "Monthly", priceCents: 900, interval: "month", weeklyTokens: 60_000_000, invites: 0 },
  { id: "pro", name: "Pro", priceCents: 1900, interval: "month", weeklyTokens: 150_000_000, invites: 2 },
];

/** What a Pro subscriber and their invitee each get when the invitee first subscribes. */
export const INVITE_REWARD_TOKENS = 4_000_000;
/** Dodo hosted sessions last 24h. Keep an extra hour for uncertain/late provider creation. */
export const PLAN_CHECKOUT_GUARD_MS = 25 * 60 * 60 * 1000;
/** Billing can recover even while model access is suspended. Resolve that subscription in the portal. */
export function subscriptionBlocksCheckout(status: string, periodEnd: number, now: number): boolean {
  return periodEnd > now || ["active", "pending", "on_hold", "paused", "past_due"].includes(status);
}

export const planById = (id: string): PlanSpec | null => PLANS.find((plan) => plan.id === id) ?? null;

/** An account's best live plan (subscription or gift) and its best live boost. */
export interface AiPlanState { plan: { id: PlanId; endsAt: number; source: "subscription" | "gift" } | null; boostTokens: number; /** Earliest known change in this snapshot; never serve it stale across this time. */ validUntil?: number | null }

/** The free weekly allowance on paid models: the best of plan, boost and everyone's allowance. */
export function effectiveWeeklyAllowance(state: AiPlanState, freeWeekly: number, now: number): number {
  const plan = state.plan !== null && state.plan.endsAt > now ? planById(state.plan.id)?.weeklyTokens ?? 0 : 0;
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
