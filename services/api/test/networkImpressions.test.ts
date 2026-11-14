import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryNetworkImpressionStore, parseNetworkImpression, withNetworkImpressions } from "../src/networkImpressions.ts";
import type { GrowthStats } from "../src/store.ts";
import type { TokenVerifier } from "../src/auth.ts";

const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");

describe("a Zeekend impression reported by the sponsored page", () => {
  it("is taken only with Zeekend's slot id shape and a known network", () => {
    expect(parseNetworkImpression({ network: "zeekend", slotId: "slot_p5b3lgsceh", layout: "banner" })).toEqual({ network: "zeekend", slotId: "slot_p5b3lgsceh", layout: "banner" });
    expect(parseNetworkImpression({ network: "zeekend", slotId: "slot_p5b3lgsceh" })?.layout).toBe("reply");
    expect(parseNetworkImpression({ network: "imprezia", slotId: "slot_p5b3lgsceh" })).toBeNull();
    expect(parseNetworkImpression({ network: "zeekend", slotId: "<script>" })).toBeNull();
    expect(parseNetworkImpression("slot_x")).toBeNull();
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
    const api = createFetchHandler({ store, clock: { now: () => NOW }, verifier });
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
    const outcome = await creditNetworkImpression({ adNetworks: store.adNetworks, bumpDailyCount: async () => ++count, now: NOW }, "dev-c", { network: "zeekend", slotId: "slot_cap00001" });
    expect(outcome).toEqual({ credited: false, reason: "daily-cap" });
  });
});
