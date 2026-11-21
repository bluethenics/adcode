import { describe, expect, it, vi } from "vitest";
import { route, type RouterDeps } from "../src/router.ts";
import { accountApiAllowed } from "../src/accountApi.ts";
import type { Env } from "../src/env.ts";
const deps: RouterDeps = {
  verify: async (token) => token === "test-token" ? { uid: "test-user", email: null, exp: 9999999999 } : null,
  refuseSocket: () => new Response(null, { status: 401 }),
};
function setup() {
  const api = vi.fn(async (_request: Request) => Response.json({ availableMicros: "1234" }));
  const sandbox = vi.fn();
  const env = { PREVIEW_SUFFIX: ".web.example", ACCOUNT_API: { fetch: api }, USER: { getByName: sandbox } } as unknown as Env;
  return { api, sandbox, env };
}
const request = (path = "/balance", init: RequestInit = {}) => new Request(`https://web.example/v1${path}`, { ...init, headers: { authorization: "Bearer test-token", ...init.headers } });
describe("account inside Vibe", () => {
  it("streams included AI through the existing service without acquiring a sandbox", async () => {
    const { env, api, sandbox } = setup();
    let finish!: () => void;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
      finish = () => controller.close();
    } });
    api.mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/event-stream", "x-adcode-request-id": "request_1", "retry-after": "10" } }));
    const response = await route(request("/ai/tagflow/chat/completions", { method: "POST", body: JSON.stringify({ model: "included", messages: [] }), headers: { "content-type": "application/json", "x-adcode-ai-source": "chat", "x-adcode-platform": "forged" } }), env, deps);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-adcode-request-id")).toBe("request_1");
    expect(response.headers.get("retry-after")).toBe("10");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("Hello");
    finish(); await reader.cancel();
    expect(api.mock.calls[0]?.[0].headers.get("x-adcode-platform")).toBe("web");
    expect(api.mock.calls[0]?.[0].headers.get("x-adcode-ai-source")).toBe("chat");
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("forwards authenticated account reads without waking a sandbox or caching private data", async () => {
    const { env, api, sandbox } = setup();
    const response = await route(request("/ledger?limit=25&cursor=abc"), env, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(api.mock.calls[0]?.[0].url).toBe("https://adcode.bluethenics.com/v1/ledger?limit=25&cursor=abc");
    expect(api.mock.calls[0]?.[0].headers.get("authorization")).toBe("Bearer test-token");
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("serves only authenticated raster artwork through the first-party binding", async () => {
    const { env, api, sandbox } = setup();
    const incoming = (key: string, token = "test-token") => new Request(`https://web.example/api/ad-assets/${key}`, { headers: { authorization: `Bearer ${token}` } });
    api.mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    const artwork = await route(incoming("creative_123.png"), env, deps);
    expect(artwork.status).toBe(200);
    expect(artwork.headers.get("content-type")).toBe("image/png");
    expect(api.mock.calls[0]?.[0].url).toBe("https://adcode.bluethenics.com/assets/creative_123.png");
    expect(api.mock.calls[0]?.[0].headers.has("authorization")).toBe(false);
    expect((await route(incoming("creative_123.png", "expired"), env, deps)).status).toBe(401);
    expect((await route(incoming("nested/key.png"), env, deps)).status).toBe(404);
    expect(api).toHaveBeenCalledOnce();
    expect(sandbox).not.toHaveBeenCalled();
  });
  it("refuses scripted artwork and redirects rather than exposing them as first-party assets", async () => {
    const { env, api } = setup();
    const incoming = new Request("https://web.example/api/ad-assets/creative_123.png", { headers: { authorization: "Bearer test-token" } });
    api.mockResolvedValueOnce(new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
    expect((await route(incoming, env, deps)).status).toBe(404);
    api.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example/track" } }));
    expect((await route(incoming, env, deps)).status).toBe(404);
  });
  it("preserves writes and strips caller-controlled identity and cookies", async () => {
    const { env, api } = setup();
    const response = await route(request("/email-preferences", { method: "PATCH", body: JSON.stringify({ subscribed: false }), headers: { "content-type": "application/json", cookie: "private=1", "x-adcode-uid": "someone-else" } }), env, deps);
    expect(response.status).toBe(200);
    const forwarded = api.mock.calls[0]![0];
    expect(forwarded.method).toBe("PATCH");
    expect(await forwarded.json()).toEqual({ subscribed: false });
    expect(forwarded.headers.has("cookie")).toBe(false);
    expect(forwarded.headers.has("x-adcode-uid")).toBe(false);
    expect(forwarded.redirect).toBe("manual");
  });
  it("rejects expired and development tokens, and writes with no token, before reaching the API", async () => {
    const { env, api } = setup();
    for (const token of ["expired", "dev"]) {
      const response = await route(request("/balance", { headers: { authorization: `Bearer ${token}` } }), env, deps);
      expect(response.status).toBe(401);
    }
    expect((await route(request("/receipts", { method: "POST", body: "{}", headers: { authorization: "" } }), env, deps)).status).toBe(401);
    expect(api).not.toHaveBeenCalled();
  });
  it("forwards a public read with no token, for the browser host's catalogue and release checks", async () => {
    const { env, api } = setup();
    expect((await route(request("/releases", { headers: { authorization: "" } }), env, deps)).status).toBe(200);
    expect(api.mock.calls[0]?.[0].url).toBe("https://adcode.bluethenics.com/v1/releases");
    expect(api.mock.calls[0]?.[0].headers.has("authorization")).toBe(false);
  });
  it("forwards the desktop's API calls and client headers, but never the administrator's routes", async () => {
    const { env, api } = setup();
    for (const path of ["/admin/people", "/admin", "/a/../admin/people"]) expect((await route(request(path, { method: "DELETE" }), env, deps)).status).toBe(404);
    expect(api).not.toHaveBeenCalled();
    expect(accountApiAllowed("/v1/withdrawals/w_123/cancel", "POST")).toBe(true);
    expect(accountApiAllowed("/v1/models/overrides", "GET")).toBe(true);
    expect(accountApiAllowed("/v1/sponsored/earn", "POST")).toBe(true);
    expect(accountApiAllowed("/v1/balance", "OPTIONS")).toBe(false);
    await route(request("/sponsored/earn", { method: "POST", body: "{}", headers: { "x-adcode-priority": "low", "x-adcode-platform": "desktop" } }), env, deps);
    const forwarded = api.mock.calls[0]![0];
    expect(forwarded.headers.get("x-adcode-priority")).toBe("low");
    expect(forwarded.headers.get("x-adcode-platform")).toBe("web");
  });
  it("does not follow redirects and handles an unavailable account service", async () => {
    const { env, api } = setup();
    api.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example" } }));
    expect((await route(request(), env, deps)).status).toBe(502);
    api.mockRejectedValueOnce(new Error("unavailable"));
    expect((await route(request(), env, deps)).status).toBe(503);
  });
});
