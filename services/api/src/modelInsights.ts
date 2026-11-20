/**
 * Per-model figures for the admin Models page and the AI section of Analytics.
 *
 * The database keeps one row per model per UTC day (migration 20261120180100_admin_model_insights);
 * this module turns those rows into what an administrator reads: rates, percentiles, a free /
 * included / paid label from the live catalogue, filters, sorting and CSV. Pure functions, so
 * the page, the export route and the tests all compute the same numbers.
 *
 * Definitions match the provider reports (tagflowReports.ts) where both show a figure:
 * error rate is provider errors / (successes + provider errors), and time to first token is
 * measured on successful responses only.
 */
import { modelProvider, providerConnections } from "./includedProviders.ts";
import { isFreeModel, isSponsoredTagflow } from "./paidTokens.ts";
import type { TagflowConfig, TagflowModel } from "./tagflowTypes.ts";
import { toCsv } from "./csv.ts";

/* ── Time to first token: the histogram ──────────────────────────────────────────────────── */

export const FIRST_TOKEN_BUCKETS = 64;
const BASE_MS = 50;
const RATIO = 1.2;

/** Same rule as `ai_first_token_bucket` in SQL: under 50 ms is bucket 0, then 20% wider each. */
export function firstTokenBucket(ms: number): number {
  if (ms < BASE_MS) return 0;
  return Math.min(FIRST_TOKEN_BUCKETS - 1, 1 + Math.floor(Math.log(ms / BASE_MS) / Math.log(RATIO)));
}

/** A bucket's range in milliseconds; the last one has no upper end. */
export function bucketBounds(index: number): [number, number] {
  if (index <= 0) return [0, BASE_MS];
  const low = BASE_MS * RATIO ** (index - 1);
  return [low, index >= FIRST_TOKEN_BUCKETS - 1 ? Number.POSITIVE_INFINITY : BASE_MS * RATIO ** index];
}

export function mergeHistograms(histograms: readonly (readonly number[])[]): number[] {
  const merged = new Array<number>(FIRST_TOKEN_BUCKETS).fill(0);
  for (const histogram of histograms) histogram.forEach((count, index) => { if (index < FIRST_TOKEN_BUCKETS) merged[index]! += Number(count) || 0; });
  return merged;
}

export const histogramSamples = (histogram: readonly number[]): number => histogram.reduce((total, count) => total + (Number(count) || 0), 0);

/**
 * The value at `fraction` (0.5 = median) of a histogram, interpolated inside its bucket. Exact
 * to within one bucket's width - 20% - and in practice much closer. Null with no samples.
 */
export function histogramPercentile(histogram: readonly number[], fraction: number): number | null {
  const total = histogramSamples(histogram);
  if (total === 0) return null;
  const rank = Math.min(total, Math.max(1, Math.ceil(fraction * total)));
  let before = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    const count = Number(histogram[index]) || 0;
    if (count > 0 && before + count >= rank) {
      const [low, high] = bucketBounds(index);
      if (!Number.isFinite(high)) return Math.round(low);
      return Math.round(low + (high - low) * ((rank - before - 0.5) / count));
    }
    before += count;
  }
  return null;
}

/* ── What the database sends ─────────────────────────────────────────────────────────────── */

export interface ModelIdentityKey { provider: string; modelId: string; upstreamModel: string }

export interface RawModelCurrent {
  requests: number; providerCalls: number; successes: number; providerErrors: number; relayErrors: number; rejected: number;
  cancelled: number; unfinished: number; users: number; inputTokens: number; outputTokens: number; cachedInputTokens: number;
  cacheMeasuredInputTokens: number; costMicros: number; estimatedRequests: number; revenueMicros: number; walletCharges: number;
  firstTokenHistogram: number[];
}
export interface RawModelPrevious {
  requests: number; successes: number; providerErrors: number; cancelled: number; users: number; inputTokens: number;
  outputTokens: number; costMicros: number; revenueMicros: number;
}
export interface RawModelInsight extends ModelIdentityKey {
  modelName: string; firstDay: string | null; lastDay: string | null; current: RawModelCurrent; previous: RawModelPrevious;
}
export interface RawInsightDay {
  day: string; requests: number; successes: number; providerErrors: number; relayErrors: number; rejected: number; cancelled: number;
  users: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheMeasuredInputTokens: number;
  costMicros: number; revenueMicros: number;
}
/** `read_ai_model_insights`. */
export interface RawModelInsights {
  refreshedAt: number | null; coverageFrom: string | null; users: number; previousUsers: number;
  models: RawModelInsight[]; daily: RawInsightDay[];
}
export interface RawModelDetailDay extends Omit<RawInsightDay, "users"> {
  providerCalls: number; unfinished: number; users: number; estimatedRequests: number; walletCharges: number; firstTokenHistogram: number[];
}
export interface RawModelError { outcome: string; code: string; upstreamStatus: number | null; requests: number; firstDay: string; lastDay: string }
/** `read_ai_model_insight`. */
export interface RawModelDetail {
  refreshedAt: number | null; coverageFrom: string | null; modelName: string | null; users: number; previousUsers: number;
  daily: RawModelDetailDay[];
  previousDaily: { day: string; requests: number; successes: number; providerErrors: number; cancelled: number; inputTokens: number; outputTokens: number; costMicros: number; firstTokenHistogram: number[] }[];
  previousRevenueMicros: number; errors: RawModelError[];
}

