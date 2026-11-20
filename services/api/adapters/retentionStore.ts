import type { SupabaseClient } from "@supabase/supabase-js";
import type { RetentionStore, RetentionSummary, RetentionTimeline, RetentionUserRow } from "../src/retention.ts";

/**
 * Retention in Supabase (migration 20261120120000_retention_tracking). Every read is one
 * RPC over the rolled-up tables: the summary is a cached row, the churned list an index
 * range, a timeline an index lookup by account.
 */
export function createRetentionStore(): RetentionStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Retention requires Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw new Error(`Retention ${name} failed`);
    return data as T;
  }
  return {
    async record(uid, now, events) {
      await rpc("record_retention_events", { p_uid: uid, p_now: now, p_items: events });
    },
    async summary(silentDays) {
      return (await rpc<RetentionSummary | null>("read_retention_summary", { p_silent: silentDays })) ?? null;
    },
    async refresh(now) {
      await rpc("refresh_retention", { p_now: now });
    },
    async churned({ now, silentDays, reason, offset, limit }) {
      return rpc<{ total: number; users: RetentionUserRow[] }>("read_retention_churned", {
        p_now: now, p_silent: silentDays, p_reason: reason, p_offset: offset, p_limit: limit,
      });
    },
    async timeline(uid) {
      return rpc<RetentionTimeline>("read_retention_user", { p_uid: uid });
    },
  };
}
