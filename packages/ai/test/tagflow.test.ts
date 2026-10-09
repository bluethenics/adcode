import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUNDLED_CATALOGUE,
  TAGFLOW_PROVIDER_ID,
  mergeCatalogue,
  providerIn,
  recommendedModel,
  transportFor,
  usableCatalogue,
  withProviderModels,
} from "../src/catalogue.ts";
import { DEFAULT_TAGFLOW_CLIENT_SETTINGS, EMPTY_OVERRIDES, parseOverrides } from "../src/catalogueOverrides.ts";
import { createOpenAiCompatibleProvider } from "../src/providers/openaiCompatible.ts";
import { RequestScheduler } from "../src/requestScheduler.ts";
import { createAgent } from "../src/agent.ts";
import type { CatalogueProvider } from "../src/catalogueTypes.ts";
import type { Provider, ProviderEvent, ProviderRequest, ToolRunner } from "../src/types.ts";

/**
 * Tag Flow AI in the AI layer: a provider every install has, a client that signs each
 * request with the account's token instead of a key, and - asked for "like Claude" - a wait
 * at the usage limit that continues the same turn when the window resets.
 */

const request: ProviderRequest = {
  model: "tagflow-code-27b",
  system: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxTokens: 64,
};

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const sse = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );

const limited = (resetsAt: number, autoContinue = true) =>
  new Response(
    JSON.stringify({ error: { message: "You've used this window's Tag Flow AI requests.", type: "usage_limit", code: "tagflow_usage_limit", resets_at: resetsAt, auto_continue: autoContinue } }),
    { status: 429, headers: { "retry-after": "60" } },
  );

describe("the bundled catalogue", () => {
  it("has Tag Flow AI, reachable, free, and starting on its code model", () => {
    const tagflow = providerIn(BUNDLED_CATALOGUE, TAGFLOW_PROVIDER_ID);
    expect(tagflow?.name).toBe("Tag Flow AI");
    expect(tagflow?.models[0]).toMatchObject({ id: "tagflow-code-27b", toolCall: true, inputCostMicrosPerMillion: 0, outputCostMicrosPerMillion: 0 });
    expect(transportFor(TAGFLOW_PROVIDER_ID)).toBe("openai-compatible");
    expect(recommendedModel(BUNDLED_CATALOGUE, TAGFLOW_PROVIDER_ID)).toBe("tagflow-code-27b");
    expect(usableCatalogue(BUNDLED_CATALOGUE).some((one) => one.id === TAGFLOW_PROVIDER_ID)).toBe(true);
  });

  it("keeps Tag Flow when the live models.dev list does not mention it", () => {
    const live: CatalogueProvider[] = [{ id: "openai", name: "OpenAI", env: [], doc: null, models: [{ id: "gpt-x", name: "GPT X", toolCall: true, reasoning: false, inputCostMicrosPerMillion: null, outputCostMicrosPerMillion: null, cacheReadCostMicrosPerMillion: null, cacheWriteCostMicrosPerMillion: null, contextWindow: null }] }];
    expect(providerIn(mergeCatalogue(BUNDLED_CATALOGUE, live), TAGFLOW_PROVIDER_ID)).toBeDefined();
  });

  it("takes Tag Flow's live model list, keeping what it knows about a model it already had", () => {
    const next = withProviderModels(BUNDLED_CATALOGUE, TAGFLOW_PROVIDER_ID, [
      { id: "tagflow-code-27b", name: "Tag Flow Code 27B" },
      { id: "tagflow-chat-8b", name: "Tag Flow Chat 8B" },
    ]);
    const models = providerIn(next, TAGFLOW_PROVIDER_ID)?.models ?? [];
    expect(models.map((one) => one.id)).toEqual(["tagflow-code-27b", "tagflow-chat-8b"]);
    expect(models[0]?.contextWindow).toBe(providerIn(BUNDLED_CATALOGUE, TAGFLOW_PROVIDER_ID)?.models[0]?.contextWindow);
    expect(models[1]).toMatchObject({ toolCall: true, inputCostMicrosPerMillion: 0, outputCostMicrosPerMillion: 0 });
  });

  it("leaves the list alone when the live answer is empty", () => {
    expect(withProviderModels(BUNDLED_CATALOGUE, TAGFLOW_PROVIDER_ID, [])).toEqual([...BUNDLED_CATALOGUE]);
  });
});

