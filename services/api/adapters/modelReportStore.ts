import type { ModelFeedbackRecord, ModelReport, ModelReportData, ModelRequestRecord } from "../src/tagflowReportTypes.ts";
import { emptyModelMetrics } from "../src/tagflowReports.ts";
import type { TagflowStore } from "../src/tagflowTypes.ts";
type SupabaseClient = import("@supabase/supabase-js").SupabaseClient;
type ReportStore = Pick<TagflowStore, "putModelRequest" | "getModelRequest" | "putModelFeedback" | "getModelFeedback" | "deleteModelFeedback" | "readModelReports" | "readModelReport" | "getModelAudienceProfile" | "putModelAudienceProfile" | "deleteModelAudienceProfile">;
const fields = ["id", "uid", "modelId", "modelName", "provider", "upstreamModel", "startedAt", "finishedAt", "providerStartedAt", "outcome", "errorCode", "upstreamStatus", "source", "streamed", "toolsOffered", "toolCalls", "finishReason", "contextWindow", "requestedOutput", "estimatedInput", "inputTokens", "outputTokens", "costMicros", "estimated", "durationMs", "firstTokenMs"] as const;
const feedbackFields = ["requestId", "uid", "rating", "category", "comment", "shareWithProvider", "createdAt", "updatedAt"] as const;
const audienceFields = ["uid","role","experience","primaryUse","updatedAt"] as const;
const requestFields = [...fields,"country","aiPersona","useCase","platform"];
const sqlName = (key: string): string => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
const encode = (value: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map(key => [sqlName(key), (value as Record<string,unknown>)[key]]));
const decode = (value: Record<string,unknown>, keys: readonly string[]): Record<string,unknown> => Object.fromEntries(keys.map(key => [key,value[sqlName(key)]]));
const check = (error: { message: string } | null): void => { if (error) throw new Error("Model reporting storage unavailable"); };
/** Cached reports are three hours old at most; `fresh` asks for a rebuild. */
const CACHE_MS = 3 * 3_600_000;
/**
 * A summary row carries headline figures only. Filled out to the full shape, so the page and the
 * downloads never meet a missing field.
 */
function complete(raw: unknown): ModelReportData {
  const data = raw as ModelReportData & { builtAt?: number };
  if (!data || !Array.isArray(data.models)) throw new Error("Invalid model report");
  const rows = data.models as Array<Partial<ModelReport> & Pick<ModelReport, "modelId" | "modelName" | "provider" | "upstreamModel">>;
  const models = rows.map((model): ModelReport => ({
    daily: [], errors: [], sources: [], hourly: [], inputBands: [], feedbackCategories: [], sharedComments: [], sharedCommentCount: 0,
    ...model,
    current: { ...emptyModelMetrics(), ...model.current },
    previous: { ...emptyModelMetrics(), ...model.previous },
  }));
  return { ...data, models };
}

export function createModelReportStore(lazy: () => Promise<SupabaseClient>): ReportStore {
  return {
    async getModelAudienceProfile(uid) { const { data,error } = await (await lazy()).from("ai_model_audience_profiles").select("*").eq("uid",uid).maybeSingle(); check(error); return data === null ? null : decode(data,audienceFields) as unknown as import("../src/modelAudience.ts").ModelAudienceProfile; },
    async putModelAudienceProfile(profile) { const { error } = await (await lazy()).from("ai_model_audience_profiles").upsert(encode(profile,audienceFields)); check(error); },
    async deleteModelAudienceProfile(uid) { const { error } = await (await lazy()).from("ai_model_audience_profiles").delete().eq("uid",uid); check(error); },
    async putModelRequest(record) { const { error } = await (await lazy()).from("ai_model_requests").upsert(encode({ country:"unknown", aiPersona:"unknown", useCase:"unknown", platform:"unknown", ...record }, requestFields)); check(error); },
    async getModelRequest(id) { const { data,error } = await (await lazy()).from("ai_model_requests").select("*").eq("id",id).maybeSingle(); check(error); return data === null ? null : decode(data,requestFields) as unknown as ModelRequestRecord; },
    async putModelFeedback(record) { const { error } = await (await lazy()).from("ai_model_feedback").upsert(encode(record,feedbackFields)); check(error); },
    async getModelFeedback(requestId,uid) { const { data,error } = await (await lazy()).from("ai_model_feedback").select("*").eq("request_id",requestId).eq("uid",uid).maybeSingle(); check(error); return data === null ? null : decode(data,feedbackFields) as unknown as ModelFeedbackRecord; },
    async deleteModelFeedback(requestId,uid) { const { error } = await (await lazy()).from("ai_model_feedback").delete().eq("request_id",requestId).eq("uid",uid); check(error); },
    /*
     * Built ahead and cached where the database has the cache (read_ai_model_report_cached), and
     * straight from the one-pass functions where it does not yet. The old all-models report timed
     * out at 825,000 requests, so it is no longer called.
     */
    async readModelReports(range, fresh = false) {
      const client = await lazy();
      const cached = await client.rpc("read_ai_model_report_cached", { p_from: range.from, p_to: range.to, p_from_at: range.fromAt, p_to_at: range.toAt, p_previous_from: range.previousFromAt, p_max_age_ms: fresh ? 0 : CACHE_MS });
      if (!cached.error) return complete(cached.data);
      const { data,error } = await client.rpc("read_ai_model_report_summary", { p_from: range.fromAt, p_to: range.toAt });
      check(error); return complete(data);
    },
    async readModelReport(range, model, fresh = false) {
      const client = await lazy();
      const one = { p_provider: model.provider, p_model: model.modelId, p_upstream: model.upstreamModel };
      const cached = await client.rpc("read_ai_model_report_cached", { p_from: range.from, p_to: range.to, p_from_at: range.fromAt, p_to_at: range.toAt, p_previous_from: range.previousFromAt, ...one, p_max_age_ms: fresh ? 0 : CACHE_MS });
      if (!cached.error) return complete(cached.data);
      const { data,error } = await client.rpc("read_ai_model_report_one", { p_from: range.fromAt, p_to: range.toAt, p_previous_from: range.previousFromAt, ...one });
      check(error); return complete(data);
    },
  };
}
