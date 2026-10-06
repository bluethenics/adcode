import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { TokenVerifier } from "../src/auth.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { MODEL_OUTCOMES, parseModelOutcomes, summarizeModelHealth } from "../src/modelOutcomes.ts";

/**
 * How assistant turns end, per model.
 *
 * "All AI models must be working" needs to know which ones are not, for real people. Each
 * editor reports finished turns as provider, model, a fixed word and a duration; the service
 * keeps daily counts with no account attached, and the admin panel's Models page shows how
 * often each model works.
 */
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user") return { uid: "u-1", claims: {} };
    return null;
  },
};

const item = (over: Record<string, unknown> = {}) => ({ provider: "openai", model: "gpt-6.1-sol", outcome: "ok", ms: 4200, ...over });

describe("parseModelOutcomes", () => {
  it("reads a batch", () => {
    expect(parseModelOutcomes({ outcomes: [item(), item({ outcome: "auth", ms: 300 })] })).toEqual([
      { provider: "openai", model: "gpt-6.1-sol", outcome: "ok", ms: 4200 },
      { provider: "openai", model: "gpt-6.1-sol", outcome: "auth", ms: 300 },
    ]);
  });

  it.each([
    ["nothing", {}],
    ["an empty batch", { outcomes: [] }],
    ["too many at once", { outcomes: Array.from({ length: 51 }, () => item()) }],
    ["a word the list does not have", { outcomes: [item({ outcome: "Incorrect API key provided" })] }],
    ["a provider id that is not one", { outcomes: [item({ provider: "Open AI!" })] }],
    ["a model id far too long", { outcomes: [item({ model: "x".repeat(300) })] }],
    ["a negative duration", { outcomes: [item({ ms: -1 })] }],
    ["a field that could carry text", { outcomes: [item({ prompt: "hello" })] }],
  ])("refuses %s", (_label, raw) => {
    expect(parseModelOutcomes(raw)).toBeNull();
  });
});

describe("summarizeModelHealth", () => {
  it("adds up days into how often each model works, busiest first", () => {
    const rows = summarizeModelHealth([
      { day: "2026-10-05", provider: "openai", model: "gpt-6.1-sol", outcome: "ok", count: 8, totalMs: 80_000 },
      { day: "2026-10-06", provider: "openai", model: "gpt-6.1-sol", outcome: "ok", count: 2, totalMs: 20_000 },
      { day: "2026-10-06", provider: "openai", model: "gpt-6.1-sol", outcome: "rate_limit", count: 2, totalMs: 1_000 },
      { day: "2026-10-06", provider: "openrouter", model: "stealth/space-bunny-alpha", outcome: "output_limit", count: 3, totalMs: 300_000 },
    ]);
    expect(rows[0]).toEqual({ provider: "openai", model: "gpt-6.1-sol", turns: 12, ok: 10, okAvgMs: 10_000, outcomes: { ok: 10, rate_limit: 2 } });
    expect(rows[1]).toMatchObject({ provider: "openrouter", turns: 3, ok: 0, okAvgMs: null });
  });

  it("does not count stopped turns against a model", () => {
    const [row] = summarizeModelHealth([
      { day: "2026-10-06", provider: "groq", model: "m", outcome: "ok", count: 4, totalMs: 4_000 },
      { day: "2026-10-06", provider: "groq", model: "m", outcome: "cancelled", count: 6, totalMs: 6_000 },
    ]);
    expect(row).toMatchObject({ turns: 4, ok: 4, outcomes: { ok: 4, cancelled: 6 } });
  });
});

describe("the routes", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let handle: (request: Request) => Promise<Response>;

  beforeEach(async () => {
    store = createMemoryStore();
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    handle = createFetchHandler({ store, verifier, clock: { now: () => Date.UTC(2026, 9, 6, 12) } });
  });

  const call = (path: string, init: { method?: string; token?: string; body?: unknown } = {}) =>
    handle(new Request(`https://adcode.test${path}`, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }));

  it("counts what an editor reports, by day, and the panel reads it back", async () => {
    expect((await call("/v1/model-outcomes", { method: "POST", token: "user", body: { outcomes: [item(), item(), item({ outcome: "auth" })] } })).status).toBe(200);
    const health = await (await call("/v1/admin/model-health?days=7", { token: "admin" })).json() as { models: unknown[] };
    expect(health.models[0]).toMatchObject({ provider: "openai", model: "gpt-6.1-sol", turns: 3, ok: 2 });
  });

  it("needs an account to report and an admin to read", async () => {
    expect((await call("/v1/model-outcomes", { method: "POST", body: { outcomes: [item()] } })).status).toBe(401);
    expect((await call("/v1/admin/model-health", { token: "user" })).status).toBe(403);
  });

  it("refuses a malformed batch", async () => {
    expect((await call("/v1/model-outcomes", { method: "POST", token: "user", body: { outcomes: [item({ outcome: "nope" })] } })).status).toBe(400);
  });
});

describe("the desktop app's copy of the list", () => {
  it("names exactly the outcomes the service accepts", () => {
    const source = readFileSync(new URL("../../../apps/desktop/src/shared/modelOutcomes.ts", import.meta.url), "utf8");
    const listed = [...source.matchAll(/^\s*"([a-z_]+)",\r?$/gm)].map((match) => match[1]);
    expect(listed).toEqual([...MODEL_OUTCOMES]);
  });
});
