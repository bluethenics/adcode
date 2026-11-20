import { describe, expect, it } from "vitest";
import {
  buildModelDetail, buildModelRows, bucketBounds, daysBetween, fillInsightDays, filterModelRows, firstTokenBucket, histogramPercentile,
  insightDaysCsv, mergeHistograms, modelDetailCsv, modelInsightKey, modelKind, modelRowsCsv, parseModelQuery, rowsForCatalogue, sortModelRows,
  DEFAULT_MODEL_FILTER, FIRST_TOKEN_BUCKETS, type RawModelDetail, type RawModelInsight, type RawModelInsights,
} from "../src/modelInsights.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";

const histogramOf = (values: number[]): number[] => {
  const histogram = new Array<number>(FIRST_TOKEN_BUCKETS).fill(0);
  for (const value of values) histogram[firstTokenBucket(value)]! += 1;
  return histogram;
};

const raw = (over: Partial<RawModelInsight> & Pick<RawModelInsight, "provider" | "modelId" | "upstreamModel">): RawModelInsight => ({
  modelName: over.modelId, firstDay: "2026-11-01", lastDay: "2026-11-20",
  current: { requests: 0, providerCalls: 0, successes: 0, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, unfinished: 0, users: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 0, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: [], ...over.current },
  previous: { requests: 0, successes: 0, providerErrors: 0, cancelled: 0, users: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, revenueMicros: 0, ...over.previous },
  ...over,
} as RawModelInsight);

const config: TagflowConfig = {
  ...DEFAULT_TAGFLOW_CONFIG,
  enabled: true,
  models: [
    { id: "tagflow-code", name: "Tagflow Code", provider: "tagflow", upstreamModel: "coder-27b", contextWindow: 131072, maxOutput: 8192, inputPrice: 0, outputPrice: 0 },
    { id: "glm-5", name: "GLM 5", provider: "groq", contextWindow: 200000, maxOutput: 8192, inputPrice: 0.6, outputPrice: 2.2 },
    { id: "deepseek-v4", name: "DeepSeek V4", provider: "openrouter", contextWindow: 128000, maxOutput: 8192, inputPrice: 0.3, outputPrice: 1.1, billing: "wallet", enabled: false },
    { id: "experiment", name: "=Experiment", provider: "groq", contextWindow: 32000, maxOutput: 4096, inputPrice: 1, outputPrice: 1, creditRate: 0 },
  ],
};

const insights: RawModelInsights = {
  refreshedAt: 1, coverageFrom: "2026-10-11", users: 50, previousUsers: 40, daily: [],
  models: [
    raw({ provider: "tagflow", modelId: "tagflow-code", upstreamModel: "coder-27b", current: { requests: 900, successes: 800, providerErrors: 50, cancelled: 30, users: 40, inputTokens: 9_000_000, outputTokens: 400_000, cachedInputTokens: 2_000_000, cacheMeasuredInputTokens: 4_000_000, costMicros: 0, firstTokenHistogram: histogramOf([300, 400, 500, 600, 2000]) } as never, previous: { requests: 600 } as never }),
    raw({ provider: "groq", modelId: "glm-5", upstreamModel: "glm-5", current: { requests: 100, successes: 90, providerErrors: 10, users: 12, costMicros: 5_000_000 } as never }),
    raw({ provider: "openrouter", modelId: "deepseek-v4", upstreamModel: "deepseek/v4-old", current: { requests: 20, successes: 20, users: 2, revenueMicros: 1_500_000, walletCharges: 20 } as never }),
  ],
};

describe("time to first token", () => {
  it("buckets like the SQL: under 50 ms, then 20% wider each, the last one open", () => {
    expect(firstTokenBucket(0)).toBe(0);
    expect(firstTokenBucket(49)).toBe(0);
    expect(firstTokenBucket(50)).toBe(1);
    expect(firstTokenBucket(59)).toBe(1);
    expect(firstTokenBucket(60)).toBe(2);
    expect(firstTokenBucket(10 ** 9)).toBe(63);
    expect(bucketBounds(0)).toEqual([0, 50]);
    expect(bucketBounds(63)[1]).toBe(Number.POSITIVE_INFINITY);
    for (let ms = 50; ms < 200_000; ms = Math.ceil(ms * 1.07)) {
      const [low, high] = bucketBounds(firstTokenBucket(ms));
      expect(ms).toBeGreaterThanOrEqual(Math.floor(low));
      expect(ms).toBeLessThan(high + 1e-9);
    }
  });

  it("reads a median and p90 back within a bucket of the exact value, and nothing from no samples", () => {
    const values = Array.from({ length: 1000 }, (_, i) => 200 + ((i * 7919) % 5000));
    const sorted = [...values].sort((a, b) => a - b);
    const histogram = histogramOf(values);
    for (const fraction of [0.5, 0.9]) {
      const exact = sorted[Math.ceil(fraction * sorted.length) - 1]!;
      expect(Math.abs(histogramPercentile(histogram, fraction)! - exact) / exact).toBeLessThan(0.1);
    }
    expect(histogramPercentile([], 0.5)).toBeNull();
    expect(histogramPercentile(new Array(64).fill(0), 0.5)).toBeNull();
  });

  it("merges histograms of different lengths by bucket", () => {
    expect(mergeHistograms([[1, 2], [0, 1, 5]]).slice(0, 3)).toEqual([1, 3, 5]);
  });
});

