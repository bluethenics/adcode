import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUsageRow, AppUsageStore } from "../src/appUsage.ts";

/** Daily feature-use totals in Supabase (migration 20261105120000_app_feature_usage). */
export function createAppUsageStore(): AppUsageStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Feature-use counts require Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  return {
    async add(report) {
      const { error } = await (await db()).rpc("record_app_usage", { p_day: report.day, p_counts: report.counts });
      if (error) throw new Error("Feature-use write failed");
    },
    async read(startDay, endDay) {
      const rows: AppUsageRow[] = [];
      for (let offset = 0; offset <= 50_000; offset += 1000) {
        const { data, error } = await (await db()).from("app_usage").select("day,name,uses,clients")
          .gte("day", startDay).lt("day", endDay).order("day").order("name").range(offset, offset + 999);
        if (error) throw new Error("Feature-use read failed");
        for (const row of (data ?? []) as { day: string; name: string; uses: number | string; clients: number }[]) rows.push({ day: row.day, name: row.name, uses: Number(row.uses), clients: row.clients });
        if ((data ?? []).length < 1000) break;
      }
      return rows;
    },
  };
}
