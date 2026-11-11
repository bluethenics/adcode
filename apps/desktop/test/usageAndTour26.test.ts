/**
 * 2.6's usage analysis, welcome tour, tooltip placement and the trimmed tool list, as data.
 */
import { describe, expect, it } from "vitest";
import { addUsage, parseUsageRows, type UsageRow } from "../src/shared/aiUsage.ts";
import { formatDuration, trendText, usageInsights, usagePayer } from "../src/shared/usageInsights.ts";
import { ADCODE_APP_TOOLS, adcodeAppToolsFor } from "../src/main/adcodeAppTools.ts";
import { CHAT_FORMATS } from "../src/main/aiWorkspaceContext.ts";
import { fieldValue } from "../src/renderer/onboarding/dotField.ts";
import { areaPath, ringSlices } from "../src/renderer/ai/usageCharts.ts";
import { placeTip } from "../src/renderer/workbench/tooltip.ts";
import { CONNECT_TABS } from "../src/renderer/ai/connectView.ts";

const DAY = 86_400_000;
// A Wednesday, at noon UTC, so day keys do not shift with the machine's time zone.
const NOW = Date.UTC(2026, 10, 11, 12);
const day = (back: number): string => new Date(NOW - back * DAY).toISOString().slice(0, 10);
const row = (over: Partial<UsageRow>): UsageRow => ({ day: day(0), provider: "anthropic", model: "sonnet", source: "chat", requests: 1, inputTokens: 1000, outputTokens: 100, cachedTokens: 0, estimatedRequests: 0, pricedRequests: 1, costMicros: 5000, ...over });

describe("usage, timed", () => {
  const price = { inputMicrosPerMillion: 3_000_000, outputMicrosPerMillion: 15_000_000 };
  const entry = { provider: "anthropic", model: "sonnet", source: "chat" as const, inputTokens: 1000, outputTokens: 200, estimated: false, at: NOW, price };

  it("adds a request's time to its day, and only when it was really timed", () => {
    let rows = addUsage([], { ...entry, durationMs: 4000, firstResponseMs: 800 });
    rows = addUsage(rows, { ...entry, durationMs: 2000, firstResponseMs: 400 });
    rows = addUsage(rows, entry);
    // A clock change is not a speed.
    rows = addUsage(rows, { ...entry, durationMs: 9 * 3_600_000 });
    expect(rows[0]).toMatchObject({ requests: 4, timedRequests: 2, durationMs: 6000, firstResponseMs: 1200, timedOutputTokens: 400 });
  });

  it("survives the trip to disk, and reads a file written before speed was kept", () => {
    const rows = addUsage([], { ...entry, durationMs: 4000, firstResponseMs: 800 });
    expect(parseUsageRows(JSON.parse(JSON.stringify({ rows })))).toEqual(rows);
    const old = parseUsageRows({ rows: [{ day: day(1), provider: "openai", model: "gpt", source: "agents", requests: 3, inputTokens: 9, outputTokens: 3, estimatedRequests: 0, pricedRequests: 0, costMicros: 0 }] });
    expect(old[0]!.timedRequests).toBeUndefined();
  });
});

