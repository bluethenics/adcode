import { describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { isAdminInsightsPath, parseDays, parseKeys, websiteWindow, type AdminInsightsStore } from "../src/adminInsights.ts";
import type { TokenVerifier } from "../src/auth.ts";
import type { RawModelDetail, RawModelInsights } from "../src/modelInsights.ts";
import type { RawWebsiteSummary } from "../src/websiteInsights.ts";
import type { AppUsageStore } from "../src/appUsage.ts";

const NOW = Date.parse("2026-11-20T15:00:00Z");
const DAY = 86_400_000;

const models: RawModelInsights = {
  refreshedAt: NOW - 60_000, coverageFrom: "2026-10-11", users: 3, previousUsers: 1,
  daily: [{ day: "2026-11-20", requests: 5, successes: 4, providerErrors: 1, relayErrors: 0, rejected: 0, cancelled: 0, users: 3, inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 7, revenueMicros: 0 }],
  models: [
    { provider: "tagflow", modelId: "busy", upstreamModel: "busy", modelName: "Busy", firstDay: "2026-11-20", lastDay: "2026-11-20",
      current: { requests: 5, providerCalls: 5, successes: 4, providerErrors: 1, relayErrors: 0, rejected: 0, cancelled: 0, unfinished: 0, users: 3, inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 7, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: [] },
      previous: { requests: 1, successes: 1, providerErrors: 0, cancelled: 0, users: 1, inputTokens: 1, outputTokens: 1, costMicros: 1, revenueMicros: 0 } },
    { provider: "heabsy", modelId: "=quiet", upstreamModel: "quiet", modelName: "=Quiet", firstDay: "2026-11-20", lastDay: "2026-11-20",
      current: { requests: 1, providerCalls: 1, successes: 1, providerErrors: 0, relayErrors: 0, rejected: 0, cancelled: 0, unfinished: 0, users: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheMeasuredInputTokens: 0, costMicros: 1, estimatedRequests: 0, revenueMicros: 0, walletCharges: 0, firstTokenHistogram: [] },
      previous: { requests: 0, successes: 0, providerErrors: 0, cancelled: 0, users: 0, inputTokens: 0, outputTokens: 0, costMicros: 0, revenueMicros: 0 } },
  ],
};
const detail: RawModelDetail = { refreshedAt: NOW, coverageFrom: "2026-10-11", modelName: "Busy", users: 3, previousUsers: 1, daily: [], previousDaily: [], previousRevenueMicros: 0, errors: [] };
const website: RawWebsiteSummary = {
  totalEvents: 30, pageViews: 20, sessions: 9, installSessions: 2, errorCount: 0, engagementMs: 0,
  daily: [{ day: "2026-11-20", views: 20, sessions: 9 }], funnels: { install: [9, 2], advertiser: [0, 0], installPages: [3, 1] },
  rankings: { pages: [{ label: "/", count: 20 }], sources: [{ label: "t.co", count: 20 }] }, metrics: [],
};

function setup({ admin = true, insights }: { admin?: boolean; insights?: Partial<AdminInsightsStore> } = {}) {
  const store = createMemoryStore();
  const verifier: TokenVerifier = { verify: async () => ({ uid: "admin-uid", claims: { email: admin ? "boss@example.test" : "someone@example.test", email_verified: true } }) };
  const fake: AdminInsightsStore = {
    models: vi.fn(async () => models), model: vi.fn(async () => detail), website: vi.fn(async () => website), rebuild: vi.fn(async () => true), ...insights,
  };
  const appUsage: AppUsageStore = { add: async () => undefined, read: async () => [{ day: "2026-11-19", name: "cmd:terminal.new", uses: 9, clients: 3 }, { day: "2026-11-19", name: "page:settings", uses: 4, clients: 2 }] };
  const handle = createFetchHandler({ store, verifier, clock: { now: () => NOW }, adminInsights: fake, appUsage });
  const get = async (path: string, init: RequestInit = {}) => {
    await store.addAdmin({ email: "boss@example.test", addedBy: "seed", addedAt: NOW });
    return handle(new Request(`https://adcode.test/v1${path}`, { ...init, headers: { authorization: "Bearer t", ...init.headers } }));
  };
  return { get, fake, store };
}

describe("admin insights routes", () => {
  it("answers only its own paths", () => {
    expect(isAdminInsightsPath("/v1/admin/insights/models")).toBe(true);
    expect(isAdminInsightsPath("/v1/admin/insights/export")).toBe(true);
    expect(isAdminInsightsPath("/v1/admin/website-analytics")).toBe(false);
  });

  it("refuses anybody who is not an administrator", async () => {
    const { get, fake } = setup({ admin: false });
    expect((await get("/admin/insights/models")).status).toBe(403);
    expect(fake.models).not.toHaveBeenCalled();
  });

  it("returns every model for the range, the catalogue's models included, with the range said", async () => {
    const { get, fake } = setup();
    const response = await get("/admin/insights/models?from=2026-11-14&to=2026-11-20");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { range: Record<string, string>; rows: { modelId: string; status: string }[]; daily: unknown[]; refreshedAt: number };
    expect(body.range).toEqual({ from: "2026-11-14", to: "2026-11-20", previousFrom: "2026-11-07", previousTo: "2026-11-13" });
    expect(body.daily).toHaveLength(7);
    expect(body.refreshedAt).toBe(NOW - 60_000);
    expect(body.rows.find((row) => row.modelId === "busy")).toBeDefined();
    expect(fake.models).toHaveBeenCalledWith("2026-11-14", "2026-11-20");
  });

  it("refuses a range in the future or longer than 93 days", async () => {
    const { get } = setup();
    expect((await get("/admin/insights/models?from=2026-11-20&to=2026-11-21")).status).toBe(400);
    expect((await get("/admin/insights/models?from=2026-01-01&to=2026-11-20")).status).toBe(400);
  });

  it("says to apply the migration when the tables are missing, instead of showing numbers", async () => {
    const { get } = setup({ insights: { models: async () => null, website: async () => null } });
    const response = await get("/admin/insights/models?from=2026-11-20&to=2026-11-20");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "insights-unavailable" });
    expect((await get("/admin/insights/website?days=7")).status).toBe(503);
  });

  it("turns a database failure into a retryable 503", async () => {
    const { get } = setup({ insights: { models: async () => { throw new Error("timeout"); } } });
    const response = await get("/admin/insights/models?from=2026-11-20&to=2026-11-20");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "insights-failed" });
  });

  it("returns one model, and wants all three parts of its identity", async () => {
    const { get, fake } = setup();
    expect((await get("/admin/insights/model?from=2026-11-20&to=2026-11-20&provider=tagflow&model=busy")).status).toBe(400);
    const response = await get("/admin/insights/model?from=2026-11-19&to=2026-11-20&provider=tagflow&model=busy&upstream=busy");
    expect(response.status).toBe(200);
    const body = await response.json() as { daily: unknown[]; totals: { users: number } };
    expect(body.daily).toHaveLength(2);
    expect(body.totals.users).toBe(3);
    expect(fake.model).toHaveBeenCalledWith("2026-11-19", "2026-11-20", { provider: "tagflow", modelId: "busy", upstreamModel: "busy" });
  });

  it("recounts on POST only", async () => {
    const { get, fake } = setup();
    expect((await get("/admin/insights/models/rebuild")).status).toBe(405);
    expect((await get("/admin/insights/models/rebuild", { method: "POST" })).status).toBe(200);
    expect(fake.rebuild).toHaveBeenCalledOnce();
  });

  it("builds the website report from the summary, whole period, with yesterday's comparison", async () => {
    const { get, fake } = setup();
    const response = await get("/admin/insights/website?days=7");
    const body = await response.json() as { truncated: boolean; sources: { label: string }[]; daily: unknown[]; dayComparison: { previous: unknown } };
    expect(body.truncated).toBe(false);
    expect(body.sources[0]!.label).toBe("x");
    expect(body.daily).toHaveLength(7);
    expect(body.dayComparison.previous).not.toBeNull();
    const { start } = websiteWindow(7, NOW);
    expect(fake.website).toHaveBeenCalledWith(start, NOW + 1);
    expect(fake.website).toHaveBeenCalledWith(start - DAY, NOW + 1 - DAY);
  });

  it("exports the filtered, sorted model list as CSV with a safe file name, and audits it", async () => {
    const { get, store } = setup();
    const audit = vi.spyOn(store, "writeAudit");
    const response = await get("/admin/insights/export?dataset=models&format=csv&from=2026-11-20&to=2026-11-20&status=active&sort=requests&dir=asc");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="adcode-models-2026-11-20-2026-11-20.csv"');
    const lines = (await response.text()).replace(/^﻿/, "").split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=Quiet"`);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "export-models" }));
  });

  it("exports exactly the compared models by key, and JSON when asked", async () => {
    const { get } = setup();
    const keys = encodeURIComponent(JSON.stringify([JSON.stringify(["tagflow", "busy", "busy"])]));
    const response = await get(`/admin/insights/export?dataset=models&format=json&from=2026-11-20&to=2026-11-20&keys=${keys}`);
    const body = await response.json() as { rows: { modelId: string }[] };
    expect(body.rows.map((row) => row.modelId)).toEqual(["busy"]);
  });

  it("exports one model, the AI days, a website table, growth and every desktop feature", async () => {
    const { get } = setup();
    expect(await (await get("/admin/insights/export?dataset=model&from=2026-11-20&to=2026-11-20&provider=tagflow&model=busy&upstream=busy")).text()).toContain('"total"');
    expect(await (await get("/admin/insights/export?dataset=ai-daily&from=2026-11-19&to=2026-11-20")).text()).toContain('"2026-11-20",5,3');
    expect(await (await get("/admin/insights/export?dataset=website&days=7&table=sources")).text()).toContain('"x",20');
    expect((await get("/admin/insights/export?dataset=website&days=7&table=passwords")).status).toBe(400);
    expect((await get("/admin/insights/export?dataset=growth")).status).toBe(200);
    const features = await (await get("/admin/insights/export?dataset=features&days=30")).text();
    expect(features).toContain('"cmd","terminal.new",9,3');
    expect(features).toContain('"page","settings",4,2');
    expect((await get("/admin/insights/export?dataset=everything")).status).toBe(400);
  });
});

describe("parameters", () => {
  it("keeps days between 1 and 90", () => {
    expect(parseDays("7")).toBe(7);
    expect(parseDays("0")).toBe(30);
    expect(parseDays("91")).toBe(30);
    expect(parseDays("1.5")).toBe(30);
    expect(parseDays(null)).toBe(30);
  });
  it("accepts at most twenty model keys", () => {
    expect(parseKeys(JSON.stringify(["a", "b"]))).toEqual(new Set(["a", "b"]));
    expect(parseKeys(JSON.stringify(Array.from({ length: 21 }, (_, i) => String(i))))).toBeNull();
    expect(parseKeys("{not json")).toBeNull();
    expect(parseKeys(JSON.stringify([1]))).toBeNull();
  });
  it("ends the website window at the next UTC midnight", () => {
    expect(websiteWindow(1, NOW)).toEqual({ start: Date.parse("2026-11-20T00:00:00Z"), end: Date.parse("2026-11-21T00:00:00Z") });
  });
});
