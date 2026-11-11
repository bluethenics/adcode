/**
 * What the usage numbers mean: the analysis behind the Usage dialog's charts.
 *
 * `aiUsage.ts` adds requests up; this reads the totals back as answers to the questions a
 * person actually has - is my use going up, when do I work, which model is good value, how
 * much is the cache saving me, is it the chat or the agents doing the spending.
 *
 * Everything here is arithmetic on rows this computer recorded. Nothing is modelled or
 * guessed: where there is not enough to say something (a trend needs an earlier period, a
 * cost needs a price), the field is null and the view says so. Response time is not here at
 * all, because ADCode does not record it.
 *
 * Pure: rows in, numbers out.
 */
import { dayKey, rangeStart, type AiUsageView, type UsageRange, type UsageRow } from "./aiUsage.ts";

/** The usage view with its analysis attached: what the Usage dialog is given. */
export interface AnalysedUsageView extends AiUsageView {
  readonly insights: UsageInsights;
}

export interface UsageDayDetail {
  readonly day: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly requests: number;
  /** Micro-dollars from priced requests; 0 when none that day had a price. */
  readonly costMicros: number;
  readonly chatRequests: number;
  readonly agentRequests: number;
}

export interface UsageModelEfficiency {
  readonly provider: string;
  readonly model: string;
  readonly requests: number;
  readonly tokensPerRequest: number;
  /** Output as a share of all tokens, 0-1: how much of the spend was the model writing. */
  readonly outputShare: number;
  /** Cached input as a share of input, 0-1. */
  readonly cacheShare: number;
  /** Micro-dollars per request, or null when the model has no price. */
  readonly costPerRequestMicros: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  /** Everything spent on this model in the period at list price, or null with no price. */
  readonly costMicros: number | null;
  /** Average time for a whole answer, in milliseconds; null until a request has been timed. */
  readonly averageResponseMs: number | null;
  /** Average wait before the model sent anything. */
  readonly averageFirstResponseMs: number | null;
  /** Output tokens per second while answering. */
  readonly tokensPerSecond: number | null;
  /** How many of its requests the speed figures are based on. */
  readonly timedRequests: number;
}

/** Whose account paid for the use: ADCode's included AI, a coding CLI's own subscription, or the person's own key. */
export type UsagePayer = "included" | "cli" | "own";
export const usagePayer = (provider: string): UsagePayer => (provider === "tagflow" ? "included" : provider.startsWith("cli-") ? "cli" : "own");

export interface UsagePayerTotal {
  readonly payer: UsagePayer;
  readonly requests: number;
  readonly tokens: number;
  /** At list price, micro-dollars; null when none of it had a price. */
  readonly costMicros: number | null;
}

export interface UsageInsights {
  readonly days: readonly UsageDayDetail[];
  /** Days in the range with at least one request. */
  readonly activeDays: number;
  readonly busiest: UsageDayDetail | null;
  readonly tokensPerRequest: number;
  readonly requestsPerActiveDay: number;
  /** Cached input as a share of all input, 0-1. */
  readonly cacheShare: number;
  /** What the cache saved, in micro-dollars, where prices are known; null otherwise. */
  readonly cacheSavedMicros: number | null;
  readonly outputShare: number;
  /** Agent requests as a share of all requests, 0-1. */
  readonly agentShare: number;
  /** Tokens by weekday, Monday first. */
  readonly weekdays: readonly number[];
  /**
   * Change against the period of equal length just before this one, as a fraction
   * (0.25 = up a quarter). Null for "all time", or when the earlier period was empty.
   */
  readonly trend: { readonly tokens: number | null; readonly requests: number | null; readonly cost: number | null } | null;
  readonly efficiency: readonly UsageModelEfficiency[];
  /** Use by who paid, always all three in the order included, cli, own. */
  readonly payers: readonly UsagePayerTotal[];
  /** Across every timed request in the period; null fields until something has been timed. */
  readonly speed: { readonly averageResponseMs: number | null; readonly averageFirstResponseMs: number | null; readonly tokensPerSecond: number | null; readonly timedRequests: number };
  /** Consecutive days with use, ending today or yesterday. */
  readonly streak: number;
}

const DAY_MS = 86_400_000;

function parseDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function shiftDay(day: string, by: number): string {
  return new Date(parseDay(day) + by * DAY_MS).toISOString().slice(0, 10);
}

