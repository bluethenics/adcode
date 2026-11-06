import type { SupabaseClient } from "@supabase/supabase-js";
import type { EncryptedAdNetworkKey } from "../src/adNetworkConfig.ts";
import type { ProviderModelStore, ProviderModelSubmission, SubmissionBilling, SubmissionStatus, SubmittedModel } from "../src/providerModels.ts";

type Row = {
  id: string; company: string; contact_name: string; email: string; website: string; api_base: string; authentication: "bearer" | "x-api-key";
  billing: SubmissionBilling; models: SubmittedModel[]; message: string; status: SubmissionStatus; note: string; key_hint: string;
  encrypted_key: EncryptedAdNetworkKey | null; received_at: number | string; decided_at: number | string | null; decided_by: string; provider_id: string;
};

const view = (row: Row): ProviderModelSubmission => ({
  id: row.id, company: row.company, contactName: row.contact_name, email: row.email, website: row.website, apiBase: row.api_base, authentication: row.authentication,
  billing: row.billing, models: row.models, message: row.message, status: row.status, note: row.note, keyHint: row.key_hint, hasKey: row.encrypted_key !== null,
  receivedAt: Number(row.received_at), decidedAt: row.decided_at === null ? null : Number(row.decided_at), decidedBy: row.decided_by, providerId: row.provider_id,
});

/** Provider model submissions in Supabase (migration 20261106122619_provider_model_submissions). */
export function createProviderModelStore(): ProviderModelStore {
  let client: SupabaseClient | undefined;
  async function db(): Promise<SupabaseClient> {
    if (client) return client;
    const url = process.env["SUPABASE_URL"], key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!url || !key) throw new Error("Provider model submissions require Supabase configuration");
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return client;
  }
  return {
    async add(submission, key) {
      const { error } = await (await db()).from("provider_model_submissions").insert({
        id: submission.id, company: submission.company, contact_name: submission.contactName, email: submission.email, website: submission.website,
        api_base: submission.apiBase, authentication: submission.authentication, billing: submission.billing, models: submission.models, message: submission.message,
        status: submission.status, note: submission.note, key_hint: submission.keyHint, encrypted_key: key, received_at: submission.receivedAt,
      });
      if (error) throw new Error("Provider model submission write failed");
    },
    async list(limit) {
      const { data, error } = await (await db()).from("provider_model_submissions").select("*").order("received_at", { ascending: false }).limit(Math.min(500, limit));
      if (error) throw new Error("Provider model submission read failed");
      // view() keeps only whether a key is held; the encrypted value never leaves this adapter in a listing.
      return ((data ?? []) as Row[]).map(view);
    },
    async get(id) {
      const { data, error } = await (await db()).from("provider_model_submissions").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error("Provider model submission read failed");
      if (data === null) return null;
      const row = data as Row;
      return { submission: view(row), key: row.encrypted_key };
    },
    async decide(id, decision) {
      const { data, error } = await (await db()).from("provider_model_submissions")
        .update({ status: decision.status, note: decision.note, decided_at: decision.decidedAt, decided_by: decision.decidedBy, provider_id: decision.providerId, encrypted_key: null })
        .eq("id", id).eq("status", "pending").select("id");
      if (error) throw new Error("Provider model submission update failed");
      return (data ?? []).length > 0;
    },
  };
}
