/**
 * The Usage page, as numbers: everything the dialog draws, worked out from the rows this
 * computer recorded.
 *
 * `aiUsage.ts` keeps one row per day, provider, model, source - and, from 2.6.1, chat and
 * project. This file filters those rows by project and provider, sums them for a range, and
 * answers the questions the page asks: how much, on what, split how, when, which chats, and
 * compared with the period before.
 *
 * Honest by construction. A figure the rows cannot support is null, never zero: there is no
 * cost without a price, no chat count for requests recorded before chats were, no hour map
 * for requests recorded before hours were, and no cache-write figure at all, because no
 * provider reports one to ADCode. The page says each of those out loud.
 *
 * Pure: rows in, numbers out. The main process runs it; the renderer turns the numbers into
 * sentences with `usageSummary`, which needs provider names only the renderer knows.
 */
import { dayKey, formatTokens, formatUsageCost, rangeStart, type UsageRange, type UsageRow } from "./aiUsage.ts";
import { shiftDay } from "./usageActivity.ts";

/** Which rows the page counts. Null or absent: all of them. */
export interface UsageFilter {
  readonly project?: string | null;
  readonly provider?: string | null;
}

/** A choice in the project or provider menu, with how much it was used in the range. */
export interface UsageOption {
  readonly id: string;
  readonly requests: number;
}

export interface UsagePageProvider {
  readonly id: string;
  readonly requests: number;
  /** Distinct chats that used it; only requests recorded with a chat count. */
  readonly chats: number;
  readonly tokens: number;
  /** Null when none of its requests had a price. */
  readonly costMicros: number | null;
  readonly costPartial: boolean;
  /** Share of all tokens, and of all priced cost, in the filtered range: 0-1. */
  readonly tokenShare: number;
  readonly costShare: number;
}

export interface UsagePageModel {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly tokens: number;
  readonly costMicros: number | null;
  readonly costPartial: boolean;
  readonly estimated: boolean;
  readonly tokenShare: number;
  readonly costShare: number;
  readonly tokensPerRequest: number;
  readonly costPerRequestMicros: number | null;
  /** Speed, from timed requests only; null until one was timed. */
  readonly averageResponseMs: number | null;
  readonly tokensPerSecond: number | null;
  readonly timedRequests: number;
}

export interface UsagePageDay {
  readonly day: string;
  readonly requests: number;
  readonly tokens: number;
  readonly costMicros: number;
  /** Per provider, in the order of `UsagePageView.series`. */
  readonly tokensBy: readonly number[];
  readonly costBy: readonly number[];
}

export interface UsagePageChat {
  readonly id: string;
  readonly project: string | null;
  readonly requests: number;
  readonly tokens: number;
  readonly costMicros: number | null;
  readonly firstDay: string;
  readonly lastDay: string;
  /** The model it used most. */
  readonly model: string;
}

export interface UsagePageTotals {
  readonly requests: number;
  readonly chatRequests: number;
  readonly agentRequests: number;
  /** Distinct chats. */
  readonly chats: number;
  /** Chat requests recorded with the chat they belonged to (2.6.1 on). */
  readonly chatTaggedRequests: number;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly uncachedTokens: number;
  readonly outputTokens: number;
  /** Everything read and written: input (cached included) plus output. */
  readonly processedTokens: number;
  readonly costMicros: number | null;
  readonly costPartial: boolean;
  readonly estimated: boolean;
  /** Null when no request with cached input had a cache price in the catalogue. */
  readonly cacheSavedMicros: number | null;
  /** Some cached input had no cache price, so the saving shown is less than the whole. */
  readonly cacheSavedPartial: boolean;
  /** Cached input as a share of all input, 0-1. */
  readonly cacheHitRate: number;
  readonly activeDays: number;
}