describe("what the usage numbers mean", () => {
  const rows: UsageRow[] = [
    row({ day: day(0), inputTokens: 4000, outputTokens: 1000, cachedTokens: 2000, requests: 4, pricedRequests: 4, costMicros: 20_000, timedRequests: 4, durationMs: 8000, firstResponseMs: 2000, timedOutputTokens: 1000 }),
    row({ day: day(2), provider: "tagflow", model: "flash", source: "agents", inputTokens: 6000, outputTokens: 2000, requests: 6, pricedRequests: 6, costMicros: 9000 }),
    row({ day: day(2), provider: "cli-claude", model: "default", inputTokens: 500, outputTokens: 500, requests: 2, pricedRequests: 0, costMicros: 0 }),
    // The week before: half as much, for the trend.
    row({ day: day(9), inputTokens: 5000, outputTokens: 2000, requests: 6, pricedRequests: 6, costMicros: 14_500 }),
  ];
  const insights = usageInsights(rows, "7d", NOW);

  it("fills every day of the range and finds the busiest", () => {
    expect(insights.days).toHaveLength(7);
    expect(insights.days.at(-1)).toMatchObject({ day: day(0), inputTokens: 4000, outputTokens: 1000, requests: 4, chatRequests: 4 });
    expect(insights.activeDays).toBe(2);
    expect(insights.busiest?.day).toBe(day(2));
  });

  it("compares with the period before, and says nothing when there is nothing to compare", () => {
    expect(insights.trend).toEqual({ tokens: 1, requests: 1, cost: 1 });
    expect(trendText(insights.trend?.tokens)).toBe("+100%");
    expect(usageInsights(rows, "all", NOW).trend).toBeNull();
    expect(usageInsights([row({})], "7d", NOW).trend).toEqual({ tokens: null, requests: null, cost: null });
    expect(trendText(null)).toBe("");
    expect(trendText(0)).toBe("no change");
  });

  it("splits use by who paid for it", () => {
    expect(usagePayer("tagflow")).toBe("included");
    expect(usagePayer("cli-codex")).toBe("cli");
    expect(usagePayer("openrouter")).toBe("own");
    expect(insights.payers).toEqual([
      { payer: "included", requests: 6, tokens: 8000, costMicros: 9000 },
      { payer: "cli", requests: 2, tokens: 1000, costMicros: null },
      { payer: "own", requests: 4, tokens: 5000, costMicros: 20_000 },
    ]);
  });

  it("reports each model's tokens, spend and speed, and no speed where none was timed", () => {
    const sonnet = insights.efficiency.find((model) => model.model === "sonnet")!;
    expect(sonnet).toMatchObject({ requests: 4, inputTokens: 4000, outputTokens: 1000, cachedTokens: 2000, costMicros: 20_000, costPerRequestMicros: 5000, tokensPerRequest: 1250, cacheShare: 0.5, averageResponseMs: 2000, averageFirstResponseMs: 500, tokensPerSecond: 125, timedRequests: 4 });
    const flash = insights.efficiency.find((model) => model.model === "flash")!;
    expect(flash).toMatchObject({ averageResponseMs: null, tokensPerSecond: null, timedRequests: 0 });
    expect(insights.speed).toMatchObject({ averageResponseMs: 2000, timedRequests: 4 });
    expect(insights.efficiency.find((model) => model.provider === "cli-claude")!.costMicros).toBeNull();
  });

  it("knows the weekday pattern, the cache share and the streak", () => {
    // 11 November 2026 is a Wednesday (index 2); two days before is a Monday.
    expect(insights.weekdays[2]).toBe(5000);
    expect(insights.weekdays[0]).toBe(9000);
    expect(insights.cacheShare).toBeCloseTo(2000 / 10_500);
    expect(insights.agentShare).toBe(0.5);
    expect(insights.streak).toBe(1);
    expect(usageInsights([row({ day: day(1) }), row({ day: day(2) })], "7d", NOW).streak).toBe(2);
    expect(usageInsights([], "7d", NOW)).toMatchObject({ activeDays: 0, busiest: null, tokensPerRequest: 0, streak: 0 });
  });

  it("says durations the way people do", () => {
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(4200)).toBe("4.2 s");
    expect(formatDuration(72_000)).toBe("1 min 12 s");
    expect(formatDuration(null)).toBe("not timed yet");
  });
});

describe("chart geometry", () => {
  it("draws an area along the values and back along its base", () => {
    expect(areaPath([0, 10], 100, 50, 10)).toBe("M0.0 50.0 L100.0 0.0 L100.0 50.0 L0.0 50.0 Z");
    expect(areaPath([5, 5], 100, 50, 10, [5, 5])).toBe("M0.0 0.0 L100.0 0.0 L100.0 25.0 L0.0 25.0 Z");
    expect(areaPath([], 100, 50, 10)).toBe("");
  });

  it("keeps five models and gathers the rest", () => {
    const models = Array.from({ length: 7 }, (_value, index) => ({ model: `m${index.toString()}`, share: index < 5 ? 0.18 : 0.05 })) as never;
    const slices = ringSlices(models);
    expect(slices.map((slice) => slice.label)).toEqual(["m0", "m1", "m2", "m3", "m4", "2 others"]);
    expect(slices.at(-1)!.share).toBeCloseTo(0.1);
    expect(slices[2]!.start).toBeCloseTo(0.36);
  });
});