/* ── What the page shows ─────────────────────────────────────────────────────────────────── */

/** Free: costs the person nothing. Included: draws on the allowance or a plan. Paid: charged to the dollar wallet. */
export type ModelKind = "free" | "included" | "paid";
/** Retired: has history but is no longer in the catalogue (removed, or its provider model changed). */
export type ModelStatus = "offered" | "hidden" | "retired";

export interface ModelFigures {
  requests: number; users: number; successes: number; providerErrors: number; relayErrors: number; rejected: number;
  cancelled: number; unfinished: number; inputTokens: number; outputTokens: number; cachedInputTokens: number;
  /** Cached input / input, over requests whose cached count was recorded. Null before any was. */
  cachedShare: number | null;
  costMicros: number; revenueMicros: number; walletCharges: number;
  /** Provider errors / (successes + provider errors). Null without either. */
  errorRate: number | null;
  /** Cancelled / requests. */
  cancelRate: number | null;
  firstTokenP50: number | null; firstTokenP90: number | null; firstTokenSamples: number;
}

export interface ModelInsightRow extends ModelIdentityKey {
  key: string;
  name: string;
  providerName: string;
  kind: ModelKind | null;
  status: ModelStatus;
  /** USD per million tokens, from the catalogue; null for a retired model. */
  inputPrice: number | null;
  outputPrice: number | null;
  /** Position in the saved catalogue, for "Edit"; null for a retired model. */
  catalogueIndex: number | null;
  firstDay: string | null;
  lastDay: string | null;
  current: ModelFigures;
  previous: { requests: number; users: number; errorRate: number | null; costMicros: number; revenueMicros: number };
  /** This model's share of every request in the range, 0-1. */
  share: number;
}

export const modelInsightKey = (model: ModelIdentityKey): string => JSON.stringify([model.provider, model.modelId, model.upstreamModel]);

const rate = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);

export function modelKind(model: Pick<TagflowModel, "billing" | "provider" | "inputPrice" | "outputPrice" | "creditRate" | "id">): ModelKind {
  if (model.billing === "wallet") return "paid";
  if (isFreeModel(model) || isSponsoredTagflow(model)) return "free";
  return "included";
}

function figures(raw: RawModelCurrent): ModelFigures {
  const histogram = raw.firstTokenHistogram ?? [];
  return {
    requests: raw.requests, users: raw.users, successes: raw.successes, providerErrors: raw.providerErrors, relayErrors: raw.relayErrors,
    rejected: raw.rejected, cancelled: raw.cancelled, unfinished: raw.unfinished, inputTokens: raw.inputTokens, outputTokens: raw.outputTokens,
    cachedInputTokens: raw.cachedInputTokens, cachedShare: rate(raw.cachedInputTokens, raw.cacheMeasuredInputTokens),
    costMicros: raw.costMicros, revenueMicros: raw.revenueMicros, walletCharges: raw.walletCharges,
    errorRate: rate(raw.providerErrors, raw.successes + raw.providerErrors), cancelRate: rate(raw.cancelled, raw.requests),
    firstTokenP50: histogramPercentile(histogram, 0.5), firstTokenP90: histogramPercentile(histogram, 0.9), firstTokenSamples: histogramSamples(histogram),
  };
}

