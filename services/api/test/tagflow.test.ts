import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG, parseTagflowConfig } from "../src/tagflowConfig.ts";
import type { TagflowConfig } from "../src/tagflowTypes.ts";
import type { TokenVerifier } from "../src/auth.ts";
import { createApiServer } from "../src/server.ts";
import { INCLUDED_PROVIDERS } from "../src/includedProviders.ts";
import { createTagflowMemoryStore } from "../src/tagflowMemoryStore.ts";
import { DEFAULT_CREDIT_PLAN } from "../src/credits.ts";
import { DEFAULT_PAID_CONFIG } from "../src/paidTokens.ts";

const config: TagflowConfig = { ...DEFAULT_TAGFLOW_CONFIG, enabled: true, baseUrl: "https://api.tagflow-ai.com/v1", defaultModel: "coder", models: [{ id: "coder", name: "Coder", contextWindow: 65_536, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2 }] };
const body = { model: "coder", messages: [{ role: "user", content: "Hello" }], max_tokens: 100, stream: true };
const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user" || token === "other") return { uid: token, claims: { email: `${token}@adcode.test`, email_verified: true } };
    if (token === "anonymous") return { uid: "anonymous", claims: {} };
    return null;
  },
};
const event = (raw: unknown): string => `data: ${JSON.stringify(raw)}\n\n`;
const reply = (): Response => new Response(event({ choices: [{ delta: { content: "Hello" }, finish_reason: "stop" }] }) + event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

describe("included Tagflow AI", () => {
  it("defaults to unlimited request counts while retaining token and cost reservations", async () => {
    const memory = createTagflowMemoryStore();
    const limits = DEFAULT_TAGFLOW_CONFIG.limits;
    for (let index = 0; index < 1002; index++) {
      expect(await memory.reserveTagflow({ id: `unlimited-${index}`, uid: "busy", day: "2026-10-11", minute: 1, tokens: 1, costMicros: 0, limits })).toBe("ok");
    }
    expect(await memory.getTagflowUsage("busy", "2026-10-11")).toMatchObject({ requests: 1002, reservedTokens: 1002 });
    expect(await memory.reserveTagflow({ id: "token-overflow", uid: "busy", day: "2026-10-11", minute: 1, tokens: 1_000_000, costMicros: 0, limits })).toBe("daily-limit");
    expect(await memory.reserveTagflow({ id: "cost-overflow", uid: "busy", day: "2026-10-11", minute: 1, tokens: 1, costMicros: 1_000_001, limits })).toBe("daily-limit");
  });
  let store: ReturnType<typeof createMemoryStore>;
  let now: number;
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;
  let handle: ReturnType<typeof createFetchHandler>;
  let pending: Response[];
  const call = async (path: string, token?: string, data?: unknown, method = data === undefined ? "GET" : "POST") => {
    const response = await handle(new Request(`https://adcode.test/v1${path}`, { method, headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }));
    pending.push(response); return response;
  };
  const chat = (token = "user", data: unknown = body) => call("/ai/tagflow/chat/completions", token, data);
  const usage = async (uid = "user") => store.getTagflowUsage(uid, new Date(now).toISOString().slice(0, 10));
  const save = async (next: TagflowConfig) => store.putTagflowConfig({ config: next, updatedAt: now, updatedBy: "admin-1" });

  beforeEach(async () => {
    store = createMemoryStore(); now = Date.parse("2026-10-10T12:00:00Z"); pending = [];
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    await save(structuredClone(config));
    upstream = vi.fn<typeof fetch>().mockImplementation(async () => reply());
    handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0] } });
  });
  afterEach(async () => { for (const response of pending) if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined); vi.unstubAllEnvs(); });

  it("uses the 256k window beyond the old 128k ceiling and reserves space for replies",async () => {
    await save({ ...config,maxInputTokens:262144,models:[{ ...config.models[0]!,contextWindow:262144 }] });
    const published = await (await call("/ai/tagflow/config")).json() as { models:{ contextWindow:number }[] };
    expect(published.models[0]!.contextWindow).toBe(262144);
    const accepted = await chat("user",{ ...body,messages:[{ role:"user",content:"x".repeat(450000) }] });
    expect(accepted.status).toBe(200); await accepted.text(); expect(upstream).toHaveBeenCalledTimes(1);
    const rejected = await chat("user",{ ...body,max_tokens:4096,messages:[{ role:"user",content:"x".repeat(780000) }] });
    expect(rejected.status).toBe(413); expect(await rejected.json()).toMatchObject({ error:{ code:"context-length" } });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("continues past historical session allowances while accounting for every request", async () => {
    await save({ ...config, credits: { sessionCredits: 0, weeklyCredits: 0, sessionHours: 5 } });
    for (let i = 0; i < 3; i++) { const response = await chat(); expect(response.status).toBe(200); await response.text(); }
    expect(await (await call("/ai/tagflow/usage", "user")).json()).toMatchObject({ unlimited: true, today: { requests: 3, inputTokens: 36, outputTokens: 9 }, credits: { session: { used: 0.045, held: 0 } } });
  });

  it("continues after a previous weekly allowance was exhausted", async () => {
    await save({ ...config, credits: { sessionCredits: 100, weeklyCredits: 1, sessionHours: 5 } });
    expect(await store.reserveTagflow({ id: "week", uid: "user", day: "2026-10-10", minute: 0, tokens: 1, costMicros: 0, limits: config.limits, credits: { millicredits: 1000, sessionLimit: 100_000, weeklyLimit: 1000, sessionMs: 5 * 3_600_000, now } })).toBe("ok");
    await store.settleTagflow("week", { inputTokens: 1, outputTokens: 0, costMicros: 0, estimated: false, failed: false, millicredits: 1000 });
    now += 6 * 3_600_000;
    const response = await chat(); expect(response.status).toBe(200); await response.text();
    expect(await (await call("/ai/tagflow/usage", "user")).json()).toMatchObject({ unlimited: true, credits: { weekly: { used: 1.015 } } });
  });

  describe("paid tokens in the published config", () => {
    const heabsy = { id: "glm", name: "GLM", provider: "custom-heabsy" as const, contextWindow: 65_536, maxOutput: 4096, inputPrice: 0, outputPrice: 0 };
    const withHeabsy = (paid: unknown) => ({ ...config, providers: [{ id: "custom-heabsy", name: "Heabsy", baseUrl: "https://api.heabsy.com/v1" }], models: [config.models[0]!, heabsy], paid }) as unknown as TagflowConfig;

    it("marks the paid provider's models and publishes the packs", async () => {
      vi.stubEnv("INCLUDED_AI_CUSTOM_HEABSY_API_KEY", "k");
      await save(withHeabsy({ ...DEFAULT_PAID_CONFIG, enabled: true }));
      const published = await (await call("/ai/tagflow/config")).json() as { paid: { enabled: boolean; packs: unknown[] }; models: { id: string; paid: boolean }[] };
      expect(published.paid).toMatchObject({ enabled: true, freeWeeklyTokens: 10_000_000 });
      expect(published.paid.packs).toHaveLength(3);
      expect(published.models.map(({ id, paid }) => [id, paid])).toEqual([["coder", false], ["glm", true]]);
    });

    it("rejects a config whose paid section is malformed", () => {
      expect(parseTagflowConfig(withHeabsy({ ...DEFAULT_PAID_CONFIG, freeWeeklyTokens: -1 }))).toBeNull();
      expect(parseTagflowConfig(withHeabsy(DEFAULT_PAID_CONFIG))?.paid).toEqual(DEFAULT_PAID_CONFIG);
      expect(parseTagflowConfig(config)?.paid).toBeUndefined();
    });
  });

  describe("paid Heabsy tokens", () => {
    const glm = { id: "glm", name: "GLM", provider: "custom-heabsy" as const, contextWindow: 65_536, maxOutput: 4096, inputPrice: 0, outputPrice: 0 };
    const mimo = { ...glm, id: "mimo", name: "Mimo" };
    const paidConfig = (enabled = true, freeWeeklyTokens = 1000) => ({ ...config, providers: [{ id: "custom-heabsy", name: "Heabsy", baseUrl: "https://api.heabsy.com/v1" }],
      models: [config.models[0]!, glm, mimo], paid: { ...DEFAULT_PAID_CONFIG, enabled, freeWeeklyTokens } }) as unknown as TagflowConfig;
    const ask = (model: string) => chat("user", { ...body, model });
    beforeEach(() => { vi.stubEnv("INCLUDED_AI_CUSTOM_HEABSY_API_KEY", "k"); });

    it("refuses a paid model once the free week is spent, in words an old desktop understands", async () => {
      await save(paidConfig(true, 1));
      const first = await ask("glm"); expect(first.status).toBe(200); await first.text();
      const refused = await ask("glm");
      expect(refused.status).toBe(429);
      const { error } = await refused.json() as { error: { code: string; limit: string; retryable: boolean; resetsAt: number; buyUrl: string; message: string } };
      expect(error).toMatchObject({ code: "daily-limit", limit: "paid", retryable: true, buyUrl: "https://adcode.bluethenics.com/ai-tokens" });
      expect(error.resetsAt).toBeGreaterThan(now);
      expect(error.message).toContain("https://adcode.bluethenics.com/ai-tokens");
      expect(error.message).toContain("Tagflow");
      expect(refused.headers.get("retry-after")).not.toBeNull();
    });

    it("never charges Tagflow, and charges nothing while the switch is off", async () => {
      await save(paidConfig(true, 1));
      for (let i = 0; i < 3; i++) { const r = await ask("coder"); expect(r.status).toBe(200); await r.text(); }
      await save(paidConfig(false, 1));
      for (let i = 0; i < 3; i++) { const r = await ask("glm"); expect(r.status).toBe(200); await r.text(); }
      expect((await store.getPaidTokens("user")).free).toBeNull();
    });

    it("uses purchased tokens after the free week", async () => {
      await save(paidConfig(true, 1));
      await store.grantTokens("user", 1_000_000, "admin-1", "test", now);
      for (let i = 0; i < 3; i++) { const r = await ask("glm"); expect(r.status).toBe(200); await r.text(); }
      expect((await store.getPaidTokens("user")).balance.purchased).toBeLessThan(1_000_000);
    });

    it("reports the free week and purchased tokens on the usage endpoint", async () => {
      await save(paidConfig(true, 10_000_000));
      await store.grantTokens("user", 50_000_000, "admin-1", "test", now);
      const r = await ask("glm"); await r.text();
      const view = await (await call("/ai/tagflow/usage", "user")).json() as { tokens: { enabled: boolean; free: { limit: number; used: number }; purchased: number } };
      expect(view.tokens).toMatchObject({ enabled: true, free: { limit: 10_000_000, used: 15 }, purchased: 50_000_000, paidModels: ["glm", "mimo"] });
    });

    it("falls back from a busy paid model only to a free one", async () => {
      // Mimo comes first in the administrator's order, so only the paid rule keeps it out.
      const ordered = paidConfig(true, 10_000_000);
      await save({ ...ordered, models: [glm, mimo, config.models[0]!] } as TagflowConfig);
      upstream.mockImplementation(async (_url, init) => JSON.parse(String(init?.body)).model === "glm" ? new Response("busy", { status: 429 }) : reply());
      const r = await ask("glm");
      expect(r.status).toBe(200);
      expect(r.headers.get("x-adcode-fallback-model")).toBe("coder");
      await r.text();
    });

    it("charges no purchased tokens when a busy paid model falls back to Tagflow", async () => {
      await save(paidConfig(true, 1));
      await store.grantTokens("user", 1_000_000, "admin-1", "test", now);
      upstream.mockImplementation(async (_url, init) => JSON.parse(String(init?.body)).model === "glm" ? new Response("busy", { status: 429 }) : reply());
      const r = await ask("glm"); expect(r.headers.get("x-adcode-fallback-model")).toBe("coder"); await r.text();
      expect(await store.getPaidTokens("user")).toMatchObject({ balance: { purchased: 1_000_000, reserved: 0 }, free: { usedTokens: 0, reservedTokens: 0 } });
    });

    it("reads no paid-token rows while paid tokens are off", async () => {
      await save(paidConfig(false, 10_000_000));
      const reads = vi.spyOn(store, "getPaidTokens");
      const view = await (await call("/ai/tagflow/usage", "user")).json() as { tokens: { enabled: boolean; purchased: number } };
      expect(view.tokens).toMatchObject({ enabled: false, purchased: 0 });
      expect(reads).not.toHaveBeenCalled();
    });

    it("gives a subscriber the plan's weekly allowance", async () => {
      await save(paidConfig(true, 1));
      await store.applySubscriptionEvent({ webhookId: "w", type: "active", subscriptionId: "s", uid: "user", plan: "pro", customerId: "c", status: "active", periodEnd: now + 30 * 86_400_000, cancelAtPeriodEnd: false, now });
      for (let i = 0; i < 3; i++) { const r = await ask("glm"); expect(r.status).toBe(200); await r.text(); }
      const view = await (await call("/ai/tagflow/usage", "user")).json() as { tokens: { free: { limit: number }; plan: { id: string } | null } };
      expect(view.tokens.free.limit).toBe(150_000_000);
      expect(view.tokens.plan).toMatchObject({ id: "pro" });
    });

    it("falls back to the free allowance once a plan has ended", async () => {
      await save(paidConfig(true, 1));
      await store.applySubscriptionEvent({ webhookId: "w", type: "active", subscriptionId: "s", uid: "user", plan: "monthly", customerId: "c", status: "active", periodEnd: now + 1000, cancelAtPeriodEnd: false, now });
      now += 2000;
      const first = await ask("glm"); expect(first.status).toBe(200); await first.text();
      expect((await ask("glm")).status).toBe(429);
    });

    it("publishes the plans", async () => {
      await save(paidConfig(true, 1));
      const published = await (await call("/ai/tagflow/config")).json() as { paid: { plans: { id: string; priceCents: number; weeklyTokens: number }[] } };
      expect(published.paid.plans.map((p) => [p.id, p.priceCents, p.weeklyTokens])).toEqual([["weekly", 300, 60_000_000], ["monthly", 900, 60_000_000], ["pro", 1900, 150_000_000]]);
    });

    it("names plans as well as tokens when the free week is spent", async () => {
      await save(paidConfig(true, 1));
      const first = await ask("glm"); await first.text();
      const { error } = await (await ask("glm")).json() as { error: { message: string } };
      expect(error.message).toContain("Buy tokens or a plan");
    });

    it("settles requests held before the switch was turned off", async () => {
      await save(paidConfig(true, 10_000_000));
      const r = await ask("glm");
      await save(paidConfig(false, 10_000_000));
      await r.text();
      expect((await store.getPaidTokens("user")).free).toMatchObject({ reservedTokens: 0, usedTokens: 15 });
    });
  });

  describe("what stands between a message and the model", () => {
    it("asks the provider while the request's telemetry write is still outstanding", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const put = store.putModelRequest.bind(store);
      vi.spyOn(store, "putModelRequest").mockImplementation(async (record) => { await held; await put(record); });
      const response = await chat();
      expect(response.status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(1);
      release(); await response.text();
    });

    it("never lets a slow early write overwrite the finished record", async () => {
      const writes: string[] = [];
      const put = store.putModelRequest.bind(store);
      vi.spyOn(store, "putModelRequest").mockImplementation(async (record) => {
        if (record.outcome === "pending") await new Promise((resolve) => setTimeout(resolve, 30));
        writes.push(record.outcome); await put(record);
      });
      const response = await chat(); await response.text();
      await vi.waitFor(() => expect(writes).toEqual(["pending", "success"]));
      const id = response.headers.get("x-adcode-request-id")!;
      expect(await store.getModelRequest(id)).toMatchObject({ outcome: "success", providerStartedAt: expect.any(Number) });
    });

    it("does not read the day's usage to answer a chat request", async () => {
      const reads = vi.spyOn(store, "getTagflowUsage");
      const response = await chat(); expect(response.status).toBe(200); await response.text();
      expect(reads).not.toHaveBeenCalled();
    });
  });

  it("retries a provider's burst rate limit and answers when it clears", async () => {
    upstream.mockImplementationOnce(async () => new Response("slow down", { status: 429 }));
    const response = await chat();
    expect(response.status).toBe(200); await response.text();
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("identifies an upstream rate limit without charging daily usage or exposing its response", async () => {
    upstream.mockImplementation(async () => new Response("server-secret private upstream limit", { status: 429 }));
    const response = await chat();
    expect(response.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(response.headers.get("retry-after")).toBe("60");
    const text = await response.text();
    expect(text).toContain("upstream-rate-limit");
    expect(text).not.toContain("server-secret");
    expect(await usage()).toMatchObject({ requests: 0, inputTokens: 0, outputTokens: 0, reservedTokens: 0 });
  });

  describe("how long an answer may stream", () => {
    const encoder = new TextEncoder();
    /** An upstream that sends `pieces`, `gapMs` apart, and stops dead (but stays open) after `stallAfter` of them. */
    const drip = (pieces: number, gapMs: number, stallAfter = Infinity) => async (_url: unknown, init?: RequestInit): Promise<Response> => {
      const signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          signal?.addEventListener("abort", () => { try { controller.error(new Error("aborted")); } catch { /* already closed */ } }, { once: true });
          for (let i = 0; i < pieces; i++) {
            if (i >= stallAfter) return;
            await new Promise((resolve) => setTimeout(resolve, gapMs));
            if (signal?.aborted) return;
            controller.enqueue(encoder.encode(event({ choices: [{ delta: { content: `part${i} ` }, finish_reason: null }] })));
          }
          controller.enqueue(encoder.encode(event({ choices: [{ delta: {}, finish_reason: "stop" }] }) + event({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 30 } }) + "data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };

    it("lets a long answer keep streaming past the time allowed to start", async () => {
      handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0], timeouts: { firstMs: 150, idleMs: 120, maxMs: 5000 } } });
      upstream.mockImplementation(drip(10, 40));
      const response = await chat();
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("part0"); expect(text).toContain("part9"); expect(text).toContain("[DONE]");
    });

    it("cuts an answer that goes silent mid-stream", async () => {
      handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0], timeouts: { firstMs: 150, idleMs: 120, maxMs: 5000 } } });
      upstream.mockImplementation(drip(10, 30, 3));
      const response = await chat();
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"code":"stream-interrupted"');
      expect(await usage()).toMatchObject({ requests: 1, reservedTokens: 0, estimatedRequests: 1 });
    });
  });

  describe("when the account's email is not verified yet", () => {
    let live: { email: string | null; emailVerified: boolean } | null;
    let sends: string[];
    const unverifying: TokenVerifier = {
      async verify(token) {
        if (token.startsWith("unverified")) return { uid: "stuck", claims: { email: "stuck@adcode.test", email_verified: false } };
        return verifier.verify(token);
      },
    };
    beforeEach(() => {
      live = { email: "stuck@adcode.test", emailVerified: false }; sends = [];
      handle = createFetchHandler({ store, verifier: unverifying, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0],
        identity: { async lookup() { return live; }, async sendVerification(idToken) { sends.push(idToken); return true; } } } });
    });

    it("emails a verification link once an hour and says where it went", async () => {
      const first = await chat("unverified-1");
      expect(first.status).toBe(403);
      expect(await first.json()).toMatchObject({ error: { code: "verify-account", message: expect.stringContaining("We sent a verification link to stuck@adcode.test") } });
      expect(sends).toEqual(["unverified-1"]);
      const again = await chat("unverified-2");
      expect((await again.json() as { error: { message: string } }).error.message).toContain("Open the verification link we emailed to stuck@adcode.test");
      expect(sends).toHaveLength(1);
      now += 3_600_001;
      await (await chat("unverified-3")).text();
      expect(sends).toHaveLength(2);
      expect(upstream).not.toHaveBeenCalled();
    });

    it("lets someone in the moment they open the link, and an older token does not lock them out again", async () => {
      expect((await chat("unverified-1")).status).toBe(403);
      live = { email: "stuck@adcode.test", emailVerified: true };
      const opened = await chat("unverified-2");
      expect(opened.status).toBe(200); await opened.text();
      expect(await store.getUser("stuck")).toMatchObject({ emailVerified: true });
      live = null;
      const stale = await chat("unverified-3");
      expect(stale.status).toBe(200); await stale.text();
      expect(await store.getUser("stuck")).toMatchObject({ emailVerified: true });
    });

    it("says so when Firebase would not send the link, instead of pointing at an email that never went", async () => {
      handle = createFetchHandler({ store, verifier: unverifying, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0],
        identity: { async lookup() { return live; }, async sendVerification() { return false; } } } });
      const response = await chat("unverified-1");
      expect((await response.json() as { error: { message: string } }).error.message).toContain("could not be sent just now");
    });

    it("asks an account with no email to sign in, and sends nothing", async () => {
      live = { email: null, emailVerified: false };
      const response = await chat("anonymous");
      expect(response.status).toBe(403);
      expect((await response.json() as { error: { message: string } }).error.message).toContain("Sign in to use included AI");
      expect(sends).toHaveLength(0);
    });
  });

  describe("when the chosen model is overloaded", () => {
    const backup = { id: "backup", name: "Backup", contextWindow: 65_536, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2, creditRate: 0.5 };
    const pricey = { id: "pricey", name: "Pricey", contextWindow: 65_536, maxOutput: 4096, inputPrice: 0.1, outputPrice: 0.2, creditRate: 2 };
    const refuseCoder = (): void => {
      upstream.mockImplementation(async (_url, init) => JSON.parse(String(init?.body)).model === "coder" ? new Response("busy", { status: 429 }) : reply());
    };
    const calledWith = (model: string): number => upstream.mock.calls.filter(([, init]) => JSON.parse(String(init?.body)).model === model).length;
    /** The last state written for each request id, in the order the requests began. */
    const recorded = (spy: { mock: { calls: unknown[][] } }) => {
      const byId = new Map<string, { modelId: string; outcome: string; errorCode: string | null }>();
      for (const [record] of spy.mock.calls as [{ id: string; modelId: string; outcome: string; errorCode: string | null }][]) byId.set(record.id, record);
      return [...byId.values()];
    };

    it("answers from a healthy included model, records both attempts honestly, and charges the lower rate", async () => {
      await save({ ...config, models: [{ ...config.models[0]!, creditRate: 1 }, backup] });
      refuseCoder();
      const writes = vi.spyOn(store, "putModelRequest");
      const response = await chat();
      expect(response.status).toBe(200);
      expect(response.headers.get("x-adcode-fallback-model")).toBe("backup");
      expect(await response.text()).toContain("Hello");
      expect(calledWith("coder")).toBe(1); expect(calledWith("backup")).toBe(1);
      expect(recorded(writes).map(({ modelId, outcome, errorCode }) => [modelId, outcome, errorCode])).toEqual([["coder", "provider_error", "upstream-rate-limit"], ["backup", "success", null]]);
      const credits = (await (await call("/ai/tagflow/usage", "user")).json() as { credits: { session: { used: number } } }).credits.session.used;
      expect(credits).toBeGreaterThan(0); expect(credits).toBeLessThan(0.015);
    });

    it("cools a model that keeps refusing, so later requests skip it instead of waiting to be refused", async () => {
      await save({ ...config, models: [config.models[0]!, backup] });
      refuseCoder();
      for (let i = 0; i < 3; i++) { const response = await chat(); expect(response.status).toBe(200); await response.text(); }
      expect(calledWith("coder")).toBe(3);
      const writes = vi.spyOn(store, "putModelRequest");
      const cooled = await chat();
      expect(cooled.status).toBe(200); expect(cooled.headers.get("x-adcode-fallback-model")).toBe("backup"); await cooled.text();
      expect(calledWith("coder")).toBe(3);
      expect(recorded(writes)[0]).toMatchObject({ modelId: "coder", outcome: "rejected", errorCode: "model-busy" });
      now += 61_000;
      upstream.mockImplementation(async () => reply());
      const recovered = await chat(); expect(recovered.status).toBe(200); await recovered.text();
      expect(recovered.headers.get("x-adcode-fallback-model")).toBeNull();
      expect(calledWith("coder")).toBe(4);
    });

    it("moves on at the first refusal instead of retrying the busy model", async () => {
      // A refusal from a saturated provider is slow: on 2026-10-21 each 429 took ~16 s, so two
      // retries kept people waiting ~48 s before the backup that answers in ~3 s.
      await save({ ...config, models: [config.models[0]!, backup] });
      upstream.mockImplementationOnce(async () => new Response("busy", { status: 429 }));
      const response = await chat();
      expect(response.status).toBe(200); expect(response.headers.get("x-adcode-fallback-model")).toBe("backup"); await response.text();
      expect(calledWith("coder")).toBe(1); expect(calledWith("backup")).toBe(1);
    });

    it("still retries a busy model when nothing else can answer", async () => {
      await save({ ...config, models: [config.models[0]!, pricey] });
      upstream.mockImplementationOnce(async () => new Response("busy", { status: 429 }));
      const response = await chat();
      expect(response.status).toBe(200); expect(response.headers.get("x-adcode-fallback-model")).toBeNull(); await response.text();
      expect(calledWith("coder")).toBe(2); expect(calledWith("pricey")).toBe(0);
    });

    it("never moves a person to a model that costs more credits", async () => {
      await save({ ...config, models: [config.models[0]!, pricey] });
      refuseCoder();
      const response = await chat();
      expect(response.status).toBe(429); await response.text();
      expect(calledWith("pricey")).toBe(0);
    });

    it("keeps the plain refusal when fallback is switched off", async () => {
      handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, rateLimitWaitsMs: [0, 0], fallback: false } });
      await save({ ...config, models: [config.models[0]!, backup] });
      refuseCoder();
      const response = await chat();
      expect(response.status).toBe(429); await response.text();
      expect(calledWith("backup")).toBe(0);
    });
  });

  it("publishes models without exposing the credential, upstream address or prices", async () => {
    const response = await call("/ai/tagflow/config");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).toContain('"available":true'); expect(text).toContain("coder");
    expect(text).not.toContain("server-secret"); expect(text).not.toContain("api.tagflow"); expect(text).not.toContain("Price");
  });
  it("accepts the existing Cloudflare secret name and prefers the canonical name", async () => {
    vi.stubEnv("TAGFLOW_API_KEY", undefined);
    vi.stubEnv("tagflow-api", "existing-secret");
    handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { fetchImpl: upstream } });
    expect(await (await call("/admin/tagflow", "admin")).json()).toMatchObject({ keyConfigured: true });
    await (await chat()).text();
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer existing-secret");
    vi.stubEnv("TAGFLOW_API_KEY", "canonical-secret");
    await (await chat()).text();
    expect(new Headers(upstream.mock.calls[1]?.[1]?.headers).get("authorization")).toBe("Bearer canonical-secret");
  });
  it.each(INCLUDED_PROVIDERS.filter((provider) => provider.id !== "tagflow"))("routes $name models only to their approved endpoint with their own secret", async (provider) => {
    vi.stubEnv(provider.secretName, `${provider.id}-private-key`);
    const model = { ...config.models[0]!, id: "public-alias", upstreamModel: "provider-model-id", provider: provider.id };
    await save({ ...config, baseUrl: "", defaultModel: model.id, models: [model] });
    expect((await call("/admin/tagflow", "admin", (await store.getTagflowConfig())!.config)).status).toBe(200);
    const response = await chat("user", { ...body, model: model.id }); expect(response.status).toBe(200); await response.text();
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(`${provider.baseUrl}/chat/completions`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${provider.id}-private-key`);
    expect(init?.redirect).toBe("manual");
    const sent = JSON.parse(init!.body as string);
    expect(sent.model).toBe("provider-model-id");
    expect(sent[provider.id === "openai" ? "max_completion_tokens" : "max_tokens"]).toBe(100);
    expect(sent[provider.id === "openai" ? "max_tokens" : "max_completion_tokens"]).toBeUndefined();
    const published = await (await call("/ai/tagflow/config")).text();
    expect(published).toContain(provider.name); expect(published).not.toContain(provider.baseUrl);
    expect(published).not.toContain("private-key"); expect(published).not.toContain("provider-model-id");
    expect(await usage()).toMatchObject({ requests: 1, inputTokens: 12, outputTokens: 3 });
  });
  const custom = { id: "custom-together-ai" as const, name: "Together AI", baseUrl: "https://api.together.xyz/v1" };
  const customModel = { ...config.models[0]!, id: "free-llama", upstreamModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", provider: custom.id };
  it("routes a registered custom provider's models to its address with its own secret", async () => {
    vi.stubEnv("INCLUDED_AI_CUSTOM_TOGETHER_AI_API_KEY", "together-private-key");
    const next = { ...config, baseUrl: "", defaultModel: customModel.id, models: [customModel], providers: [custom] };
    const saved = await call("/admin/tagflow", "admin", next);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ keyConfigured: true, config: { providers: [custom] }, connections: expect.arrayContaining([expect.objectContaining({ id: custom.id, secretName: "INCLUDED_AI_CUSTOM_TOGETHER_AI_API_KEY", configured: true, custom: true })]) });
    const response = await chat("user", { ...body, model: customModel.id }); expect(response.status).toBe(200); await response.text();
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe("https://api.together.xyz/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer together-private-key");
    expect(init?.redirect).toBe("manual");
    const sent = JSON.parse(init!.body as string);
    expect(sent.model).toBe(customModel.upstreamModel); expect(sent.max_tokens).toBe(100); expect(sent.max_completion_tokens).toBeUndefined();
    const published = await (await call("/ai/tagflow/config")).text();
    expect(JSON.parse(published)).toMatchObject({ models: [{ id: customModel.id, providerName: "Together AI" }] });
    expect(published).not.toContain(custom.baseUrl); expect(published).not.toContain("private-key"); expect(published).not.toContain(customModel.upstreamModel);
    expect(await usage()).toMatchObject({ requests: 1, inputTokens: 12, outputTokens: 3 });
  });
  it.each([["x-api-key", "x-api-key"], ["api-key", "api-key"]] as const)("sends a custom provider's key in its %s header", async (authentication, header) => {
    vi.stubEnv("INCLUDED_AI_CUSTOM_TOGETHER_AI_API_KEY", "together-private-key");
    await save({ ...config, baseUrl: "", defaultModel: customModel.id, models: [customModel], providers: [{ ...custom, authentication, outputTokenField: "max_completion_tokens" }] });
    await (await chat("user", { ...body, model: customModel.id })).text();
    const headers = new Headers(upstream.mock.calls[0]?.[1]?.headers);
    expect(headers.get(header)).toBe("together-private-key"); expect(headers.get("authorization")).toBeNull();
    const sent = JSON.parse(upstream.mock.calls[0]![1]!.body as string);
    expect(sent.max_completion_tokens).toBe(100); expect(sent.max_tokens).toBeUndefined();
  });
  it("lets an administrator save a provider's key as its own Cloudflare secret, and nothing else", async () => {
    const written: [string, string | null][] = [];
    const workerSecrets = { configured: () => true, put: async (name: string, value: string) => { written.push([name, value]); return { ok: true } as const; }, remove: async (name: string) => { written.push([name, null]); return { ok: true } as const; } };
    handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, workerSecrets } });
    await save({ ...config, providers: [custom] });
    expect(await (await call("/admin/tagflow", "admin")).json()).toMatchObject({ keysManageable: true });
    expect((await call("/admin/tagflow/keys", "user", { provider: custom.id, key: "sk-hb-test-value" })).status).toBe(403);
    expect((await call("/admin/tagflow/keys", "admin", { provider: "custom-unsaved", key: "sk-hb-test-value" })).status).toBe(404);
    for (const key of ["short", "has a space in it", 42, "x".repeat(4097)]) expect((await call("/admin/tagflow/keys", "admin", { provider: custom.id, key })).status).toBe(400);
    expect((await call("/admin/tagflow/keys", "admin", { provider: custom.id, key: "sk-test-value", secretName: "SUPABASE_SERVICE_ROLE_KEY" })).status).toBe(400);
    expect(written).toEqual([]);
    const saved = await call("/admin/tagflow/keys", "admin", { provider: custom.id, key: "  sk-hb-test-value  " });
    expect(saved.status).toBe(200);
    const text = await saved.text(); expect(text).not.toContain("sk-hb-test-value");
    expect((await call("/admin/tagflow/keys", "admin", { provider: "openai", key: null })).status).toBe(200);
    expect(written).toEqual([["INCLUDED_AI_CUSTOM_TOGETHER_AI_API_KEY", "sk-hb-test-value"], ["INCLUDED_AI_OPENAI_API_KEY", null]]);
  });
  it("explains how to set up key saving when its token is missing", async () => {
    const workerSecrets = { configured: () => false, put: async () => ({ ok: false, reason: "not-configured", message: "Key saving is not set up yet." } as const), remove: async () => ({ ok: true } as const) };
    handle = createFetchHandler({ store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream, workerSecrets } });
    expect(await (await call("/admin/tagflow", "admin")).json()).toMatchObject({ keysManageable: false });
    const response = await call("/admin/tagflow/keys", "admin", { provider: "tagflow", key: "sk-test-value" });
    expect(response.status).toBe(409); expect(await response.text()).toContain("not set up");
  });
  it("combines a partner's old separate pool into the one credit balance, at a rate that keeps its value", async () => {
    vi.stubEnv("INCLUDED_AI_CUSTOM_TOGETHER_AI_API_KEY", "together-private-key");
    const pooled = { ...custom, limits: { ...config.limits, dailyTokens: 5_000_000 } };
    await save({ ...config, models: [...config.models, customModel, { ...customModel, id: "priced", creditRate: 3 }], providers: [pooled] });
    expect((await call("/admin/tagflow", "admin", (await store.getTagflowConfig())!.config)).status).toBe(200);
    const published = await (await call("/ai/tagflow/config")).json() as { models: { id: string; creditRate: number }[]; credits: unknown };
    // 1M main tokens a day against a 5M partner pool: the partner costs 0.2 credits per 1,000 tokens.
    expect(published.models.map((model) => [model.id, model.creditRate])).toEqual([["coder", 1], ["free-llama", 0.2], ["priced", 3]]);
    expect(published.credits).toEqual(DEFAULT_CREDIT_PLAN);
    const response = await chat("user", { ...body, model: customModel.id }); expect(response.status).toBe(200); await response.text();
    // Charged to the account itself, never to a separate pool any more.
    expect(await usage()).toMatchObject({ requests: 1, inputTokens: 12, outputTokens: 3 });
    expect(await store.getTagflowUsage("user#custom-together-ai", new Date(now).toISOString().slice(0, 10))).toBeNull();
    const main = await chat(); expect(main.status).toBe(200); await main.text();
    const view = await (await call("/ai/tagflow/usage", "user")).json() as { credits: { session: { used: number }; rates: Record<string, number> }; pools?: unknown };
    expect(view.credits.session.used).toBe(0.018);
    expect(view.credits.rates).toEqual({ coder: 1, "free-llama": 0.2, priced: 3 });
    expect(view.pools).toBeUndefined();
    expect(parseTagflowConfig({ ...config, models: [...config.models, customModel], providers: [{ ...custom, limits: { dailyTokens: -1 } }] })).toBeNull();
    expect(parseTagflowConfig({ ...config, models: [{ ...config.models[0]!, creditRate: -1 }] })).toBeNull();
    expect(parseTagflowConfig({ ...config, credits: { sessionCredits: 1, weeklyCredits: 1, sessionHours: 0 } })).toBeNull();
  });
  it("hides a custom provider's models until its own secret exists, and never reads another secret", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "database-secret");
    const sneaky = { ...custom, id: "custom-supabase-service-role" as const };
    await save({ ...config, models: [...config.models, { ...customModel, provider: sneaky.id }], providers: [sneaky] });
    expect(await (await call("/ai/tagflow/config")).json()).toMatchObject({ models: [{ id: "coder" }] });
    expect((await chat("user", { ...body, model: customModel.id })).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    const admin = await (await call("/admin/tagflow", "admin")).text();
    expect(admin).toContain("INCLUDED_AI_CUSTOM_SUPABASE_SERVICE_ROLE_API_KEY"); expect(admin).not.toContain("database-secret");
  });
  it("accepts only public HTTPS custom providers that models can name", () => {
    const valid = { ...config, models: [...config.models, customModel], providers: [custom] };
    expect(parseTagflowConfig(valid)?.providers).toEqual([custom]);
    expect(parseTagflowConfig({ ...valid, providers: [{ ...custom, baseUrl: "https://api.together.xyz/v1/" }] })?.providers?.[0]?.baseUrl).toBe(custom.baseUrl);
    expect(parseTagflowConfig({ ...config, providers: [] })).not.toHaveProperty("providers");
    for (const baseUrl of ["http://api.together.xyz/v1", "https://api.together.xyz:8443/v1", "https://key:secret@api.together.xyz/v1", "https://api.together.xyz/v1?key=1", "https://api.together.xyz/v1#x",
      "https://127.0.0.1/v1", "https://10.0.0.8/v1", "https://[::1]/v1", "https://localhost/v1", "https://metadata.internal/v1", "https://printer.local/v1", "https://intranet/v1", "not a url"]) {
      expect(parseTagflowConfig({ ...valid, providers: [{ ...custom, baseUrl }] }), baseUrl).toBeNull();
    }
    for (const provider of [{ ...custom, id: "openai" }, { ...custom, id: "custom-" }, { ...custom, id: "custom-Upper" }, { ...custom, id: "custom-a_b" }, { ...custom, name: " " },
      { ...custom, secretName: "SUPABASE_SERVICE_ROLE_KEY" }, { ...custom, authentication: "query" }, { ...custom, outputTokenField: "n" }]) {
      expect(parseTagflowConfig({ ...valid, providers: [provider] }), JSON.stringify(provider)).toBeNull();
    }
    expect(parseTagflowConfig({ ...valid, providers: [custom, custom] })).toBeNull();
    expect(parseTagflowConfig({ ...valid, providers: [] })).toBeNull();
    const many = (count: number) => [custom, ...Array.from({ length: count - 1 }, (_, n) => ({ ...custom, id: `custom-p${n}` }))];
    expect(parseTagflowConfig({ ...valid, providers: many(20) })?.providers).toHaveLength(20);
    expect(parseTagflowConfig({ ...valid, providers: many(21) })).toBeNull();
  });
  it("hides disconnected and disabled models, refuses them before charging, and allows usage across providers", async () => {
    vi.stubEnv("INCLUDED_AI_OPENAI_API_KEY", "openai-private-key");
    vi.stubEnv("INCLUDED_AI_GROQ_API_KEY", undefined);
    const openai = { ...config.models[0]!, id: "other-coder", provider: "openai" as const };
    await save({ ...config, models: [...config.models, openai, { ...openai, id: "missing-key", provider: "groq" }, { ...openai, id: "hidden", enabled: false }], limits: { ...config.limits, dailyRequests: 1 } });
    expect(await (await call("/ai/tagflow/config")).json()).toMatchObject({ models: [{ id: "coder" }, { id: "other-coder" }] });
    expect((await chat("user", { ...body, model: "missing-key" })).status).toBe(503);
    expect((await chat("user", { ...body, model: "hidden" })).status).toBe(400);
    expect(await usage()).toBeNull(); expect(upstream).not.toHaveBeenCalled();
    await (await chat()).text();
    expect((await chat("user", { ...body, model: "other-coder" })).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it("requires the selected default's secret and never accepts arbitrary connections or secret names", async () => {
    vi.stubEnv("INCLUDED_AI_OPENAI_API_KEY", undefined);
    const other = { ...config.models[0]!, id: "other-coder", provider: "openai" as const };
    const next = { ...config, models: [...config.models, other], defaultModel: other.id };
    const missing = await call("/admin/tagflow", "admin", next);
    expect(missing.status).toBe(409); expect(await missing.text()).toContain("INCLUDED_AI_OPENAI_API_KEY");
    for (const extra of [{ provider: "attacker" }, { baseUrl: "https://attacker.test" }, { secretName: "SUPABASE_SERVICE_ROLE_KEY" }, { upstreamModel: "bad id" }, { enabled: "yes" }]) {
      expect(parseTagflowConfig({ ...config, models: [{ ...config.models[0], ...extra }] })).toBeNull();
    }
    expect(parseTagflowConfig({ ...config, models: [{ ...config.models[0], enabled: false }] })).toBeNull();
  });
  it("falls back to a connected model when the default's key is removed without disclosing secrets in admin", async () => {
    vi.stubEnv("INCLUDED_AI_OPENAI_API_KEY", undefined);
    await save({ ...config, models: [...config.models, { ...config.models[0]!, id: "other", provider: "openai" }], defaultModel: "other" });
    expect(await (await call("/ai/tagflow/config")).json()).toMatchObject({ defaultModel: "coder", models: [{ id: "coder" }] });
    const text = await (await call("/admin/tagflow", "admin")).text();
    expect(text).toContain('"configured":false'); expect(text).toContain("INCLUDED_AI_OPENAI_API_KEY"); expect(text).not.toContain("server-secret");
  });
  it("requires authentication, verifies account ownership and blocks banned users", async () => {
    expect((await chat("")).status).toBe(401);
    expect((await chat("anonymous")).status).toBe(403);
    await store.putUser({ uid: "user", status: "banned", createdAt: now });
    expect((await chat()).status).toBe(403); expect(upstream).not.toHaveBeenCalled();
  });
  it("trims pasted server keys and never logs a key-bearing network exception", async () => {
    vi.stubEnv("INCLUDED_AI_OPENAI_API_KEY", "  private-key\n");
    const model = { ...config.models[0]!, id: "other", provider: "openai" as const };
    await save({ ...config, models: [model], defaultModel: model.id });
    await (await chat("user", { ...body, model: model.id })).text();
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer private-key");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      upstream.mockRejectedValueOnce(new TypeError("Invalid header: private-key"));
      const response = await chat("user", { ...body, model: model.id });
      expect(await response.text()).not.toContain("private-key");
      expect(warning).toHaveBeenCalledWith("Included AI connection failed", { provider: "openai", reason: "key-format" });
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private-key");
    } finally { warning.mockRestore(); }
  });
  it("allows only admins to change configuration or another person's allowance", async () => {
    expect((await call("/admin/tagflow", "user", config)).status).toBe(403);
    expect((await call("/admin/tagflow/users/other", "user", { blocked: true, limits: null })).status).toBe(403);
    expect((await call("/admin/tagflow", "admin", config)).status).toBe(200);
    expect((await store.listAudit()).some((row) => row.action === "save-tagflow-config")).toBe(true);
  });
  it("restricts relay addresses to the authorized provider and refuses redirects", async () => {
    for (const baseUrl of ["https://attacker.test/v1", "https://tagflow-ai.com.attacker.test/v1", "https://attacker-tagflow-ai.com/v1", "http://api.tagflow-ai.com/v1", "https://key@api.tagflow-ai.com/v1", "https://api.tagflow-ai.com/v1?key=secret"]) expect(parseTagflowConfig({ ...config, baseUrl })).toBeNull();
    await (await chat()).text();
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.tagflow-ai.com/v1/chat/completions");
    expect(upstream.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer server-secret");
  });
  it("counts real streamed tokens and settles exactly once", async () => {
    expect((await chat()).status).toBe(200);
    // Read another request to completion: outstanding budgets are separate from real counts.
    const response = await chat(); await response.text();
    const row = await usage();
    expect(row).toMatchObject({ requests: 2, inputTokens: 12, outputTokens: 3, costMicros: 2, estimatedRequests: 0 });
    expect(row!.reservedTokens).toBeGreaterThan(0);
    const reservation = { id: "test", uid: "other", day: "2026-10-10", minute: 1, tokens: 100, costMicros: 100, limits: config.limits };
    await store.reserveTagflow(reservation);
    const settlement = { inputTokens: 10, outputTokens: 5, costMicros: 10, estimated: false, failed: false };
    await store.settleTagflow("test", settlement); await store.settleTagflow("test", settlement);
    expect(await usage("other")).toMatchObject({ requests: 1, inputTokens: 10, outputTokens: 5, reservedTokens: 0 });
  });
  it("refuses an upstream redirect without forwarding a credential or charging a completed request", async () => {
    upstream.mockImplementation(async () => new Response(null, { status: 307, headers: { location: "https://attacker.test/steal" } }));
    expect((await chat()).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]?.[0]).toBe("https://api.tagflow-ai.com/v1/chat/completions");
    expect(upstream.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(await usage()).toMatchObject({ requests: 0, reservedTokens: 0, costMicros: 0 });
  });
  it("delivers the first chunk before the provider finishes", async () => {
    let finish: (() => void) | undefined;
    upstream.mockImplementation(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: "first" } }] }))); finish = () => { controller.enqueue(new TextEncoder().encode(event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1 } }) + "data: [DONE]\n\n")); controller.close(); }; } }), { headers: { "content-type": "text/event-stream" } }));
    const response = await chat(); const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("first");
    expect((await usage())!.reservedTokens).toBeGreaterThan(0);
    finish!(); while (!(await reader.read()).done) { /* Drain the stream. */ }
    expect(await usage()).toMatchObject({ inputTokens: 10, outputTokens: 1, reservedTokens: 0 });
  });
  it("accounts for concurrent requests without a per-user request ceiling", async () => {
    await save({ ...config, limits: { ...config.limits, dailyRequests: 1 } });
    const responses = await Promise.all(Array.from({ length: 10 }, () => chat()));
    expect(responses.every(response => response.status === 200)).toBe(true);
    await Promise.all(responses.map(response => response.text()));
    expect(upstream).toHaveBeenCalledTimes(10);
    expect(await usage()).toMatchObject({ requests: 10, inputTokens: 120, outputTokens: 30, reservedTokens: 0, reservedCostMicros: 0 });
  });

  it("ignores legacy token, credit, spending, and request quotas for included AI", async () => {
    await save({ ...config, credits: { sessionCredits: 0, weeklyCredits: 0, sessionHours: 5 }, limits: { dailyTokens: 0, dailyRequests: 0, dailyCostMicros: 0, requestsPerMinute: 0 } });
    for (let i = 0; i < 3; i++) { const response = await chat(); expect(response.status).toBe(200); await response.text(); }
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(await usage()).toMatchObject({ requests: 3, reservedTokens: 0 });
  });

  it("applies individual overrides and blocking, with null restoring current defaults", async () => {
    await call("/ai/tagflow/usage", "user");
    const path = "/admin/tagflow/users/user";
    expect((await call(path, "admin", { blocked: true, limits: null })).status).toBe(200);
    expect((await chat()).status).toBe(403);
    await call(path, "admin", { blocked: false, limits: { ...config.limits, dailyRequests: 0 } }); expect((await chat()).status).toBe(200);
    await call(path, "admin", { blocked: false, limits: null }); expect((await chat()).status).toBe(200);
    expect((await call("/admin/tagflow/users/unknown", "admin", { blocked: false, limits: null })).status).toBe(404);
  });
  it("settles concurrent reservations past old credit limits exactly once", async () => {
    await save({ ...config, credits: { sessionCredits: 1, weeklyCredits: 1, sessionHours: 5 }, models: [{ ...config.models[0]!, creditRate: 10 }] });
    const responses = await Promise.all(Array.from({ length: 10 }, () => chat()));
    expect(responses.every(response => response.ok)).toBe(true);
    await Promise.all(responses.map(response => response.text()));
    expect(upstream).toHaveBeenCalledTimes(10);
    expect(await usage()).toMatchObject({ inputTokens: 120, outputTokens: 30, reservedTokens: 0 });
    expect(await (await call("/ai/tagflow/usage", "user")).json()).toMatchObject({ unlimited: true, credits: { session: { used: 1.5, held: 0 } } });
  });

  it("keeps daily accounting separate and never trusts a caller-provided uid", async () => {
    await save({ ...config, limits: { ...config.limits, dailyRequests: 1 } }); await (await chat()).text(); expect((await chat()).status).toBe(200);
    now = Date.parse("2026-10-11T00:00:00Z"); expect((await chat()).status).toBe(200);
    expect((await chat("user", { ...body, uid: "other" })).status).toBe(400);
    const view = await (await call("/ai/tagflow/usage?uid=other", "user")).json() as { usage: { uid: string }; resetsAt: number };
    // The session window that opened with the first request after midnight.
    expect(view.usage.uid).toBe("user"); expect(view.resetsAt).toBe(Date.parse("2026-10-11T05:00:00Z"));
  });
  it("charges the reserved maximum on cancellation so repeat cancellations cannot bypass limits", async () => {
    upstream.mockImplementation(async()=>new Response(new ReadableStream({ start(controller){ controller.enqueue(new TextEncoder().encode(event({choices:[{delta:{content:"partial"}}]}))); } }),{headers:{"content-type":"text/event-stream"}}));
    const response = await chat(); await response.body!.cancel();
    expect(await usage()).toMatchObject({ requests: 1, outputTokens: 100, reservedTokens: 0, estimatedRequests: 1 });
  });
  it("settles once when a cancelled reader and its pending pull fail together", async () => {
    const original = store.settleTagflow.bind(store);
    const settle = vi.spyOn(store, "settleTagflow").mockImplementation(async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return original(...args);
    });
    upstream.mockImplementation(async (_url, init) => new Response(new ReadableStream<Uint8Array>({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true }); },
    }), { headers: { "content-type": "text/event-stream" } }));
    const response = await chat();
    await response.body!.cancel();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(await usage()).toMatchObject({ requests: 1, outputTokens: 100, reservedTokens: 0 });
  });
  it("estimates missing counts and keeps upstream errors out of client responses", async () => {
    upstream.mockImplementation(async () => new Response(event({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    await (await chat()).text(); expect((await usage())!.estimatedRequests).toBe(1);
    upstream.mockImplementation(async () => new Response("server-secret private provider error", { status: 401 }));
    const response = await chat(); expect(response.status).toBe(502); expect(await response.text()).not.toContain("server-secret");
    expect((await usage())!.requests).toBe(1);
  });
  it("rejects disallowed models, images, fan-out, output aliases and invalid limits", async () => {
    for (const data of [{ ...body, model: "unoffered" }, { ...body, n: 10 }, { ...body, max_completion_tokens: 1 }, { ...body, max_tokens: -1 }, { ...body, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://private.test" } }] }] }]) expect((await chat("user", data)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
    expect(parseTagflowConfig({ ...config, models: [...config.models, ...config.models] })).toBeNull();
    expect(parseTagflowConfig({ ...config, limits: { ...config.limits, dailyRequests: -1 } })).toBeNull();
    expect(parseTagflowConfig({ ...config, apiKey: "hidden" })).toBeNull();
  });
  it("allows a 26k estimated input with 73k left instead of reserving every byte as a token", async () => {
    const day = new Date(now).toISOString().slice(0,10);
    await store.reserveTagflow({ id:"earlier",uid:"user",day,minute:1,tokens:926827,costMicros:0,limits:config.limits });
    await store.settleTagflow("earlier",{ inputTokens:919303,outputTokens:7524,costMicros:0,estimated:false,failed:false });
    const response = await chat("user", { ...body,max_tokens:4096,messages:[{ role:"user",content:"a".repeat(78000) }] });
    expect(response.status).toBe(200);
    const held=(await usage())!.reservedTokens;
    expect(held).toBeGreaterThan(26000); expect(held).toBeLessThan(31000);
    await response.text();
    expect(await usage()).toMatchObject({inputTokens:919315,outputTokens:7527,reservedTokens:0,estimatedRequests:0});
  });
  it("starts a large request while any credit is left and charges what it really used", async () => {
    await save({ ...config, credits:{ sessionCredits:2,weeklyCredits:100,sessionHours:5 } });
    const response=await chat("user",{ ...body,max_tokens:4096,messages:[{ role:"user",content:"a".repeat(78000) }] });
    expect(response.status).toBe(200);
    const held = (await (await call("/ai/tagflow/usage","user")).json() as { credits:{ session:{ held:number } } }).credits.session.held;
    expect(held).toBeGreaterThan(26); expect(held).toBeLessThan(31);
    await response.text();
    expect(await (await call("/ai/tagflow/usage","user")).json()).toMatchObject({ credits:{ session:{ used:0.015,held:0 } } });
  });
  it("keeps missing-usage estimates independent of how many streaming chunks carry the text", async () => {
    const output="abc".repeat(30);
    const withoutUsage=(pieces:string[])=>new Response(pieces.map(content=>event({choices:[{delta:{content}}]})).join("")+event({choices:[{delta:{},finish_reason:"stop"}]})+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}});
    upstream.mockImplementationOnce(async()=>withoutUsage([output]));
    await (await chat()).text();
    upstream.mockImplementationOnce(async()=>withoutUsage([...output]));
    await (await chat("other")).text();
    const first=await usage(); const second=await usage("other");
    expect(first).toMatchObject({outputTokens:30,estimatedRequests:1,reservedTokens:0});
    expect(second).toMatchObject({inputTokens:first!.inputTokens,outputTokens:30,estimatedRequests:1,reservedTokens:0});
    expect(first!.inputTokens).toBeLessThan(330);
  });
  it("uses final provider counts already received if the consumer cancels before the stream closes",async()=>{
    upstream.mockImplementation(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(event({choices:[{delta:{content:"ok"},finish_reason:"stop"}]})+event({choices:[],usage:{prompt_tokens:17,completion_tokens:2}})));}}),{headers:{"content-type":"text/event-stream"}}));
    const response=await chat(); const reader=response.body!.getReader();
    await reader.read(); await reader.cancel();
    expect(await usage()).toMatchObject({inputTokens:17,outputTokens:2,reservedTokens:0,estimatedRequests:0});
  });
  it("accepts Groq's provider usage and does not add cached or reasoning token details again",async()=>{
    upstream.mockImplementation(async()=>new Response(event({choices:[{delta:{content:"ok"},finish_reason:"stop"}],x_groq:{usage:{prompt_tokens:12,completion_tokens:3,prompt_tokens_details:{cached_tokens:8},completion_tokens_details:{reasoning_tokens:2}}}})+"data: [DONE]\n\n",{headers:{"content-type":"text/event-stream"}}));
    await (await chat()).text();
    expect(await usage()).toMatchObject({inputTokens:12,outputTokens:3,reservedTokens:0,estimatedRequests:0});
  });
  it("identifies actual context overflow without blaming image attachments or charging", async () => {
    await save({ ...config, maxInputTokens: 1000 });
    const response = await chat("user", { ...body, messages: [{ role: "user", content: "x".repeat(6000) }] });
    expect(response.status).toBe(413);
    const error = await response.json() as { error: { code: string; message: string } };
    expect(error.error.code).toBe("context-length");
    expect(error.error.message).toContain("Limit 1000");
    expect(error.error.message).not.toContain("Image");
    expect(upstream).not.toHaveBeenCalled();
    expect(await usage()).toBeNull();
  });
  it("accepts larger context and reserves reply space within the configured model window", async () => {
    await save({ ...config, models: [{ ...config.models[0]!, contextWindow: 131_072 }] });
    expect(await (await call("/ai/tagflow/config")).json()).toMatchObject({ models: [{ contextWindow: 131_072 }] });
    const larger = await chat("user", { ...body, messages: [{ role: "user", content: "text ".repeat(30_000) }] });
    expect(larger.status).toBe(200); await larger.text();
    const calls = upstream.mock.calls.length;
    const oversized = await chat("user", { ...body, max_tokens: 4096, messages: [{ role: "user", content: "x".repeat(390_000) }] });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "context-length" } });
    expect(upstream.mock.calls).toHaveLength(calls);
  });
  it("distinguishes unsupported images, unavailable models and invalid message history", async () => {
    const image = await chat("user", { ...body, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://private.test" } }] }] });
    expect(await image.json()).toMatchObject({ error: { code: "images-not-supported" } });
    const model = await chat("user", { ...body, model: "unoffered" });
    expect(await model.json()).toMatchObject({ error: { code: "model-unavailable" } });
    const history = await chat("user", { ...body, messages: [{ role: "assistant", content: 7 }] });
    expect(await history.json()).toMatchObject({ error: { code: "invalid-messages" } });
    expect(upstream).not.toHaveBeenCalled();
    expect(await usage()).toBeNull();
  });
  it("clamps output and asks the provider for stream usage", async () => {
    await (await chat("user", { ...body, max_tokens: 60_000 })).text();
    const sent = JSON.parse(upstream.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(sent["max_tokens"]).toBe(4096); expect(sent["stream_options"]).toEqual({ include_usage: true });
  });
  it("reads split UTF-8 events and suppresses split upstream error events", async () => {
    const split = (text: string): Response => {
      const data = new TextEncoder().encode(text);
      return new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
    };
    upstream.mockImplementation(async () => split(event({ choices: [{ delta: { content: "नमस्ते" }, finish_reason: "stop" }] }) + event({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 6 } }) + "data: [DONE]\n\n"));
    expect(await (await chat()).text()).toContain("नमस्ते"); expect((await usage())!.inputTokens).toBe(5);
    upstream.mockImplementation(async () => split(event({ error: { message: "server-secret" } })));
    const interrupted = await (await chat()).text();
    expect(interrupted).toContain('"code":"stream-interrupted"');
    expect(interrupted).not.toContain("server-secret");
    expect(await usage()).toMatchObject({ requests: 2, outputTokens: 106, reservedTokens: 0 });
  });
  it("supports non-stream replies and hides the feature when the server key is absent", async () => {
    upstream.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } }), { headers: { "content-type": "application/json" } }));
    expect((await chat("user", { ...body, stream: false })).status).toBe(200); expect(await usage()).toMatchObject({ inputTokens: 10, outputTokens: 2, reservedTokens: 0 });
    handle = createFetchHandler({ store, verifier, tagflow: { apiKey: "", fetchImpl: upstream } });
    expect(await (await call("/ai/tagflow/config")).json()).toMatchObject({ available: false, models: [] });
    expect((await call("/admin/tagflow", "admin", config)).status).toBe(409);
  });
  it("serves the same relay over the Node transport", async () => {
    const server = await createApiServer({ port: 0, store, verifier, clock: { now: () => now }, tagflow: { apiKey: "server-secret", fetchImpl: upstream } });
    try {
      const response = await fetch(`${server.url}/v1/ai/tagflow/chat/completions`, { method: "POST", headers: { authorization: "Bearer user", "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(200); expect(await response.text()).toContain("Hello"); expect((await usage())!.inputTokens).toBe(12);
    } finally { await server.close(); }
  });
});
