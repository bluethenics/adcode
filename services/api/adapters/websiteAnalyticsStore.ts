import type { WebsiteAnalyticsStore, WebsiteEvent } from "../src/websiteAnalytics.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a Supabase error is about the `placement` column not existing yet.
 *
 * Migration 20261006120000 adds it. A web build that runs before the migration is applied
 * must still record events - without the placement - rather than lose every one of them.
 */
const missingPlacement = (error: { message?: string } | null): boolean => /placement/i.test(error?.message ?? "");

/** Bounded report reads prevent a popular site from exhausting the Worker heap. */
export function createWebsiteAnalyticsStore(): WebsiteAnalyticsStore {
  let client: SupabaseClient | undefined;
  async function db() {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Website analytics requires Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  return {
    async append(events) {
      const rows = events.map(({ receivedAt, ...event }) => ({ ...event, placement: event.placement ?? "", received_at: receivedAt }));
      let { error } = await (await db()).from("website_events").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (error && missingPlacement(error)) {
        ({ error } = await (await db()).from("website_events").upsert(rows.map(({ placement: _placement, ...row }) => row), { onConflict: "id", ignoreDuplicates: true }));
      }
      if (error) throw new Error("Website analytics write failed");
    },
    async read(start, end) {
      const events: WebsiteEvent[] = [];
      let columns = "id,session,name,path,source,campaign,device,value,received_at,placement";
      for (let offset = 0; offset <= 20000; offset += 1000) {
        let { data, error } = await (await db()).from("website_events").select(columns)
          .gte("received_at", start).lt("received_at", end).order("received_at", { ascending: false }).order("id").range(offset, offset + 999);
        if (error && missingPlacement(error) && columns.endsWith(",placement")) {
          columns = columns.replace(",placement", "");
          ({ data, error } = await (await db()).from("website_events").select(columns)
            .gte("received_at", start).lt("received_at", end).order("received_at", { ascending: false }).order("id").range(offset, offset + 999));
        }
        if (error) throw new Error("Website analytics read failed");
        if (offset === 20000) return { events, truncated: (data?.length ?? 0) > 0 };
        for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          events.push({
            id: String(row["id"]),
            session: String(row["session"]),
            name: String(row["name"]),
            path: String(row["path"]),
            source: String(row["source"]),
            campaign: String(row["campaign"]),
            device: String(row["device"]),
            value: Number(row["value"]),
            receivedAt: Number(row["received_at"]),
            placement: typeof row["placement"] === "string" ? row["placement"] : "",
          });
        }
        if (!data || data.length < 1000) return { events, truncated: false };
      }
      return { events, truncated: false };
    },
  };
}
