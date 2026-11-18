import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminConsoleStore, CampaignAudience, CampaignInput, CampaignJob, CampaignRecord, CampaignSendRow, CampaignStats, CampaignStatus,
} from "../src/adminConsole.ts";

/**
 * The admin console against Supabase. Searches, profiles and the campaign rules are database
 * functions (see `20261117120000_email_campaigns.sql` and `20261117120100_admin_user_lookup.sql`);
 * the plain table reads and writes are here.
 */
const CAMPAIGN_COLS = "id,name,subject,preheader,heading,body,cta_label,cta_url,audience,inactive_days,total_limit,daily_limit,status,created_by,created_at,updated_at,started_at,finished_at,finish_reason";

type Row = Record<string, unknown>;
const num = (value: unknown): number => Number(value ?? 0);
const maybe = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export function fromCampaignRow(row: Row): CampaignRecord {
  return {
    id: String(row["id"]), name: String(row["name"]), subject: String(row["subject"]), preheader: String(row["preheader"] ?? ""),
    heading: String(row["heading"]), body: String(row["body"]),
    ctaLabel: (row["cta_label"] as string | null) ?? null, ctaUrl: (row["cta_url"] as string | null) ?? null,
    audience: row["audience"] as CampaignAudience, inactiveDays: maybe(row["inactive_days"]),
    totalLimit: num(row["total_limit"]), dailyLimit: num(row["daily_limit"]), status: row["status"] as CampaignStatus,
    createdBy: String(row["created_by"]), createdAt: num(row["created_at"]), updatedAt: num(row["updated_at"]),
    startedAt: maybe(row["started_at"]), finishedAt: maybe(row["finished_at"]), finishReason: (row["finish_reason"] as string | null) ?? null,
  };
}

function toCampaignRow(input: CampaignInput): Row {
  return {
    name: input.name, subject: input.subject, preheader: input.preheader, heading: input.heading, body: input.body,
    cta_label: input.ctaLabel, cta_url: input.ctaUrl, audience: input.audience, inactive_days: input.inactiveDays,
    total_limit: input.totalLimit, daily_limit: input.dailyLimit,
  };
}

export function createAdminConsoleStore(): AdminConsoleStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Admin console requires Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await (await db()).rpc(name, args);
    if (error) throw new Error("Admin console operation failed: " + name);
    return data as T;
  }

  return {
    async searchUsers(query, limit) {
      return (await rpc<unknown[] | null>("admin_user_search", { p_q: query, p_limit: limit })) ?? [];
    },
    async userProfile(uid, now) {
      return await rpc<Record<string, unknown> | null>("admin_user_profile", { p_uid: uid, p_now: now });
    },
    async setEmailBlocked(uid, blocked, now) {
      return await rpc("admin_set_email_blocked", { p_uid: uid, p_blocked: blocked, p_now: now });
    },
    async listCampaigns() {
      const { data, error } = await (await db()).from("email_campaigns").select(CAMPAIGN_COLS).order("created_at", { ascending: false }).limit(200);
      if (error) throw new Error("Campaigns unavailable");
      return (data as Row[]).map(fromCampaignRow);
    },
    async getCampaign(id) {
      const { data, error } = await (await db()).from("email_campaigns").select(CAMPAIGN_COLS).eq("id", id).maybeSingle();
      if (error) throw new Error("Campaign unavailable");
      return data === null ? null : fromCampaignRow(data as Row);
    },
    async createCampaign(input, by, now) {
      const { data, error } = await (await db()).from("email_campaigns")
        .insert({ ...toCampaignRow(input), status: "draft", created_by: by, created_at: now, updated_at: now })
        .select(CAMPAIGN_COLS).single();
      if (error) throw new Error("Campaign could not be saved");
      return fromCampaignRow(data as Row);
    },
    async updateCampaign(id, input, now) {
      const { data, error } = await (await db()).from("email_campaigns")
        .update({ ...toCampaignRow(input), updated_at: now }).eq("id", id).in("status", ["draft", "paused"])
        .select(CAMPAIGN_COLS).maybeSingle();
      if (error) throw new Error("Campaign could not be saved");
      return data === null ? null : fromCampaignRow(data as Row);
    },
    async setCampaignStatus(id, status, now) {
      return await rpc("email_campaign_set_status", { p_id: id, p_status: status, p_now: now });
    },
    async campaignStats(ids, now) {
      if (ids.length === 0) return {};
      const rows = (await rpc<Row[] | null>("email_campaign_stats", { p_ids: [...ids], p_now: now })) ?? [];
      const stats: Record<string, CampaignStats> = {};
      for (const row of rows) {
        stats[String(row["campaign_id"])] = {
          queued: num(row["queued"]), sent: num(row["sent"]), failed: num(row["failed"]), delivered: num(row["delivered"]),
          opened: num(row["opened"]), clicked: num(row["clicked"]), bounced: num(row["bounced"]), complained: num(row["complained"]),
          returned: num(row["returned"]), today: num(row["today"]), lastSentAt: maybe(row["last_sent_at"]),
        };
      }
      return stats;
    },
    async recentSends(id, limit) {
      const { data, error } = await (await db()).from("email_campaign_sends")
        .select("email,status,attempts,claimed_at,sent_at,delivered_at,opened_at,clicked_at,bounced_at,last_error")
        .eq("campaign_id", id).order("claimed_at", { ascending: false }).limit(limit);
      if (error) throw new Error("Campaign sends unavailable");
      return (data as Row[]).map((row): CampaignSendRow => ({
        email: String(row["email"]), status: String(row["status"]), attempts: num(row["attempts"]), claimedAt: num(row["claimed_at"]),
        sentAt: maybe(row["sent_at"]), deliveredAt: maybe(row["delivered_at"]), openedAt: maybe(row["opened_at"]),
        clickedAt: maybe(row["clicked_at"]), bouncedAt: maybe(row["bounced_at"]), lastError: (row["last_error"] as string | null) ?? null,
      }));
    },
    async audience(audience, inactiveDays, now) {
      return Number(await rpc("email_campaign_audience", { p_audience: audience, p_inactive_days: inactiveDays, p_now: now }));
    },
    async claimCampaignSends(now, limit) {
      const rows = (await rpc<Row[] | null>("email_campaign_claim", { p_now: now, p_limit: limit })) ?? [];
      return rows.map((row): CampaignJob => ({
        id: String(row["id"]), campaignId: String(row["campaign_id"]), uid: String(row["uid"]), email: String(row["email"]),
        attempts: num(row["attempts"]), unsubscribeToken: String(row["unsubscribe_token"]), displayName: (row["display_name"] as string | null) ?? null,
      }));
    },
    async finishCampaignSend(id, result, now) {
      await rpc("email_campaign_finish", "providerId" in result
        ? { p_id: id, p_provider_id: result.providerId, p_retry: false, p_code: null, p_now: now }
        : { p_id: id, p_provider_id: null, p_retry: result.retry, p_code: result.code, p_now: now });
    },
  };
}