describe("the admin panel's Tag Flow settings, as the app reads them", () => {
  it("are on, continuing automatically, with Tag Flow's privacy link, when nothing was saved", () => {
    expect(EMPTY_OVERRIDES.tagflow).toEqual(DEFAULT_TAGFLOW_CLIENT_SETTINGS);
    expect(parseOverrides({}).tagflow).toEqual({ enabled: true, autoContinue: true, privacyUrl: "https://tagflow-ai.com/legal/privacy", termsUrl: null });
  });

  it("follow what the panel saved", () => {
    const parsed = parseOverrides({ tagflow: { enabled: false, requestLimit: 5, windowHours: 2, autoContinue: false, privacyUrl: "https://tf.test/p", termsUrl: "https://tf.test/t" } });
    expect(parsed.tagflow).toEqual({ enabled: false, autoContinue: false, privacyUrl: "https://tf.test/p", termsUrl: "https://tf.test/t" });
  });

  it("ignore links that are not https and switches that are not booleans", () => {
    const parsed = parseOverrides({ tagflow: { enabled: "no", privacyUrl: "javascript:alert(1)", termsUrl: "http://tf.test/t" } });
    expect(parsed.tagflow).toEqual(DEFAULT_TAGFLOW_CLIENT_SETTINGS);
  });
});

describe("the client, through the relay", () => {
  it("signs each request with a fresh token from the getter", async () => {
    const seen: (string | null)[] = [];
    let token = 0;
    const provider = createOpenAiCompatibleProvider({
      id: TAGFLOW_PROVIDER_ID,
      displayName: "Tag Flow AI",
      baseUrl: "https://adcode.test/v1/ai/tagflow",
      apiKey: async () => `token-${String(++token)}`,
      models: ["tagflow-code-27b"],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("authorization"));
        return sse("ok");
      }) as typeof fetch,
    });
    await collect(provider.stream(request, new AbortController().signal));
    await collect(provider.stream(request, new AbortController().signal));
    expect(seen).toEqual(["Bearer token-1", "Bearer token-2"]);
  });

  it("sends no effort field Tag Flow has not promised to accept", async () => {
    let body: Record<string, unknown> = {};
    const provider = createOpenAiCompatibleProvider({
      id: TAGFLOW_PROVIDER_ID,
      displayName: "Tag Flow AI",
      baseUrl: "https://adcode.test/v1/ai/tagflow",
      apiKey: "t",
      models: ["tagflow-code-27b"],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sse("ok");
      }) as typeof fetch,
    });
    await collect(provider.stream({ ...request, effort: "high" }, new AbortController().signal));
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("reads the relay's usage limit off a 429", async () => {
    const provider = createOpenAiCompatibleProvider({
      id: TAGFLOW_PROVIDER_ID,
      displayName: "Tag Flow AI",
      baseUrl: "https://adcode.test/v1/ai/tagflow",
      apiKey: "t",
      models: ["tagflow-code-27b"],
      fetchImpl: (async () => limited(1_234_567, false)) as unknown as typeof fetch,
    });
    const error = await collect(provider.stream(request, new AbortController().signal)).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 429, usageLimit: { resetsAt: 1_234_567, autoContinue: false } });
    expect(String((error as Error).message)).toMatch(/Tag Flow AI/);
  });
});

/** A provider that answers each request from the list, then plain text. */
function scripted(answers: (() => ProviderEvent[] | Error)[]): Provider & { calls: number } {
  const provider = {
    id: TAGFLOW_PROVIDER_ID,
    displayName: "Tag Flow AI",
    models: ["tagflow-code-27b"],
    calls: 0,
    async *stream(): AsyncIterable<ProviderEvent> {
      const answer = answers[provider.calls++]?.() ?? [{ kind: "text" as const, text: "done" }, { kind: "stop" as const, reason: "end-turn" as const }];
      if (answer instanceof Error) throw answer;
      for (const event of answer) yield event;
    },
  };
  return provider;
}

const usageLimit = (resetsAt: number, autoContinue = true) =>
  Object.assign(new Error("Tag Flow AI returned HTTP 429: limit"), { status: 429, retryAfter: "60", usageLimit: { resetsAt, autoContinue } });

