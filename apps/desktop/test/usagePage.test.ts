/**
 * The Usage page's numbers (shared/usagePage.ts) and the 2.6.1 fields behind them: chat,
 * project, hour of day and the cost split, recorded by addUsage and read back from disk.
 */
import { describe, expect, it } from "vitest";
import { addUsage, costSplit, dayKey, mergeUsageRow, parseUsageRows, rangeStart, type UsageEntry, type UsageRow } from "../src/shared/aiUsage.ts";
import { hourLabel, rangePhrase, smoothLine, trendArrow, usagePage, usageSummary, weekdayOf, whatIfCostMicros } from "../src/shared/usagePage.ts";

const DAY = 86_400_000;
// A Wednesday at noon local time, so day keys and hours are the machine's own.
const NOW = new Date(2026, 10, 11, 12).getTime();
const day = (back: number): string => dayKey(NOW - back * DAY);
const row = (over: Partial<UsageRow>): UsageRow => ({ day: day(0), provider: "anthropic", model: "sonnet", source: "chat", requests: 1, inputTokens: 1000, outputTokens: 100, cachedTokens: 0, estimatedRequests: 0, pricedRequests: 1, costMicros: 5000, ...over });

describe("what a request records from 2.6.1", () => {
  const price = { inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000, cacheReadMicrosPerMillion: 300_000 };
  const entry: UsageEntry = { provider: "anthropic", model: "sonnet", source: "chat", inputTokens: 10_000, outputTokens: 1000, cachedTokens: 8000, estimated: false, at: new Date(2026, 10, 11, 15, 30).getTime(), price, chat: "c1", project: "E:/work/shop" };

  it("splits the cost by type and prices what the cache saved", () => {
    expect(costSplit(price, 10_000, 1000, 8000)).toEqual({ input: 6000, cacheRead: 2400, output: 15_000, saved: 21_600 });
    // No cache price: cached input is priced as input, and the saving is unknown, not zero.
    expect(costSplit({ inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 0 }, 1000, 0, 500).saved).toBeNull();
  });

  it("keeps one row per chat and project, with the hour and the split", () => {
    let rows = addUsage([], entry);
    rows = addUsage(rows, entry);
    rows = addUsage(rows, { ...entry, chat: "c2" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ chat: "c1", project: "E:/work/shop", requests: 2, inputCostMicros: 12_000, cacheReadCostMicros: 4800, outputCostMicros: 30_000, cacheSavedMicros: 43_200 });
    expect(rows[0]!.hours![15]).toBe(2);
    expect(rows[0]!.costMicros).toBe(46_800);
    // An unpriced request adds no split and no saving.
    const unpriced = addUsage([], { ...entry, price: null })[0]!;
    expect(unpriced.inputCostMicros).toBeUndefined();
    expect(unpriced.cacheSavedMicros).toBeUndefined();
  });

  it("survives the trip to disk, and drops what does not belong", () => {
    const rows = addUsage([], entry);
    expect(parseUsageRows(JSON.parse(JSON.stringify({ rows })))).toEqual(rows);
    const odd = parseUsageRows({ rows: [{ ...rows[0], hours: [1, 2], chat: "", project: 5, inputCostMicros: -1 }] })[0]!;
    expect(odd.hours).toBeUndefined();
    expect(odd.chat).toBeUndefined();
    expect(odd.project).toBeUndefined();
    expect(odd.inputCostMicros).toBeUndefined();
  });

  it("merges counts recorded before the file was read into the matching row", () => {
    const [a] = addUsage([], entry);
    const merged = mergeUsageRow([a!], a!);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ requests: 2, cacheSavedMicros: 43_200 });
    expect(merged[0]!.hours![15]).toBe(2);
    expect(mergeUsageRow([a!], { ...a!, chat: "other" })).toHaveLength(2);
  });

  it("covers 90 days", () => {
    expect(rangeStart("90d", NOW)).toBe(day(89));
  });
});

