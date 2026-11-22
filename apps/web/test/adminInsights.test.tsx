import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AiUsageReport } from "../src/components/AiUsagePanel";
import { ModelDetailBody, ModelRowFigures } from "../src/components/ModelInsights";
import { InsightProblem } from "../src/components/AdminInsightsUI";
import { change, compact, modelsQuery, ms, presetRange, previousRange, rangeLabel, usd } from "../src/lib/adminInsights";
import { buildModelDetail, buildModelRows, firstTokenBucket, type RawModelInsights } from "../../../services/api/src/modelInsights.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../../../services/api/src/tagflowConfig.ts";

const NOW = Date.parse("2026-11-20T15:00:00Z");
const hist = (values: number[]) => { const h = new Array<number>(64).fill(0); for (const v of values) h[firstTokenBucket(v)]! += 1; return h; };
const raw: RawModelInsights = {
  refreshedAt: NOW, coverageFrom: "2026-10-11", users: 7, previousUsers: 5,
  daily: [
    { day: "2026-11-19", requests: 40, successes: 36, providerErrors: 4, relayErrors: 0, rejected: 0, cancelled: 1, users: 5, inputTokens: 40_000, outputTokens: 4000, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 1_200_000, revenueMicros: 0 },
    { day: "2026-11-20", requests: 60, successes: 60, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, users: 6, inputTokens: 60_000, outputTokens: 6000, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 800_000, revenueMicros: 0 },
  ],
  models: [{ provider: "groq", modelId: "glm-5", upstreamModel: "glm-5", modelName: "GLM 5", firstDay: "2026-11-19", lastDay: "2026-11-20",
    current: { requests: 100, providerCalls: 100, successes: 96, providerErrors: 4, relayErrors: 0, rejected: 0, cancelled: 1, unfinished: 0, users: 7, inputTokens: 100_000, outputTokens: 10_000, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 2_000_000, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: hist([400, 500, 700]) },
    previous: { requests: 80, successes: 80, providerErrors: 0, cancelled: 0, users: 5, inputTokens: 1, outputTokens: 1, costMicros: 1_000_000, revenueMicros: 0 } }],
};
const config = { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, models: [{ id: "glm-5", name: "GLM 5", provider: "groq" as const, contextWindow: 1, maxOutput: 1, inputPrice: 0.6, outputPrice: 2.2 }] };
const rows = buildModelRows(raw, config);

describe("AI models tab", () => {
  it("shows real dated figures with their comparison, and links to the Models page", () => {
    const html = renderToStaticMarkup(<AiUsageReport data={{ range: { from: "2026-11-19", to: "2026-11-20" }, ...raw, rows }} />);
    expect(html).toContain("100");
    expect(html).toContain("+25.0%");
    expect(html).toContain("$2.00");
    expect(html).toContain("GLM 5");
    expect(html).toContain("/admin/tagflow?view=models");
    expect(html).toContain("Not recorded yet");
    expect(html).not.toMatch(/sample|placeholder|lorem/i);
  });

  it("says there is no data, and what fills it, instead of zeros", () => {
    const html = renderToStaticMarkup(<AiUsageReport data={{ range: { from: "2026-11-20", to: "2026-11-20" }, refreshedAt: null, coverageFrom: null, users: 0, previousUsers: 0, rows: [], daily: [] }} />);
    expect(html).toContain("No data yet");
    expect(html).toContain("within 10 minutes");
  });
});

describe("a model's data", () => {
  it("puts its figures on its row", () => {
    const html = renderToStaticMarkup(<ModelRowFigures row={rows[0]!} loaded />);
    expect(html).toContain("100");
    expect(html).toContain("4.0%");
    expect(html).toMatch(/\d+ ms/);
    expect(renderToStaticMarkup(<ModelRowFigures row={rows[0]!} loaded={false} />)).toContain("adm-skel-bar");
  });

  it("shows every figure the detail view promises, with the error codes", () => {
    const detail = buildModelDetail({
      refreshedAt: NOW, coverageFrom: "2026-10-11", modelName: "GLM 5", users: 7, previousUsers: 5,
      daily: raw.daily.map((day) => ({ ...day, providerCalls: day.requests, unfinished: 0, estimatedRequests: 0, walletCharges: 0, firstTokenHistogram: hist([500]) })),
      previousDaily: [{ day: "2026-11-17", requests: 80, successes: 80, providerErrors: 0, cancelled: 0, inputTokens: 1, outputTokens: 1, costMicros: 1, firstTokenHistogram: hist([900]) }],
      previousRevenueMicros: 0, errors: [{ outcome: "provider_error", code: "rate_limit", upstreamStatus: 429, requests: 4, firstDay: "2026-11-19", lastDay: "2026-11-19" }],
    }, { from: "2026-11-19", to: "2026-11-20" });
    const html = renderToStaticMarkup(<ModelDetailBody data={{ ...detail, range: { from: "2026-11-19", to: "2026-11-20", previousFrom: "2026-11-17", previousTo: "2026-11-18" }, modelName: "GLM 5", generatedAt: NOW }} row={{ kind: "included", name: "GLM 5" }} />);
    for (const label of ["Requests", "Users", "Tokens in", "Tokens out", "Cached input", "Provider cost", "Revenue", "Error rate", "First token, median", "First token, p90", "Cancelled", "Top error codes", "rate_limit", "429"]) expect(html).toContain(label);
    expect(html).toContain("Included models are paid for by plans");
  });
});

describe("problems", () => {
  it("offers Retry on a failure, and an honest empty state when tables are missing", () => {
    const failed = renderToStaticMarkup(<InsightProblem kind="server" message="The server did not answer." onRetry={() => undefined} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Retry");
    const missing = renderToStaticMarkup(<InsightProblem kind="migration" message="Apply migration 20261120180100." fills="Filled every 10 minutes." onRetry={() => undefined} />);
    expect(missing).toContain("No data yet");
    expect(missing).toContain("Filled every 10 minutes.");
    expect(missing).not.toContain('role="alert"');
  });
});

describe("ranges and how figures read", () => {
  it("names the range in UTC and marks a range ending today", () => {
    expect(presetRange(7, NOW)).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(previousRange({ from: "2026-11-14", to: "2026-11-20" })).toEqual({ from: "2026-11-07", to: "2026-11-13" });
    expect(rangeLabel({ from: "2026-11-14", to: "2026-11-20" }, NOW)).toBe("14 Nov – 20 Nov 2026 (UTC), today so far");
    expect(rangeLabel({ from: "2026-11-01", to: "2026-11-01" }, NOW)).toBe("1 Nov 2026 (UTC)");
  });
  it("formats counts, money, durations and changes", () => {
    expect(compact(9999)).toBe("9,999");
    expect(compact(1_250_000)).toBe("1.3M");
    expect(usd(2_000_000)).toBe("$2.00");
    expect(usd(0)).toBe("$0");
    expect(ms(820)).toBe("820 ms");
    expect(ms(12_400)).toBe("12.4 s");
    expect(change(125, 100)).toBe("+25.0%");
    expect(change(5, 0)).toBe("new");
    expect(change(0, 0)).toBeNull();
  });
  it("puts only chosen filters in an export address", () => {
    expect(modelsQuery({ from: "2026-11-14", to: "2026-11-20" }, { q: " glm ", provider: "all", kind: "paid", status: "all" }, { key: "cost", direction: "asc" }))
      .toBe("from=2026-11-14&to=2026-11-20&q=glm&kind=paid&sort=cost&dir=asc");
  });
});
