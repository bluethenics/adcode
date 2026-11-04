import { modelProvider } from "./includedProviders.ts";
import { AUDIENCE_DIMENSIONS, type ModelAudienceProfile } from "./modelAudience.ts";
import type { TagflowConfig } from "./tagflowTypes.ts";
import type { ModelFeedbackRecord, ModelIdentity, ModelReport, ModelReportData, ModelReportMetrics, ModelReportRange, ModelReportResponse, ModelRequestRecord } from "./tagflowReportTypes.ts";

export const REPORT_DEFINITIONS: Record<string, string> = {
  demand: "Verified-account API attempts for known configured models with readable JSON, including retries and ADCode rejections. Attempts need not reach the provider and are not unique messages or tasks. Admin tests are excluded from all customer metrics.",
  users: "Distinct accounts that attempted this model. Repeat users made at least two attempts in the period. New/returning classification uses this model's first recorded attempt; no pre-collection history is inferred.",
  comparison: "The preceding window has the same elapsed duration. Today is partial. Comparisons are incomplete when either period predates telemetry collection.",
  reliability: "Provider error rate = provider errors / (successful responses + provider errors). ADCode rejections, relay errors, cancellations and unfinished telemetry are separate and excluded from that denominator. This is observed request reliability, not scheduled uptime.",
  tokens: "Input/output totals include billed estimates for interrupted or unreported responses; the estimated-request count identifies these. Costs use configured provider prices and are not an invoice. Token percentiles use successful responses only.",
  performance: "Latency and first-output percentiles use successful responses only. Measurements are observed at the ADCode relay, including network and relay bookkeeping. First output includes text or tool-call output from streaming responses, excluding role-only frames. Observed output tokens/second uses reported tokens divided by time after first output; it is not a GPU benchmark. Sample counts accompany these metrics.",
  capacity: "Peak RPM/TPM use fixed UTC minute buckets of provider-call start times. TPM attributes each call's total tokens to its start minute, not provider billing windows. Peak concurrency uses recorded provider-call intervals; unfinished calls are capped at three minutes.",
  capabilities: "Tool requests offered tools; tool calls count generated calls, not successful tool execution. Output-limit stops and refusals are provider finish reasons. Operational success does not establish correctness or task completion.",
  feedback: "One voluntary rating per owned request, editable or removable. Satisfaction = helpful / all ratings; it is a self-selected sample, not all users. Feedback dates refer to submission time and are attributed to the request's original provider/model revision. Only comments explicitly approved for provider sharing are included, with at most 50 excerpts per model.",
  privacy: "Exports contain aggregates, model identifiers and voluntarily shared comments. Account IDs, emails, prompts, responses, code, tool arguments and raw upstream errors are excluded.",
  coverage: "Collection begins with this feature. Legacy account totals cannot be assigned to individual models. Telemetry is best effort and unrecorded gaps cannot be reconstructed. Removed models and changed upstream revisions retain separate report entries.",
  audience: "Country is the approximate network country observed by Cloudflare, not verified residence; VPNs and proxies can change it. No IP address or precise location is stored for this report. Roles, experience and primary purpose are optional, consented self-reports from the account's current profile. Updating or removing that profile updates reports, including historical periods. Unknown entries are shown explicitly. Distinct accounts can appear in multiple country, persona or workflow groups, so group user counts must not be summed.",
  purpose: "Assistant personas and workflows are fixed categories reported by the desktop, not semantic analysis of conversations. Custom agent names and instructions are never included. Workflow counts describe features used, not verified user intent or task completion. Declared primary purpose comes from the optional survey. Older clients and pre-feature requests have unknown audience metadata.",
  configuration: "Capacity shown is the current ADCode model configuration. Context includes input plus reserved output; input allowance and output caps may be lower. Historical requests used the settings at their request time. The configured context is not a new independent provider-capacity benchmark.",
};

const countKeys = ["attempts", "providerCalls", "successes", "providerErrors", "relayErrors", "rejected", "cancelled", "unfinished", "activeUsers", "repeatUsers", "newUsers", "returningUsers", "inputTokens", "outputTokens", "costMicros", "estimatedRequests", "toolRequests", "toolCalls", "streamedRequests", "outputLimitStops", "refusals", "peakRpm", "peakTpm", "peakConcurrency", "latencySamples", "firstTokenSamples", "throughputSamples", "helpful", "notHelpful", "feedbackUsers"] as const;
const percentileKeys = ["durationP50", "durationP95", "firstTokenP50", "firstTokenP95", "inputP50", "inputP95", "outputP50", "outputP95", "outputTpsP50", "outputTpsP95"] as const;
export function emptyModelMetrics(): ModelReportMetrics {
  return Object.fromEntries([...countKeys.map(key => [key, 0]), ...percentileKeys.map(key => [key, null])]) as unknown as ModelReportMetrics;
}
export const reportModelKey = (model: ModelIdentity): string => JSON.stringify([model.provider, model.modelId, model.upstreamModel]);
export const reportRate = (numerator: number, denominator: number): number | null => denominator > 0 ? numerator / denominator * 100 : null;

