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

const everywhere = ["banner", "notification", "reply"];

describe("the sponsored page's partners", () => {
  it("lists Zeekend with its public key and Imprezia without its secret one, each with an equal share by default", async () => {
    await save(imprezia, "api_pub_secret_imprezia");
    await save(zeekend, "pub_live_abc123XYZ");
    const expected = [
      { id: "zeekend", publisherKey: "pub_live_abc123XYZ", placementId: "chat-main", share: 50, places: everywhere },
      { id: "imprezia", share: 50, places: everywhere },
    ];
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual(expected);
    // No sign-in: the sponsored page has none.
    const api = createFetchHandler({ store, clock: { now: () => 1_000 }, verifier, adNetworks: deps() });
    const response = await api(new Request("https://api.example.com/v1/sponsored/networks"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ networks: expected });
    expect(text).not.toContain("api_pub_secret_imprezia");
  });

  it("carries the split and places the admin saved, and Imprezia's placement label when it has one", async () => {
    await save({ ...imprezia, imprezia: { kind: "chat", id: "editor_card" }, mix: { share: 30, places: ["notification"] } }, "api_pub_secret_imprezia");
    await save({ ...zeekend, mix: { share: 70, places: ["banner", "reply"] } }, "pub_live_abc123XYZ");
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([
      { id: "zeekend", publisherKey: "pub_live_abc123XYZ", placementId: "chat-main", share: 70, places: ["banner", "reply"] },
      { id: "imprezia", placementId: "editor_card", share: 30, places: ["notification"] },
    ]);
  });

  it("leaves out a partner that is off, has no key or has a key that is not its own", async () => {
    await save({ ...imprezia, enabled: false }, "api_pub_secret_imprezia");
    await save(zeekend, null);
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([]);
    await save(zeekend, "not-a-zeekend-key");
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [encryption] })).toEqual([]);
    expect(await sponsoredNetworks({ adNetworks: undefined })).toEqual([]);
    // Without the encryption key nothing can be read, so nothing is listed.
    await save(imprezia, "api_pub_secret_imprezia");
    expect(await sponsoredNetworks({ adNetworks: store.adNetworks, encryptionKeys: () => [] })).toEqual([]);
  });
});

