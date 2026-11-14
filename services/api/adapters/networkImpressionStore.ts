import type { SupabaseClient } from "@supabase/supabase-js";
import type { NetworkImpressionStore, NetworkImpressionSummary } from "../src/networkImpressions.ts";

/**
 * Zeekend impressions in Postgres: `network_impressions`, one row per slot, and the two
 * functions of migration 20261113200000 - an insert that ignores a slot already counted, and
 * the totals and 30-day series the admin's growth figures add in.
 */
export function createNetworkImpressionStore(lazy: () => Promise<SupabaseClient>): NetworkImpressionStore {
  return {
    async record(impression, at) {
      const { data, error } = await (await lazy()).rpc("record_network_impression", {
        p_slot_id: impression.slotId,
        p_network: impression.network,
        p_layout: impression.layout,
        p_at: at,
      });
      if (error) throw new Error(`record_network_impression failed: ${error.message}`);
      return data === true;
    },
    async summary(now) {
      const { data, error } = await (await lazy()).rpc("network_impression_summary", { p_now: now });
      if (error) throw new Error(`network_impression_summary failed: ${error.message}`);
      const raw = (data ?? {}) as { total?: unknown; last1d?: unknown; last7d?: unknown; last30d?: unknown; daily?: unknown };
      const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0);
      const daily: Record<string, number> = {};
      if (Array.isArray(raw.daily)) {
        for (const row of raw.daily as Array<{ day?: unknown; count?: unknown }>) {
          if (typeof row.day === "string") daily[row.day] = count(row.count);
        }
      }
      const summary: NetworkImpressionSummary = { total: count(raw.total), last1d: count(raw.last1d), last7d: count(raw.last7d), last30d: count(raw.last30d), daily };
      return summary;
    },
  };
}