describe("one row per model", () => {
  const rows = buildModelRows(insights, config);
  const byId = (id: string) => rows.find((row) => row.modelId === id)!;

  it("labels free, included and paid from the catalogue", () => {
    expect(byId("tagflow-code").kind).toBe("free");
    expect(byId("glm-5").kind).toBe("included");
    expect(byId("deepseek-v4").kind).toBe("paid");
    expect(byId("experiment").kind).toBe("free");
    expect(modelKind({ id: "x", provider: "groq", inputPrice: 0, outputPrice: 0 })).toBe("included");
  });

  it("gives a catalogued model with no requests a zero row, and a vanished identity a retired one", () => {
    expect(byId("experiment").current.requests).toBe(0);
    expect(byId("experiment").current.errorRate).toBeNull();
    const retired = rows.find((row) => row.upstreamModel === "deepseek/v4-old")!;
    expect(retired.status).toBe("retired");
    expect(retired.kind).toBeNull();
    expect(retired.current.revenueMicros).toBe(1_500_000);
    expect(byId("deepseek-v4").status).toBe("hidden");
    expect(rows.filter((row) => row.modelId === "deepseek-v4")).toHaveLength(2);
  });

  it("computes rates and shares the way the provider reports do", () => {
    const tagflow = byId("tagflow-code");
    expect(tagflow.current.errorRate).toBeCloseTo(50 / 850);
    expect(tagflow.current.cancelRate).toBeCloseTo(30 / 900);
    expect(tagflow.current.cachedShare).toBeCloseTo(0.5);
    expect(tagflow.share).toBeCloseTo(900 / 1020);
    expect(tagflow.current.firstTokenSamples).toBe(5);
    expect(tagflow.current.firstTokenP50).toBeGreaterThan(400);
    expect(tagflow.current.firstTokenP50).toBeLessThan(600);
    expect(byId("glm-5").current.cachedShare).toBeNull();
  });

  it("finds, filters and sorts, keeping rows without a value last", () => {
    expect(filterModelRows(rows, { ...DEFAULT_MODEL_FILTER, q: "glm" }).map((row) => row.modelId)).toEqual(["glm-5"]);
    expect(filterModelRows(rows, { ...DEFAULT_MODEL_FILTER, q: "groq" }).map((row) => row.modelId).sort()).toEqual(["experiment", "glm-5"]);
    expect(filterModelRows(rows, { ...DEFAULT_MODEL_FILTER, kind: "paid" })).toHaveLength(1);
    expect(filterModelRows(rows, { ...DEFAULT_MODEL_FILTER, status: "active" }).every((row) => row.current.requests > 0)).toBe(true);
    expect(filterModelRows(rows, { ...DEFAULT_MODEL_FILTER, provider: "openrouter" })).toHaveLength(2);
    expect(sortModelRows(rows, "requests", "desc")[0]!.modelId).toBe("tagflow-code");
    const byError = sortModelRows(rows, "errorRate", "asc");
    expect(byError.at(-1)!.current.errorRate).toBeNull();
    expect(sortModelRows(rows, "errorRate", "desc").at(-1)!.current.errorRate).toBeNull();
    expect(sortModelRows(rows, "name", "asc")[0]!.name).toBe("=Experiment");
    expect(sortModelRows(rows, "change", "desc")[0]!.modelId).toBe("tagflow-code");
  });

  it("reads filters and sort from an address, refusing unknown values", () => {
    const query = parseModelQuery(new URLSearchParams("q=glm&provider=groq&kind=paid&status=hidden&sort=firstToken&dir=asc"));
    expect(query).toEqual({ filter: { q: "glm", provider: "groq", kind: "paid", status: "hidden" }, sort: "firstToken", direction: "asc" });
    expect(parseModelQuery(new URLSearchParams("kind=gold&sort=drop table&dir=sideways"))).toEqual({ filter: DEFAULT_MODEL_FILTER, sort: "requests", direction: "desc" });
  });

  it("lays the editor's draft over the saved figures", () => {
    const draft: TagflowConfig = { ...config, models: [{ ...config.models[1]!, name: "GLM 5 (renamed)", enabled: false }, { id: "", name: "", contextWindow: 1, maxOutput: 1, inputPrice: 0, outputPrice: 0 }] };
    const { rows: overlaid, retired } = rowsForCatalogue(rows, draft);
    expect(overlaid[0]).toMatchObject({ name: "GLM 5 (renamed)", status: "hidden", catalogueIndex: 0 });
    expect(overlaid[0]!.current.requests).toBe(100);
    expect(overlaid[1]!.key).toBe("new:1");
    expect(retired.map((row) => row.modelId).sort()).toEqual(["deepseek-v4", "tagflow-code"]);
  });
});