export function parseReportRange(from: string | null, to: string | null, now: number): ModelReportRange | null {
  const today = new Date(now).toISOString().slice(0, 10);
  const last = to ?? today;
  const valid = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
  if (!valid(last)) return null;
  const first = from ?? new Date(Date.parse(last) - 29 * 86_400_000).toISOString().slice(0, 10);
  if (!valid(first) || !valid(last) || first > last || last > today || Date.parse(last) - Date.parse(first) > 92 * 86_400_000) return null;
  const fromAt = Date.parse(first);
  const toAt = Math.min(Date.parse(last) + 86_400_000, now);
  return { from: first, to: last, fromAt, toAt, previousFromAt: fromAt - (toAt - fromAt), previousToAt: fromAt };
}

export function completeModelReport(data: ModelReportData, config: TagflowConfig, range: ModelReportRange, now: number, only?: Pick<ModelIdentity, "provider" | "modelId" | "upstreamModel">): ModelReportResponse {
  const models = [...data.models];
  for (const model of config.models) {
    const identity = { modelId: model.id, modelName: model.name, provider: modelProvider(model), upstreamModel: model.upstreamModel ?? model.id };
    if (only !== undefined && reportModelKey({ ...identity, modelName: "" }) !== reportModelKey({ ...only, modelName: "" })) continue;
    const existing = models.find(one => reportModelKey(one) === reportModelKey(identity));
    const configuration = { contextWindow: model.contextWindow, inputLimit: Math.min(model.contextWindow,config.maxInputTokens), outputLimit: Math.min(model.maxOutput,config.maxOutputTokens), enabled: config.enabled && model.enabled !== false };
    if (existing) { existing.modelName = model.name; existing.configuration = configuration; }
    else models.push({ ...identity, configuration, audience: { countries:[], userRoles:[], experienceLevels:[], aiPersonas:[], useCases:[], declaredUses:[], platforms:[] }, current: emptyModelMetrics(), previous: emptyModelMetrics(), daily: [], errors: [], sources: [], hourly: [], inputBands: [], feedbackCategories: [], sharedComments: [], sharedCommentCount: 0 });
  }
  models.sort((a,b) => b.current.attempts - a.current.attempts || a.modelName.localeCompare(b.modelName));
  return { ...data, models, range, generatedAt: now, definitions: REPORT_DEFINITIONS };
}

const sum = (rows: ModelRequestRecord[], key: "inputTokens" | "outputTokens" | "costMicros" | "toolCalls"): number => rows.reduce((total,row) => total + row[key], 0);
const percentile = (values: number[], fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a,b) => a-b), at = (sorted.length-1)*fraction, lower = Math.floor(at);
  return sorted[lower]! + (sorted[Math.ceil(at)]! - sorted[lower]!) * (at-lower);
};
const isCustomer = (row: ModelRequestRecord): boolean => row.source !== "admin-test";
const group = <T>(rows: T[], key: (row: T) => string): Map<string,T[]> => {
  const result = new Map<string,T[]>();
  for (const row of rows) { const value = key(row); const items = result.get(value) ?? []; items.push(row); result.set(value,items); }
  return result;
};