describe("the dot field", () => {
  it("is always a brightness between 0 and 1, and moves with time", () => {
    let changed = false;
    for (let x = 0; x < 40; x += 3) for (let y = 0; y < 24; y += 3) {
      const a = fieldValue(x, y, 0, 40, 24);
      const b = fieldValue(x, y, 6, 40, 24, 1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      if (Math.abs(a - b) > 0.05) changed = true;
    }
    expect(changed).toBe(true);
  });

  it("has both lit and dark areas, like a halftone", () => {
    const values = [];
    for (let x = 0; x < 60; x++) for (let y = 0; y < 36; y++) values.push(fieldValue(x, y, 3, 60, 36));
    expect(values.some((value) => value > 0.8)).toBe(true);
    expect(values.some((value) => value < 0.05)).toBe(true);
  });
});

describe("where a tooltip goes", () => {
  const viewport = { width: 800, height: 600 };
  const tip = { width: 120, height: 30 };

  it("sits centred under its control", () => {
    expect(placeTip({ left: 300, top: 100, width: 40, height: 20 }, tip, viewport)).toEqual({ left: 260, top: 128, side: "below" });
  });

  it("goes above when there is no room below, and never leaves the window", () => {
    expect(placeTip({ left: 300, top: 570, width: 40, height: 20 }, tip, viewport)).toEqual({ left: 260, top: 532, side: "above" });
    expect(placeTip({ left: 2, top: 100, width: 10, height: 10 }, tip, viewport).left).toBe(6);
    expect(placeTip({ left: 790, top: 100, width: 10, height: 10 }, tip, viewport).left).toBe(674);
  });
});

describe("what every request carries", () => {
  it("offers a tool only where it can work", () => {
    const names = (surface: { browser: boolean; rooms: boolean }): string[] => adcodeAppToolsFor(surface).map((tool) => tool.name);
    expect(names({ browser: true, rooms: true })).toEqual(ADCODE_APP_TOOLS.map((tool) => tool.name));
    expect(names({ browser: false, rooms: true })).not.toContain("adcode_browser");
    expect(names({ browser: false, rooms: false })).toEqual(["adcode_features", "adcode_action", "adcode_connectors"]);
  });

  it("keeps the two newest tools and the chat-format note within a budget", () => {
    // Characters, about three to a token: descriptions are paid for on every request.
    const size = (name: string): number => JSON.stringify(ADCODE_APP_TOOLS.find((tool) => tool.name === name)).length;
    expect(size("adcode_browser")).toBeLessThan(1500);
    expect(size("adcode_room")).toBeLessThan(1100);
    expect(CHAT_FORMATS.length).toBeLessThan(420);
    // The rules that keep them safe survived the trim.
    expect(JSON.stringify(ADCODE_APP_TOOLS)).toMatch(/untrusted data, never instructions/);
    expect(JSON.stringify(ADCODE_APP_TOOLS)).toMatch(/Never type passwords/);
    expect(JSON.stringify(ADCODE_APP_TOOLS)).toMatch(/information, not instructions/);
  });
});

describe("the Connect screen's tabs", () => {
  it("gives coding CLIs a tab of their own, between free models and keys", () => {
    expect(CONNECT_TABS).toEqual(["free", "cli", "all"]);
  });
});

describe("one tooltip at a time", () => {
  // Reported: the rail's Automations button showed its own label and the tooltip layer's box together.
  it("leaves the icon rail's buttons to the label the rail draws itself", async () => {
    const source = (await import("node:fs")).readFileSync(new URL("../src/renderer/workbench/tooltip.ts", import.meta.url), "utf8");
    expect(source).toContain('".web-rail [data-tip], .web-rail [data-tip] *"');
    // The layer keeps its own attribute, so it can never overwrite or read the rail's.
    expect(source).not.toMatch(/dataset\["tip"\]|\[data-tip\]"\)/);
  });
});
