import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryNetworkImpressionStore, parseNetworkImpression, withNetworkImpressions } from "../src/networkImpressions.ts";
import type { GrowthStats } from "../src/store.ts";
import type { TokenVerifier } from "../src/auth.ts";

const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");

const IMPREZIA_CARD = "slot_imp_0f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f";

describe("a partner impression reported by the sponsored page", () => {
  it("is taken only with a card id of a known shape, whose network it names", () => {
    expect(parseNetworkImpression({ network: "zeekend", slotId: "slot_p5b3lgsceh", layout: "banner" })).toEqual({ network: "zeekend", slotId: "slot_p5b3lgsceh", layout: "banner" });
    expect(parseNetworkImpression({ network: "zeekend", slotId: "slot_p5b3lgsceh" })?.layout).toBe("reply");
    expect(parseNetworkImpression({ network: "imprezia", slotId: IMPREZIA_CARD, layout: "notification" })).toEqual({ network: "imprezia", slotId: IMPREZIA_CARD, layout: "notification" });
    // The 2.6.5 app calls every card Zeekend's: the id decides.
    expect(parseNetworkImpression({ network: "zeekend", slotId: IMPREZIA_CARD })?.network).toBe("imprezia");
    expect(parseNetworkImpression({ network: "imprezia", slotId: "slot_p5b3lgsceh" })?.network).toBe("zeekend");
    expect(parseNetworkImpression({ network: "other", slotId: "slot_p5b3lgsceh" })).toBeNull();
    expect(parseNetworkImpression({ network: "imprezia", slotId: "slot_imp_not-a-uuid!" })).toBeNull();
    expect(parseNetworkImpression({ network: "imprezia", slotId: "slot_imp_zz" })).toBeNull();
    expect(parseNetworkImpression({ network: "zeekend", slotId: "<script>" })).toBeNull();
    expect(parseNetworkImpression("slot_x")).toBeNull();
  });

  it("names its network by the card id, Imprezia's within the 2.6.5 app's slot check", async () => {
    const { cardNetwork } = await import("../src/networkImpressions.ts");
    expect(cardNetwork("slot_p5b3lgsceh")).toBe("zeekend");
    expect(cardNetwork(IMPREZIA_CARD)).toBe("imprezia");
    expect(cardNetwork("imprezia")).toBeNull();
    // What the 2.6.5 app checks before it claims a card.
    expect(/^slot_[A-Za-z0-9_-]{4,64}$/.test(IMPREZIA_CARD)).toBe(true);
  });

  it("counts a slot once, however often it is reported", async () => {
    const store = createMemoryStore();
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier });
    const post = (body: unknown) => api(new Request("https://api.example.com/v1/sponsored/impression", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(await (await post({ network: "zeekend", slotId: "slot_abcdef", layout: "banner" })).json()).toEqual({ counted: true });
    expect(await (await post({ network: "zeekend", slotId: "slot_abcdef", layout: "banner" })).json()).toEqual({ counted: false });
    expect((await post({ network: "zeekend", slotId: "nope" })).status).toBe(400);
    expect((await store.networkImpressions!.summary(NOW)).total).toBe(1);
  });

  it("is refused past thirty a minute from one address", async () => {
    const store = createMemoryStore();
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier });
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++) {
      const response = await api(new Request("https://api.example.com/v1/sponsored/impression", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ network: "zeekend", slotId: `slot_n${String(i).padStart(4, "0")}` }) }));
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});

describe("the admin's ads shown", () => {
  it("adds Zeekend's cards to every total and to the day they were seen", async () => {
    const network = createMemoryNetworkImpressionStore();
    await network.record({ network: "zeekend", slotId: "slot_today1", layout: "banner" }, NOW - 1_000);
    await network.record({ network: "zeekend", slotId: "slot_today2", layout: "reply" }, NOW - 2_000);
    await network.record({ network: "zeekend", slotId: "slot_older1", layout: "notification" }, NOW - 10 * DAY);
    const stats = { adsShown: 100, adsShown7d: 20, adsShown30d: 50, daily: [{ day: "2026-11-13", active: 1, joined: 0, adsShown: 3, returning: null }, { day: "2026-11-03", active: 1, joined: 0, adsShown: 1, returning: null }] } as unknown as GrowthStats;
    const merged = withNetworkImpressions(stats, await network.summary(NOW));
    expect(merged.adsShown).toBe(103);
    expect(merged.adsShown7d).toBe(22);
    expect(merged.adsShown30d).toBe(53);
    expect(merged.daily.map((day) => day.adsShown)).toEqual([5, 2]);
    expect(merged.networkAdsShown).toBe(3);
    expect(merged.networkAdsShown7d).toBe(2);
    expect(withNetworkImpressions(stats, null).adsShown).toBe(100);
  });
});

