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

export type UsageSource = "chat" | "agents";
export type UsageRange = "today" | "7d" | "30d" | "all";

export const USAGE_RANGES: readonly { readonly value: UsageRange; readonly label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
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
  /** Requests whose count was estimated here rather than reported by the provider. */
  readonly estimatedRequests: number;
  /** Requests with a known price; their cost is in `costMicros`. */
  readonly pricedRequests: number;
  readonly costMicros: number;
}

export interface UsagePrice {
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
}

export interface UsageEntry {
  readonly provider: string;
  readonly model: string;
  readonly source: UsageSource;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
  readonly at: number;
  /** Null when the catalogue has no price for this model. */
  readonly price: UsagePrice | null;
}

export interface UsageModelView {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
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
  readonly range: UsageRange;
  readonly totals: {
    readonly requests: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
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
const MAX_ROWS = 20_000;
const DAY_MS = 86_400_000;

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

/** What one request cost at a price, in millionths of a dollar. */
export function costOf(price: UsagePrice, inputTokens: number, outputTokens: number): number {
  return Math.round((inputTokens * price.inputMicrosPerMillion + outputTokens * price.outputMicrosPerMillion) / 1_000_000);
}

/** The rows with one request added to its day's row. */
export function addUsage(rows: readonly UsageRow[], entry: UsageEntry): UsageRow[] {
  const day = dayKey(entry.at);
  const inputTokens = finite(entry.inputTokens);
  const outputTokens = finite(entry.outputTokens);
  const priced = entry.price !== null;
  const cost = entry.price === null ? 0 : costOf(entry.price, inputTokens, outputTokens);
  const index = rows.findIndex((row) => row.day === day && row.provider === entry.provider && row.model === entry.model && row.source === entry.source);
  const base: UsageRow = index === -1
    ? { day, provider: entry.provider, model: entry.model, source: entry.source, requests: 0, inputTokens: 0, outputTokens: 0, estimatedRequests: 0, pricedRequests: 0, costMicros: 0 }
    : rows[index]!;
  const next: UsageRow = {
    ...base,
    requests: base.requests + 1,
    inputTokens: base.inputTokens + inputTokens,
    outputTokens: base.outputTokens + outputTokens,
    estimatedRequests: base.estimatedRequests + (entry.estimated ? 1 : 0),
    pricedRequests: base.pricedRequests + (priced ? 1 : 0),
    costMicros: base.costMicros + cost,
  };
  if (index === -1) return [...rows, next];
  const copy = [...rows];
  copy[index] = next;
  return copy;
}

/** Drop rows older than the keep window. */
export function pruneUsage(rows: readonly UsageRow[], now: number, keepDays = KEEP_USAGE_DAYS): UsageRow[] {
  const oldest = dayKey(now - keepDays * DAY_MS);
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
    rows.push({ day, provider, model, source, requests: requests!, inputTokens: inputTokens!, outputTokens: outputTokens!, estimatedRequests: estimatedRequests!, pricedRequests: pricedRequests!, costMicros: costMicros! });
  }
  return rows;
}

/** The first day a range covers, or null for all time. */
export function rangeStart(range: UsageRange, now: number): string | null {
  if (range === "all") return null;
  const days = range === "today" ? 0 : range === "7d" ? 6 : 29;
  return dayKey(now - days * DAY_MS);
}

function daysBetween(first: string, now: number): string[] {
  const out: string[] = [];
  const today = dayKey(now);
  // Walk back from today rather than forward from `first`, so a clock change mid-range
  // cannot skip or repeat a day.
  for (let back = 0; back < KEEP_USAGE_DAYS + 1; back += 1) {
    const day = dayKey(now - back * DAY_MS);
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

  const byModel = new Map<string, { provider: string; model: string; requests: number; input: number; output: number; cost: number; priced: number; estimated: number; chat: number; agents: number }>();
  for (const row of inRange) {
    const key = `${row.provider}\u0000${row.model}`;
    const entry = byModel.get(key) ?? { provider: row.provider, model: row.model, requests: 0, input: 0, output: 0, cost: 0, priced: 0, estimated: 0, chat: 0, agents: 0 };
    entry.requests += row.requests;
    entry.input += row.inputTokens;
    entry.output += row.outputTokens;
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
    costMicros: priced.length === 0 ? null : priced.reduce((sum, model) => sum + (model.costMicros ?? 0), 0),
    costPartial: models.some((model) => model.costPartial) || (priced.length > 0 && priced.length < models.length),
    estimated: models.some((model) => model.estimated),
  };

  const tokensByDay = new Map<string, number>();
  for (const row of inRange) tokensByDay.set(row.day, (tokensByDay.get(row.day) ?? 0) + row.inputTokens + row.outputTokens);
  const firstDay = start ?? since ?? dayKey(now);
  const days = daysBetween(firstDay, now).map((day) => ({ day, tokens: tokensByDay.get(day) ?? 0 }));

  return { range, totals, models, days, since };
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
