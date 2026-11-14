import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { handleAdNetworkAdmin } from "../src/adNetworks.ts";
import { parseAdNetworkConfig, adNetworkReadiness, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { encryptAdNetworkKey } from "../src/adNetworkCrypto.ts";
import { isZeekendKey, sponsoredNetworks, zeekendKeyMode } from "../src/sponsoredNetworks.ts";
import type { TokenVerifier } from "../src/auth.ts";

const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };

const encryption = Buffer.alloc(32, 9).toString("base64");
const zeekend: AdNetworkConfig = { id: "zeekend", name: "Zeekend", provider: "zeekend", enabled: true, priority: 5, viewPayoutMicros: "0", clickPayoutMicros: "0", zeekend: { placementId: "chat-main" } };
const imprezia: AdNetworkConfig = { id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } };
let store: ReturnType<typeof createMemoryStore>;
const deps = () => ({ store, clock: { now: () => 1_000 }, ids: { next: (prefix: string) => `${prefix}_1` }, encryptionKeys: () => [encryption] });
async function save(config: AdNetworkConfig, key: string | null): Promise<void> {
  await store.adNetworks!.put(config, "admin", 1_000);
  if (key !== null) await store.adNetworks!.putKey(config.id, encryptAdNetworkKey(config.id, key, encryption));
}
beforeEach(() => { store = createMemoryStore(); });

describe("Zeekend keys", () => {
  it("tells a live key from Zeekend's sandbox keys and refuses anything else", () => {
    expect(isZeekendKey("pub_live_abc123XYZ")).toBe(true);
    for (const key of ["pub_test", "pub_sandbox", "pub_demo"]) { expect(isZeekendKey(key)).toBe(true); expect(zeekendKeyMode(key)).toBe("sandbox"); }
    expect(zeekendKeyMode("pub_live_abc123XYZ")).toBe("live");
    for (const key of ["api_pub_123", "pub_live_", "pub_live_a b", " pub_test", "pub_testing"]) expect(isZeekendKey(key), key).toBe(false);
  });
});

describe("a Zeekend connection", () => {
  it("is a chat connection that can be switched on, with chat-main by default", () => {
    expect(parseAdNetworkConfig({ ...zeekend, zeekend: undefined })).toMatchObject({ provider: "zeekend", enabled: true, zeekend: { placementId: "chat-main" } });
    expect(parseAdNetworkConfig({ ...zeekend, zeekend: { placementId: "reply_card" } })?.zeekend).toEqual({ placementId: "reply_card" });
    expect(parseAdNetworkConfig({ ...zeekend, zeekend: { placementId: "has space" } })).toBeNull();
    expect(adNetworkReadiness(zeekend, false)).toBe("key-required");
    expect(adNetworkReadiness(zeekend, true)).toBe("ready");
  });

  it("refuses a key that is not Zeekend's, and reports which environment a saved key is", async () => {
    await save({ ...zeekend, enabled: false }, null);
    const refused = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/zeekend/key", "PUT", { key: "api_pub_wrong" });
    expect(refused.status).toBe(400);
    const saved = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/zeekend/key", "PUT", { key: " pub_live_abc123XYZ " });
    expect(saved.body).toMatchObject({ keyConfigured: true, keyMode: "live" });
    const test = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/zeekend/test", "POST", {});
    expect(test.body).toMatchObject({ ok: true, sandbox: false, zeekend: { placementId: "chat-main", keyMode: "live", validKey: true } });
    const list = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks", "GET");
    expect((list.body["networks"] as Array<Record<string, unknown>>)[0]).toMatchObject({ id: "zeekend", keyMode: "live", readiness: "disabled" });
    expect(JSON.stringify(list.body)).not.toContain("pub_live_abc123XYZ");
  });
});

describe("the sponsored page's partners", () => {
  it("asks Zeekend only, with its public key - a saved Imprezia connection is never listed", async () => {
    await save(imprezia, "api_pub_secret_imprezia");
    await save(zeekend, "pub_live_abc123XYZ");
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([
      { id: "zeekend", publisherKey: "pub_live_abc123XYZ", placementId: "chat-main" },
    ]);
    // No sign-in: the sponsored page has none.
    const api = createFetchHandler({ store, clock: { now: () => 1_000 }, verifier, adNetworks: deps() });
    const response = await api(new Request("https://api.example.com/v1/sponsored/networks"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ networks: [{ id: "zeekend", publisherKey: "pub_live_abc123XYZ", placementId: "chat-main" }] });
    expect(text).not.toContain("api_pub_secret_imprezia");
  });

  it("leaves out a partner that is off, has no key or has a key that is not its own", async () => {
    await save({ ...imprezia, enabled: false }, "api_pub_secret_imprezia");
    await save(zeekend, null);
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([]);
    await save(zeekend, "not-a-zeekend-key");
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([]);
    expect(await sponsoredNetworks({ adNetworks: undefined })).toEqual([]);
  });
});
