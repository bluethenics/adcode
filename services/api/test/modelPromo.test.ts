import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { DEFAULT_TAGFLOW_CONFIG, parseTagflowConfig } from "../src/tagflowConfig.ts";
import { DEFAULT_PAID_CONFIG } from "../src/paidTokens.ts";
import { createModelPromoMemoryStore, endModelPromo, parseModelPromo, startModelPromo } from "../src/modelPromo.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";

const NOW = Date.parse("2026-11-23T12:00:00Z");
const config: TagflowConfig = {
  ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "free",
  models: [
    { id: "free", name: "Free", contextWindow: 32768, maxOutput: 4096, inputPrice: 0, outputPrice: 0 },
    { id: "deepseek", name: "DeepSeek Flash", provider: "openrouter", upstreamModel: "deepseek/flash", billing: "wallet", contextWindow: 32768, maxOutput: 4096, inputPrice: 10, outputPrice: 20 },
    { id: "opus", name: "Opus", provider: "openrouter", upstreamModel: "anthropic/opus", billing: "wallet", contextWindow: 32768, maxOutput: 4096, inputPrice: 5, outputPrice: 25 },
  ],
  paid: { ...DEFAULT_PAID_CONFIG, enabled: true },
};

describe("free model promotion rules", () => {
  it("starts from whole cents, real wallet models and whole days, as a new pool each time", () => {
    const promo = startModelPromo({ name: "Free DeepSeek", perUserCents: 15, maxUsers: 300, days: 30, models: ["deepseek"] }, ["deepseek", "opus"], NOW);
    expect(promo).toMatchObject({ perUserMicros: 150_000, maxUsers: 300, models: ["deepseek"], startsAt: NOW, endsAt: NOW + 30 * 86_400_000 });
    expect(startModelPromo({ name: "x", perUserCents: 15, maxUsers: 300, days: 30, models: ["free"] }, ["deepseek"], NOW)).toBeNull();
    expect(startModelPromo({ name: "x", perUserCents: 501, maxUsers: 300, days: 30, models: ["deepseek"] }, ["deepseek"], NOW)).toBeNull();
    expect(startModelPromo({ name: "x", perUserCents: 15, maxUsers: 0, days: 30, models: ["deepseek"] }, ["deepseek"], NOW)).toBeNull();
    expect(startModelPromo({ name: "x", perUserCents: 15, maxUsers: 3, days: 1, models: ["deepseek"] }, ["deepseek"], NOW + 1)?.id).not.toBe(promo?.id);
    expect(parseModelPromo({ ...promo, extra: 1 })).toBeNull();
    expect(endModelPromo(promo!, NOW + 5).endsAt).toBe(NOW + 5);
  });

  it("closes the pool at the limit and never lets a claim go below zero", async () => {
    const store = createModelPromoMemoryStore();
    expect(await store.claimModelPromo("p", "a", 100, 2, NOW)).toBe("granted");
    expect(await store.claimModelPromo("p", "a", 100, 2, NOW)).toBe("already");
    expect(await store.claimModelPromo("p", "b", 100, 2, NOW)).toBe("granted");
    expect(await store.claimModelPromo("p", "c", 100, 2, NOW)).toBe("full");
    expect(await store.reserveModelPromo("h1", "p", "a", "deepseek", 70, NOW)).toBe(70);
    // Only 30 is left, so the next request is held for 30: the last one is free, never refused.
    expect(await store.reserveModelPromo("h2", "p", "a", "deepseek", 70, NOW)).toBe(30);
    expect(await store.reserveModelPromo("h3", "p", "a", "deepseek", 70, NOW)).toBe(0);
    await store.settleModelPromo("h1", 20, NOW);
    await store.settleModelPromo("h2", 999, NOW);
    expect(await store.getModelPromoClaim("p", "a", NOW)).toEqual({ grantedMicros: 100, spentMicros: 50, reservedMicros: 0 });
    expect(await store.modelPromoStats("p")).toEqual({ claims: 2, spentMicros: 50 });
  });
});