export interface UsagePageView {
  readonly range: UsageRange;
  readonly filter: { readonly project: string | null; readonly provider: string | null };
  /** Menu choices, from the whole range whatever the filter, most used first. */
  readonly projects: readonly UsageOption[];
  /** Requests in the range that ran with no project recorded (before 2.6.1, or no folder open). */
  readonly unassignedRequests: number;
  readonly providers: readonly UsageOption[];
  readonly totals: UsagePageTotals;
  /**
   * Cost split by what it paid for, in micro-dollars; null with no priced request. `unsplit`
   * is priced cost recorded before the split was kept. Cache writes are not here: no provider
   * reports them to ADCode.
   */
  readonly costByType: { readonly input: number; readonly cacheRead: number; readonly output: number; readonly unsplit: number } | null;
  readonly tokensByType: { readonly input: number; readonly cacheRead: number; readonly output: number };
  /** Most tokens first. */
  readonly providerRows: readonly UsagePageProvider[];
  /** Providers in the chart, most tokens first; `days[].tokensBy` follows this order. */
  readonly series: readonly string[];
  readonly days: readonly UsagePageDay[];
  /** Most tokens first. */
  readonly models: readonly UsagePageModel[];
  readonly perRequest: { readonly tokens: number; readonly costMicros: number | null };
  /** Averages over chats recorded with their chat; null when there are none. */
  readonly perChat: { readonly tokens: number; readonly costMicros: number | null; readonly requests: number } | null;
  /** The period of equal length just before this one; null for all time. */
  readonly previous: { readonly requests: number; readonly tokens: number; readonly costMicros: number; readonly tokensPerRequest: number } | null;
  /** Change against `previous` as a fraction (0.25 = up a quarter); null with nothing to compare. */
  readonly trend: { readonly tokens: number | null; readonly costMicros: number | null; readonly requests: number | null; readonly tokensPerRequest: number | null };
  /** Requests by weekday (Monday first) and local hour; only requests recorded with an hour count. */
  readonly hours: { readonly grid: readonly (readonly number[])[]; readonly recorded: number; readonly busiest: { readonly weekday: number; readonly hour: number; readonly requests: number } | null };
  /** The chats that cost the most (or used the most tokens, where unpriced), up to eight. */
  readonly chats: readonly UsagePageChat[];
  /** Among models with at least three timed requests: quickest and slowest to write. */
  readonly speed: { readonly fastest: UsagePageModel | null; readonly slowest: UsagePageModel | null };
}

const parseDay = (day: string): number => {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
};
/** Monday 0 ... Sunday 6. */
export const weekdayOf = (day: string): number => (new Date(parseDay(day)).getUTCDay() + 6) % 7;

const change = (now: number, before: number): number | null => (before <= 0 ? null : (now - before) / before);
const tokensOf = (row: UsageRow): number => row.inputTokens + row.outputTokens;

function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let day = first; day <= last && out.length < 800; day = shiftDay(day, 1)) out.push(day);
  return out;
}

function matches(row: UsageRow, filter: { readonly project: string | null; readonly provider: string | null }): boolean {
  return (filter.project === null || row.project === filter.project) && (filter.provider === null || row.provider === filter.provider);
}

function options(rows: readonly UsageRow[], pick: (row: UsageRow) => string | undefined): UsageOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = pick(row);
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + row.requests);
  }
  return [...counts].map(([id, requests]) => ({ id, requests })).sort((a, b) => b.requests - a.requests || a.id.localeCompare(b.id));
}