const EMPTY_CURRENT: RawModelCurrent = {
  requests: 0, providerCalls: 0, successes: 0, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, unfinished: 0, users: 0,
  inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 0, estimatedRequests: 0, revenueMicros: 0,
  walletCharges: 0, firstTokenHistogram: [],
};
const EMPTY_PREVIOUS: RawModelPrevious = { requests: 0, successes: 0, providerErrors: 0, cancelled: 0, users: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, revenueMicros: 0 };

/**
 * Every model the catalogue offers or hides, plus every model with history in the range, each
 * once. A catalogued model with no requests still gets a row (all zeros), so "is anybody using
 * this?" has an answer.
 */
export function buildModelRows(raw: Pick<RawModelInsights, "models">, config: TagflowConfig | null): ModelInsightRow[] {
  const providers = providerConnections(config?.providers);
  const providerName = (id: string): string => providers.find((provider) => provider.id === id)?.name || id;
  const byKey = new Map(raw.models.map((model) => [modelInsightKey(model), model]));
  const rows: ModelInsightRow[] = [];
  const seen = new Set<string>();
  const total = raw.models.reduce((sum, model) => sum + model.current.requests, 0);
  const row = (identity: ModelIdentityKey, data: RawModelInsight | undefined, extra: Pick<ModelInsightRow, "name" | "kind" | "status" | "inputPrice" | "outputPrice" | "catalogueIndex">): ModelInsightRow => {
    const current = data?.current ?? EMPTY_CURRENT, previous = data?.previous ?? EMPTY_PREVIOUS;
    return {
      ...identity, key: modelInsightKey(identity), providerName: providerName(identity.provider), ...extra,
      firstDay: data?.firstDay ?? null, lastDay: data?.lastDay ?? null, current: figures(current),
      previous: { requests: previous.requests, users: previous.users, errorRate: rate(previous.providerErrors, previous.successes + previous.providerErrors), costMicros: previous.costMicros, revenueMicros: previous.revenueMicros },
      share: total > 0 ? current.requests / total : 0,
    };
  };
  (config?.models ?? []).forEach((model, index) => {
    if (!model.id) return;
    const identity = { provider: modelProvider(model), modelId: model.id, upstreamModel: model.upstreamModel ?? model.id };
    const key = modelInsightKey(identity);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row(identity, byKey.get(key), {
      name: model.name || model.id, kind: modelKind(model), status: config?.enabled !== false && model.enabled !== false ? "offered" : "hidden",
      inputPrice: model.inputPrice, outputPrice: model.outputPrice, catalogueIndex: index,
    }));
  });
  for (const model of raw.models) {
    const key = modelInsightKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row(model, model, { name: model.modelName || model.modelId, kind: null, status: "retired", inputPrice: null, outputPrice: null, catalogueIndex: null }));
  }
  return rows;
}

/**
 * The catalogue being edited, with each model's figures from the server's rows. The editor's
 * draft decides the name, label and status (an unsaved "hide" shows at once); the figures stay
 * those of the saved identity. A model with no id yet gets a placeholder key. `retired` are the
 * models with history in the range that the draft no longer lists.
 */
export function rowsForCatalogue(insightRows: readonly ModelInsightRow[], config: TagflowConfig): { rows: ModelInsightRow[]; retired: ModelInsightRow[] } {
  const byKey = new Map(insightRows.map((row) => [row.key, row]));
  const providers = providerConnections(config.providers);
  const keys = new Set<string>();
  const rows = config.models.map((model, index): ModelInsightRow => {
    const identity = { provider: modelProvider(model), modelId: model.id, upstreamModel: model.upstreamModel ?? model.id };
    const key = model.id ? modelInsightKey(identity) : `new:${index}`;
    keys.add(key);
    const base = byKey.get(key);
    return {
      ...identity, key, providerName: providers.find((provider) => provider.id === identity.provider)?.name || identity.provider,
      name: model.name || model.id || "New model", kind: modelKind(model), status: config.enabled !== false && model.enabled !== false ? "offered" : "hidden",
      inputPrice: model.inputPrice, outputPrice: model.outputPrice, catalogueIndex: index,
      firstDay: base?.firstDay ?? null, lastDay: base?.lastDay ?? null, current: base?.current ?? figures(EMPTY_CURRENT),
      previous: base?.previous ?? { requests: 0, users: 0, errorRate: null, costMicros: 0, revenueMicros: 0 }, share: base?.share ?? 0,
    };
  });
  const retired = insightRows.filter((row) => !keys.has(row.key) && (row.current.requests > 0 || row.previous.requests > 0)).map((row) => ({ ...row, status: "retired" as const, catalogueIndex: null }));
  return { rows, retired };
}

