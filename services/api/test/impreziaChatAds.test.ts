import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { handleServe } from "../src/serve.ts";
import { handleReceipts } from "../src/receipts.ts";
import { handleAdNetworkAdmin } from "../src/adNetworks.ts";
import { adNetworkReadiness, parseAdNetworkConfig, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { impreziaBaseUrl, unpackImpression } from "../src/impreziaChatAds.ts";
import { relayImprezia } from "../src/impreziaProxy.ts";

const encryption = Buffer.alloc(32, 7).toString("base64");
const LIVE = "api_pub_live_secret", SANDBOX = "api_pub_sandbox_secret";
const config: AdNetworkConfig = { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "1000", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "editor_card" } };
let store: ReturnType<typeof createMemoryStore>, now: number;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
const deps = () => ({ store, clock: { now: () => now }, ids: { next: (prefix: string) => `${prefix}_1` }, encryptionKeys: () => [encryption], fetchImpl });
const request = { tags: ["lang:typescript", "React"], themeKind: "dark" as const, count: 1 };
async function connect(key: string, over: Partial<AdNetworkConfig> = {}) {
  await store.adNetworks!.put({ ...config, ...over }, "admin", now);
  await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, key, encryption));
}
const testConnection = () => handleAdNetworkAdmin(deps(), "admin-1", "/v1/admin/ad-networks/imprezia/test", "POST", {});
const preview = (path: string) => relayImprezia({ adNetworks: store.adNetworks, fetchImpl, encryptionKeys: () => [encryption], bump: async () => 1, now: () => now }, {
  method: "POST", path, body: JSON.stringify({ request: "q", response: "a", sessionId: "preview-chat" }),
  contentType: "application/json", sdkVersion: "0.5.24", sdkPlatform: "browser", userAgent: "Mozilla/5.0", ip: undefined,
});
async function previewPath() {
  const tested = await testConnection();
  return (tested.body["sdk"] as { endpoint: string }).endpoint.slice("/v1/imprezia".length) + "/v1/monetize/append";
}
beforeEach(() => {
  store = createMemoryStore(); now = 1_793_104_700_000;
  fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ monetizedResponse: "a", linkData: {} }));
});

describe("Imprezia SDK-only delivery", () => {
  it("retains saved settings while selecting environments for the SDK relay", () => {
    expect(parseAdNetworkConfig(config)).toEqual(config);
    expect(adNetworkReadiness(config, true)).toBe("ready");
    expect(impreziaBaseUrl(SANDBOX)).toBe("https://api-sandbox.imprezia.ai");
    expect(impreziaBaseUrl(LIVE)).toBe("https://api.imprezia.ai");
    expect(impreziaBaseUrl("api_pub_beta_secret")).toBe("https://api-beta.imprezia.ai");
  });

  it.each([LIVE, SANDBOX])("never calls a provider or creates a native delivery for %s", async key => {
    await connect(key);
    expect((await handleServe(deps(), "alice", request)).creatives).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await store.adNetworks!.delivery("alice", "an_n_1")).toBeNull();
  });

  it("prepares a browser SDK preview without making a handwritten ad request or exposing the key", async () => {
    await connect(SANDBOX, { enabled: false });
    const result = await testConnection();
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, sandbox: true, sdk: { endpoint: expect.stringMatching(/^\/v1\/imprezia\/preview\/imprezia\//), placementId: "editor_card" } });
    expect(result.body).not.toHaveProperty("creative");
    expect(JSON.stringify(result.body)).not.toContain(SANDBOX);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await store.getBalance("admin-1")).availableMicros).toBe(0n);
  });

  it("lets the SDK preview the selected disabled connection, instead of a different enabled network", async () => {
    await connect(SANDBOX, { enabled: false });
    await store.adNetworks!.put({ ...config, id: "other" }, "admin", now);
    await store.adNetworks!.putKey("other", encryptAdNetworkKey("other", LIVE, encryption));
    expect((await preview(await previewPath())).status).toBe(200);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api-sandbox.imprezia.ai/v1/monetize/append");
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)["X-API-Key"]).toBe(SANDBOX);
  });

  it("expires preview permits and rejects tampering, cross-network use, and key rotation", async () => {
    await connect(SANDBOX);
    const path = await previewPath();
    expect((await preview(path.replace("/imprezia/", "/other/"))).status).toBe(403);
    expect((await preview(path.replace("/v1/monetize", "x/v1/monetize"))).status).not.toBe(200);
    now += 5 * 60_000;
    expect((await preview(path)).status).toBe(403);
    now -= 5 * 60_000;
    await connect(LIVE);
    expect((await preview(path)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not let a preview permit reach the direct ad endpoint", async () => {
    await connect(SANDBOX);
    const path = (await previewPath()).replace("/v1/monetize/append", "/v1/ads/chat");
    expect((await preview(path)).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors already-issued receipts once without sending manual impression requests", async () => {
    await connect(LIVE);
    const legacy = 'imprezia1:["imp-1","tok",1793104700000,"k1"]';
    expect(unpackImpression(legacy)?.uuid).toBe("imp-1");
    await store.adNetworks!.recordDelivery({ id: "an_legacy", networkId: config.id, uid: "alice", creativeId: "an_legacy", providerCreativeId: legacy,
      servedAt: now, expiresAt: now + 60_000, viewPayoutMicros: "1000", clickPayoutMicros: "0", logoLight: "https://storage.googleapis.com/ad.png", logoDark: "https://storage.googleapis.com/ad.png" });
    now += 3_000;
    const receipt = { receiptId: "one", creativeId: "an_legacy", shownAt: now - 2_000, dwellMs: 1_500, themeKind: "dark" as const, outcome: "impression" as const };
    await handleReceipts(deps(), "alice", { receipts: [receipt, { ...receipt, receiptId: "two" }] });
    expect((await store.getBalance("alice")).availableMicros).toBe(1000n);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