/** Work out the page for one range and filter. */
export function usagePage(rows: readonly UsageRow[], range: UsageRange, now: number, filterIn: UsageFilter = {}): UsagePageView {
  const today = dayKey(now);
  const start = rangeStart(range, now);
  const inRange = rows.filter((row) => (start === null || row.day >= start) && row.day <= today);
  const filter = { project: filterIn.project ?? null, provider: filterIn.provider ?? null };
  const chosen = inRange.filter((row) => matches(row, filter));

  // Totals.
  let requests = 0, chatRequests = 0, chatTagged = 0, input = 0, cached = 0, output = 0, cost = 0, priced = 0, estimated = 0;
  let splitInput = 0, splitCache = 0, splitOutput = 0, unsplit = 0, saved = 0, savedKnown = false, cachedUnpriced = false;
  const chatIds = new Set<string>();
  for (const row of chosen) {
    requests += row.requests;
    if (row.source === "chat") chatRequests += row.requests;
    if (row.chat !== undefined) { chatIds.add(row.chat); chatTagged += row.requests; }
    input += row.inputTokens;
    cached += row.cachedTokens ?? 0;
    output += row.outputTokens;
    cost += row.costMicros;
    priced += row.pricedRequests;
    estimated += row.estimatedRequests;
    const split = (row.inputCostMicros ?? 0) + (row.cacheReadCostMicros ?? 0) + (row.outputCostMicros ?? 0);
    splitInput += row.inputCostMicros ?? 0;
    splitCache += row.cacheReadCostMicros ?? 0;
    splitOutput += row.outputCostMicros ?? 0;
    // Rounding makes the split a micro-dollar or two off per request; that is not "unsplit".
    const left = row.costMicros - split;
    if (left > row.requests * 2) unsplit += left;
    if (row.cacheSavedMicros !== undefined) { saved += row.cacheSavedMicros; savedKnown = true; }
    if ((row.cachedTokens ?? 0) > 0 && row.cacheSavedMicros === undefined) cachedUnpriced = true;
  }

  // Providers.
  const byProvider = new Map<string, { requests: number; tokens: number; cost: number; priced: number; chats: Set<string> }>();
  for (const row of chosen) {
    const entry = byProvider.get(row.provider) ?? { requests: 0, tokens: 0, cost: 0, priced: 0, chats: new Set<string>() };
    entry.requests += row.requests;
    entry.tokens += tokensOf(row);
    entry.cost += row.costMicros;
    entry.priced += row.pricedRequests;
    if (row.chat !== undefined) entry.chats.add(row.chat);
    byProvider.set(row.provider, entry);
  }
  const processed = input + output;
  const providerRows: UsagePageProvider[] = [...byProvider].map(([id, entry]) => ({
    id,
    requests: entry.requests,
    chats: entry.chats.size,
    tokens: entry.tokens,
    costMicros: entry.priced === 0 ? null : entry.cost,
    costPartial: entry.priced > 0 && entry.priced < entry.requests,
    tokenShare: processed === 0 ? 0 : entry.tokens / processed,
    costShare: cost === 0 || entry.priced === 0 ? 0 : entry.cost / cost,
  })).sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  const series = providerRows.map((row) => row.id);

  // Days, per provider.
  const first = start ?? chosen.reduce<string>((earliest, row) => (row.day < earliest ? row.day : earliest), today);
  const dayIndex = new Map(daysFrom(first, today).map((day, index) => [day, index] as const));
  const days = [...dayIndex.keys()].map((day) => ({ day, requests: 0, tokens: 0, costMicros: 0, tokensBy: series.map(() => 0), costBy: series.map(() => 0) }));
  for (const row of chosen) {
    const day = days[dayIndex.get(row.day) ?? -1];
    if (day === undefined) continue;
    const at = series.indexOf(row.provider);
    day.requests += row.requests;
    day.tokens += tokensOf(row);
    day.costMicros += row.costMicros;
    day.tokensBy[at]! += tokensOf(row);
    day.costBy[at]! += row.costMicros;
  }

  // Models.
  const byModel = new Map<string, { provider: string; model: string; requests: number; input: number; cached: number; output: number; cost: number; priced: number; estimated: number; timed: number; duration: number; timedOutput: number }>();
  for (const row of chosen) {
    const key = `${row.provider}\u0000${row.model}`;
    const entry = byModel.get(key) ?? { provider: row.provider, model: row.model, requests: 0, input: 0, cached: 0, output: 0, cost: 0, priced: 0, estimated: 0, timed: 0, duration: 0, timedOutput: 0 };
    entry.requests += row.requests;
    entry.input += row.inputTokens;
    entry.cached += row.cachedTokens ?? 0;
    entry.output += row.outputTokens;
    entry.cost += row.costMicros;
    entry.priced += row.pricedRequests;
    entry.estimated += row.estimatedRequests;
    entry.timed += row.timedRequests ?? 0;
    entry.duration += row.durationMs ?? 0;
    entry.timedOutput += row.timedOutputTokens ?? 0;
    byModel.set(key, entry);
  }
  const models: UsagePageModel[] = [...byModel.values()].filter((entry) => entry.requests > 0).map((entry) => {
    const timed = entry.timed > 0 && entry.duration > 0;
    return {
      provider: entry.provider,
      model: entry.model,
      requests: entry.requests,
      inputTokens: entry.input,
      cachedTokens: entry.cached,
      outputTokens: entry.output,
      tokens: entry.input + entry.output,
      costMicros: entry.priced === 0 ? null : entry.cost,
      costPartial: entry.priced > 0 && entry.priced < entry.requests,
      estimated: entry.estimated > 0,
      tokenShare: processed === 0 ? 0 : (entry.input + entry.output) / processed,
      costShare: cost === 0 || entry.priced === 0 ? 0 : entry.cost / cost,
      tokensPerRequest: Math.round((entry.input + entry.output) / entry.requests),
      costPerRequestMicros: entry.priced === 0 ? null : Math.round(entry.cost / entry.priced),
      averageResponseMs: timed ? Math.round(entry.duration / entry.timed) : null,
      tokensPerSecond: timed ? Math.round((entry.timedOutput / (entry.duration / 1000)) * 10) / 10 : null,
      timedRequests: timed ? entry.timed : 0,
    };
  }).sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model));

  // The period before.
  let previous: UsagePageView["previous"] = null;
  if (start !== null) {
    const from = shiftDay(start, -dayIndex.size);
    const before = rows.filter((row) => row.day >= from && row.day < start && matches(row, filter));
    const beforeRequests = before.reduce((total, row) => total + row.requests, 0);
    const beforeTokens = before.reduce((total, row) => total + tokensOf(row), 0);
    previous = {
      requests: beforeRequests,
      tokens: beforeTokens,
      costMicros: before.reduce((total, row) => total + row.costMicros, 0),
      tokensPerRequest: beforeRequests === 0 ? 0 : Math.round(beforeTokens / beforeRequests),
    };
  }
  const tokensPerRequest = requests === 0 ? 0 : Math.round(processed / requests);
  const trend = {
    tokens: previous === null ? null : change(processed, previous.tokens),
    costMicros: previous === null ? null : change(cost, previous.costMicros),
    requests: previous === null ? null : change(requests, previous.requests),
    tokensPerRequest: previous === null || requests === 0 ? null : change(tokensPerRequest, previous.tokensPerRequest),
  };

  // Hours.
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let recorded = 0;
  for (const row of chosen) {
    if (row.hours === undefined) continue;
    const weekday = weekdayOf(row.day);
    row.hours.forEach((count, hour) => {
      grid[weekday]![hour]! += count;
      recorded += count;
    });
  }
  let busiest: UsagePageView["hours"]["busiest"] = null;
  grid.forEach((hours, weekday) => hours.forEach((count, hour) => {
    if (count > 0 && (busiest === null || count > busiest.requests)) busiest = { weekday, hour, requests: count };
  }));

  // Chats.
  const byChat = new Map<string, { project: string | null; requests: number; tokens: number; cost: number; priced: number; first: string; last: string; models: Map<string, number> }>();
  for (const row of chosen) {
    if (row.chat === undefined) continue;
    const entry = byChat.get(row.chat) ?? { project: row.project ?? null, requests: 0, tokens: 0, cost: 0, priced: 0, first: row.day, last: row.day, models: new Map<string, number>() };
    entry.requests += row.requests;
    entry.tokens += tokensOf(row);
    entry.cost += row.costMicros;
    entry.priced += row.pricedRequests;
    if (row.day < entry.first) entry.first = row.day;
    if (row.day > entry.last) entry.last = row.day;
    entry.models.set(row.model, (entry.models.get(row.model) ?? 0) + tokensOf(row));
    byChat.set(row.chat, entry);
  }
  const chats: UsagePageChat[] = [...byChat].map(([id, entry]) => ({
    id,
    project: entry.project,
    requests: entry.requests,
    tokens: entry.tokens,
    costMicros: entry.priced === 0 ? null : entry.cost,
    firstDay: entry.first,
    lastDay: entry.last,
    model: [...entry.models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "",
  })).sort((a, b) => (b.costMicros ?? -1) - (a.costMicros ?? -1) || b.tokens - a.tokens || a.id.localeCompare(b.id)).slice(0, 8);
  const chatTokens = [...byChat.values()].reduce((total, entry) => total + entry.tokens, 0);
  const chatPriced = [...byChat.values()].filter((entry) => entry.priced > 0);

  // Speed.
  const timed = models.filter((model) => model.timedRequests >= 3 && model.tokensPerSecond !== null).sort((a, b) => (b.tokensPerSecond ?? 0) - (a.tokensPerSecond ?? 0));

  return {
    range,
    filter,
    projects: options(inRange, (row) => row.project),
    unassignedRequests: inRange.filter((row) => row.project === undefined).reduce((total, row) => total + row.requests, 0),
    providers: options(inRange, (row) => row.provider),
    totals: {
      requests,
      chatRequests,
      agentRequests: requests - chatRequests,
      chats: chatIds.size,
      chatTaggedRequests: chatTagged,
      inputTokens: input,
      cachedTokens: cached,
      uncachedTokens: input - cached,
      outputTokens: output,
      processedTokens: processed,
      costMicros: priced === 0 ? null : cost,
      costPartial: priced > 0 && priced < requests,
      estimated: estimated > 0,
      cacheSavedMicros: savedKnown ? saved : null,
      cacheSavedPartial: savedKnown && cachedUnpriced,
      cacheHitRate: input === 0 ? 0 : cached / input,
      activeDays: days.filter((day) => day.requests > 0).length,
    },
    costByType: priced === 0 ? null : { input: splitInput, cacheRead: splitCache, output: splitOutput, unsplit },
    tokensByType: { input: input - cached, cacheRead: cached, output },
    providerRows,
    series,
    days,
    models,
    perRequest: { tokens: tokensPerRequest, costMicros: priced === 0 ? null : Math.round(cost / priced) },
    perChat: byChat.size === 0 ? null : {
      tokens: Math.round(chatTokens / byChat.size),
      requests: Math.round(chatTagged / byChat.size),
      costMicros: chatPriced.length === 0 ? null : Math.round(chatPriced.reduce((total, entry) => total + entry.cost, 0) / chatPriced.length),
    },
    previous,
    trend,
    hours: { grid, recorded, busiest },
    chats,
    speed: { fastest: timed[0] ?? null, slowest: timed.length > 1 ? timed[timed.length - 1]! : null },
  };
}

