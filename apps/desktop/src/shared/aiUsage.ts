/**
 * What the AI has used: tokens and an estimated cost, per model, per day.
 *
 * People bring their own keys here, so "how much have I spent this week, and on which
 * model?" is a real question with real money behind it - and until now the only answer was
 * the provider's own billing page, a day late. Every request the built-in chat or an agent
 * makes adds its count to a row for that day, provider, model and source; the Usage page
 * sums the rows for the range you pick.
 *
 * Honest about what it does not know. A provider that reports no count is counted here from
 * the text sent and received, and the row says it was estimated. A model with no price in
 * the catalogue has no cost rather than a made-up one. Nothing here is a bill.
 *
 * Pure and dependency-free: the main process keeps the rows, the renderer draws the view,
 * and the tests exercise both through this file.
 */

import { shiftDay, usageActivity, type UsageActivityView } from "./usageActivity.ts";

export type UsageSource = "chat" | "agents";
export type UsageRange = "today" | "7d" | "30d" | "90d" | "all";

export const USAGE_RANGES: readonly { readonly value: UsageRange; readonly label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

/** One day's use of one model from one place. */
export interface UsageRow {
  /** Local calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly provider: string;
  readonly model: string;
  readonly source: UsageSource;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of `inputTokens`, how many the provider read from its prompt cache. Absent in older files. */
  readonly cachedTokens?: number;
  /** Requests whose count was estimated here rather than reported by the provider. */
  readonly estimatedRequests: number;
  /** Requests with a known price; their cost is in `costMicros`. */
  readonly pricedRequests: number;
  readonly costMicros: number;
  /**
   * Speed, kept from 2.6 on: how many of the day's requests were timed, their total time, the
   * total wait for a first response, and the output tokens those timed requests produced.
   * Absent in rows written before, which simply have no speed to show.
   */
  readonly timedRequests?: number;
  readonly durationMs?: number;
  readonly firstResponseMs?: number;
  readonly timedOutputTokens?: number;
  /**
   * Kept from 2.6.1 on, absent in older rows. `chat` is the conversation a chat request
   * belonged to and `project` the folder it ran in, so the page can count chats and filter by
   * project. `hours` counts the day's requests by local hour, 0-23, for the busiest-hours map.
   */
  readonly chat?: string;
  readonly project?: string;
  readonly hours?: readonly number[];
  /**
   * The cost split by what was paid for, in micro-dollars, for priced requests: fresh input,
   * input read from the cache, and output. Together they make `costMicros` (give or take
   * rounding) for the requests that had them; a row's older requests are left unsplit.
   */
  readonly inputCostMicros?: number;
  readonly cacheReadCostMicros?: number;
  readonly outputCostMicros?: number;
  /** What reading from the cache saved against the full input price, where the catalogue has a cache price. */
  readonly cacheSavedMicros?: number;
}

export interface UsagePrice {
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
  /** What cached input costs; absent when the catalogue does not say, and it is priced as input. */
  readonly cacheReadMicrosPerMillion?: number;
}

export interface UsageEntry {
  readonly provider: string;
  readonly model: string;
  readonly source: UsageSource;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of `inputTokens`, how many came from the provider's prompt cache, when it said. */
  readonly cachedTokens?: number;
  readonly estimated: boolean;
  readonly at: number;
  /** Start to end of the provider's stream, when the request was timed. */
  readonly durationMs?: number;
  readonly firstResponseMs?: number;
  /** Null when the catalogue has no price for this model. */
  readonly price: UsagePrice | null;
  /** The chat conversation this request was part of; absent for agents. */
  readonly chat?: string;
  /** The project folder it ran in; absent when no folder was open. */
  readonly project?: string;
}

export interface UsageModelView {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Of `inputTokens`, how many were read from the provider's prompt cache. */
  readonly cachedTokens: number;
  /** Null when no request to this model had a known price. */
  readonly costMicros: number | null;
  /** Some requests had no price, so the cost shown is less than the whole. */
  readonly costPartial: boolean;
  /** Some counts were estimated here. */
  readonly estimated: boolean;
  /** This model's share of all tokens in the range, 0 to 1. */
  readonly share: number;
  readonly chatRequests: number;
  readonly agentRequests: number;
}

export interface UsageDayView {
  readonly day: string;
  readonly tokens: number;
}

export interface AiUsageView {
  /** Local calendar activity for the past year, independent of the totals range. */
  readonly activity: UsageActivityView;
  readonly range: UsageRange;
  readonly totals: {
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedTokens: number;
    readonly costMicros: number | null;
    readonly costPartial: boolean;
    readonly estimated: boolean;
  };
  /** Most tokens first. */
  readonly models: readonly UsageModelView[];
  /** One entry per day in the range, oldest first - empty days included, so a chart has no gaps. */
  readonly days: readonly UsageDayView[];
  /** The first day anything was recorded, or null when nothing has been. */
  readonly since: string | null;
}

/** How long rows are kept. Long enough for "this year", short enough to stay a small file. */
export const KEEP_USAGE_DAYS = 400;
// Rows are per chat as well as per model from 2.6.1, so there are more of them.
const MAX_ROWS = 30_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The local calendar day of a moment. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * What one request cost at a price, in millionths of a dollar. `cachedTokens` are part of
 * `inputTokens`, charged at the cache-read price where the catalogue has one.
 */
export function costOf(price: UsagePrice, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const cached = Math.min(cachedTokens, inputTokens);
  const cachedRate = price.cacheReadMicrosPerMillion ?? price.inputMicrosPerMillion;
  return Math.round(((inputTokens - cached) * price.inputMicrosPerMillion + cached * cachedRate + outputTokens * price.outputMicrosPerMillion) / 1_000_000);
}

/** One request's cost split into fresh input, cached input and output, and what the cache saved. */
export function costSplit(price: UsagePrice, inputTokens: number, outputTokens: number, cachedTokens = 0): { readonly input: number; readonly cacheRead: number; readonly output: number; readonly saved: number | null } {
  const cached = Math.min(cachedTokens, inputTokens);
  const cachedRate = price.cacheReadMicrosPerMillion ?? price.inputMicrosPerMillion;
  return {
    input: Math.round(((inputTokens - cached) * price.inputMicrosPerMillion) / 1_000_000),
    cacheRead: Math.round((cached * cachedRate) / 1_000_000),
    output: Math.round((outputTokens * price.outputMicrosPerMillion) / 1_000_000),
    saved: price.cacheReadMicrosPerMillion === undefined ? null : Math.round((cached * Math.max(0, price.inputMicrosPerMillion - price.cacheReadMicrosPerMillion)) / 1_000_000),
  };
}

interface RowKey { readonly day: string; readonly provider: string; readonly model: string; readonly source: UsageSource; readonly chat?: string | undefined; readonly project?: string | undefined }

/** Two rows count into one when they share day, provider, model, source, chat and project. */
function sameRow(row: UsageRow, other: RowKey): boolean {
  return row.day === other.day && row.provider === other.provider && row.model === other.model && row.source === other.source && row.chat === other.chat && row.project === other.project;
}

type SummedField = "timedRequests" | "durationMs" | "firstResponseMs" | "timedOutputTokens" | "inputCostMicros" | "cacheReadCostMicros" | "outputCostMicros" | "cacheSavedMicros";
const SUMMED: readonly SummedField[] = ["timedRequests", "durationMs", "firstResponseMs", "timedOutputTokens", "inputCostMicros", "cacheReadCostMicros", "outputCostMicros", "cacheSavedMicros"];

/** Add one row's counts into the matching row, or append it: how counts recorded before the file was read join it. */
export function mergeUsageRow(into: readonly UsageRow[], row: UsageRow): UsageRow[] {
  const index = into.findIndex((other) => sameRow(other, row));
  if (index === -1) return [...into, row];
  const base = into[index]!;
  const extra: Partial<Record<SummedField, number>> = {};
  for (const key of SUMMED) {
    if (base[key] !== undefined || row[key] !== undefined) extra[key] = (base[key] ?? 0) + (row[key] ?? 0);
  }
  const hours = base.hours === undefined && row.hours === undefined ? undefined : Array.from({ length: 24 }, (_value, hour) => (base.hours?.[hour] ?? 0) + (row.hours?.[hour] ?? 0));
  const copy = [...into];
  copy[index] = {
    ...base,
    requests: base.requests + row.requests,
    inputTokens: base.inputTokens + row.inputTokens,
    outputTokens: base.outputTokens + row.outputTokens,
    cachedTokens: (base.cachedTokens ?? 0) + (row.cachedTokens ?? 0),
    estimatedRequests: base.estimatedRequests + row.estimatedRequests,
    pricedRequests: base.pricedRequests + row.pricedRequests,
    costMicros: base.costMicros + row.costMicros,
    ...extra,
    ...(hours === undefined ? {} : { hours }),
  };
  return copy;
}

/** The rows with one request added to its day's row. */
export function addUsage(rows: readonly UsageRow[], entry: UsageEntry): UsageRow[] {
  const day = dayKey(entry.at);
  const inputTokens = finite(entry.inputTokens);
  const outputTokens = finite(entry.outputTokens);
  const cachedTokens = Math.min(finite(entry.cachedTokens ?? 0), inputTokens);
  const priced = entry.price !== null;
  // A day-long or zero "duration" is a clock change or a bug, not a speed.
  const duration = finite(entry.durationMs ?? 0);
  const timed = duration > 0 && duration < 3_600_000;
  const cost = entry.price === null ? 0 : costOf(entry.price, inputTokens, outputTokens, cachedTokens);
  const split = entry.price === null ? null : costSplit(entry.price, inputTokens, outputTokens, cachedTokens);
  const chat = typeof entry.chat === "string" && entry.chat.length > 0 && entry.chat.length <= 128 ? entry.chat : undefined;
  const project = typeof entry.project === "string" && entry.project.length > 0 && entry.project.length <= 1024 ? entry.project : undefined;
  const index = rows.findIndex((row) => sameRow(row, { day, provider: entry.provider, model: entry.model, source: entry.source, chat, project }));
  const base: UsageRow = index === -1
    ? { day, provider: entry.provider, model: entry.model, source: entry.source, requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, estimatedRequests: 0, pricedRequests: 0, costMicros: 0, ...(chat === undefined ? {} : { chat }), ...(project === undefined ? {} : { project }) }
    : rows[index]!;
  const hours = Array.from({ length: 24 }, (_value, hour) => base.hours?.[hour] ?? 0);
  hours[new Date(entry.at).getHours()]! += 1;
  const next: UsageRow = {
    ...base,
    requests: base.requests + 1,
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
    cachedTokens: (base.cachedTokens ?? 0) + cachedTokens,
    estimatedRequests: base.estimatedRequests + (entry.estimated ? 1 : 0),
    pricedRequests: base.pricedRequests + (priced ? 1 : 0),
    costMicros: base.costMicros + cost,
    ...(timed ? {
      timedRequests: (base.timedRequests ?? 0) + 1,
      durationMs: (base.durationMs ?? 0) + duration,
      firstResponseMs: (base.firstResponseMs ?? 0) + Math.min(duration, finite(entry.firstResponseMs ?? 0)),
      timedOutputTokens: (base.timedOutputTokens ?? 0) + outputTokens,
    } : {}),
    hours,
    ...(split === null ? {} : {
      inputCostMicros: (base.inputCostMicros ?? 0) + split.input,
      cacheReadCostMicros: (base.cacheReadCostMicros ?? 0) + split.cacheRead,
      outputCostMicros: (base.outputCostMicros ?? 0) + split.output,
    }),
    ...(split === null || split.saved === null ? {} : { cacheSavedMicros: (base.cacheSavedMicros ?? 0) + split.saved }),
  };
  if (index === -1) return [...rows, next];
  const copy = [...rows];
  copy[index] = next;
  return copy;
}

/** Drop rows older than the keep window. */
export function pruneUsage(rows: readonly UsageRow[], now: number, keepDays = KEEP_USAGE_DAYS): UsageRow[] {
  const oldest = shiftDay(dayKey(now), -keepDays);
  return rows.filter((row) => row.day >= oldest).slice(-MAX_ROWS);
}

/** Rows read back off the disk; anything malformed is dropped rather than trusted. */
export function parseUsageRows(raw: unknown): UsageRow[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(list)) return [];
  const rows: UsageRow[] = [];
  const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null);
  for (const item of list.slice(-MAX_ROWS)) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const day = row["day"];
    const provider = row["provider"];
    const model = row["model"];
    const source = row["source"];
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (typeof provider !== "string" || provider.length === 0 || provider.length > 64) continue;
    if (typeof model !== "string" || model.length === 0 || model.length > 256) continue;
    if (source !== "chat" && source !== "agents") continue;
    const numbers = ["requests", "inputTokens", "outputTokens", "estimatedRequests", "pricedRequests", "costMicros"].map((key) => count(row[key]));
    if (numbers.some((value) => value === null)) continue;
    const [requests, inputTokens, outputTokens, estimatedRequests, pricedRequests, costMicros] = numbers as number[];
    // Files written before cached counts were kept have none; that reads as nothing cached.
    const cachedTokens = Math.min(count(row["cachedTokens"]) ?? 0, inputTokens!);
    const timedRequests = Math.min(count(row["timedRequests"]) ?? 0, requests!);
    const chat = row["chat"];
    const project = row["project"];
    const hours = row["hours"];
    const optional: Record<string, number> = {};
    for (const key of ["inputCostMicros", "cacheReadCostMicros", "outputCostMicros", "cacheSavedMicros"]) {
      const value = count(row[key]);
      if (value !== null) optional[key] = value;
    }
    rows.push({ day, provider, model, source, requests: requests!, inputTokens: inputTokens!, outputTokens: outputTokens!, cachedTokens, estimatedRequests: estimatedRequests!, pricedRequests: pricedRequests!, costMicros: costMicros!,
      ...(timedRequests > 0 ? { timedRequests, durationMs: count(row["durationMs"]) ?? 0, firstResponseMs: count(row["firstResponseMs"]) ?? 0, timedOutputTokens: Math.min(count(row["timedOutputTokens"]) ?? 0, outputTokens!) } : {}),
      ...(typeof chat === "string" && chat.length > 0 && chat.length <= 128 ? { chat } : {}),
      ...(typeof project === "string" && project.length > 0 && project.length <= 1024 ? { project } : {}),
      ...(Array.isArray(hours) && hours.length === 24 && hours.every((value) => count(value) !== null) ? { hours: hours.map((value) => count(value)!) } : {}),
      ...optional,
    });
  }
  return rows;
}