function span(from: string, to: string): string[] {
  const out: string[] = [];
  for (let at = parseDay(from); at <= parseDay(to) && out.length < 800; at += DAY_MS) out.push(new Date(at).toISOString().slice(0, 10));
  return out;
}

const change = (now: number, before: number): number | null => (before <= 0 ? null : (now - before) / before);

export interface UsageRate { readonly provider: string; readonly model: string; readonly inputMicrosPerMillion: number; readonly cacheReadMicrosPerMillion: number }

/**
 * `rates` lets the cache saving be priced: for each model, what uncached and cached input
 * cost. Models missing from it are left out of the saving, and if none are known it is null.
 */
export function usageInsights(rows: readonly UsageRow[], range: UsageRange, now: number, rates: readonly UsageRate[] = []): UsageInsights {
  const today = dayKey(now);
  const start = rangeStart(range, now);
  const inRange = rows.filter((row) => (start === null || row.day >= start) && row.day <= today);
  const first = start ?? inRange.reduce<string>((earliest, row) => (row.day < earliest ? row.day : earliest), today);

  const byDay = new Map<string, { input: number; output: number; cached: number; requests: number; cost: number; chat: number; agents: number }>();
  for (const row of inRange) {
    const entry = byDay.get(row.day) ?? { input: 0, output: 0, cached: 0, requests: 0, cost: 0, chat: 0, agents: 0 };
    entry.input += row.inputTokens;
    entry.output += row.outputTokens;
    entry.cached += row.cachedTokens ?? 0;
    entry.requests += row.requests;
    entry.cost += row.costMicros;
    if (row.source === "chat") entry.chat += row.requests; else entry.agents += row.requests;
    byDay.set(row.day, entry);
  }
  const days: UsageDayDetail[] = span(first, today).map((day) => {
    const entry = byDay.get(day);
    return { day, inputTokens: entry?.input ?? 0, outputTokens: entry?.output ?? 0, cachedTokens: entry?.cached ?? 0, requests: entry?.requests ?? 0, costMicros: entry?.cost ?? 0, chatRequests: entry?.chat ?? 0, agentRequests: entry?.agents ?? 0 };
  });

  const sum = (pick: (day: UsageDayDetail) => number): number => days.reduce((total, day) => total + pick(day), 0);
  const input = sum((day) => day.inputTokens);
  const output = sum((day) => day.outputTokens);
  const cached = sum((day) => day.cachedTokens);
  const requests = sum((day) => day.requests);
  const cost = sum((day) => day.costMicros);
  const active = days.filter((day) => day.requests > 0);
  const tokensOf = (day: UsageDayDetail): number => day.inputTokens + day.outputTokens;

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const day of days) weekdays[(new Date(parseDay(day.day)).getUTCDay() + 6) % 7]! += tokensOf(day);

  let trend: UsageInsights["trend"] = null;
  if (start !== null) {
    const length = days.length;
    const from = shiftDay(start, -length);
    const before = rows.filter((row) => row.day >= from && row.day < start);
    trend = {
      tokens: change(input + output, before.reduce((total, row) => total + row.inputTokens + row.outputTokens, 0)),
      requests: change(requests, before.reduce((total, row) => total + row.requests, 0)),
      cost: change(cost, before.reduce((total, row) => total + row.costMicros, 0)),
    };
  }

  const byModel = new Map<string, { provider: string; model: string; requests: number; input: number; output: number; cached: number; cost: number; priced: number; timed: number; duration: number; first: number; timedOutput: number }>();
  for (const row of inRange) {
    const key = `${row.provider}\u0000${row.model}`;
    const entry = byModel.get(key) ?? { provider: row.provider, model: row.model, requests: 0, input: 0, output: 0, cached: 0, cost: 0, priced: 0, timed: 0, duration: 0, first: 0, timedOutput: 0 };
    entry.timed += row.timedRequests ?? 0;
    entry.duration += row.durationMs ?? 0;
    entry.first += row.firstResponseMs ?? 0;
    entry.timedOutput += row.timedOutputTokens ?? 0;
    entry.requests += row.requests;
    entry.input += row.inputTokens;
    entry.output += row.outputTokens;
    entry.cached += row.cachedTokens ?? 0;
    entry.cost += row.costMicros;
    entry.priced += row.pricedRequests;
    byModel.set(key, entry);
  }
  const efficiency: UsageModelEfficiency[] = [...byModel.values()].filter((entry) => entry.requests > 0).map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    requests: entry.requests,
    tokensPerRequest: Math.round((entry.input + entry.output) / entry.requests),
    outputShare: entry.input + entry.output === 0 ? 0 : entry.output / (entry.input + entry.output),
    cacheShare: entry.input === 0 ? 0 : entry.cached / entry.input,
    costPerRequestMicros: entry.priced === 0 ? null : Math.round(entry.cost / entry.priced),
    inputTokens: entry.input,
    outputTokens: entry.output,
    cachedTokens: entry.cached,
    costMicros: entry.priced === 0 ? null : entry.cost,
    ...speedOf(entry.timed, entry.duration, entry.first, entry.timedOutput),
  })).sort((a, b) => b.requests - a.requests || a.model.localeCompare(b.model));

  let saved = 0;
  let pricedCache = false;
  for (const entry of byModel.values()) {
    const rate = rates.find((one) => one.provider === entry.provider && one.model === entry.model);
    if (rate === undefined || entry.cached === 0) continue;
    pricedCache = true;
    saved += (entry.cached * Math.max(0, rate.inputMicrosPerMillion - rate.cacheReadMicrosPerMillion)) / 1_000_000;
  }

  // A streak survives until a whole day is missed: nothing yet today does not break it.
  let streak = 0;
  const used = new Set(rows.filter((row) => row.requests > 0).map((row) => row.day));
  for (let day = used.has(today) ? today : shiftDay(today, -1); used.has(day); day = shiftDay(day, -1)) streak += 1;

  const payers: UsagePayerTotal[] = (["included", "cli", "own"] as const).map((payer) => {
    const mine = [...byModel.values()].filter((entry) => usagePayer(entry.provider) === payer);
    const priced = mine.reduce((total, entry) => total + entry.priced, 0);
    return {
      payer,
      requests: mine.reduce((total, entry) => total + entry.requests, 0),
      tokens: mine.reduce((total, entry) => total + entry.input + entry.output, 0),
      costMicros: priced === 0 ? null : mine.reduce((total, entry) => total + entry.cost, 0),
    };
  });
  const every = [...byModel.values()];
  const speed = speedOf(every.reduce((total, entry) => total + entry.timed, 0), every.reduce((total, entry) => total + entry.duration, 0), every.reduce((total, entry) => total + entry.first, 0), every.reduce((total, entry) => total + entry.timedOutput, 0));

  return {
    payers,
    speed,
    days,
    activeDays: active.length,
    busiest: active.length === 0 ? null : active.reduce((best, day) => (tokensOf(day) > tokensOf(best) ? day : best)),
    tokensPerRequest: requests === 0 ? 0 : Math.round((input + output) / requests),
    requestsPerActiveDay: active.length === 0 ? 0 : Math.round(requests / active.length),
    cacheShare: input === 0 ? 0 : cached / input,
    cacheSavedMicros: pricedCache ? Math.round(saved) : null,
    outputShare: input + output === 0 ? 0 : output / (input + output),
    agentShare: requests === 0 ? 0 : sum((day) => day.agentRequests) / requests,
    weekdays,
    trend,
    efficiency,
    streak,
  };
}