/* ── Find, filter, sort ──────────────────────────────────────────────────────────────────── */

export interface ModelFilter { q: string; provider: string; kind: ModelKind | "all"; status: ModelStatus | "all" | "active" }
export const DEFAULT_MODEL_FILTER: ModelFilter = { q: "", provider: "all", kind: "all", status: "all" };

export const SORT_KEYS = ["requests", "users", "tokens", "cost", "revenue", "errorRate", "firstToken", "cancelled", "cachedShare", "change", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_LABELS: Record<SortKey, string> = {
  requests: "Requests", users: "Users", tokens: "Tokens", cost: "Provider cost", revenue: "Revenue", errorRate: "Error rate",
  firstToken: "Time to first token", cancelled: "Cancellations", cachedShare: "Cached share", change: "Change in requests", name: "Name",
};

export function filterModelRows(rows: readonly ModelInsightRow[], filter: ModelFilter): ModelInsightRow[] {
  const words = filter.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.provider !== "all" && row.provider !== filter.provider) return false;
    if (filter.kind !== "all" && row.kind !== filter.kind) return false;
    if (filter.status === "active" ? row.current.requests === 0 : filter.status !== "all" && row.status !== filter.status) return false;
    if (words.length === 0) return true;
    const haystack = `${row.name} ${row.modelId} ${row.upstreamModel} ${row.providerName} ${row.provider}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The change in requests against the previous window, -1..+inf; null when the previous window was empty. */
export const requestChange = (row: ModelInsightRow): number | null => (row.previous.requests > 0 ? row.current.requests / row.previous.requests - 1 : null);

function sortValue(row: ModelInsightRow, key: SortKey): number | string | null {
  const c = row.current;
  switch (key) {
    case "requests": return c.requests;
    case "users": return c.users;
    case "tokens": return c.inputTokens + c.outputTokens;
    case "cost": return c.costMicros;
    case "revenue": return c.revenueMicros;
    case "errorRate": return c.errorRate;
    case "firstToken": return c.firstTokenP50;
    case "cancelled": return c.cancelled;
    case "cachedShare": return c.cachedShare;
    case "change": return requestChange(row);
    case "name": return row.name.toLowerCase();
  }
}

/** Sorted copy. Rows without a value (no samples yet) go last whichever way the sort runs. */
export function sortModelRows(rows: readonly ModelInsightRow[], key: SortKey, direction: "asc" | "desc"): ModelInsightRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a, key), right = sortValue(b, key);
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "string" || typeof right === "string" ? String(left).localeCompare(String(right)) : left - right;
    return order === 0 ? a.name.localeCompare(b.name) : order * sign;
  });
}

/** Reads `q`, `provider`, `kind`, `status`, `sort` and `dir` from an export or page address. */
export function parseModelQuery(params: URLSearchParams): { filter: ModelFilter; sort: SortKey; direction: "asc" | "desc" } {
  const kind = params.get("kind"), status = params.get("status"), sort = params.get("sort");
  return {
    filter: {
      q: (params.get("q") ?? "").slice(0, 200),
      provider: (params.get("provider") ?? "all").slice(0, 80) || "all",
      kind: kind === "free" || kind === "included" || kind === "paid" ? kind : "all",
      status: status === "offered" || status === "hidden" || status === "retired" || status === "active" ? status : "all",
    },
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? sort as SortKey : "requests",
    direction: params.get("dir") === "asc" ? "asc" : "desc",
  };
}

/* ── One model ───────────────────────────────────────────────────────────────────────────── */

export interface ModelDetailDay {
  day: string; requests: number; users: number; successes: number; providerErrors: number; relayErrors: number; rejected: number;
  cancelled: number; unfinished: number; inputTokens: number; outputTokens: number; cachedInputTokens: number; cachedShare: number | null;
  costMicros: number; revenueMicros: number; errorRate: number | null; firstTokenP50: number | null; firstTokenP90: number | null;
}
export interface ModelDetail {
  refreshedAt: number | null;
  coverageFrom: string | null;
  totals: ModelFigures;
  previous: { requests: number; users: number; errorRate: number | null; costMicros: number; revenueMicros: number; firstTokenP50: number | null; cancelled: number; inputTokens: number; outputTokens: number };
  /** Every day of the range, oldest first; days without requests are zeros. */
  daily: ModelDetailDay[];
  errors: RawModelError[];
}

/** Every UTC day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); at <= end && days.length < 400; at += 86_400_000) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

export function buildModelDetail(raw: RawModelDetail, range: { from: string; to: string }): ModelDetail {
  const byDay = new Map(raw.daily.map((day) => [day.day, day]));
  const sum = <K extends keyof RawModelDetailDay>(key: K): number => raw.daily.reduce((total, day) => total + (Number(day[key]) || 0), 0);
  const histogram = mergeHistograms(raw.daily.map((day) => day.firstTokenHistogram ?? []));
  const totals = figures({
    requests: sum("requests"), providerCalls: sum("providerCalls"), successes: sum("successes"), providerErrors: sum("providerErrors"),
    relayErrors: sum("relayErrors"), rejected: sum("rejected"), cancelled: sum("cancelled"), unfinished: sum("unfinished"), users: raw.users,
    inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), cachedInputTokens: sum("cachedInputTokens"),
    cacheMeasuredInputTokens: sum("cacheMeasuredInputTokens"), costMicros: sum("costMicros"), estimatedRequests: sum("estimatedRequests"),
    revenueMicros: sum("revenueMicros"), walletCharges: sum("walletCharges"), firstTokenHistogram: histogram,
  });
  const before = raw.previousDaily;
  const previousSum = (key: "requests" | "successes" | "providerErrors" | "cancelled" | "costMicros" | "inputTokens" | "outputTokens"): number => before.reduce((total, day) => total + (Number(day[key]) || 0), 0);
  return {
    refreshedAt: raw.refreshedAt,
    coverageFrom: raw.coverageFrom,
    totals,
    previous: {
      requests: previousSum("requests"), users: raw.previousUsers, errorRate: rate(previousSum("providerErrors"), previousSum("successes") + previousSum("providerErrors")),
      costMicros: previousSum("costMicros"), revenueMicros: raw.previousRevenueMicros, cancelled: previousSum("cancelled"),
      inputTokens: previousSum("inputTokens"), outputTokens: previousSum("outputTokens"),
      firstTokenP50: histogramPercentile(mergeHistograms(before.map((day) => day.firstTokenHistogram ?? [])), 0.5),
    },
    daily: daysBetween(range.from, range.to).map((day): ModelDetailDay => {
      const found = byDay.get(day);
      const h = found?.firstTokenHistogram ?? [];
      return {
        day, requests: found?.requests ?? 0, users: found?.users ?? 0, successes: found?.successes ?? 0, providerErrors: found?.providerErrors ?? 0,
        relayErrors: found?.relayErrors ?? 0, rejected: found?.rejected ?? 0, cancelled: found?.cancelled ?? 0, unfinished: found?.unfinished ?? 0,
        inputTokens: found?.inputTokens ?? 0, outputTokens: found?.outputTokens ?? 0, cachedInputTokens: found?.cachedInputTokens ?? 0,
        cachedShare: found === undefined ? null : rate(found.cachedInputTokens, found.cacheMeasuredInputTokens),
        costMicros: found?.costMicros ?? 0, revenueMicros: found?.revenueMicros ?? 0,
        errorRate: found === undefined ? null : rate(found.providerErrors, found.successes + found.providerErrors),
        firstTokenP50: histogramPercentile(h, 0.5), firstTokenP90: histogramPercentile(h, 0.9),
      };
    }),
    errors: raw.errors,
  };
}

/** Every day of the range for the all-models chart, zeros where nothing ran. */
export function fillInsightDays(daily: readonly RawInsightDay[], range: { from: string; to: string }): RawInsightDay[] {
  const byDay = new Map(daily.map((day) => [day.day, day]));
  return daysBetween(range.from, range.to).map((day) => byDay.get(day) ?? {
    day, requests: 0, successes: 0, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, users: 0, inputTokens: 0,
    outputTokens: 0, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 0, revenueMicros: 0,
  });
}

/* ── Files ───────────────────────────────────────────────────────────────────────────────── */

const usd = (micros: number): number => Math.round(micros) / 1_000_000;
const ratio = (value: number | null): number | string => (value === null ? "" : Math.round(value * 10_000) / 10_000);
const KIND_WORDS: Record<ModelKind, string> = { free: "Free", included: "Included", paid: "Paid (wallet)" };

export function modelRowsCsv(rows: readonly ModelInsightRow[], range: { from: string; to: string }): string {
  return toCsv([
    ["from_utc", "to_utc", "provider", "model_id", "provider_model", "name", "kind", "status", "requests", "users", "successes", "provider_errors",
      "relay_errors", "rejected", "cancelled", "unfinished", "error_rate", "cancel_rate", "input_tokens", "output_tokens", "cached_input_tokens",
      "cached_share", "provider_cost_usd", "revenue_usd", "wallet_charges", "first_token_p50_ms", "first_token_p90_ms", "first_token_samples",
      "share_of_requests", "previous_requests", "previous_users", "previous_error_rate", "previous_cost_usd", "previous_revenue_usd",
      "input_price_per_1m", "output_price_per_1m"],
    ...rows.map((row) => {
      const c = row.current;
      return [range.from, range.to, row.provider, row.modelId, row.upstreamModel, row.name, row.kind === null ? "" : KIND_WORDS[row.kind], row.status,
        c.requests, c.users, c.successes, c.providerErrors, c.relayErrors, c.rejected, c.cancelled, c.unfinished, ratio(c.errorRate), ratio(c.cancelRate),
        c.inputTokens, c.outputTokens, c.cachedInputTokens, ratio(c.cachedShare), usd(c.costMicros), usd(c.revenueMicros), c.walletCharges,
        c.firstTokenP50 ?? "", c.firstTokenP90 ?? "", c.firstTokenSamples, ratio(row.share), row.previous.requests, row.previous.users,
        ratio(row.previous.errorRate), usd(row.previous.costMicros), usd(row.previous.revenueMicros), row.inputPrice ?? "", row.outputPrice ?? ""];
    }),
  ]);
}

/** One model's file: a section column so totals, days and errors share one rectangular sheet. */
export function modelDetailCsv(row: Pick<ModelInsightRow, "provider" | "modelId" | "upstreamModel" | "name">, detail: ModelDetail, range: { from: string; to: string }): string {
  const t = detail.totals;
  const head = ["section", "provider", "model_id", "provider_model", "date_utc", "requests", "users", "successes", "provider_errors", "relay_errors",
    "rejected", "cancelled", "error_rate", "input_tokens", "output_tokens", "cached_input_tokens", "cached_share", "provider_cost_usd", "revenue_usd",
    "first_token_p50_ms", "first_token_p90_ms", "error_outcome", "error_code", "upstream_status", "error_first_day", "error_last_day"];
  const id = [row.provider, row.modelId, row.upstreamModel];
  const blank = (n: number): string[] => new Array<string>(n).fill("");
  return toCsv([
    head,
    ["total", ...id, `${range.from} to ${range.to}`, t.requests, t.users, t.successes, t.providerErrors, t.relayErrors, t.rejected, t.cancelled,
      ratio(t.errorRate), t.inputTokens, t.outputTokens, t.cachedInputTokens, ratio(t.cachedShare), usd(t.costMicros), usd(t.revenueMicros),
      t.firstTokenP50 ?? "", t.firstTokenP90 ?? "", ...blank(5)],
    ...detail.daily.map((day) => ["daily", ...id, day.day, day.requests, day.users, day.successes, day.providerErrors, day.relayErrors, day.rejected,
      day.cancelled, ratio(day.errorRate), day.inputTokens, day.outputTokens, day.cachedInputTokens, ratio(day.cachedShare), usd(day.costMicros),
      usd(day.revenueMicros), day.firstTokenP50 ?? "", day.firstTokenP90 ?? "", ...blank(5)]),
    ...detail.errors.map((error) => ["error", ...id, "", error.requests, ...blank(15), error.outcome, error.code, error.upstreamStatus ?? "none", error.firstDay, error.lastDay]),
  ]);
}

export function insightDaysCsv(daily: readonly RawInsightDay[]): string {
  return toCsv([
    ["date_utc", "requests", "users", "successes", "provider_errors", "relay_errors", "rejected", "cancelled", "error_rate", "input_tokens",
      "output_tokens", "cached_input_tokens", "cached_share", "provider_cost_usd", "revenue_usd"],
    ...daily.map((day) => [day.day, day.requests, day.users, day.successes, day.providerErrors, day.relayErrors, day.rejected, day.cancelled,
      ratio(rate(day.providerErrors, day.successes + day.providerErrors)), day.inputTokens, day.outputTokens, day.cachedInputTokens,
      ratio(rate(day.cachedInputTokens, day.cacheMeasuredInputTokens)), usd(day.costMicros), usd(day.revenueMicros)]),
  ]);
}
