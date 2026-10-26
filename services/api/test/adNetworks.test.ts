import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { handleServe } from "../src/serve.ts";
import { handleReceipts } from "../src/receipts.ts";
import { parseAdNetworkConfig, publicHttpsUrl, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { decryptAdNetworkKey, encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import type { TokenVerifier } from "../src/auth.ts";

const encryption = Buffer.alloc(32, 7).toString("base64");
const config: AdNetworkConfig = {
  id: "generic", name: "Example demand", provider: "http-json", enabled: false, priority: 10, viewPayoutMicros: "1200", clickPayoutMicros: "5000",
  http: { serveUrl: "https://ads.provider.com/serve", method: "POST", authHeader: "authorization", authPrefix: "Bearer ", requestTemplate: { tags: "{{tags}}", theme: "{{theme}}", requestId: "{{requestId}}" }, creativePath: "ad", fields: { id: "id", advertiser: "brand", headline: "title", body: "text", clickUrl: "url", logoLight: "logo", logoDark: "" }, verifyUrl: "https://ads.provider.com/verify", verifyTemplate: { id: "{{providerCreativeId}}", event: "{{event}}", eventId: "{{eventId}}" }, verifiedPath: "verified", eventIdPath: "eventId" },
};
const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: { email: `${token}@example.com`, email_verified: true } }; } };
let store: ReturnType<typeof createMemoryStore>;
let now: number; let counter: number; let verified: unknown;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
const deps = () => ({ store, clock: { now: () => now }, ids: { next: (prefix: string) => `${prefix}_${++counter}` }, encryptionKeys: () => [encryption], fetchImpl });
const request = { tags: ["lang:rust"], themeKind: "dark" as const, count: 1 };
beforeEach(async () => {
  store = createMemoryStore(); now = 100_000; counter = 0; verified = true;
  await store.addAdmin({ email: "admin@example.com", addedAt: now, addedBy: "setup" });
  fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer provider-secret");
    if (url.endsWith("/verify")) {
      const event = JSON.parse(String(init?.body)) as { eventId: string };
      return Response.json({ verified, eventId: event.eventId });
    }
    return Response.json({ ad: { id: "provider-ad-1", brand: "Example", title: "Try this tool", text: "For software teams", url: "https://sponsor.com/tool", logo: "https://sponsor.com/logo.png" } });
  });
});
async function enable() {
  await store.adNetworks!.put({ ...config, enabled: true }, "admin", now);
  await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, "provider-secret", encryption));
}
const receipt = (id: string, outcome: "impression" | "click" = "impression", receiptId = "receipt-1") => ({ receiptId, creativeId: id, shownAt: now - 2_000, dwellMs: 1_500, themeKind: "dark" as const, outcome });
describe("ad network settings", () => {
  it("validates mappings and only permits public HTTPS endpoints without redirect or credential surprises", () => {
    expect(parseAdNetworkConfig(config)).toEqual(config);
    for (const serveUrl of ["http://provider.com", "https://127.0.0.1/x", "https://169.254.169.254/x", "https://localhost/x", "https://user:pass@provider.com/x", "https://[::1]/x", "https://service.internal/x"]) {
      expect(publicHttpsUrl(serveUrl), serveUrl).toBe(false);
      expect(parseAdNetworkConfig({ ...config, http: { ...config.http!, serveUrl } })).toBeNull();
    }
    expect(parseAdNetworkConfig({ ...config, http: { ...config.http!, verifyUrl: "https://different.com/verify" } })).toBeNull();
    expect(parseAdNetworkConfig({ ...config, http: { ...config.http!, fields: { ...config.http!.fields, id: "__proto__.id" } } })).toBeNull();
    expect(parseAdNetworkConfig({ ...config, provider: "imprezia", enabled: true })).toBeNull();
  });
  it("encrypts API keys at rest, binds them to one network, and supports previous read keys", () => {
    const stored = encryptAdNetworkKey("generic", "provider-secret", encryption);
    expect(JSON.stringify(stored)).not.toContain("provider-secret");
    expect(decryptAdNetworkKey("generic", stored, [Buffer.alloc(32, 8).toString("base64"), encryption])).toBe("provider-secret");
    expect(() => decryptAdNetworkKey("other", stored, [encryption])).toThrow();
  });
  it("only admins can change connections and GET never returns credentials", async () => {
    const api = createFetchHandler({ ...deps(), verifier, adNetworks: deps() });
    const call = (token: string, path: string, method = "GET", body?: unknown) => api(new Request(`https://api.example.com/v1/admin/ad-networks${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    expect((await call("user", "", "PUT", config)).status).toBe(403);
    expect((await call("admin", "", "PUT", config)).status).toBe(200);
    expect((await call("admin", "/generic/key", "PUT", { key: "provider-secret" })).status).toBe(200);
    const result = await call("admin", "");
    expect(result.status).toBe(200);
    const body = await result.text(); expect(body).toContain('"keyConfigured":true'); expect(body).not.toContain("provider-secret"); expect(body).not.toContain("ciphertext");
    expect((await store.listAudit()).map(row => row.action)).toContain("ad-network-key-save");
    expect((await call("admin", "/generic/test", "POST", {})).status).toBe(200);
    expect((await store.getBalance("admin")).availableMicros).toBe(0n);
  });
});
describe("external inventory and earnings", () => {
  it("serves a normalized creative with an owned delivery and pays a provider-confirmed view once", async () => {
    await enable();
    const served = await handleServe(deps(), "alice", request); const creative = served.creatives[0]!;
    expect(creative.headline).toBe("Try this tool"); expect(creative.creativeId).toMatch(/^an_/);
    expect(JSON.stringify(served)).not.toContain("provider-secret");
    const delivery = await store.adNetworks!.delivery("alice", creative.creativeId);
    expect(delivery?.viewPayoutMicros).toBe("1200");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)); expect(body.tags).toEqual(["lang:rust"]);
    now += 3_000;
    // A changed admin price cannot change an already issued view.
    await store.adNetworks!.put({ ...config, enabled: true, viewPayoutMicros: "9900" }, "admin", now);
    await handleReceipts(deps(), "alice", { receipts: [receipt(creative.creativeId)] });
    await handleReceipts(deps(), "alice", { receipts: [receipt(creative.creativeId, "impression", "changed-client-id")] });
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).endsWith("/verify"))).toHaveLength(1);
    expect((await store.getBalance("alice")).availableMicros).toBe(1200n);
    expect((await store.listEntries("alice", { limit: 10, cursor: null })).rows).toHaveLength(1);
    expect(await store.getSpend(config.id)).toBe(0n);
  });
  it("cannot earn from a guessed delivery, another account, an impossible dwell or an unverified provider response", async () => {
    await enable(); const { creatives } = await handleServe(deps(), "alice", request); now += 3_000;
    await handleReceipts(deps(), "mallory", { receipts: [receipt(creatives[0]!.creativeId)] });
    await handleReceipts(deps(), "alice", { receipts: [{ ...receipt(creatives[0]!.creativeId), dwellMs: 0 }] });
    for (const value of [false, "true", 1, null]) { verified = value; await handleReceipts(deps(), "alice", { receipts: [receipt(creatives[0]!.creativeId)] }); }
    expect((await store.getBalance("alice")).availableMicros).toBe(0n); expect((await store.getBalance("mallory")).availableMicros).toBe(0n);
  });
  it("leaves transient provider verification failures queued, then pays the configured click rate", async () => {
    await enable(); const { creatives } = await handleServe(deps(), "alice", request); now += 3_000;
    fetchImpl.mockRejectedValueOnce(new Error("upstream says provider-secret"));
    expect(await handleReceipts(deps(), "alice", { receipts: [receipt(creatives[0]!.creativeId, "click")] })).toEqual({ acked: [] });
    expect(await handleReceipts(deps(), "alice", { receipts: [receipt(creatives[0]!.creativeId, "click")] })).toEqual({ acked: ["receipt-1"] });
    expect((await store.getBalance("alice")).availableMicros).toBe(5000n);
  });
  it("makes bounded progress through a receipt backlog without sequential provider waits", async () => {
    await enable();
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) ids.push((await handleServe(deps(), "alice", request)).creatives[0]!.creativeId);
    now += 3_000;
    const wall = vi.spyOn(Date, "now").mockReturnValue(0);
    fetchImpl.mockImplementation(async (_input, init) => {
      wall.mockReturnValue(1_000);
      const event = JSON.parse(String(init?.body)) as { eventId: string };
      return Response.json({ verified: true, eventId: event.eventId });
    });
    try {
      const result = await handleReceipts(deps(), "alice", { receipts: ids.map((id,index) => receipt(id, "impression", `receipt-${index}`)) });
      expect(result.acked).toHaveLength(4);
      expect((await store.getBalance("alice")).availableMicros).toBe(4_800n);
      const retry = await handleReceipts(deps(), "alice", { receipts: [receipt(ids[4]!, "impression", "receipt-4")] });
      expect(retry.acked).toEqual(["receipt-4"]);
      expect((await store.getBalance("alice")).availableMicros).toBe(6_000n);
    } finally { wall.mockRestore(); }
  });
  it("never contacts external demand when the kill switch is on", async () => {
    await enable(); const config = await store.getConfig(); await store.putConfig({ ...config, killSwitch: true });
    expect(await handleServe(deps(), "alice", request)).toEqual({ creatives: [] }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("fails closed for broken providers without exposing provider errors", async () => {
    await enable(); fetchImpl.mockRejectedValue(new Error("provider-secret"));
    expect(await handleServe(deps(), "alice", request)).toEqual({ creatives: [] });
  });
  it("uses beehiiv's documented read-only offer endpoint without generating live inventory or earnings", async () => {
    const bee: AdNetworkConfig = { id: "newsletter", name: "beehiiv", provider: "beehiiv", enabled: false, priority: 1, viewPayoutMicros: "0", clickPayoutMicros: "0", beehiiv: { publicationId: "pub_1234-abcd", offerId: "offer-1" } };
    await store.adNetworks!.put(bee, "admin", now); await store.adNetworks!.putKey(bee.id, encryptAdNetworkKey(bee.id, "provider-secret", encryption));
    fetchImpl.mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://api.beehiiv.com/v2/publications/pub_1234-abcd/ad_network/offers/offer-1/advertisements");
      expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer provider-secret");
      return Response.json({ advertisements: [{ id: "ad-1", name: "Primary", headline: "Sponsor", text: "Copy", description: "About the sponsor" }] });
    });
    const { handleAdNetworkAdmin } = await import("../src/adNetworks.ts");
    const result = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/newsletter/test", "POST", {});
    expect(result.status).toBe(200); expect(result.body["readiness"]).toBe("newsletter-preview-only");
    expect(await handleServe(deps(), "alice", request)).toEqual({ creatives: [] }); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