/** Speed from timed requests alone; every figure is null until at least one was timed. */
function speedOf(timed: number, durationMs: number, firstMs: number, outputTokens: number): { averageResponseMs: number | null; averageFirstResponseMs: number | null; tokensPerSecond: number | null; timedRequests: number } {
  if (timed <= 0 || durationMs <= 0) return { averageResponseMs: null, averageFirstResponseMs: null, tokensPerSecond: null, timedRequests: 0 };
  return {
    averageResponseMs: Math.round(durationMs / timed),
    averageFirstResponseMs: Math.round(firstMs / timed),
    tokensPerSecond: Math.round((outputTokens / (durationMs / 1000)) * 10) / 10,
    timedRequests: timed,
  };
}

/** 850 ms, 4.2 s, 1 min 12 s - a duration the way it is said. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "not timed yet";
  if (ms < 1000) return `${Math.round(ms).toString()} ms`;
  if (ms < 60_000) return `${(Math.round(ms / 100) / 10).toString()} s`;
  return `${Math.floor(ms / 60_000).toString()} min ${Math.round((ms % 60_000) / 1000).toString()} s`;
}

/** "+25%", "-8%", "no change", or "" when there is nothing to compare with. */
export function trendText(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const percent = Math.round(value * 100);
  return percent === 0 ? "no change" : `${percent > 0 ? "+" : ""}${percent.toLocaleString("en-US")}%`;
}
