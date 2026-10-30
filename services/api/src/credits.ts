/**
 * Free AI credits: one balance for every included model, refilled on a rolling 5-hour window
 * with a weekly ceiling, as in a Claude Max plan.
 *
 * A credit is about 1,000 tokens on a standard model. Each model has a rate - credits per
 * 1,000 tokens - so a partner model that is cheaper to serve costs fewer credits, and every
 * model draws from the same balance. Windows start with the first request after the previous
 * one ended, not on a clock, so nobody loses half a window by starting late.
 *
 * Amounts are stored in millicredits (integers), so a 0.2-rate model charges exactly.
 * Pure functions; the stores keep the windows.
 */
import type { CustomProvider, IncludedProviderId, TagflowLimits } from "./includedProviders.ts";

export interface CreditPlan {
  /** Credits per rolling session window. */
  sessionCredits: number;
  /** Credits per rolling 7-day window. */
  weeklyCredits: number;
  /** Length of a session window, in hours. */
  sessionHours: number;
}

/** The old daily allowance (2M tokens on the main pool) now refills every five hours. */
export const DEFAULT_CREDIT_PLAN: CreditPlan = { sessionCredits: 2200, weeklyCredits: 22000, sessionHours: 5 };
export const WEEK_MS = 7 * 86_400_000;
export const MAX_CREDITS = 10_000_000;
export const MAX_CREDIT_RATE = 100;

export type CreditWindowKind = "session" | "week";

/** One window as stored: millicredits used by finished requests and held by running ones. */
export interface CreditWindow {
  startedAt: number;
  endsAt: number;
  usedMillicredits: number;
  reservedMillicredits: number;
}

export interface CreditWindows {
  session: CreditWindow | null;
  week: CreditWindow | null;
}

/** What a reservation asks the store to check and hold, in millicredits. */
export interface CreditCharge {
  millicredits: number;
  sessionLimit: number;
  weeklyLimit: number;
  sessionMs: number;
  now: number;
}

const record = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const whole = (raw: unknown, max: number): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= max;

export function parseCreditPlan(raw: unknown): CreditPlan | null {
  if (!record(raw) || Object.keys(raw).some((key) => !["sessionCredits", "weeklyCredits", "sessionHours"].includes(key))) return null;
  const { sessionCredits, weeklyCredits, sessionHours } = raw;
  if (!whole(sessionCredits, MAX_CREDITS) || !whole(weeklyCredits, MAX_CREDITS) || !whole(sessionHours, 168) || sessionHours < 1) return null;
  return { sessionCredits, weeklyCredits, sessionHours };
}

export const isCreditRate = (raw: unknown): raw is number => typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= MAX_CREDIT_RATE;

/**
 * Credits per 1,000 tokens. An explicit rate wins. A partner that used to have its own daily
 * pool keeps its value: a 10M-token pool beside a 2M main allowance becomes a 0.2 rate, so the
 * same tokens fit in the one combined balance.
 */
export function modelCreditRate(
  model: { creditRate?: number; provider?: IncludedProviderId },
  config: { limits: TagflowLimits; providers?: CustomProvider[] },
): number {
  if (model.creditRate !== undefined) return model.creditRate;
  const pool = config.providers?.find((provider) => provider.id === (model.provider ?? "tagflow"))?.limits;
  if (pool === undefined || pool.dailyTokens <= 0 || config.limits.dailyTokens <= 0) return 1;
  return Math.round(Math.min(MAX_CREDIT_RATE, Math.max(0.01, config.limits.dailyTokens / pool.dailyTokens)) * 1000) / 1000;
}

/** Millicredits for a token count at a rate: rate credits per 1,000 tokens = rate millicredits per token. */
export const millicreditsFor = (tokens: number, rate: number): number => Math.ceil(Math.max(0, tokens) * rate);

export const credits = (millicredits: number): number => Math.round(millicredits) / 1000;