describe("the admin's traffic split", () => {
  it("is saved for every network at once, and refused whole when one entry is wrong", async () => {
    await save(zeekend, "pub_live_abc123XYZ");
    await save(imprezia, "api_pub_secret_imprezia");
    const saved = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/mix", "PUT", { networks: [
      { id: "zeekend", share: 60, places: ["reply", "banner"] },
      { id: "imprezia", share: 40, places: ["banner", "notification", "reply"] },
    ] });
    expect(saved).toEqual({ status: 200, body: { ok: true, mix: [
      { id: "zeekend", share: 60, places: ["banner", "reply"] },
      { id: "imprezia", share: 40, places: everywhere },
    ] } });
    expect((await store.adNetworks!.get("zeekend"))?.mix).toEqual({ share: 60, places: ["banner", "reply"] });
    for (const networks of [
      [{ id: "zeekend", share: 101, places: [] }],
      [{ id: "zeekend", share: 10.5, places: [] }],
      [{ id: "zeekend", share: 10, places: ["sidebar"] }],
      [{ id: "zeekend", share: 10, places: ["banner", "banner"] }],
      [{ id: "zeekend", share: 10, places: [] }, { id: "zeekend", share: 20, places: [] }],
      [],
    ]) {
      const refused = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/mix", "PUT", { networks });
      expect(refused.status, JSON.stringify(networks)).toBe(400);
    }
    // One bad entry saves nothing, not even the good one before it.
    await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/mix", "PUT", { networks: [{ id: "zeekend", share: 5, places: ["banner"] }, { id: "imprezia", share: -1, places: [] }] });
    expect((await store.adNetworks!.get("zeekend"))?.mix?.share).toBe(60);
  });

  it("only takes sponsored-card networks", async () => {
    await save({ id: "json", name: "JSON", provider: "beehiiv", enabled: false, priority: 1, viewPayoutMicros: "0", clickPayoutMicros: "0", beehiiv: { publicationId: "pub_1", offerId: "o" } }, null);
    expect((await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/mix", "PUT", { networks: [{ id: "json", share: 50, places: ["banner"] }] })).status).toBe(404);
    expect((await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks/mix", "PUT", { networks: [{ id: "missing", share: 50, places: ["banner"] }] })).status).toBe(404);
  });

  it("is kept by a full save of the connection, and each network's cards shown come back with the list", async () => {
    expect(parseAdNetworkConfig({ ...zeekend, mix: { share: 20, places: ["banner"] } })?.mix).toEqual({ share: 20, places: ["banner"] });
    expect(parseAdNetworkConfig({ ...zeekend, mix: { share: 20, places: "banner" } })).toBeNull();
    await save(zeekend, "pub_live_abc123XYZ");
    await store.networkImpressions!.record({ network: "imprezia", slotId: "slot_imp_0f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f", layout: "banner" }, 900);
    const list = await handleAdNetworkAdmin(deps(), "admin", "/v1/admin/ad-networks", "GET");
    expect(list.body["shown"]).toEqual({ imprezia: { last1d: 1, last7d: 1 } });
  });

  it("lets Imprezia pay per card like Zeekend, within the same ceilings", async () => {
    expect(parseAdNetworkConfig({ ...imprezia, imprezia: { kind: "chat", id: "", payPerCardMicros: "3000", paidCardsPerDay: 200 } })?.imprezia).toEqual({ kind: "chat", id: "", payPerCardMicros: "3000", paidCardsPerDay: 200 });
    expect(parseAdNetworkConfig({ ...imprezia, imprezia: { kind: "chat", id: "", payPerCardMicros: "100001" } })).toBeNull();
    expect(parseAdNetworkConfig({ ...imprezia, imprezia: { kind: "chat", id: "", paidCardsPerDay: 1001 } })).toBeNull();
  });
});

describe("cards from a test key", () => {
  it("pay nobody: a sandbox or beta Imprezia key, Zeekend's pub_test, or no readable key", async () => {
    const { servesTestCards } = await import("../src/adNetworks.ts");
    await save(imprezia, "api_pub_sandbox_abc");
    expect(await servesTestCards(deps(), imprezia)).toBe(true);
    await save(imprezia, "api_pub_beta_abc");
    expect(await servesTestCards(deps(), imprezia)).toBe(true);
    await save(imprezia, "api_pub_live_abc");
    expect(await servesTestCards(deps(), imprezia)).toBe(false);
    await save(zeekend, "pub_test");
    expect(await servesTestCards(deps(), zeekend)).toBe(true);
    await save(zeekend, "pub_live_abc123XYZ");
    expect(await servesTestCards(deps(), zeekend)).toBe(false);
    // A key that cannot be decrypted serves nothing real either.
    expect(await servesTestCards({ ...deps(), encryptionKeys: () => [Buffer.alloc(32, 1).toString("base64")] }, zeekend)).toBe(true);
  });

  it("are refused at the earn route, leaving the card unused", async () => {
    await save(imprezia, "api_pub_sandbox_abc");
    const api = createFetchHandler({ store, clock: { now: () => 1_000 }, verifier, adNetworks: deps() });
    const card = "slot_imp_0f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f";
    const earn = () => api(new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", headers: { authorization: "Bearer dev-t", "content-type": "application/json" }, body: JSON.stringify({ network: "imprezia", slotId: card }) }));
    expect(await (await earn()).json()).toEqual({ credited: false, reason: "unpaid" });
    expect(await store.adNetworks!.delivery("dev-t", card)).toBeNull();
    await save(imprezia, "api_pub_live_abc");
    expect(await (await earn()).json()).toEqual({ credited: true, micros: "2000" });
  });
});
