import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATIVE_REVIEWS, DEFAULT_AD_SAFETY, type AdSafetyStore, type CreativeReview, type EarningHold, type EarningHoldStore } from "../src/adSafety.ts";

/**
 * Ad safety in Postgres: the one-row `ad_safety_settings` (migration 20261126120000) and the
 * earnings holds of migrations 20261125135000/136000.
 *
 * Reading settings tolerates a database a migration behind - no table, no row - by answering
 * the defaults, so the service can be deployed before the migration and nothing about ads
 * stops. Saving them needs the table, and says so.
 */
const check = (error: { message: string } | null, what: string): void => { if (error !== null) throw new Error(`Ad safety (${what}): ${error.message}`); };

type SettingsRow = { creative_review: string; cards_need_verified: boolean; updated_at: number | string | null; updated_by: string | null };

export function createAdSafetyStore(lazy: () => Promise<SupabaseClient>): AdSafetyStore {
  return {
    async get() {
      const { data, error } = await (await lazy()).from("ad_safety_settings").select("creative_review,cards_need_verified,updated_at,updated_by").eq("id", 1).maybeSingle<SettingsRow>();
      if (error !== null || data === null) return DEFAULT_AD_SAFETY;
      return {
        creativeReview: CREATIVE_REVIEWS.includes(data.creative_review as CreativeReview) ? data.creative_review as CreativeReview : DEFAULT_AD_SAFETY.creativeReview,
        cardsNeedVerifiedEmail: data.cards_need_verified !== false,
        updatedAt: data.updated_at === null ? null : Number(data.updated_at),
        updatedBy: data.updated_by,
      };
    },
    async put(next, adminUid, now) {
      const db = await lazy();
      const { error } = await db.from("ad_safety_settings").upsert({ id: 1, creative_review: next.creativeReview, cards_need_verified: next.cardsNeedVerifiedEmail, updated_at: now, updated_by: adminUid });
      check(error, "save settings");
      const audit = await db.from("audit_log").insert({ admin_uid: adminUid, action: `ad-safety:${next.creativeReview}:${next.cardsNeedVerifiedEmail ? "verified-only" : "anyone"}`, subject_uid: "*", at: now });
      check(audit.error, "audit");
    },
  };
}

type HoldRow = { uid: string; reason: string; held_micros: number | string; source_micros: number | string; already_spent_micros: number | string; placed_at: number | string; placed_by: string; note: string | null };

export function createEarningHoldStore(lazy: () => Promise<SupabaseClient>): EarningHoldStore {
  return {
    async list(limit) {
      const db = await lazy();
      const { data, error } = await db.from("earning_holds")
        .select("uid,reason,held_micros::text,source_micros::text,already_spent_micros::text,placed_at,placed_by,note")
        .is("released_at", null).order("held_micros", { ascending: false }).limit(Math.max(1, Math.min(500, limit)));
      check(error, "list holds");
      const totals = await db.from("earning_holds").select("held_micros::text").is("released_at", null);
      check(totals.error, "total holds");
      const rows = (data ?? []) as HoldRow[];
      const holds: EarningHold[] = rows.map((row) => ({
        uid: row.uid,
        reason: row.reason,
        heldMicros: String(row.held_micros),
        sourceMicros: String(row.source_micros),
        alreadySpentMicros: String(row.already_spent_micros),
        placedAt: Number(row.placed_at),
        placedBy: row.placed_by,
        note: row.note,
      }));
      const all = (totals.data ?? []) as { held_micros: string | number }[];
      return { holds, accounts: all.length, heldMicros: all.reduce((total, row) => total + BigInt(String(row.held_micros)), 0n).toString() };
    },
    async release({ uid, reason, adminUid, now }) {
      const db = await lazy();
      const { data, error } = await db.rpc("release_earning_hold", { p_admin: adminUid, p_now: now, p_uid: uid, p_reason: reason });
      check(error, "release");
      const released = typeof data === "number" ? data : Number(data ?? 0);
      const audit = await db.from("audit_log").insert({ admin_uid: adminUid, action: `earning-hold-release:${reason}:${released}`, subject_uid: uid ?? "*", at: now });
      check(audit.error, "audit");
      return released;
    },
  };
}
