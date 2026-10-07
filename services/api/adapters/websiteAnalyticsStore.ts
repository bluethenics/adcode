import { WEB_VITALS, type WebsiteAnalyticsStore, type WebsiteEvent } from "../src/websiteAnalytics.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a Supabase error is about a column that a later migration adds.
 *
 * Migration 20261006120000 adds `placement` and 20261006180100 adds `occurred_at`. A web build
 * that runs before they are applied must still record events - without those two fields -
 * rather than lose every one of them.
 */
const OPTIONAL = ["occurred_at", "placement"] as const;
const missingColumn = (error: { message?: string } | null): (typeof OPTIONAL)[number] | undefined =>
  OPTIONAL.find((column) => (error?.message ?? "").includes(column));

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
  type Row = Record<string, unknown>;
  /** Inserts rows; `replace` overwrites an existing id instead of keeping the first. */
  async function write(rows: Row[], replace: boolean) {
    if (rows.length === 0) return;
    const upsert = (batch: Row[], keepFirst: boolean) =>
      db().then((database) => database.from("website_events").upsert(batch, { onConflict: "id", ignoreDuplicates: keepFirst }));
    let { error } = await upsert(rows, !replace);
    // Drop whichever optional column the database does not have yet, then the other.
    for (let missing = missingColumn(error), tries = 0; error && missing !== undefined && tries < OPTIONAL.length; missing = missingColumn(error), tries += 1) {
      const absent = missing;
      rows = rows.map(({ [absent]: _dropped, ...row }) => row);
      ({ error } = await upsert(rows, !replace));
    }
    // Replacing needs UPDATE, granted by migration 20261006180100. Without it a re-sent
    // vital keeps its first value, as it always did, rather than failing the batch.
    if (error && replace) ({ error } = await upsert(rows, true));
    if (error) throw new Error("Website analytics write failed");
  }
  return {
    async append(events) {
      // One row per id: the same id twice in a batch is a re-sent Web Vital, the later value
      // the current one - and Postgres refuses to upsert one row twice in a statement.
      const latest = [...new Map(events.map((event) => [event.id, event])).values()];
      const rows = latest.map(({ receivedAt, occurredAt, ...event }) => ({ ...event, placement: event.placement ?? "", received_at: receivedAt, occurred_at: occurredAt }));
      // A Web Vital that changed (CLS grows, INP moves) arrives again under its first id, and
      // the newer value is the one that describes the visit.
      await write(rows.filter((row) => !WEB_VITALS.includes(row.name)), false);
      await write(rows.filter((row) => WEB_VITALS.includes(row.name)), true);
    },
    async read(start, end) {
      const events: WebsiteEvent[] = [];
      let columns = ["id", "session", "name", "path", "source", "campaign", "device", "value", "received_at", ...OPTIONAL];
      const page = async (offset: number) => (await db()).from("website_events").select(columns.join(","))
        .gte("received_at", start).lt("received_at", end).order("received_at", { ascending: false }).order("id").range(offset, offset + 999);
      for (let offset = 0; offset <= 20000; offset += 1000) {
        let { data, error } = await page(offset);
        for (let missing = missingColumn(error); error && missing !== undefined && columns.includes(missing); missing = missingColumn(error)) {
          const absent = missing;
          columns = columns.filter((column) => column !== absent);
          ({ data, error } = await page(offset));
        }
        if (error) throw new Error("Website analytics read failed");
        if (offset === 20000) return { events, truncated: (data?.length ?? 0) > 0 };
        for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          const receivedAt = Number(row["received_at"]);
          events.push({
            id: String(row["id"]),
            session: String(row["session"]),
            name: String(row["name"]),
            path: String(row["path"]),
            source: String(row["source"]),
            campaign: String(row["campaign"]),
            device: String(row["device"]),
            value: Number(row["value"]),
            receivedAt,
            occurredAt: row["occurred_at"] === null || row["occurred_at"] === undefined ? receivedAt : Number(row["occurred_at"]),
            placement: typeof row["placement"] === "string" ? row["placement"] : "",
          });
        }
        if (!data || data.length < 1000) return { events, truncated: false };
      }
      return { events, truncated: false };
    },
  };
}
