/**
 * Included AI tokens: one free daily allowance across every included provider, then purchased tokens.
 *
 * Cost-credit requests reserve the complete quote, free first, then purchased usage.
 * Settlement releases unused headroom. Legacy configurations retain token admission.
 * Persisted token field names also carry cost-credit units after the versioned cutover.
 * Pure functions; the stores apply them atomically.
 */
export const DAILY_ALLOWANCE_MS = 86_400_000;
// Legacy weekly field names are retained in persisted settings and API payloads.

export interface PaidPack { id: string; priceCents: number; tokens: number }
export interface PaidConfig { enabled: boolean; accounting?: "cost-v1"; /** Legacy provider selection, retained for saved configurations. All included models now share the allowance. */ providers: string[]; freeWeeklyTokens: number; packs: PaidPack[] }

export const DEFAULT_PAID_CONFIG: PaidConfig = {
  enabled: false,
  providers: ["custom-heabsy"],
  freeWeeklyTokens: 5_000_000,
  packs: [
    // A first purchase under the $10 Boost, at the same $2 per 1,000 credits (3 November 2026).
    { id: "starter", priceCents: 300, tokens: 16_500_000 },
    { id: "50m", priceCents: 1000, tokens: 55_000_000 },
    { id: "140m", priceCents: 2500, tokens: 154_000_000 },
    { id: "300m", priceCents: 5000, tokens: 330_000_000 },
  ],
};
export const COST_PAID_CONFIG: PaidConfig = { ...DEFAULT_PAID_CONFIG, accounting: "cost-v1", freeWeeklyTokens: 1_540_000 };
export const BUY_TOKENS_URL = "https://adcode.bluethenics.com/ai-tokens";
/** Where "Buy credits" lands when credits run out: the packs, smallest first. */
export const BUY_PACKS_URL = `${BUY_TOKENS_URL}#wallet`;
/** One-time credit packs ended with the plans (6 November 2026); USD credits replace both. */
export const PACKS_ON_SALE = false;
export const TOKEN_ORDER_PREFIX = "ait_";
const MAX_TOKENS = 10_000_000_000;

const record = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const whole = (raw: unknown, min: number, max: number): raw is number => typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max;

export function parsePaidConfig(raw: unknown): PaidConfig | null {
  if (!record(raw) || Object.keys(raw).some((key) => !["enabled", "providers", "freeWeeklyTokens", "packs", "accounting"].includes(key))) return null;
  const { enabled, providers, freeWeeklyTokens, packs } = raw;
  if (raw["accounting"] !== undefined && raw["accounting"] !== "cost-v1") return null;
  if (typeof enabled !== "boolean" || !whole(freeWeeklyTokens, 0, MAX_TOKENS)) return null;
  // Accept legacy provider selections without using them to exempt models from accounting.
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
  return { enabled, ...(raw["accounting"] === "cost-v1" ? { accounting: "cost-v1" as const } : {}), providers: [...providers] as string[], freeWeeklyTokens, packs: parsed };
}

/**
 * Tagflow sponsors its models, so a Tagflow model priced at zero is free to use. Zero prices on
 * any other provider still mean "nobody entered them" and stay blocked.
 *
 * This used to match only `tagflow-code-27b` by ID, so a second Tagflow model an administrator
 * added (tagflow-code-flash-1, November 2026) saved fine and then never reached anybody.
 */
export function isSponsoredTagflow(model: { id?: string; provider?: string; billing?: string; inputPrice?: number; outputPrice?: number }): boolean {
  return (model.provider ?? "tagflow") === "tagflow" && model.billing !== "wallet" && model.inputPrice === 0 && model.outputPrice === 0;
}

export function isPaidModel(model: Parameters<typeof isSponsoredTagflow>[0], paid: PaidConfig | undefined): boolean {
  return paid?.enabled === true && !(paid.accounting === "cost-v1" && isSponsoredTagflow(model));
}

export interface FreeWindow { startedAt: number; endsAt: number; usedTokens: number; reservedTokens: number }
export interface TokenBalance { purchased: number; reserved: number }
export interface PaidHold { freeTokens: number; paidTokens: number; windowStartedAt: number }

function live(window: FreeWindow | null, now: number): FreeWindow | null {
  if (window === null) return null;
  const endsAt = Math.min(window.endsAt, window.startedAt + DAILY_ALLOWANCE_MS);
  return endsAt <= now ? null : { ...window, endsAt };
}

export function holdTokens(free: FreeWindow | null, balance: TokenBalance, freeWeekly: number, hold: number, now: number, requireFull = false):
  | { ok: true; window: FreeWindow; balance: TokenBalance; hold: PaidHold }
  | { ok: false; resetsAt: number } {
  const window = live(free, now) ?? { startedAt: now, endsAt: now + DAILY_ALLOWANCE_MS, usedTokens: 0, reservedTokens: 0 };
  const freeLeft = Math.max(0, freeWeekly - window.usedTokens - window.reservedTokens);
  if ((requireFull && Math.max(0, hold) > freeLeft + Math.max(0, balance.purchased - balance.reserved)) || freeLeft + Math.max(0, balance.purchased - balance.reserved) <= 0) return { ok: false, resetsAt: window.endsAt };
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
  const used = Math.min(Math.max(0, actual), hold.freeTokens + hold.paidTokens);
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
