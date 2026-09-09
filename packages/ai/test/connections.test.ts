import { describe, it, expect, vi, afterEach } from "vitest";
import { parseConnections } from "../src/connections.ts";
import { RequestScheduler } from "../src/requestScheduler.ts";
describe("connections", () => {
  it("validates endpoints and drops secrets", () => {
    const item = {
      id: "connection-a",
      name: "NIM",
      baseUrl: "https://integrate.api.nvidia.com/v1/",
      model: "org/model",
      rpm: 30,
      apiKey: "secret",
    };
    expect(parseConnections(JSON.stringify([item]))[0]).toEqual({
      ...item,
      baseUrl: item.baseUrl.slice(0, -1),
      apiKey: undefined,
    });
    expect(() =>
      parseConnections(
        JSON.stringify([{ ...item, baseUrl: "http://remote.test/v1" }]),
      ),
    ).toThrow();
    expect(() => parseConnections(JSON.stringify([item, item]))).toThrow();
  });
});
describe("shared request scheduler", () => {
  afterEach(() => vi.useRealTimers());
  it("paces consumers and removes cancelled waits", async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler();
    const a = new AbortController();
    await scheduler.acquire("a", 30, a.signal);
    const cancelled = new AbortController();
    const pending = scheduler
      .acquire("a", 30, cancelled.signal)
      .catch((e) => e.name);
    cancelled.abort();
    expect(await pending).toBe("AbortError");
    let started = false;
    const next = scheduler.acquire("a", 30, a.signal).then(() => {
      started = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(started).toBe(true);
  });
  it("honors cooldown across consumers", async () => {
    vi.useFakeTimers();
    const scheduler = new RequestScheduler();
    scheduler.cooldown("a", 5000);
    let started = false;
    const next = scheduler
      .acquire("a", 60, new AbortController().signal)
      .then(() => {
        started = true;
      });
    await vi.advanceTimersByTimeAsync(4999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await next;
  });
});
import type { Provider, ProviderRequest } from "../src/types.ts";
const request: ProviderRequest = {
  model: "m",
  system: "",
  messages: [],
  tools: [],
  maxTokens: 1,
};
async function consume(
  provider: Provider,
  signal = new AbortController().signal,
) {
  for await (const _event of provider.stream(request, signal)) {
    /* drain */
  }
}
describe("rate-limit recovery", () => {
  afterEach(() => vi.useRealTimers());
  it.each(["2", "Thu, 01 Jan 1970 00:00:02 GMT"])(
    "honors Retry-After %s before retry",
    async (retryAfter) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      let attempts = 0;
      const provider: Provider = {
        id: "a",
        displayName: "A",
        models: [],
        async *stream() {
          attempts++;
          if (attempts === 1) throw { status: 429, retryAfter };
          yield { kind: "stop", reason: "end-turn" };
        },
      };
      const result = consume(
        new RequestScheduler().wrap(provider, "a", () => 6000),
      );
      await vi.advanceTimersByTimeAsync(1999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(attempts).toBe(2);
    },
  );
  it("bounds attempts and never retries emitted output", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const provider: Provider = {
      id: "a",
      displayName: "A",
      models: [],
      async *stream() {
        attempts++;
        throw { status: 429, retryAfter: "0" };
      },
    };
    const result = consume(
      new RequestScheduler().wrap(provider, "a", () => 6000),
    ).catch((e) => e.status);
    await vi.runAllTimersAsync();
    expect(await result).toBe(429);
    expect(attempts).toBe(3);
    attempts = 0;
    const emitted: Provider = {
      ...provider,
      async *stream() {
        attempts++;
        yield { kind: "text", text: "partial" };
        throw { status: 429 };
      },
    };
    expect(
      await consume(
        new RequestScheduler().wrap(emitted, "a", () => 6000),
      ).catch((e) => e.status),
    ).toBe(429);
    expect(attempts).toBe(1);
  });
  it("cancels a cooldown without issuing another request", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const controller = new AbortController();
    const provider: Provider = {
      id: "a",
      displayName: "A",
      models: [],
      async *stream() {
        attempts++;
        throw { status: 429, retryAfter: "60" };
      },
    };
    const scheduler = new RequestScheduler();
    const result = consume(
      scheduler.wrap(provider, "a", () => 30),
      controller.signal,
    ).catch((e) => e.name);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect(await result).toBe("AbortError");
    expect(attempts).toBe(1);
    expect(scheduler.status("a").queued).toBe(0);
  });
});