/**
 * Smooth a line through points without overshooting them (monotone cubic, Fritsch-Carlson):
 * a day with nothing stays at zero rather than dipping below it, and a peak is never drawn
 * higher than it was. Returns a whole path, starting with "M".
 */
export function smoothLine(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";
  const at = (index: number): readonly [number, number] => points[index]!;
  const fixed = (value: number): string => value.toFixed(1);
  if (points.length === 1) return `M${fixed(at(0)[0])} ${fixed(at(0)[1])}`;
  const n = points.length;
  const slopes: number[] = [];
  for (let index = 0; index < n - 1; index++) {
    const dx = at(index + 1)[0] - at(index)[0];
    slopes.push(dx === 0 ? 0 : (at(index + 1)[1] - at(index)[1]) / dx);
  }
  const tangents: number[] = [slopes[0]!];
  for (let index = 1; index < n - 1; index++) {
    const a = slopes[index - 1]!, b = slopes[index]!;
    tangents.push(a * b <= 0 ? 0 : (a + b) / 2);
  }
  tangents.push(slopes[n - 2]!);
  // Fritsch-Carlson: keep each tangent inside the band that cannot overshoot.
  for (let index = 0; index < n - 1; index++) {
    const slope = slopes[index]!;
    if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
    const alpha = tangents[index]! / slope, beta = tangents[index + 1]! / slope;
    const length = alpha * alpha + beta * beta;
    if (length > 9) {
      const tau = 3 / Math.sqrt(length);
      tangents[index] = tau * alpha * slope;
      tangents[index + 1] = tau * beta * slope;
    }
  }
  let path = `M${fixed(at(0)[0])} ${fixed(at(0)[1])}`;
  for (let index = 0; index < n - 1; index++) {
    const [x0, y0] = at(index), [x1, y1] = at(index + 1);
    const third = (x1 - x0) / 3;
    path += ` C${fixed(x0 + third)} ${fixed(y0 + tangents[index]! * third)} ${fixed(x1 - third)} ${fixed(y1 - tangents[index + 1]! * third)} ${fixed(x1)} ${fixed(y1)}`;
  }
  return path;
}

