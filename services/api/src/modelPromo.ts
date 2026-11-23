/**
 * Free model promotion: the first N verified accounts each get a fixed amount of free usage on
 * chosen paid models (direct DeepSeek at launch, 23 Nov 2026: $0.15 for 300 accounts).
 *
 * The aim is a loop. Free DeepSeek keeps a new person working while sponsored cards earn for
 * them, and once their earnings reach the conversion minimum they turn them into credits and
 * keep going. So the grant is spent at the same listed prices as purchased credits, and it is
 * separate money: it never pays for other models, never mixes into a purchased balance, and
 * never refunds to anyone.
 *
 * Stored on the Tagflow config record beside the usage campaign and the price offer, so an
 * administrator starts and stops it from the web admin. Claims and holds live in their own
 * tables (`model_promo_claims`, `model_promo_holds`); the purchased wallet is untouched. Pure.
 */

export interface ModelPromo {
  id: string;
  name: string;
  /** Free usage per account, in micro-dollars at listed prices. */
  perUserMicros: number;
  /** Accounts that can claim it; the pool is closed once this many have. */
  maxUsers: number;
  /** Model ids (wallet models) the grant may pay for. */
  models: string[];
  startsAt: number;
  endsAt: number;
}

/** One account's share of a promotion. */
export interface ModelPromoClaim { grantedMicros: number; spentMicros: number; reservedMicros: number }

export type ModelPromoClaimResult = "granted" | "already" | "full";

export interface ModelPromoStore {
  /** Gives `uid` the promotion's grant if fewer than `maxUsers` accounts have it. Atomic. */
  claimModelPromo(promoId: string, uid: string, micros: number, maxUsers: number, now: number): Promise<ModelPromoClaimResult>;
  getModelPromoClaim(promoId: string, uid: string, now: number): Promise<ModelPromoClaim | null>;
  /** Accounts that have claimed, and micro-dollars they have spent. */
  modelPromoStats(promoId: string): Promise<{ claims: number; spentMicros: number }>;
  /**
   * Holds up to `micros` of the account's remaining grant for one request and returns what was
   * held: 0 when nothing remains. A request may be held for less than its maximum when only a
   * little of the grant is left; the charge is then capped at the hold, so the last request is
   * free rather than refused.
   */
  reserveModelPromo(holdId: string, promoId: string, uid: string, model: string, micros: number, now: number): Promise<number>;
  settleModelPromo(holdId: string, micros: number, now: number): Promise<void>;
}

export const MAX_PROMO_USERS = 100_000;
/** $5 per account: anything larger is a gift, not a starter. */
export const MAX_PROMO_MICROS = 5_000_000;
export const MAX_PROMO_DAYS = 365;
export const MAX_PROMO_NAME = 60;
const DAY_MS = 86_400_000;

const isRecord = (raw: unknown): raw is Record<string, unknown> => typeof raw === "object" && raw !== null && !Array.isArray(raw);
const whole = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const at = (value: unknown): value is number => whole(value, 1, 9_000_000_000_000);

export function parseModelPromo(raw: unknown): ModelPromo | null {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !["id", "name", "perUserMicros", "maxUsers", "models", "startsAt", "endsAt"].includes(key))) return null;
  const { id, name, perUserMicros, maxUsers, models, startsAt, endsAt } = raw;
  if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) return null;
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > MAX_PROMO_NAME) return null;
  if (!whole(perUserMicros, 1, MAX_PROMO_MICROS) || !whole(maxUsers, 1, MAX_PROMO_USERS)) return null;
  if (!Array.isArray(models) || models.length === 0 || models.length > 20 || !models.every((model) => typeof model === "string" && /^[A-Za-z0-9._:/-]{1,100}$/.test(model))) return null;
  if (!at(startsAt) || !at(endsAt) || endsAt <= startsAt || endsAt - startsAt > MAX_PROMO_DAYS * DAY_MS) return null;
  return { id, name: name.trim(), perUserMicros, maxUsers, models: [...new Set(models as string[])], startsAt, endsAt };
}

/** The promotion running at `now`, or null. */
export function activeModelPromo(promo: ModelPromo | undefined, now: number): ModelPromo | null {
  return promo !== undefined && promo.startsAt <= now && now < promo.endsAt ? promo : null;
}

/** Whether a running promotion pays for `modelId`. */
export function promoCovers(promo: ModelPromo | null, modelId: string): promo is ModelPromo {
  return promo !== null && promo.models.includes(modelId);
}

/**
 * A promotion that starts now. Amount in whole cents (1-500), accounts 1-100,000, whole days.
 * The id is derived from the start time, so a new promotion is a new pool: claims of an earlier
 * one never count against it.
 */
