import type { WebsiteAnalyticsStore, WebsiteEvent } from "../src/websiteAnalytics.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

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
      const { error } = await (await db()).from("website_events").upsert(events.map(({ receivedAt, ...event }) => ({ ...event, received_at: receivedAt })), { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error("Website analytics write failed");
    },
    async read(start, end) {
      const events: WebsiteEvent[] = [];
      for (let offset = 0; offset <= 20000; offset += 1000) {
        const { data, error } = await (await db()).from("website_events").select("id,session,name,path,source,campaign,device,value,received_at")
          .gte("received_at", start).lt("received_at", end).order("received_at", { ascending: false }).order("id").range(offset, offset + 999);
        if (error) throw new Error("Website analytics read failed");
        if (offset === 20000) return { events, truncated: (data?.length ?? 0) > 0 };
        for (const row of data ?? []) events.push({ id: row.id, session: row.session, name: row.name, path: row.path, source: row.source, campaign: row.campaign, device: row.device, value: row.value, receivedAt: row.received_at });
        if (!data || data.length < 1000) return { events, truncated: false };
      }
      return { events, truncated: false };
    },
  };
}