/** The most the same tokens would cost on another model, counting cached input as fresh: its cache price is not known here. */
export function whatIfCostMicros(tokens: { readonly inputTokens: number; readonly outputTokens: number }, price: { readonly inputUsdPerMillion: number; readonly outputUsdPerMillion: number }): number {
  return Math.round(tokens.inputTokens * price.inputUsdPerMillion + tokens.outputTokens * price.outputUsdPerMillion);
}

/** "3 pm", "12 am" - an hour the way it is said. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** "today", "in the past 7 days", "so far". */
export function rangePhrase(range: UsageRange): string {
  return range === "today" ? "today" : range === "7d" ? "in the past 7 days" : range === "30d" ? "in the past 30 days" : range === "90d" ? "in the past 90 days" : "so far";
}

/** "↑ 25%", "↓ 8%", "no change", or "" with nothing to compare. */
export function trendArrow(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const percent = Math.round(value * 100);
  return percent === 0 ? "no change" : `${percent > 0 ? "↑" : "↓"} ${Math.abs(percent).toLocaleString("en-US")}%`;
}

/**
 * A few plain sentences that say what the page shows, most useful first: where the money or
 * tokens went, what the cache saved, how it compares with before, and when you work.
 */
export function usageSummary(page: UsagePageView, view: "cost" | "tokens", nameOf: (provider: string) => string): string[] {
  const totals = page.totals;
  if (totals.requests === 0) return [];
  const out: string[] = [];
  const when = rangePhrase(page.range);
  const top = page.providerRows[0];
  const byCost = view === "cost" && totals.costMicros !== null && totals.costMicros > 0;
  if (top !== undefined) {
    if (page.providerRows.length === 1) {
      out.push(byCost
        ? `You spent about ${formatUsageCost(totals.costMicros)} ${when}, all of it on ${nameOf(top.id)}.`
        : `You used ${formatTokens(totals.processedTokens)} tokens ${when}, all of them on ${nameOf(top.id)}.`);
    } else if (byCost) {
      const most = [...page.providerRows].sort((a, b) => (b.costMicros ?? 0) - (a.costMicros ?? 0))[0]!;
      if (most.costShare >= 0.995) out.push(`All of the ${formatUsageCost(totals.costMicros)} you spent ${when} went to ${nameOf(most.id)}; the rest had no cost.`);
      else out.push(`You spent most on ${nameOf(most.id)} ${when}: about ${formatUsageCost(most.costMicros)} of ${formatUsageCost(totals.costMicros)}.`);
    } else {
      out.push(`Most of your tokens went to ${nameOf(top.id)} ${when}: ${Math.round(top.tokenShare * 100)}% of ${formatTokens(totals.processedTokens)}.`);
    }
  }
  if (totals.cacheSavedMicros !== null && totals.cacheSavedMicros >= 10_000) {
    out.push(`Caching saved you about ${formatUsageCost(totals.cacheSavedMicros)}${totals.cacheSavedPartial ? " (more on models with no cache price)" : ""}.`);
  } else if (totals.cacheHitRate >= 0.05) {
    out.push(`${Math.round(totals.cacheHitRate * 100)}% of what the AI read came from its cache, which is cheaper and quicker than reading it fresh.`);
  }
  const trend = view === "cost" && page.trend.costMicros !== null ? page.trend.costMicros : page.trend.tokens;
  if (trend !== null && page.previous !== null) {
    const percent = Math.round(Math.abs(trend) * 100);
    const what = view === "cost" && page.trend.costMicros !== null ? "spent" : "used";
    const span = page.range === "today" ? "yesterday" : `the ${page.days.length} days before`;
    out.push(percent === 0 ? `That is about the same as ${span}.` : `You ${what} ${percent}% ${trend > 0 ? "more" : "less"} than ${span}.`);
  }
  if (page.perRequest.tokens >= 40_000) {
    out.push(`Each request read about ${formatTokens(page.perRequest.tokens)} tokens. Long chats re-read their history every step, so a new chat for a new task costs less.`);
  }
  const busiest = page.hours.busiest;
  if (busiest !== null && page.hours.recorded >= 10) {
    out.push(`You use AI most on ${WEEKDAY_NAMES[busiest.weekday]}s around ${hourLabel(busiest.hour)}.`);
  }
  return out.slice(0, 4);
}