function metrics(rows: ModelRequestRecord[], all: ModelRequestRecord[], feedback: ModelFeedbackRecord[], from: number, to: number): ModelReportMetrics {
  const result = emptyModelMetrics();
  const successful = rows.filter(row => row.outcome === "success");
  const called = rows.filter(row => row.providerStartedAt !== null);
  const rated = feedback.filter(row => row.createdAt >= from && row.createdAt < to);
  const users = group(rows,row => row.uid);
  result.attempts = rows.length; result.providerCalls = called.length;
  for (const [field,outcome] of [["successes","success"],["providerErrors","provider_error"],["relayErrors","relay_error"],["rejected","rejected"],["cancelled","cancelled"],["unfinished","pending"]] as const) result[field] = rows.filter(row => row.outcome === outcome).length;
  result.activeUsers = users.size; result.repeatUsers = [...users.values()].filter(items => items.length >= 2).length;
  const firstSeen = group(all,row => row.uid);
  result.newUsers = [...users.keys()].filter(uid => Math.min(...firstSeen.get(uid)!.map(row => row.startedAt)) >= from).length;
  result.returningUsers = result.activeUsers - result.newUsers;
  result.inputTokens = sum(rows,"inputTokens"); result.outputTokens = sum(rows,"outputTokens"); result.costMicros = sum(rows,"costMicros"); result.toolCalls = sum(rows,"toolCalls");
  result.estimatedRequests = called.filter(row => row.estimated && row.outcome !== "pending").length;
  result.toolRequests = called.filter(row => row.toolsOffered).length; result.streamedRequests = called.filter(row => row.streamed).length;
  result.outputLimitStops = successful.filter(row => row.finishReason === "length").length; result.refusals = successful.filter(row => row.finishReason === "refusal").length;
  const minutes = group(called,row => String(Math.floor(row.providerStartedAt! / 60_000)));
  result.peakRpm = Math.max(0,...[...minutes.values()].map(items => items.length));
  result.peakTpm = Math.max(0,...[...minutes.values()].map(items => sum(items,"inputTokens")+sum(items,"outputTokens")));
  const deltas = new Map<number,number>();
  for (const row of called) {
    const start = row.providerStartedAt!;
    const end = row.finishedAt ?? Math.min(to,start+180_000);
    if (end <= start) continue;
    deltas.set(start,(deltas.get(start) ?? 0)+1); deltas.set(end,(deltas.get(end) ?? 0)-1);
  }
  let concurrency = 0;
  for (const [,delta] of [...deltas.entries()].sort((a,b) => a[0]-b[0])) { concurrency += delta; result.peakConcurrency = Math.max(result.peakConcurrency,concurrency); }
  const durations = successful.flatMap(row => row.durationMs === null ? [] : [row.durationMs]);
  const firstTokens = successful.flatMap(row => row.firstTokenMs === null ? [] : [row.firstTokenMs]);
  const throughputs = successful.flatMap(row => !row.estimated && row.outputTokens > 0 && row.durationMs !== null && row.firstTokenMs !== null && row.durationMs > row.firstTokenMs ? [row.outputTokens * 1000 / (row.durationMs-row.firstTokenMs)] : []);
  result.latencySamples = durations.length; result.firstTokenSamples = firstTokens.length; result.throughputSamples = throughputs.length;
  for (const [name,values] of [["duration",durations],["firstToken",firstTokens],["input",successful.map(row => row.inputTokens)],["output",successful.map(row => row.outputTokens)],["outputTps",throughputs]] as const) {
    result[`${name}P50`] = percentile([...values],0.5); result[`${name}P95`] = percentile([...values],0.95);
  }
  result.helpful = rated.filter(row => row.rating === "helpful").length; result.notHelpful = rated.length-result.helpful; result.feedbackUsers = new Set(rated.map(row => row.uid)).size;
  return result;
}

