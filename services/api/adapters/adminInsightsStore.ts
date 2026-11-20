import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminInsightsStore } from "../src/adminInsights.ts";
import type { RawModelDetail, RawModelInsights } from "../src/modelInsights.ts";
import type { RawWebsiteSummary } from "../src/websiteInsights.ts";

/**
 * The admin insights reads, in Supabase (migration 20261120180100_admin_model_insights).
 *
 * A function that does not exist yet answers null - "apply the migration" - rather than an
 * error, so a website deployed before the migration says what is missing instead of failing.
 */
const missingFunction = (error: { code?: string; message?: string } | null): boolean =>
  error !== null && (error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? ""));

export function createAdminInsightsStore(): AdminInsightsStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Admin insights require Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  async function call<T>(name: string, args: Record<string, unknown>): Promise<T | null> {
    const { data, error } = await (await db()).rpc(name, args);
    if (missingFunction(error)) return null;
    if (error) throw new Error("Admin insights read failed");
    return data as T;
  }
  return {
    models: (from, to) => call<RawModelInsights>("read_ai_model_insights", { p_from: from, p_to: to }),
    model: (from, to, model) => call<RawModelDetail>("read_ai_model_insight", { p_from: from, p_to: to, p_provider: model.provider, p_model: model.modelId, p_upstream: model.upstreamModel }),
    website: (start, end) => call<RawWebsiteSummary>("read_website_analytics_summary", { p_start: start, p_end: end }),
    async rebuild() {
      const { error } = await (await db()).rpc("refresh_ai_model_daily_recent");
      if (missingFunction(error)) return false;
      if (error) throw new Error("Admin insights rebuild failed");
      return true;
    },
  };
}