/** The first day a range covers, or null for all time. */
export function rangeStart(range: UsageRange, now: number): string | null {
  if (range === "all") return null;
  const days = range === "today" ? 0 : range === "7d" ? 6 : range === "30d" ? 29 : 89;
  return shiftDay(dayKey(now), -days);
}

function daysBetween(first: string, now: number): string[] {
  const out: string[] = [];
  const today = dayKey(now);
  // Walk back from today rather than forward from `first`, so a clock change mid-range
  // cannot skip or repeat a day.
  for (let back = 0; back < KEEP_USAGE_DAYS + 1; back += 1) {
    const day = shiftDay(today, -back);
    if (day < first) break;
    if (out[out.length - 1] !== day) out.push(day);
    if (day === first) break;
  }
  if (out.length === 0) out.push(today);
  return out.reverse();
}

/** Sum the rows for one range into what the Usage page shows. */
export function summarizeUsage(rows: readonly UsageRow[], range: UsageRange, now: number): AiUsageView {
  const start = rangeStart(range, now);
  const inRange = rows.filter((row) => start === null || row.day >= start);
  const since = rows.reduce<string | null>((first, row) => (first === null || row.day < first ? row.day : first), null);

  const byModel = new Map<string, { provider: string; model: string; requests: number; input: number; output: number; cached: number; cost: number; priced: number; estimated: number; chat: number; agents: number }>();
  for (const row of inRange) {
    const key = `${row.provider}\u0000${row.model}`;
    const entry = byModel.get(key) ?? { provider: row.provider, model: row.model, requests: 0, input: 0, output: 0, cached: 0, cost: 0, priced: 0, estimated: 0, chat: 0, agents: 0 };
    entry.requests += row.requests;
    entry.input += row.inputTokens;
    entry.output += row.outputTokens;
    entry.cached += row.cachedTokens ?? 0;
    entry.cost += row.costMicros;
    entry.priced += row.pricedRequests;
    entry.estimated += row.estimatedRequests;
    if (row.source === "chat") entry.chat += row.requests;
    else entry.agents += row.requests;
    byModel.set(key, entry);
  }

  const allTokens = [...byModel.values()].reduce((sum, entry) => sum + entry.input + entry.output, 0);
  const models: UsageModelView[] = [...byModel.values()]
    .map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      requests: entry.requests,
      inputTokens: entry.input,
      outputTokens: entry.output,
      cachedTokens: entry.cached,
      costMicros: entry.priced === 0 ? null : entry.cost,
      costPartial: entry.priced > 0 && entry.priced < entry.requests,
      estimated: entry.estimated > 0,
      share: allTokens === 0 ? 0 : (entry.input + entry.output) / allTokens,
      chatRequests: entry.chat,
      agentRequests: entry.agents,
    }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) || a.model.localeCompare(b.model));

  const priced = models.filter((model) => model.costMicros !== null);
  const requests = models.reduce((sum, model) => sum + model.requests, 0);
  const totals = {
    requests,
    inputTokens: models.reduce((sum, model) => sum + model.inputTokens, 0),
    outputTokens: models.reduce((sum, model) => sum + model.outputTokens, 0),
    cachedTokens: models.reduce((sum, model) => sum + model.cachedTokens, 0),
    costMicros: priced.length === 0 ? null : priced.reduce((sum, model) => sum + (model.costMicros ?? 0), 0),
    costPartial: models.some((model) => model.costPartial) || (priced.length > 0 && priced.length < models.length),
    estimated: models.some((model) => model.estimated),
  };

  const tokensByDay = new Map<string, number>();
  for (const row of inRange) tokensByDay.set(row.day, (tokensByDay.get(row.day) ?? 0) + row.inputTokens + row.outputTokens);
  const firstDay = start ?? since ?? dayKey(now);
  const days = daysBetween(firstDay, now).map((day) => ({ day, tokens: tokensByDay.get(day) ?? 0 }));

  const activity = usageActivity(rows.map((row) => ({ day: row.day, requests: row.requests, tokens: row.inputTokens + row.outputTokens })), dayKey(now));
  return { range, totals, models, days, since, activity };
}

/** 950, 12.4k, 3.1M - the way token counts are usually said. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return String(count);
}

/** Dollars, with sub-cent amounts said as such rather than rounded to nothing. */
export function formatUsageCost(micros: number | null): string {
  if (micros === null) return "No price";
  if (micros === 0) return "$0.00";
  if (micros < 10_000) return "< $0.01";
  return `$${(micros / 1_000_000).toFixed(micros < 100_000_000 ? 2 : 0)}`;
}