/** A stored window that has ended counts as empty: the next request starts a fresh one. */
export function liveWindow(window: CreditWindow | null, now: number): CreditWindow | null {
  return window === null || window.endsAt <= now ? null : window;
}

/** One window as the account sees it, in credits. */
export interface CreditWindowView {
  limit: number;
  used: number;
  held: number;
  remaining: number;
  /** Null until the first request opens the window. */
  startedAt: number | null;
  resetsAt: number | null;
}

export interface CreditsView {
  plan: CreditPlan;
  session: CreditWindowView;
  weekly: CreditWindowView;
  /** Credits per 1,000 tokens, per offered model. */
  rates: Record<string, number>;
}

function windowView(window: CreditWindow | null, limitCredits: number, now: number): CreditWindowView {
  const live = liveWindow(window, now);
  const used = credits(live?.usedMillicredits ?? 0);
  const held = credits(live?.reservedMillicredits ?? 0);
  return { limit: limitCredits, used, held, remaining: Math.max(0, credits(limitCredits * 1000 - (live?.usedMillicredits ?? 0) - (live?.reservedMillicredits ?? 0))), startedAt: live?.startedAt ?? null, resetsAt: live?.endsAt ?? null };
}

export function creditsView(plan: CreditPlan, windows: CreditWindows, rates: Record<string, number>, now: number): CreditsView {
  return { plan, session: windowView(windows.session, plan.sessionCredits, now), weekly: windowView(windows.week, plan.weeklyCredits, now), rates };
}

export function creditCharge(plan: CreditPlan, millicredits: number, now: number): CreditCharge {
  return { millicredits, sessionLimit: plan.sessionCredits * 1000, weeklyLimit: plan.weeklyCredits * 1000, sessionMs: plan.sessionHours * 3_600_000, now };
}

/**
 * The check both stores make, inside their own atomic step. A request starts while the window
 * has any credit left; what it really used is charged when it finishes, so one long reply can
 * take a window slightly past its limit rather than being refused near the end.
 */
export function admitCredits(windows: CreditWindows, charge: CreditCharge, unlimited = false):
  | { ok: true; windows: { session: CreditWindow; week: CreditWindow } }
  | { ok: false; limit: "session-limit" | "weekly-limit" } {
  const open = (window: CreditWindow | null, length: number): CreditWindow =>
    liveWindow(window, charge.now) ?? { startedAt: charge.now, endsAt: charge.now + length, usedMillicredits: 0, reservedMillicredits: 0 };
  const session = open(windows.session, charge.sessionMs);
  const week = open(windows.week, WEEK_MS);
  if (!unlimited && charge.millicredits > 0) {
    if (week.usedMillicredits + week.reservedMillicredits >= charge.weeklyLimit) return { ok: false, limit: "weekly-limit" };
    if (session.usedMillicredits + session.reservedMillicredits >= charge.sessionLimit) return { ok: false, limit: "session-limit" };
  }
  return { ok: true, windows: {
    session: { ...session, reservedMillicredits: session.reservedMillicredits + charge.millicredits },
    week: { ...week, reservedMillicredits: week.reservedMillicredits + charge.millicredits },
  } };
}

/** Settle a reservation into its window, unless that window has since ended and a new one began. */
export function settleWindow(window: CreditWindow | null, startedAt: number | null, reserved: number, used: number): CreditWindow | null {
  if (window === null || startedAt === null || window.startedAt !== startedAt) return window;
  return { ...window, reservedMillicredits: Math.max(0, window.reservedMillicredits - reserved), usedMillicredits: window.usedMillicredits + Math.max(0, used) };
}

/** "3 hr 12 min", "45 min", "under a minute": how long until a window refills. */
export function untilText(at: number, now: number): string {
  const minutes = Math.ceil((at - now) / 60_000);
  if (minutes <= 1) return "under a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}${hours > 0 ? ` ${hours} hr` : ""}`;
  return hours > 0 ? `${hours} hr${rest > 0 ? ` ${rest} min` : ""}` : `${rest} min`;
}