export function startModelPromo(raw: unknown, offered: readonly string[], now: number): ModelPromo | null {
  if (!isRecord(raw)) return null;
  const { name, perUserCents, maxUsers, days, models } = raw;
  if (!whole(perUserCents, 1, MAX_PROMO_MICROS / 10_000) || !whole(days, 1, MAX_PROMO_DAYS)) return null;
  if (!Array.isArray(models) || !models.every((model) => typeof model === "string" && offered.includes(model))) return null;
  return parseModelPromo({ id: `promo-${now.toString(36)}`, name, perUserMicros: perUserCents * 10_000, maxUsers, models, startsAt: now, endsAt: now + days * DAY_MS });
}

/** The promotion ended now; unchanged if it already ended. Claims keep what remains of them until then. */
export function endModelPromo(promo: ModelPromo, now: number): ModelPromo {
  return now >= promo.endsAt ? promo : { ...promo, endsAt: Math.max(promo.startsAt + 1, now) };
}

/** What a signed-in account is told: the offer, the places left, and its own share. */
export interface PublicModelPromo {
  name: string; perUserMicros: number; models: { id: string; name: string }[]; endsAt: number;
  spotsLeft: number; claim: { grantedMicros: number; spentMicros: number; availableMicros: number } | null;
}

export function publicModelPromo(promo: ModelPromo, names: ReadonlyMap<string, string>, claims: number, claim: ModelPromoClaim | null): PublicModelPromo {
  return {
    name: promo.name, perUserMicros: promo.perUserMicros, endsAt: promo.endsAt,
    models: promo.models.map((id) => ({ id, name: names.get(id) ?? id })),
    spotsLeft: Math.max(0, promo.maxUsers - claims),
    claim: claim === null ? null : { grantedMicros: claim.grantedMicros, spentMicros: claim.spentMicros, availableMicros: Math.max(0, claim.grantedMicros - claim.spentMicros - claim.reservedMicros) },
  };
}

/** In-memory promotion storage, with the same rules as the SQL functions. */
export function createModelPromoMemoryStore(): ModelPromoStore {
  const claims = new Map<string, ModelPromoClaim & { promoId: string; uid: string }>();
  const holds = new Map<string, { key: string; amount: number; createdAt: number; done: boolean }>();
  const key = (promoId: string, uid: string) => `${promoId}\u0000${uid}`;
  const expire = (now: number) => {
    for (const hold of holds.values()) {
      if (hold.done || hold.createdAt >= now - 1_800_000) continue;
      hold.done = true;
      const claim = claims.get(hold.key);
      if (claim) claim.reservedMicros -= hold.amount;
    }
  };
  return {
    async claimModelPromo(promoId, uid, micros, maxUsers, _now) {
      if (claims.has(key(promoId, uid))) return "already";
      if ([...claims.values()].filter((claim) => claim.promoId === promoId).length >= maxUsers) return "full";
      claims.set(key(promoId, uid), { promoId, uid, grantedMicros: micros, spentMicros: 0, reservedMicros: 0 });
      return "granted";
    },
    async getModelPromoClaim(promoId, uid, now) {
      expire(now);
      const claim = claims.get(key(promoId, uid));
      return claim === undefined ? null : { grantedMicros: claim.grantedMicros, spentMicros: claim.spentMicros, reservedMicros: claim.reservedMicros };
    },
    async modelPromoStats(promoId) {
      const all = [...claims.values()].filter((claim) => claim.promoId === promoId);
      return { claims: all.length, spentMicros: all.reduce((sum, claim) => sum + claim.spentMicros, 0) };
    },
    async reserveModelPromo(holdId, promoId, uid, _model, micros, now) {
      expire(now);
      const claim = claims.get(key(promoId, uid));
      if (claim === undefined || holds.has(holdId) || !Number.isSafeInteger(micros) || micros <= 0) return 0;
      const amount = Math.min(micros, claim.grantedMicros - claim.spentMicros - claim.reservedMicros);
      if (amount <= 0) return 0;
      claim.reservedMicros += amount;
      holds.set(holdId, { key: key(promoId, uid), amount, createdAt: now, done: false });
      return amount;
    },
    async settleModelPromo(holdId, micros, _now) {
      const hold = holds.get(holdId);
      if (hold === undefined || hold.done) return;
      hold.done = true;
      const claim = claims.get(hold.key);
      if (claim === undefined) return;
      claim.reservedMicros -= hold.amount;
      claim.spentMicros += Math.max(0, Math.min(hold.amount, micros));
    },
  };
}
