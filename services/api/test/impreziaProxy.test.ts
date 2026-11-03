import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiServer } from "../src/server.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { forwardableIp, relayImprezia, type ImpreziaProxyRequest } from "../src/impreziaProxy.ts";

const encryption = Buffer.alloc(32, 9).toString("base64");
const KEY = "api_pub_live_secret";
const chat: AdNetworkConfig = { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } };
let store: ReturnType<typeof createMemoryStore>;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
let count: number;
const deps = () => ({ adNetworks: store.adNetworks, fetchImpl, encryptionKeys: () => [encryption], bump: async () => ++count, now: () => 1_793_104_700_000 });
const call = (over: Partial<ImpreziaProxyRequest> = {}): ImpreziaProxyRequest => ({
  method: "POST", path: "/v1/monetize/append", body: JSON.stringify({ request: "q", response: "a", sessionId: "chat-1" }),
  contentType: "application/json", sdkVersion: "1.4.0", sdkPlatform: "browser", userAgent: "Mozilla/5.0 ADCode", ip: "203.0.113.9", ...over,
});
async function connect(over: Partial<AdNetworkConfig> = {}): Promise<void> {
  await store.adNetworks!.put({ ...chat, ...over }, "admin", 0);
  await store.adNetworks!.putKey(chat.id, encryptAdNetworkKey(chat.id, KEY, encryption));
}
beforeEach(() => {
  store = createMemoryStore(); count = 0;
  fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ response: "a", links: [] }));
});

describe("the Imprezia SDK relay", () => {
  it("adds the admin's saved key and the person's details, and forwards the body unchanged", async () => {
    await connect();
    const result = await relayImprezia(deps(), call());
    expect(result.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.imprezia.ai/v1/monetize/append");
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe(KEY);
    expect(headers["X-SDK-Version"]).toBe("1.4.0");
    // The SDK in the sponsored page is a browser; claiming `node` would strip web-only cards.
    expect(headers["X-SDK-Platform"]).toBe("browser");
    expect(headers["X-Forwarded-User-Agent"]).toBe("Mozilla/5.0 ADCode");
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(JSON.parse(String(init!.body))).toEqual({ request: "q", response: "a", sessionId: "chat-1" });
    // Workers rejects "error"; "manual" keeps a redirect from being followed with the key.
    expect(init!.redirect).toBe("manual");
  });

  it("refuses an upstream redirect instead of following it with the key", async () => {
    await connect();
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }));
    expect((await relayImprezia(deps(), call())).status).toBe(502);
  });

  it("keeps the SDK's platform, and treats an unknown one as a browser", async () => {
    await connect();
    await relayImprezia(deps(), call({ sdkPlatform: "android" }));
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)["X-SDK-Platform"]).toBe("android");
    await relayImprezia(deps(), call({ sdkPlatform: "curl" }));
    expect((fetchImpl.mock.calls[1]![1]!.headers as Record<string, string>)["X-SDK-Platform"]).toBe("browser");
  });

  it("accepts a text/plain impression beacon as JSON", async () => {
    await connect();
    const result = await relayImprezia(deps(), call({ path: "/v1/events/sdk-impression", contentType: "text/plain", body: "{\"impressionUuid\":\"i\"}" }));
    expect(result.status).toBe(200);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ impressionUuid: "i" });
  });

  it("forwards only the SDK's own paths, so the key reaches nothing else", async () => {
    await connect();
    for (const path of ["/v1/ads/chat", "/v1/admin/keys", "/v1/monetize/../keys", "//evil.example/v1/monetize/x"]) {
      expect((await relayImprezia(deps(), call({ path }))).status, path).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does nothing while the admin has the connection off or has no key saved", async () => {
    expect((await relayImprezia(deps(), call())).status).toBe(503);
    await connect({ enabled: false });
    expect((await relayImprezia(deps(), call())).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the sandbox host for a sandbox key", async () => {
    await store.adNetworks!.put(chat, "admin", 0);
    await store.adNetworks!.putKey(chat.id, encryptAdNetworkKey(chat.id, "api_pub_sandbox_x", encryption));
    await relayImprezia(deps(), call());
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api-sandbox.imprezia.ai/v1/monetize/append");
  });

  it("limits each network per minute and refuses malformed bodies", async () => {
    await connect();
    count = 120;
    expect((await relayImprezia(deps(), call())).status).toBe(429);
    count = 0;
    expect((await relayImprezia(deps(), call({ body: "{not json" }))).status).toBe(400);
  });

  it("is reachable without a token at /v1/imprezia, as the browser SDK sends no Authorization", async () => {
    await connect();
    const server = await createApiServer({
      store,
      verifier: { async verify() { return null; } },
      adNetworks: { fetchImpl, encryptionKeys: () => [encryption] },
    });
    try {
      const response = await fetch(`${server.url}/v1/imprezia/v1/monetize/append`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sdk-platform": "browser", "x-sdk-version": "0.5.24" },
        body: JSON.stringify({ request: "q", response: "a", sessionId: "chat-1" }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const [url, init] = fetchImpl.mock.calls[0]!;
      expect(url).toBe("https://api.imprezia.ai/v1/monetize/append");
      expect((init!.headers as Record<string, string>)["X-API-Key"]).toBe(KEY);
      expect((init!.headers as Record<string, string>)["X-SDK-Platform"]).toBe("browser");
    } finally {
      await server.close();
    }
  });

  it("requires an admin to prepare a disabled connection, then relays only the SDK preview", async () => {
    await connect({ enabled: false });
    await store.addAdmin({ email: "admin@example.com", addedAt: 0, addedBy: "setup" });
    const server = await createApiServer({ store,
      verifier: { async verify(token) { return token === "admin" ? { uid: "admin", claims: { email: "admin@example.com", email_verified: true } } : null; } },
      adNetworks: { fetchImpl, encryptionKeys: () => [encryption] },
    });
    try {
      const url = `${server.url}/v1/admin/ad-networks/imprezia/test`;
      expect((await fetch(url, { method: "POST" })).status).toBe(401);
      const prepared = await fetch(url, { method: "POST", headers: { authorization: "Bearer admin", "content-type": "application/json" }, body: "{}" });
      expect(prepared.status).toBe(200);
      const { sdk } = await prepared.json() as { sdk: { endpoint: string } };
      expect(fetchImpl).not.toHaveBeenCalled();
      const body = { request: "sample", response: "sample answer", sessionId: "preview-conversation", sdkCapabilities: ["tracker-frames"] };
      const response = await fetch(`${server.url}${sdk.endpoint}/v1/monetize/append`, {
        method: "POST", headers: { "content-type": "application/json", "x-sdk-platform": "browser", "x-sdk-version": "0.5.24" }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.imprezia.ai/v1/monetize/append");
      expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual(body);
    } finally { await server.close(); }
  });

  it("never forwards a private, loopback or placeholder address", () => {
    expect(forwardableIp("203.0.113.9")).toBe("203.0.113.9");
    expect(forwardableIp("2001:db8::1")).toBe("2001:db8::1");
    for (const value of ["10.0.0.4", "192.168.1.2", "127.0.0.1", "172.20.1.1", "::1", "fd00::1", "unknown", "", undefined]) expect(forwardableIp(value), String(value)).toBeUndefined();
  });
});