describe("one model's days", () => {
  const detailRaw: RawModelDetail = {
    refreshedAt: 5, coverageFrom: "2026-10-11", modelName: "GLM 5", users: 9, previousUsers: 4,
    daily: [
      { day: "2026-11-18", requests: 10, providerCalls: 10, successes: 8, providerErrors: 2, relayErrors: 0, rejected: 0, cancelled: 1, unfinished: 0, users: 5, inputTokens: 100, outputTokens: 10, cachedInputTokens: 20, cacheMeasuredInputTokens: 50, costMicros: 300, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: histogramOf([400, 500]) },
      { day: "2026-11-20", requests: 4, providerCalls: 4, successes: 4, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, unfinished: 0, users: 4, inputTokens: 40, outputTokens: 4, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 100, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: histogramOf([900]) },
    ],
    previousDaily: [{ day: "2026-11-16", requests: 7, successes: 7, providerErrors: 0, cancelled: 2, inputTokens: 1, outputTokens: 1, costMicros: 50, firstTokenHistogram: histogramOf([1000]) }],
    previousRevenueMicros: 0,
    errors: [{ outcome: "provider_error", code: "rate_limit", upstreamStatus: 429, requests: 2, firstDay: "2026-11-18", lastDay: "2026-11-18" }],
  };
  const detail = buildModelDetail(detailRaw, { from: "2026-11-18", to: "2026-11-20" });

  it("fills every day of the range and totals across them", () => {
    expect(detail.daily.map((day) => day.day)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(detail.daily[1]).toMatchObject({ requests: 0, errorRate: null, firstTokenP50: null });
    expect(detail.totals).toMatchObject({ requests: 14, users: 9, providerErrors: 2, cancelled: 1, costMicros: 400 });
    expect(detail.totals.cachedShare).toBeCloseTo(0.4);
    expect(detail.previous).toMatchObject({ requests: 7, users: 4, cancelled: 2, errorRate: 0 });
    expect(detail.previous.firstTokenP50).toBeGreaterThan(900);
  });

  it("writes one rectangular CSV with totals, days and errors", () => {
    const csv = modelDetailCsv({ provider: "groq", modelId: "glm-5", upstreamModel: "glm-5", name: "GLM 5" }, detail, { from: "2026-11-18", to: "2026-11-20" });
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    const width = lines[0]!.split(",").length;
    expect(lines).toHaveLength(1 + 1 + 3 + 1);
    expect(lines.every((line) => line.split(",").length === width)).toBe(true);
    expect(lines[1]).toContain('"total"');
    expect(lines.at(-1)).toContain('"rate_limit"');
  });
});

describe("files", () => {
  it("guards spreadsheet formulas in names and leaves numbers as numbers", () => {
    const csv = modelRowsCsv(buildModelRows(insights, config), { from: "2026-11-01", to: "2026-11-20" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`"'=Experiment"`);
    expect(csv).not.toContain(`,"=Experiment"`);
    expect(csv).toContain(",900,");
  });

  it("writes every day of the range for the all-models chart and file", () => {
    const days = fillInsightDays([{ day: "2026-11-02", requests: 3, successes: 3, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, users: 1, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 1_000_000, revenueMicros: 0 }], { from: "2026-11-01", to: "2026-11-03" });
    expect(days.map((day) => day.requests)).toEqual([0, 3, 0]);
    expect(insightDaysCsv(days)).toContain('"2026-11-02",3,1,3');
    expect(daysBetween("2026-11-20", "2026-11-19")).toEqual([]);
    expect(modelInsightKey({ provider: "a", modelId: "b", upstreamModel: "c" })).toBe('["a","b","c"]');
  });
});
