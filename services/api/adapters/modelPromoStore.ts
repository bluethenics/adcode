import type { ModelPromoClaim, ModelPromoClaimResult, ModelPromoStore } from "../src/modelPromo.ts";

type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
const check = (error: { message: string } | null): void => { if (error !== null) throw new Error(`Model promo storage: ${error.message}`); };
const CLAIM_RESULTS: readonly ModelPromoClaimResult[] = ["granted", "already", "full"];

/** The free model promotion's claims and holds, through the server-only SQL functions. */
export function createModelPromoStore(lazy: () => Promise<SupabaseClient>): ModelPromoStore {
  return {
    async claimModelPromo(promoId, uid, micros, maxUsers, now) {
      const { data, error } = await (await lazy()).rpc("claim_model_promo", { p_promo: promoId, p_uid: uid, p_micros: micros, p_max: maxUsers, p_now: now }); check(error);
      if (!CLAIM_RESULTS.includes(data)) throw new Error("Invalid model promo claim result");
      return data as ModelPromoClaimResult;
    },
    async getModelPromoClaim(promoId, uid, now) {
      const { data, error } = await (await lazy()).rpc("model_promo_view", { p_promo: promoId, p_uid: uid, p_now: now }); check(error);
      if (data === null || typeof data !== "object") return null;
      const row = data as Record<string, unknown>;
      return { grantedMicros: Number(row["grantedMicros"]), spentMicros: Number(row["spentMicros"]), reservedMicros: Number(row["reservedMicros"]) } satisfies ModelPromoClaim;
    },
    async modelPromoStats(promoId) {
      const { data, error } = await (await lazy()).rpc("model_promo_stats", { p_promo: promoId }); check(error);
      const row = (data ?? {}) as Record<string, unknown>;
      return { claims: Number(row["claims"] ?? 0), spentMicros: Number(row["spentMicros"] ?? 0) };
    },
    async reserveModelPromo(holdId, promoId, uid, model, micros, now) {
      const { data, error } = await (await lazy()).rpc("reserve_model_promo", { p_id: holdId, p_promo: promoId, p_uid: uid, p_model: model, p_micros: micros, p_now: now }); check(error);
      const held = Number(data ?? 0);
      return Number.isSafeInteger(held) && held > 0 ? held : 0;
    },
    async settleModelPromo(holdId, micros, now) {
      const { error } = await (await lazy()).rpc("settle_model_promo", { p_id: holdId, p_micros: micros, p_now: now }); check(error);
    },
  };
}