describe("the usage page", () => {
  const rows: UsageRow[] = [
    row({ day: day(0), chat: "a", project: "/p/shop", inputTokens: 10_000, cachedTokens: 6000, outputTokens: 2000, requests: 4, pricedRequests: 4, costMicros: 40_000, inputCostMicros: 12_000, cacheReadCostMicros: 2000, outputCostMicros: 26_000, cacheSavedMicros: 16_000, hours: Array.from({ length: 24 }, (_v, h) => (h === 15 ? 4 : 0)), timedRequests: 4, durationMs: 8000, timedOutputTokens: 2000 }),
    row({ day: day(1), chat: "b", project: "/p/blog", provider: "openai", model: "gpt", inputTokens: 3000, outputTokens: 1000, requests: 2, pricedRequests: 2, costMicros: 10_000, inputCostMicros: 6000, cacheReadCostMicros: 0, outputCostMicros: 4000, hours: Array.from({ length: 24 }, (_v, h) => (h === 9 ? 2 : 0)), timedRequests: 3, durationMs: 3000, timedOutputTokens: 1500 }),
    // Agents, before chats and projects were recorded, with no price and no split.
    row({ day: day(2), source: "agents", provider: "tagflow", model: "flash", inputTokens: 5000, outputTokens: 1000, requests: 3, pricedRequests: 0, costMicros: 0, estimatedRequests: 1 }),
    // An old priced row, before the cost split: its cost is "unsplit".
    row({ day: day(3), inputTokens: 1000, outputTokens: 1000, requests: 1, pricedRequests: 1, costMicros: 9000 }),
    // The week before.
    row({ day: day(9), inputTokens: 4000, outputTokens: 1000, requests: 5, pricedRequests: 5, costMicros: 20_000 }),
    // Outside even the period before.
    row({ day: day(40), inputTokens: 99_999 }),
  ];
  const page = usagePage(rows, "7d", NOW);

  it("adds up the range: tokens by type, cost by type, chats and the cache", () => {
    expect(page.totals).toMatchObject({
      requests: 10, chatRequests: 7, agentRequests: 3, chats: 2, chatTaggedRequests: 6,
      inputTokens: 19_000, cachedTokens: 6000, uncachedTokens: 13_000, outputTokens: 5000, processedTokens: 24_000,
      costMicros: 59_000, costPartial: true, estimated: true, cacheSavedMicros: 16_000, cacheSavedPartial: false, activeDays: 4,
    });
    expect(page.totals.cacheHitRate).toBeCloseTo(6000 / 19_000);
    expect(page.costByType).toEqual({ input: 18_000, cacheRead: 2000, output: 30_000, unsplit: 9000 });
    expect(page.tokensByType).toEqual({ input: 13_000, cacheRead: 6000, output: 5000 });
  });

  it("ranks providers and lays out a day per provider for the chart", () => {
    expect(page.providerRows.map((p) => [p.id, p.tokens, p.costMicros, p.chats])).toEqual([["anthropic", 14_000, 49_000, 1], ["tagflow", 6000, null, 0], ["openai", 4000, 10_000, 1]]);
    expect(page.providerRows[0]!.costShare).toBeCloseTo(49_000 / 59_000);
    expect(page.series).toEqual(["anthropic", "tagflow", "openai"]);
    expect(page.days).toHaveLength(7);
    expect(page.days.at(-1)).toMatchObject({ day: day(0), tokens: 12_000, tokensBy: [12_000, 0, 0], costBy: [40_000, 0, 0] });
    expect(page.days.at(-2)!.tokensBy).toEqual([0, 0, 4000]);
  });

  it("compares with the period before, per request too", () => {
    expect(page.previous).toEqual({ requests: 5, tokens: 5000, costMicros: 20_000, tokensPerRequest: 1000 });
    expect(page.trend.requests).toBe(1);
    expect(page.trend.tokensPerRequest).toBeCloseTo(1.4);
    expect(page.perRequest).toEqual({ tokens: 2400, costMicros: Math.round(59_000 / 7) });
    expect(page.perChat).toEqual({ tokens: 8000, requests: 3, costMicros: 25_000 });
    expect(usagePage(rows, "all", NOW).previous).toBeNull();
    expect(usagePage(rows, "all", NOW).trend.tokens).toBeNull();
  });

  it("maps the hours by weekday, from rows that recorded them", () => {
    expect(page.hours.recorded).toBe(6);
    expect(page.hours.busiest).toEqual({ weekday: weekdayOf(day(0)), hour: 15, requests: 4 });
    expect(page.hours.grid[weekdayOf(day(1))]![9]).toBe(2);
  });

  it("lists the costliest chats and the fastest and slowest models", () => {
    expect(page.chats.map((c) => [c.id, c.costMicros, c.project, c.model])).toEqual([["a", 40_000, "/p/shop", "sonnet"], ["b", 10_000, "/p/blog", "gpt"]]);
    expect(page.speed.fastest?.model).toBe("gpt");
    expect(page.speed.slowest?.model).toBe("sonnet");
    expect(page.models[0]).toMatchObject({ model: "sonnet", tokens: 14_000, costMicros: 49_000, tokensPerSecond: 250 });
  });

  it("filters by project and provider, keeping every choice in the menus", () => {
    const shop = usagePage(rows, "7d", NOW, { project: "/p/shop" });
    expect(shop.totals.requests).toBe(4);
    expect(shop.projects.map((p) => p.id)).toEqual(["/p/shop", "/p/blog"]);
    expect(shop.unassignedRequests).toBe(4);
    const openai = usagePage(rows, "7d", NOW, { provider: "openai" });
    expect(openai.totals.processedTokens).toBe(4000);
    expect(openai.providers.map((p) => p.id)).toEqual(["anthropic", "tagflow", "openai"]);
    expect(openai.filter).toEqual({ project: null, provider: "openai" });
  });

  it("says unknown rather than zero", () => {
    const empty = usagePage([], "7d", NOW);
    expect(empty.totals).toMatchObject({ requests: 0, costMicros: null, cacheSavedMicros: null, chats: 0 });
    expect(empty.costByType).toBeNull();
    expect(empty.perChat).toBeNull();
    expect(empty.hours.busiest).toBeNull();
    expect(empty.speed).toEqual({ fastest: null, slowest: null });
    expect(usageSummary(empty, "cost", (id) => id)).toEqual([]);
  });

  it("sums the page up in plain sentences", () => {
    const names = (id: string): string => ({ anthropic: "Anthropic", openai: "OpenAI", tagflow: "Included AI" })[id] ?? id;
    const cost = usageSummary(page, "cost", names);
    expect(cost[0]).toBe("You spent most on Anthropic in the past 7 days: about $0.05 of $0.06.");
    expect(cost[1]).toBe("Caching saved you about $0.02.");
    expect(cost[2]).toBe("You spent 195% more than the 7 days before.");
    expect(usageSummary(page, "tokens", names)[0]).toBe("Most of your tokens went to Anthropic in the past 7 days: 58% of 24k.");
  });
});