describe("free model promotion through the relay", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let handle: ReturnType<typeof createFetchHandler>;
  let uid = "u";
  let clock = NOW;
  const call = (path: string, body?: unknown, token = "user") => handle(new Request(`https://test/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-adcode-paid-credits": "1" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const chat = (model = "deepseek") => call("/ai/tagflow/chat/completions", { model, messages: [{ role: "user", content: "Hello" }], max_tokens: 100, stream: false });
  const start = (maxUsers = 300) => call("/admin/ai-plans/model-promo", { name: "Free DeepSeek", perUserCents: 15, maxUsers, days: 30, models: ["deepseek"] }, "admin");

  beforeEach(async () => {
    vi.stubEnv("INCLUDED_AI_OPENROUTER_API_KEY", "server-provider-key");
    store = createMemoryStore();
    uid = "u";
    clock = NOW;
    await store.putTagflowConfig({ config, updatedAt: NOW, updatedBy: "setup" });
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    for (const id of ["u", "v"]) await store.putUser({ uid: id, status: "active", createdAt: NOW, email: `${id}@test.com`, emailVerified: true });
    await store.putUser({ uid: "anon", status: "active", createdAt: NOW });
    fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
    handle = createFetchHandler({
      store, clock: { now: () => clock },
      verifier: { async verify(token: string) { return token === "admin" ? { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } } : { uid, claims: uid === "anon" ? {} : { email: `${uid}@test.com`, email_verified: true } }; } },
      tagflow: { apiKey: "free-key", fetchImpl: fetcher, rateLimitWaitsMs: [] },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("pays for DeepSeek from the grant on first use, with no purchased credits", async () => {
    expect((await start()).status).toBe(200);
    const response = await chat();
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const wallet = await (await call("/ai/wallet")).json() as { balanceMicros: number; promo: { spotsLeft: number; claim: { spentMicros: number; availableMicros: number } } };
    expect(wallet.balanceMicros).toBe(0);
    expect(wallet.promo.spotsLeft).toBe(299);
    expect(wallet.promo.claim.spentMicros).toBeGreaterThan(0);
    expect(wallet.promo.claim.availableMicros).toBe(150_000 - wallet.promo.claim.spentMicros);
  });

  it("never pays for a model the promotion does not cover", async () => {
    await start();
    expect((await chat("opus")).status).toBe(402);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("is claimed only by verified accounts, and only while places last", async () => {
    await start(1);
    expect(await (await call("/ai/promo/model", {})).json()).toMatchObject({ result: "granted" });
    expect(await (await call("/ai/promo/model", {})).json()).toMatchObject({ result: "already" });
    uid = "v";
    const full = await call("/ai/promo/model", {});
    expect(full.status).toBe(410);
    expect((await chat()).status).toBe(402);
    uid = "anon";
    expect((await call("/ai/promo/model", {})).status).toBe(403);
  });

  it("falls back to purchased credits once the grant is spent, and survives a settings save", async () => {
    await start();
    const saved = parseTagflowConfig((await store.getTagflowConfig())!.config);
    expect(saved?.modelPromo?.perUserMicros).toBe(150_000);
    const admin = await call("/admin/ai-plans/model-promo", undefined, "admin");
    expect(await admin.json()).toMatchObject({ active: true, claims: 0 });
    for (let index = 0; index < 400; index++) {
      const response = await chat();
      if (response.status !== 200) { const body = await response.text(); expect(`${response.status} ${index} ${body}`).toMatch(/^402/); break; }
      await response.text();
    }
    const wallet = await (await call("/ai/wallet")).json() as { promo: { claim: { availableMicros: number; spentMicros: number } } };
    expect(wallet.promo.claim.availableMicros).toBe(0);
    expect(wallet.promo.claim.spentMicros).toBeLessThanOrEqual(150_000);
    expect(await (await call("/admin/ai-plans/model-promo", { stop: true }, "admin")).json()).toMatchObject({ active: false });
    clock += 1_000;
    expect(await (await call("/ai/promo/model")).json()).toEqual({ promo: null });
  });
});
