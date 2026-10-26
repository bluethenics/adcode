import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelWatchRow, StatusAlertJob, StatusAlertPayload, StatusAlertStore, StatusAlertTopic, WatchedLevel } from "../src/statusAlerts.ts";

/** The status page's subscriber lists and alert queue (migration 20261021150000). */
export function createSupabaseStatusAlertStore(): StatusAlertStore {
  let client: SupabaseClient | undefined;
  async function db() {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Status alerts require Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw new Error("Status alert operation failed: " + name);
    return data;
  }
  return {
    async subscribe(input) {
      const rows = await rpc("status_subscribe", { p_email: input.email, p_models: input.models, p_incidents: input.incidents, p_now: input.now }) as Array<Record<string, unknown>>;
      const row = rows[0];
      return { send: row?.["send"] === true, confirmToken: typeof row?.["confirm_token"] === "string" ? row["confirm_token"] : null };
    },
    async recordConfirmation(email, providerId) { await rpc("status_record_confirmation", { p_email: email, p_provider_id: providerId }); },
    async confirm(token, now) {
      const result = await rpc("status_confirm", { p_token: token, p_now: now });
      return result === "confirmed" || result === "expired" ? result : "invalid";
    },
    async unsubscribe(token, now) { return await rpc("status_unsubscribe", { p_token: token, p_now: now }) === true; },
    async watchRows() {
      const { data, error } = await (await db()).from("status_model_watch").select("*");
      if (error) throw new Error("Status watch unavailable");
      return (data ?? []).map((row): ModelWatchRow => ({
        modelKey: String(row.model_key), name: String(row.name), day: String(row.day),
        turns: Number(row.turns), errors: Number(row.errors), notified: row.notified as WatchedLevel,
        goodStreak: Number(row.good_streak), changedAt: row.changed_at === null ? null : Number(row.changed_at), checkedAt: Number(row.checked_at),
      }));
    },
    async saveWatchRows(rows) {
      const { error } = await (await db()).from("status_model_watch").upsert(rows.map((row) => ({
        model_key: row.modelKey, name: row.name, day: row.day, turns: row.turns, errors: row.errors,
        notified: row.notified, good_streak: row.goodStreak, changed_at: row.changedAt, checked_at: row.checkedAt,
      })));
      if (error) throw new Error("Status watch could not be saved");
    },
    async queueAlert(input) {
      return Number(await rpc("status_queue_alert", { p_topic: input.topic, p_ref: input.ref, p_subject: input.subject.slice(0, 200), p_payload: input.payload, p_now: input.now }));
    },
    async claimAlerts(now, limit) {
      const rows = await rpc("status_claim_alerts", { p_now: now, p_limit: limit }) as Array<Record<string, unknown>>;
      return rows.map((row): StatusAlertJob => ({
        id: String(row["id"]), email: String(row["email"]), attempts: Number(row["attempts"]), topic: row["topic"] as StatusAlertTopic,
        subject: String(row["subject"]), payload: row["payload"] as StatusAlertPayload, manageToken: String(row["manage_token"]),
      }));
    },
    async finishAlert(id, result, now) {
      await rpc("status_finish_alert", "providerId" in result
        ? { p_id: id, p_provider_id: result.providerId, p_retry: false, p_code: null, p_now: now }
        : { p_id: id, p_provider_id: null, p_retry: result.retry, p_code: result.code, p_now: now });
    },
    async counts() {
      const database = await db();
      // Head-only counts: the list can outgrow one page of rows long before it outgrows this.
      const count = async (filter: Record<string, string | boolean>): Promise<number> => {
        let query = database.from("status_subscribers").select("id", { count: "exact", head: true });
        for (const [column, value] of Object.entries(filter)) query = query.eq(column, value);
        const { count: found, error } = await query;
        if (error) throw new Error("Status subscribers unavailable");
        return found ?? 0;
      };
      const [active, models, incidents, pending] = await Promise.all([
        count({ state: "active" }), count({ state: "active", models: true }), count({ state: "active", incidents: true }), count({ state: "pending" }),
      ]);
      return { active, models, incidents, pending };
    },
  };
}