describe("drawing and wording helpers", () => {
  it("smooths a line through every point without overshooting", () => {
    expect(smoothLine([])).toBe("");
    expect(smoothLine([[0, 5]])).toBe("M0.0 5.0");
    const path = smoothLine([[0, 100], [10, 0], [20, 0], [30, 100]]);
    expect(path.startsWith("M0.0 100.0 C")).toBe(true);
    // Flat stretch at zero stays at zero: every control point between x=10 and x=20 is at y=0.
    const numbers = path.split(/[ MC]+/).filter(Boolean).map(Number);
    const ys = numbers.filter((_n, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it("estimates another model's cost as an upper bound", () => {
    expect(whatIfCostMicros({ inputTokens: 1_000_000, outputTokens: 100_000 }, { inputUsdPerMillion: 3, outputUsdPerMillion: 15 })).toBe(4_500_000);
  });

  it("says hours, ranges and trends the way people do", () => {
    expect([hourLabel(0), hourLabel(9), hourLabel(12), hourLabel(15)]).toEqual(["12 am", "9 am", "12 pm", "3 pm"]);
    expect(rangePhrase("90d")).toBe("in the past 90 days");
    expect(trendArrow(0.25)).toBe("↑ 25%");
    expect(trendArrow(-0.08)).toBe("↓ 8%");
    expect(trendArrow(0)).toBe("no change");
    expect(trendArrow(null)).toBe("");
  });
});
