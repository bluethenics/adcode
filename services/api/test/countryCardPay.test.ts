import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { creditNetworkImpression, sponsoredCardRate } from "../src/networkImpressions.ts";
import { parseAdNetworkConfig, parseCountryPay, zeekendPay, type AdNetworkConfig } from "../src/adNetworkConfig.ts";
import { EDGE_COUNTRY, edgeCountry } from "../src/regions.ts";
import type { TokenVerifier } from "../src/auth.ts";

/*
 * Pay per Zeekend card by the viewer's country (2026-11-24): the country is the edge's, a listed
 * country pays its own row, anywhere else the default, and no row may pay more than it earns.
 */
const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };
const NOW = Date.parse("2026-11-24T12:00:00Z");
const zeekend = (extra: Record<string, unknown> = {}): AdNetworkConfig => ({
  id: "zeekend", name: "Zeekend", provider: "zeekend", enabled: true, priority: 5, viewPayoutMicros: "0", clickPayoutMicros: "0",
  zeekend: {
    placementId: "chat-main", payPerCardMicros: "1000", paidCardsPerDay: 300,
    countryPay: [
      { country: "US", payPerCardMicros: "6000", earnPerCardMicros: "10000" },
      { country: "IN", payPerCardMicros: "300", earnPerCardMicros: "600", paidCardsPerDay: 2 },
    ],
    ...extra,
  },
});

describe("the viewer's country", () => {
  it("comes from the edge's stamp when there is one, and then no header can override it", () => {
    expect(edgeCountry({ headers: { "cf-ipcountry": "US" }, [EDGE_COUNTRY]: "IN" })).toBe("IN");
    expect(edgeCountry({ headers: { "cf-ipcountry": "US" }, [EDGE_COUNTRY]: null })).toBeNull();
  });
  it("falls back to cf-ipcountry only with no edge in front, and is null for anything not a real country", () => {
    expect(edgeCountry({ headers: { "cf-ipcountry": " de " } })).toBe("DE");
    expect(edgeCountry({ headers: { "cf-ipcountry": ["gb", "US"] } })).toBe("GB");
    for (const header of ["XX", "T1", "", "USA", "zz", undefined]) expect(edgeCountry({ headers: { "cf-ipcountry": header } })).toBeNull();
  });
});

describe("choosing the rate", () => {
  it("pays a listed country its own rate and its own cap, or the default cap", () => {
    expect(zeekendPay(zeekend(), "US")).toEqual({ payMicros: 6000, perDay: 300, country: "US", listed: true });
    expect(zeekendPay(zeekend(), "IN")).toEqual({ payMicros: 300, perDay: 2, country: "IN", listed: true });
  });
  it("pays the default for an unlisted, unknown or missing country", () => {
    expect(zeekendPay(zeekend(), "FR")).toEqual({ payMicros: 1000, perDay: 300, country: "FR", listed: false });
    expect(zeekendPay(zeekend(), null)).toEqual({ payMicros: 1000, perDay: 300, country: null, listed: false });
    expect(zeekendPay(zeekend(), "T1")).toEqual({ payMicros: 1000, perDay: 300, country: null, listed: false });
    expect(zeekendPay(undefined, "US")).toEqual({ payMicros: 2000, perDay: 300, country: "US", listed: false });
  });
});

describe("saving the table", () => {
  it("keeps valid rows, sorted, and drops an empty table", () => {
    expect(parseAdNetworkConfig(zeekend())?.zeekend?.countryPay?.map((row) => row.country)).toEqual(["IN", "US"]);
    expect(parseAdNetworkConfig(zeekend({ countryPay: [] }))?.zeekend?.countryPay).toBeUndefined();
  });
  it("refuses a row that pays more than a card earns there, or a default that does", () => {
    expect(parseCountryPay([{ country: "BR", payPerCardMicros: "2001", earnPerCardMicros: "2000" }])).toBeNull();
    expect(parseCountryPay([{ country: "BR", payPerCardMicros: "2000", earnPerCardMicros: "2000" }])).not.toBeNull();
    expect(parseAdNetworkConfig(zeekend({ defaultEarnPerCardMicros: "999" }))).toBeNull();
    expect(parseAdNetworkConfig(zeekend({ defaultEarnPerCardMicros: "1500" }))?.zeekend?.defaultEarnPerCardMicros).toBe("1500");
  });
  it("refuses unknown or repeated countries, bad amounts, and caps past the ceiling", () => {
    for (const rows of [
      [{ country: "XX", payPerCardMicros: "100" }],
      [{ country: "us", payPerCardMicros: "100" }],
      [{ country: "US", payPerCardMicros: "100" }, { country: "US", payPerCardMicros: "200" }],
      [{ country: "US", payPerCardMicros: "100001" }],
      [{ country: "US", payPerCardMicros: "1.5" }],
      [{ country: "US", payPerCardMicros: "100", paidCardsPerDay: 1001 }],
      [{ country: "US", payPerCardMicros: "100", earnPerCardMicros: "1000001" }],
      "US,0.002",
    ]) expect(parseCountryPay(rows)).toBeNull();
    expect(parseAdNetworkConfig(zeekend({ countryPay: [{ country: "XX", payPerCardMicros: "1" }] }))).toBeNull();
  });
});