describe("paying for a Zeekend card", () => {
  const zeekendConfig = { id: "zeekend", name: "Zeekend", provider: "zeekend" as const, enabled: true, priority: 5, viewPayoutMicros: "0", clickPayoutMicros: "0", zeekend: { placementId: "chat-main" } };

  async function ready() {
    const store = createMemoryStore();
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    // A live key: a connection with a test key, or none, pays nobody (adNetworks.ts servesTestCards).
    const encryption = Buffer.alloc(32, 9).toString("base64");
    const { encryptAdNetworkKey } = await import("../src/adNetworkCrypto.ts");
    await store.adNetworks!.putKey("zeekend", encryptAdNetworkKey("zeekend", "pub_live_abc123XYZ", encryption));
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier, adNetworks: { encryptionKeys: () => [encryption] } });
    const earn = (uid: string, slotId: string) => api(new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" }, body: JSON.stringify({ network: "zeekend", slotId, layout: "banner" }) }));
    return { store, earn };
  }

  it("credits $0.002 to the signed-in account, once per slot, and a slot to one person only", async () => {
    const { earn } = await ready();
    expect(await (await earn("dev-a", "slot_paid0001")).json()).toEqual({ credited: true, micros: "2000" });
    expect(await (await earn("dev-a", "slot_paid0001")).json()).toEqual({ credited: false, reason: "already" });
    expect(await (await earn("dev-b", "slot_paid0001")).json()).toEqual({ credited: false, reason: "already" });
  });

  it("needs a signed-in account", async () => {
    const store = createMemoryStore();
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier });
    const response = await api(new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", body: JSON.stringify({ network: "zeekend", slotId: "slot_paid0002" }) }));
    expect(response.status).toBe(401);
  });

  it("pays nothing without a live Zeekend connection, and stops at the daily cap", async () => {
    const { creditNetworkImpression, ZEEKEND_PAID_PER_DAY } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    expect(await creditNetworkImpression({ adNetworks: store.adNetworks, bumpDailyCount: (key, day) => store.bumpRequestCount(key, day), now: NOW }, "dev-c", { network: "zeekend", slotId: "slot_cap00000" })).toEqual({ credited: false, reason: "no-network" });
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    let count = ZEEKEND_PAID_PER_DAY;
    const outcome = await creditNetworkImpression({ adNetworks: store.adNetworks, bumpDailyCount: async (key) => (key.startsWith("cards-paid:") ? ++count : 1), now: NOW }, "dev-c", { network: "zeekend", slotId: "slot_cap00001" });
    expect(outcome).toEqual({ credited: false, reason: "daily-cap" });
  });

  it("pays for an Imprezia card at Imprezia's own rate, even when the 2.6.5 app calls it Zeekend's", async () => {
    const { creditNetworkImpression } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    const deps = { adNetworks: store.adNetworks, bumpDailyCount: (key: string, day: number) => store.bumpRequestCount(key, day), now: NOW };
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    // Zeekend alone pays nothing for an Imprezia card.
    expect(await creditNetworkImpression(deps, "dev-i", { network: "imprezia", slotId: IMPREZIA_CARD })).toEqual({ credited: false, reason: "no-network" });
    await store.adNetworks!.put({ id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "", payPerCardMicros: "3000" } }, "admin", NOW);
    expect(await creditNetworkImpression(deps, "dev-i", { network: "zeekend", slotId: IMPREZIA_CARD })).toEqual({ credited: true, micros: "3000" });
    expect(await creditNetworkImpression(deps, "dev-i", { network: "imprezia", slotId: IMPREZIA_CARD })).toEqual({ credited: false, reason: "already" });
    expect((await store.adNetworks!.delivery("dev-i", IMPREZIA_CARD))?.networkId).toBe("imprezia");
    expect((await store.getBalance("dev-i")).lifetimeMicros).toBe(3_000n);
  });

  it("counts one day's paid cards across every network, so a split pays no more cards than one network did", async () => {
    const { creditNetworkImpression } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    await store.adNetworks!.put({ ...zeekendConfig, zeekend: { placementId: "chat-main", paidCardsPerDay: 2 } } as never, "admin", NOW);
    await store.adNetworks!.put({ id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "", paidCardsPerDay: 2 } }, "admin", NOW);
    // A minute apart each, so the per-minute pace never decides.
    const earn = (slotId: string, minute: number) => creditNetworkImpression({ adNetworks: store.adNetworks, bumpDailyCount: (key, day) => store.bumpRequestCount(key, day), now: NOW + minute * 60_000 }, "dev-s", { slotId });
    expect((await earn("slot_split0001", 0)).credited).toBe(true);
    expect((await earn(IMPREZIA_CARD, 1)).credited).toBe(true);
    expect(await earn("slot_split0002", 2)).toEqual({ credited: false, reason: "daily-cap" });
  });

  it("paces paid cards per minute across every network", async () => {
    const { creditNetworkImpression, CARDS_PAID_PER_MINUTE } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    await store.adNetworks!.put({ id: "imprezia", name: "Imprezia", provider: "imprezia", enabled: true, priority: 10, viewPayoutMicros: "0", clickPayoutMicros: "0", imprezia: { kind: "chat", id: "" } }, "admin", NOW);
    const deps = { adNetworks: store.adNetworks, bumpDailyCount: (key: string, day: number) => store.bumpRequestCount(key, day), now: NOW };
    const ids = ["slot_pace0001", "slot_imp_1f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f", "slot_pace0002", "slot_imp_2f8e4f2c-6b1d-4c1e-9d55-3a2b1c0d9e8f"];
    const outcomes = [];
    for (const slotId of ids) outcomes.push(await creditNetworkImpression(deps, "dev-p", { slotId }));
    expect(outcomes.filter((one) => one.credited)).toHaveLength(CARDS_PAID_PER_MINUTE);
    expect(outcomes.at(-1)).toEqual({ credited: false, reason: "too-fast" });
  });

  it("pays the rate the admin set on the Zeekend connection, up to its daily cap", async () => {
    const { creditNetworkImpression } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    await store.adNetworks!.put({ ...zeekendConfig, zeekend: { placementId: "chat-main", payPerCardMicros: "5000", paidCardsPerDay: 2 } } as never, "admin", NOW);
    const deps = { adNetworks: store.adNetworks, bumpDailyCount: (key: string, day: number) => store.bumpRequestCount(key, day), now: NOW };
    expect(await creditNetworkImpression(deps, "dev-d", { network: "zeekend", slotId: "slot_rate0001" })).toEqual({ credited: true, micros: "5000" });
    expect(await creditNetworkImpression(deps, "dev-d", { network: "zeekend", slotId: "slot_rate0002" })).toEqual({ credited: true, micros: "5000" });
    expect(await creditNetworkImpression(deps, "dev-d", { network: "zeekend", slotId: "slot_rate0003" })).toEqual({ credited: false, reason: "daily-cap" });
    expect((await store.getBalance("dev-d")).lifetimeMicros).toBe(10_000n);
  });

  it("pays nothing at a rate of $0, without using up the slot", async () => {
    const { creditNetworkImpression } = await import("../src/networkImpressions.ts");
    const store = createMemoryStore();
    await store.adNetworks!.put({ ...zeekendConfig, zeekend: { placementId: "chat-main", payPerCardMicros: "0" } } as never, "admin", NOW);
    const deps = { adNetworks: store.adNetworks, bumpDailyCount: (key: string, day: number) => store.bumpRequestCount(key, day), now: NOW };
    expect(await creditNetworkImpression(deps, "dev-e", { network: "zeekend", slotId: "slot_free0001" })).toEqual({ credited: false, reason: "unpaid" });
    expect(await store.adNetworks!.delivery("dev-e", "slot_free0001")).toBeNull();
  });

  it("refuses a rate above $0.10 a card or a cap above 1,000 a day, and keeps the defaults when unset", async () => {
    const { parseAdNetworkConfig, zeekendPay } = await import("../src/adNetworkConfig.ts");
    expect(parseAdNetworkConfig({ ...zeekendConfig, zeekend: { placementId: "chat-main", payPerCardMicros: "100001" } })).toBeNull();
    expect(parseAdNetworkConfig({ ...zeekendConfig, zeekend: { placementId: "chat-main", paidCardsPerDay: 1001 } })).toBeNull();
    expect(parseAdNetworkConfig({ ...zeekendConfig, zeekend: { placementId: "chat-main", payPerCardMicros: "2.5" } })).toBeNull();
    const saved = parseAdNetworkConfig({ ...zeekendConfig, zeekend: { placementId: "chat-main", payPerCardMicros: "100000", paidCardsPerDay: 1000 } });
    expect(saved?.zeekend).toEqual({ placementId: "chat-main", payPerCardMicros: "100000", paidCardsPerDay: 1000 });
    expect(zeekendPay(parseAdNetworkConfig(zeekendConfig) ?? undefined)).toEqual({ payMicros: 2000, perDay: 300 });
  });
});
