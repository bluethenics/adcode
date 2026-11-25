import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdIntegrityStore, IntegrityAlert } from "../src/adIntegrity.ts";

/** Ad integrity in Postgres: migration 20261125130000_ad_integrity.sql. Errors throw; adIntegrity.ts decides what a throw means. */
const check = (error: { message: string } | null, what: string): void => { if (error !== null) throw new Error(`Ad integrity (${what}): ${error.message}`); };

export function createAdIntegrityStore(lazy: () => Promise<SupabaseClient>): AdIntegrityStore {
  return {
    async touch({ uid, conversation, now }) {
      const { data, error } = await (await lazy()).rpc("ad_integrity_touch", { p_uid: uid, p_conversation: conversation, p_now: now });
      check(error, "touch");
      const raw = (data ?? {}) as { hourCount?: unknown; beatRun?: unknown };
      return { hourCount: Number(raw.hourCount ?? 0) || 0, beatRun: Number(raw.beatRun ?? 0) || 0 };
    },
    async bump(network, kind, bucket) {
      const { data, error } = await (await lazy()).rpc("ad_integrity_bump", { p_network: network, p_kind: kind, p_bucket: bucket });
      check(error, "bump");
      return Number(data) || 0;
    },
    async sum(network, kind, fromBucket, toBucket) {
      const { data, error } = await (await lazy()).from("ad_integrity_buckets").select("n").eq("network", network).eq("kind", kind).gte("bucket", fromBucket).lte("bucket", toBucket);
      check(error, "sum");
      return ((data ?? []) as Array<{ n: number }>).reduce((total, row) => total + Number(row.n), 0);
    },
    async breakers() {
      const { data, error } = await (await lazy()).from("ad_network_breakers").select("network, open, reason, opened_at");
      check(error, "breakers");
      return data;
    },
    async openBreaker({ network, reason, details, now }) {
      const { data, error } = await (await lazy()).rpc("ad_integrity_open_breaker", { p_network: network, p_reason: reason, p_details: details, p_now: now });
      check(error, "open");
      return data === true;
    },
    async closeBreaker({ network, adminUid, now }) {
      const db = await lazy();
      const { data, error } = await db.from("ad_network_breakers").update({ open: false, closed_by: adminUid, closed_at: now }).eq("network", network).eq("open", true).select("network");
      check(error, "close");
      if ((data ?? []).length === 0) return false;
      const audit = await db.from("audit_log").insert({ admin_uid: adminUid, action: "ad-breaker-close", subject_uid: network, at: now });
      check(audit.error, "close audit");
      return true;
    },
    async listAlerts(limit) {
      const { data, error } = await (await lazy()).from("ad_integrity_alerts").select("id, network, reason, details, at").order("at", { ascending: false }).limit(limit);
      check(error, "alerts");
      return ((data ?? []) as Array<{ id: number | string; network: string; reason: string; details: Record<string, unknown> | null; at: number | string }>)
        .map((row): IntegrityAlert => ({ id: Number(row.id), network: row.network, reason: row.reason, details: row.details ?? {}, at: Number(row.at) }));
    },
  };
}