describe("paying a card", () => {
  async function setup(config = zeekend()) {
    const store = createMemoryStore();
    await store.adNetworks!.put(config, "admin", NOW);
    const deps = (country: string | null) => ({ adNetworks: store.adNetworks, bumpDailyCount: (key: string, day: number) => store.bumpRequestCount(key, day), now: NOW, country });
    return { store, deps };
  }
  it("credits the country's rate, and the default where unlisted", async () => {
    const { deps } = await setup();
    expect(await creditNetworkImpression(deps("US"), "u1", { network: "zeekend", slotId: "slot_country01" })).toEqual({ credited: true, micros: "6000" });
    expect(await creditNetworkImpression(deps("FR"), "u1", { network: "zeekend", slotId: "slot_country02" })).toEqual({ credited: true, micros: "1000" });
    expect(await creditNetworkImpression(deps(null), "u1", { network: "zeekend", slotId: "slot_country03" })).toEqual({ credited: true, micros: "1000" });
  });
  it("stops at the country's own cap", async () => {
    const { deps, store } = await setup();
    expect(await creditNetworkImpression(deps("IN"), "u2", { network: "zeekend", slotId: "slot_capin001" })).toEqual({ credited: true, micros: "300" });
    expect(await creditNetworkImpression(deps("IN"), "u2", { network: "zeekend", slotId: "slot_capin002" })).toEqual({ credited: true, micros: "300" });
    expect(await creditNetworkImpression(deps("IN"), "u2", { network: "zeekend", slotId: "slot_capin003" })).toEqual({ credited: false, reason: "daily-cap" });
    expect((await store.getBalance("u2")).lifetimeMicros).toBe(600n);
  });
  it("pays nothing in a country set to $0, without using up the slot", async () => {
    const { deps, store } = await setup(zeekend({ countryPay: [{ country: "RU", payPerCardMicros: "0" }] }));
    expect(await creditNetworkImpression(deps("RU"), "u3", { network: "zeekend", slotId: "slot_zero0001" })).toEqual({ credited: false, reason: "unpaid" });
    expect(await store.adNetworks!.delivery("u3", "slot_zero0001")).toBeNull();
  });
});

describe("the earn and rate routes", () => {
  async function api(country: (request: Request) => string | undefined) {
    const store = createMemoryStore();
    await store.adNetworks!.put(zeekend(), "admin", NOW);
    // A live key: a connection with a test key, or none, pays nobody (adNetworks.ts servesTestCards).
    const encryption = Buffer.alloc(32, 9).toString("base64");
    const { encryptAdNetworkKey } = await import("../src/adNetworkCrypto.ts");
    await store.adNetworks!.putKey("zeekend", encryptAdNetworkKey("zeekend", "pub_live_abc123XYZ", encryption));
    return createFetchHandler({ store, clock: { now: () => NOW }, verifier, tagflow: { country }, adNetworks: { encryptionKeys: () => [encryption] } });
  }
  const earn = (slotId: string, headers: Record<string, string> = {}) => new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", headers: { authorization: "Bearer u9", "content-type": "application/json", ...headers }, body: JSON.stringify({ network: "zeekend", slotId }) });
  const rate = (headers: Record<string, string> = {}) => new Request("https://api.example.com/v1/sponsored/rate", { headers: { authorization: "Bearer u9", ...headers } });

  it("pays the edge's country, not a country header the caller sends", async () => {
    const handle = await api(() => "IN");
    expect(await (await handle(earn("slot_route001", { "cf-ipcountry": "US" }))).json()).toEqual({ credited: true, micros: "300" });
  });
  it("pays the default when the edge knows no country, even with a header", async () => {
    const handle = await api(() => undefined);
    expect(await (await handle(earn("slot_route002", { "cf-ipcountry": "US" }))).json()).toEqual({ credited: true, micros: "1000" });
  });
  it("pays the default when reading the country fails", async () => {
    const handle = await api(() => { throw new Error("no context"); });
    expect(await (await handle(earn("slot_route003"))).json()).toEqual({ credited: true, micros: "1000" });
  });
  it("tells a person their own rate and cap, and nothing about what ADCode earns", async () => {
    const handle = await api(() => "US");
    const response = await handle(rate());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ country: "US", countryRate: true, payPerCardMicros: "6000", paidCardsPerDay: 300, paying: true });
    expect(JSON.stringify(body)).not.toMatch(/earn|10000/);
  });
  it("needs a signed-in account for the rate", async () => {
    const handle = await api(() => "US");
    expect((await handle(new Request("https://api.example.com/v1/sponsored/rate"))).status).toBe(401);
  });
  it("says cards pay nothing with no live Zeekend connection", async () => {
    expect(await sponsoredCardRate(createMemoryStore().adNetworks, "US")).toEqual({ country: "US", countryRate: false, payPerCardMicros: "0", paidCardsPerDay: 0, paying: false });
  });
});