/** Memory adapter's report implementation. Production aggregates in Postgres, without row caps. */
export function summarizeModelReports(requests: ModelRequestRecord[], feedback: ModelFeedbackRecord[], range: ModelReportRange, collectionStartedAt: number | null, profiles: ReadonlyMap<string,ModelAudienceProfile> = new Map()): ModelReportData {
  const customers = requests.filter(isCustomer);
  const requestById = new Map(customers.map(row => [row.id,row]));
  const identities = new Map([...customers].sort((a,b) => a.startedAt-b.startedAt).map(row => [reportModelKey(row),row]));
  const models: ModelReport[] = [];
  for (const [key,identity] of identities) {
    const all = customers.filter(row => reportModelKey(row) === key);
    const current = all.filter(row => row.startedAt >= range.fromAt && row.startedAt < range.toAt);
    const previous = all.filter(row => row.startedAt >= range.previousFromAt && row.startedAt < range.previousToAt);
    const ratings = feedback.filter(row => { const request = requestById.get(row.requestId); return request !== undefined && reportModelKey(request) === key; });
    const currentRatings = ratings.filter(row => row.createdAt >= range.fromAt && row.createdAt < range.toAt);
    const previousRatings = ratings.filter(row => row.createdAt >= range.previousFromAt && row.createdAt < range.previousToAt);
    if (current.length === 0 && previous.length === 0 && currentRatings.length === 0 && previousRatings.length === 0) continue;
    const errors = [...group(current.filter(row => row.errorCode !== null),row => JSON.stringify([row.outcome,row.errorCode,row.upstreamStatus])).values()].map(rows => ({ outcome: rows[0]!.outcome, code: rows[0]!.errorCode!, upstreamStatus: rows[0]!.upstreamStatus, count: rows.length, firstAt: Math.min(...rows.map(row => row.startedAt)), lastAt: Math.max(...rows.map(row => row.startedAt)) })).sort((a,b) => b.count-a.count);
    const days = new Set([...current.map(row => new Date(row.startedAt).toISOString().slice(0,10)),...currentRatings.map(row => new Date(row.createdAt).toISOString().slice(0,10))]);
    const daily = [...days].sort().map(day => {
      const start = Date.parse(day), dayRows = current.filter(row => row.startedAt >= start && row.startedAt < start+86_400_000);
      const value = metrics(dayRows,all,ratings,start,start+86_400_000);
      return { day, attempts: value.attempts, successes: value.successes, providerErrors: value.providerErrors, rejected: value.rejected, activeUsers: value.activeUsers, inputTokens: value.inputTokens, outputTokens: value.outputTokens, helpful: value.helpful, notHelpful: value.notHelpful };
    });
    const shared = currentRatings.filter(row => row.shareWithProvider && row.comment.trim()).sort((a,b) => b.createdAt-a.createdAt);
    const dimensionValue = (row: ModelRequestRecord, dimension: typeof AUDIENCE_DIMENSIONS[number]): string => ({ countries: row.country, userRoles: profiles.get(row.uid)?.role, experienceLevels: profiles.get(row.uid)?.experience, aiPersonas: row.aiPersona, useCases: row.useCase, declaredUses: profiles.get(row.uid)?.primaryUse, platforms: row.platform })[dimension] ?? "unknown";
    const audience = Object.fromEntries(AUDIENCE_DIMENSIONS.map(dimension => [dimension,[...group([...current,...previous],row => dimensionValue(row,dimension))].map(([value,rows]) => {
      const selected = rows.filter(row => row.startedAt >= range.fromAt), before = rows.filter(row => row.startedAt < range.fromAt);
      return { value, requests: selected.length, activeUsers: new Set(selected.map(row => row.uid)).size, successes: selected.filter(row => row.outcome === "success").length, providerErrors: selected.filter(row => row.outcome === "provider_error").length, inputTokens: sum(selected,"inputTokens"), outputTokens: sum(selected,"outputTokens"), previousRequests: before.length, previousActiveUsers: new Set(before.map(row => row.uid)).size };
    }).sort((a,b) => b.requests-a.requests || a.value.localeCompare(b.value))])) as NonNullable<ModelReport["audience"]>;
    models.push({ modelId: identity.modelId, modelName: identity.modelName, provider: identity.provider, upstreamModel: identity.upstreamModel, audience,
      current: metrics(current,all,ratings,range.fromAt,range.toAt), previous: metrics(previous,all,ratings,range.previousFromAt,range.previousToAt), daily, errors,
      sources: [...group(current,row => row.source)].map(([source,rows]) => ({ source: source as ModelRequestRecord["source"], requests: rows.length })),
      hourly: [...group(current.filter(row => row.providerStartedAt !== null),row => String(new Date(row.providerStartedAt!).getUTCHours()))].map(([hour,rows]) => ({ hour: Number(hour), requests: rows.length })).sort((a,b) => a.hour-b.hour),
      inputBands: [...group(current.filter(row => row.outcome === "success"),row => row.inputTokens < 8192 ? "<8k" : row.inputTokens < 32768 ? "8k–32k" : row.inputTokens < 65536 ? "32k–64k" : row.inputTokens < 131072 ? "64k–128k" : row.inputTokens < 262144 ? "128k–256k" : "256k+")].map(([band,rows]) => ({ band, requests: rows.length })),
      feedbackCategories: [...group(currentRatings,row => row.category)].map(([category,rows]) => ({ category: category as ModelFeedbackRecord["category"], helpful: rows.filter(row => row.rating === "helpful").length, notHelpful: rows.filter(row => row.rating === "not-helpful").length })),
      sharedComments: shared.slice(0,50).map(row => ({ at: row.createdAt, rating: row.rating, category: row.category, comment: row.comment })), sharedCommentCount: shared.length,
    });
  }
  return { collectionStartedAt, models };
}
