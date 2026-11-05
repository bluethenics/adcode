import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApplicationStatus, ProviderApplicationStore, ProviderOffer } from "../src/providerApplications.ts";

type Row = { id: string; company: string; contact_name: string; email: string; website: string; models: string[]; api_base: string; offers: ProviderOffer[]; pricing: string; message: string; status: ApplicationStatus; note: string; received_at: number | string };

/** Provider applications in Supabase (migration 20261105130000_provider_applications). */
export function createProviderApplicationStore(): ProviderApplicationStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Provider applications require Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  return {
    async add(application) {
      const { error } = await (await db()).from("provider_applications").insert({
        id: application.id, company: application.company, contact_name: application.contactName, email: application.email, website: application.website,
        models: application.models, api_base: application.apiBase, offers: application.offers, pricing: application.pricing, message: application.message,
        status: application.status, note: application.note, received_at: application.receivedAt,
      });
      if (error) throw new Error("Provider application write failed");
    },
    async list(limit) {
      const { data, error } = await (await db()).from("provider_applications").select("*").order("received_at", { ascending: false }).limit(Math.min(500, limit));
      if (error) throw new Error("Provider application read failed");
      return ((data ?? []) as Row[]).map((row) => ({
        id: row.id, company: row.company, contactName: row.contact_name, email: row.email, website: row.website, models: row.models, apiBase: row.api_base,
        offers: row.offers, pricing: row.pricing, message: row.message, status: row.status, note: row.note, receivedAt: Number(row.received_at),
      }));
    },
    async setStatus(id, status, note) {
      const { data, error } = await (await db()).from("provider_applications").update({ status, note }).eq("id", id).select("id");
      if (error) throw new Error("Provider application update failed");
      return (data ?? []).length > 0;
    },
  };
}
