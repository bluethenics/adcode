import { describe, expect, it, vi } from "vitest";
import { KEEP_STALE_MS, withEdgeCache, type EdgeCacheStore } from "../src/lib/edgeCache";

/** Cloudflare's cache, as far as `withEdgeCache` uses it: keyed on the request URL. */
function memoryCache(): EdgeCacheStore & { size(): number } {
  const kept = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][] }>();
  return {
    async match(key) {
      const hit = kept.get(key.url);
      return hit === undefined ? undefined : new Response(hit.body, { status: hit.status, headers: hit.headers });
    },
    async put(key, response) {
      kept.set(key.url, { body: await response.arrayBuffer(), status: response.status, headers: [...response.headers] });
    },
    size: () => kept.size,
  };
}

const ORIGIN = "https://adcode.bluethenics.com";

describe("public API reads at the edge", () => {
  const setup = () => {
    let now = 1_000_000;
    const tasks: Promise<unknown>[] = [];
    const cache = memoryCache();
    let answer: () => Response = () => new Response(JSON.stringify({ models: ["a"] }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    const api = vi.fn(async () => answer());
    const deps = { cache, waitUntil: (task: Promise<unknown>) => { tasks.push(task); }, now: () => now };
    const get = async (path: string, headers: Record<string, string> = {}) => {
      const response = await withEdgeCache(new Request(`${ORIGIN}${path}`, { headers }), api, deps);
      await Promise.all(tasks);
      return response;
    };
    return { cache, api, get, tick: (ms: number) => { now += ms; }, fail: (next: () => Response) => { answer = next; } };
  };

  it("asks the database once a minute for the AI model list, however many people ask", async () => {
    const { api, get, tick } = setup();
    const first = await get("/v1/ai/tagflow/config");
    expect(first.headers.get("x-adcode-edge-cache")).toBe("MISS");
    for (let i = 0; i < 50; i++) expect((await get("/v1/ai/tagflow/config")).headers.get("x-adcode-edge-cache")).toBe("HIT");
    expect(api).toHaveBeenCalledTimes(1);
    expect(await (await get("/v1/ai/tagflow/config")).json()).toEqual({ models: ["a"] });
    tick(60_001);
    await get("/v1/ai/tagflow/config");
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("answers with the last good copy when the database cannot answer", async () => {
    const { get, tick, fail } = setup();
    await get("/v1/status");
    tick(10 * 60_000);
    fail(() => new Response("{}", { status: 503 }));
    const stale = await get("/v1/status");
    expect(stale.status).toBe(200);
    expect(stale.headers.get("x-adcode-edge-cache")).toBe("STALE");
    expect(await stale.json()).toEqual({ models: ["a"] });
    fail(() => { throw new Error("database unreachable"); });
    expect((await get("/v1/status")).status).toBe(200);
    tick(KEEP_STALE_MS);
    expect((await get("/v1/status")).status).toBe(503);
  });

  it("never caches a signed-in request, a write, or a route that is not public", async () => {
    const { cache, api, get } = setup();
    await get("/v1/ai/tagflow/config", { authorization: "Bearer user" });
    await get("/v1/ai/tagflow/usage");
    await get("/v1/balance");
    await withEdgeCache(new Request(`${ORIGIN}/v1/serve`, { method: "POST", body: "{}" }), api, { cache, waitUntil: () => undefined, now: () => 0 });
    expect(cache.size()).toBe(0);
    expect(api).toHaveBeenCalledTimes(4);
  });

  it("does not let a made-up query string reach the database, but keeps the ones a route reads", async () => {
    const { api, get } = setup();
    await get("/v1/stats?x=1");
    await get("/v1/stats?x=2&y=3");
    expect(api).toHaveBeenCalledTimes(1);
    await get("/v1/status?days=30");
    await get("/v1/status?days=30&junk=1");
    await get("/v1/status?days=7");
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("keeps one origin's CORS answer away from another origin", async () => {
    const { api, get, fail } = setup();
    fail(() => new Response("{}", { status: 200, headers: { "access-control-allow-origin": "https://web.bluethenics.com", vary: "Origin" } }));
    const site = await get("/v1/stats", { origin: "https://web.bluethenics.com" });
    const app = await get("/v1/stats");
    expect(api).toHaveBeenCalledTimes(2);
    expect(site.headers.get("vary")).toBe("Origin");
    expect(app.headers.get("x-adcode-edge-cache")).toBe("MISS");
  });

  it("does not stand a stale copy in for a real 404", async () => {
    const { get, tick, fail } = setup();
    await get("/v1/posts/hello");
    tick(301_000);
    fail(() => new Response("{}", { status: 404 }));
    expect((await get("/v1/posts/hello")).status).toBe(404);
  });

  it("passes straight through where there is no cache", async () => {
    const api = vi.fn(async () => new Response("ok"));
    const response = await withEdgeCache(new Request(`${ORIGIN}/v1/stats`), api, { cache: null, waitUntil: () => undefined, now: () => 0 });
    expect(await response.text()).toBe("ok");
  });
});