describe("waiting out the usage limit", () => {
  afterEach(() => vi.useRealTimers());

  it("says when it resets, waits for it, and continues the same request", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const inner = scripted([() => usageLimit(1_000_000 + 3_600_000)]);
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    const events: ProviderEvent[] = [];
    const run = (async () => {
      for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: "limit-wait", provider: "Tag Flow AI", resetsAt: 1_000_000 + 3_600_000 }]);
    await vi.advanceTimersByTimeAsync(3_599_000);
    expect(inner.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(inner.calls).toBe(2);
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("waits again when the window it was promised is still closed", async () => {
    vi.useFakeTimers({ now: 0 });
    const inner = scripted([() => usageLimit(1_000), () => usageLimit(5_000)]);
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    const events: ProviderEvent[] = [];
    const run = (async () => {
      for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    })();
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    expect(events.filter((one) => one.kind === "limit-wait").map((one) => (one as { resetsAt: number }).resetsAt)).toEqual([1_000, 5_000]);
    expect(inner.calls).toBe(3);
  });

  it("gives up after five waits in a row rather than looping forever", async () => {
    vi.useFakeTimers({ now: 0 });
    const inner = scripted(Array.from({ length: 10 }, (_, index) => () => usageLimit((index + 1) * 1_000)));
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    const run = collect(provider.stream(request, new AbortController().signal)).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await run).toMatchObject({ usageLimit: { resetsAt: 6_000 } });
    expect(inner.calls).toBe(6);
  });

  it("stops at once when the person presses Stop during the wait", async () => {
    vi.useFakeTimers({ now: 0 });
    const inner = scripted([() => usageLimit(3_600_000)]);
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    const controller = new AbortController();
    const run = collect(provider.stream(request, controller.signal)).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await run).toMatchObject({ name: "AbortError" });
    expect(inner.calls).toBe(1);
  });

  it("does not replay a reply that had already started", async () => {
    vi.useFakeTimers({ now: 0 });
    let call = 0;
    const inner: Provider = {
      id: TAGFLOW_PROVIDER_ID,
      displayName: "Tag Flow AI",
      models: [],
      async *stream() {
        call += 1;
        yield { kind: "text", text: "half" };
        throw usageLimit(1_000);
      },
    };
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    const run = collect(provider.stream(request, new AbortController().signal)).catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await run).toMatchObject({ status: 429 });
    expect(call).toBe(1);
  });

  it("ends the turn with the reset time when the admin panel turned auto-continue off", async () => {
    vi.useFakeTimers({ now: 0 });
    const inner = scripted([() => usageLimit(3_600_000, false)]);
    const provider = new RequestScheduler().wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000, { waitForUsageLimit: true });
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toMatchObject({ usageLimit: { autoContinue: false } });
    expect(inner.calls).toBe(1);
  });

  it("fails at once, and holds nothing else up, for a caller that cannot wait", async () => {
    vi.useFakeTimers({ now: 0 });
    const scheduler = new RequestScheduler();
    const inner = scripted([() => usageLimit(3_600_000)]);
    const provider = scheduler.wrap(inner, TAGFLOW_PROVIDER_ID, () => 6000);
    await expect(collect(provider.stream(request, new AbortController().signal))).rejects.toMatchObject({ status: 429 });
    expect(inner.calls).toBe(1);
    // An inline completion a moment later is not queued behind an hour's cooldown.
    expect(scheduler.status(TAGFLOW_PROVIDER_ID).cooldownUntil).toBeLessThanOrEqual(Date.now());
  });
});

describe("the agent", () => {
  it("passes the wait through so the chat can show it", async () => {
    const provider = scripted([() => [{ kind: "limit-wait", provider: "Tag Flow AI", resetsAt: 42 }, { kind: "text", text: "back" }, { kind: "stop", reason: "end-turn" }]]);
    const runner: ToolRunner = { run: async () => ({ content: "", isError: false }) };
    const agent = createAgent({ provider, model: "tagflow-code-27b", tools: [], runner });
    const events = [];
    for await (const event of agent.send("hi")) events.push(event);
    expect(events).toContainEqual({ kind: "limit-wait", provider: "Tag Flow AI", resetsAt: 42 });
  });
});
