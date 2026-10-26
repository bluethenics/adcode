/**
 * Paid AI tokens: a free weekly allowance on the paid providers' models, then tokens the person
 * bought. Tagflow is never paid. Spec: docs/superpowers/specs/2026-10-21-paid-ai-tokens-design.md.
 *
 * A request is admitted while any free or purchased tokens are left, holds its estimate free
 * first, and is charged what it really used when it finishes - so a task is never cut off
 * midway, and one long request may take the purchased balance slightly below zero.
 * Pure functions; the stores apply them atomically.
 */
import { WEEK_MS } from "./credits.ts";

export interface PaidPack { id: string; priceCents: number; tokens: number }
export interface PaidConfig { enabled: boolean; providers: string[]; freeWeeklyTokens: number; packs: PaidPack[] }

export const DEFAULT_PAID_CONFIG: PaidConfig = {
  enabled: false,
  providers: ["custom-heabsy"],
  freeWeeklyTokens: 10_000_000,
  packs: [
    { id: "50m", priceCents: 1000, tokens: 50_000_000 },
    { id: "140m", priceCents: 2500, tokens: 140_000_000 },
    { id: "300m", priceCents: 5000, tokens: 300_000_000 },
  ],
};
export const BUY_TOKENS_URL = "https://adcode.bluethenics.com/ai-tokens";
export const TOKEN_ORDER_PREFIX = "ait_";
const MAX_TOKENS = 10_000_000_000;

const record = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const whole = (raw: unknown, min: number, max: number): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max;

export function parsePaidConfig(raw: unknown): PaidConfig | null {
  if (!record(raw) || Object.keys(raw).some((key) => !["enabled", "providers", "freeWeeklyTokens", "packs"].includes(key))) return null;
  const { enabled, providers, freeWeeklyTokens, packs } = raw;
  if (typeof enabled !== "boolean" || !whole(freeWeeklyTokens, 0, MAX_TOKENS)) return null;
  // Only administrator-registered providers can be paid: Tagflow stays free.
  if (!Array.isArray(providers) || providers.length > 20 || providers.some((id) => typeof id !== "string" || !/^custom-[a-z0-9-]{1,40}$/.test(id))) return null;
  if (!Array.isArray(packs) || packs.length === 0 || packs.length > 6) return null;
  const parsed: PaidPack[] = [];
  for (const pack of packs) {
    if (!record(pack) || Object.keys(pack).some((key) => !["id", "priceCents", "tokens"].includes(key))) return null;
    const { id, priceCents, tokens } = pack;
    if (typeof id !== "string" || !/^[a-z0-9]{1,16}$/.test(id) || !whole(priceCents, 100, 100_000) || !whole(tokens, 1, MAX_TOKENS)) return null;
    if (parsed.some((one) => one.id === id)) return null;
    parsed.push({ id, priceCents, tokens });
  }
  return { enabled, providers: [...providers] as string[], freeWeeklyTokens, packs: parsed };
}

export function isPaidModel(model: { provider?: string }, paid: PaidConfig | undefined): boolean {
  return paid?.enabled === true && paid.providers.includes(model.provider ?? "tagflow");
}

export interface FreeWindow { startedAt: number; endsAt: number; usedTokens: number; reservedTokens: number }
export interface TokenBalance { purchased: number; reserved: number }
export interface PaidHold { freeTokens: number; paidTokens: number; windowStartedAt: number }

const live = (window: FreeWindow | null, now: number): FreeWindow | null => window === null || window.endsAt <= now ? null : window;

export function holdTokens(free: FreeWindow | null, balance: TokenBalance, freeWeekly: number, hold: number, now: number):
  | { ok: true; window: FreeWindow; balance: TokenBalance; hold: PaidHold }
  | { ok: false; resetsAt: number } {
  const window = live(free, now) ?? { startedAt: now, endsAt: now + WEEK_MS, usedTokens: 0, reservedTokens: 0 };
  const freeLeft = Math.max(0, freeWeekly - window.usedTokens - window.reservedTokens);
  if (freeLeft <= 0 && balance.purchased - balance.reserved <= 0) return { ok: false, resetsAt: window.endsAt };
  const freeTokens = Math.min(Math.max(0, hold), freeLeft);
  const paidTokens = Math.max(0, hold) - freeTokens;
  return {
    ok: true,
    window: { ...window, reservedTokens: window.reservedTokens + freeTokens },
    balance: { purchased: balance.purchased, reserved: balance.reserved + paidTokens },
    hold: { freeTokens, paidTokens, windowStartedAt: window.startedAt },
  };
}

export function chargeTokens(free: FreeWindow | null, balance: TokenBalance, hold: PaidHold, actual: number):
  { window: FreeWindow | null; balance: TokenBalance; paidCharged: number } {
  const used = Math.max(0, actual);
  const freeCharged = Math.min(used, hold.freeTokens);
  const paidCharged = used - freeCharged;
  // A window that restarted since this request was held is not this request's to change.
  const window = free !== null && free.startedAt === hold.windowStartedAt
    ? { ...free, usedTokens: free.usedTokens + freeCharged, reservedTokens: Math.max(0, free.reservedTokens - hold.freeTokens) }
    : free;
  return { window, balance: { purchased: balance.purchased - paidCharged, reserved: Math.max(0, balance.reserved - hold.paidTokens) }, paidCharged };
}

export interface TokensView {
  enabled: boolean;
  free: { limit: number; used: number; held: number; remaining: number; resetsAt: number | null };
  purchased: number;
}

export function tokensView(paid: PaidConfig | undefined, free: FreeWindow | null, balance: TokenBalance, now: number): TokensView {
  const limit = paid?.freeWeeklyTokens ?? DEFAULT_PAID_CONFIG.freeWeeklyTokens;
  const window = live(free, now);
  const used = window?.usedTokens ?? 0;
  const held = window?.reservedTokens ?? 0;
  return { enabled: paid?.enabled === true, free: { limit, used, held, remaining: Math.max(0, limit - used - held), resetsAt: window?.endsAt ?? null }, purchased: Math.max(0, balance.purchased - balance.reserved) };
}
