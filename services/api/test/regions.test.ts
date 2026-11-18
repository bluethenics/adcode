import { describe, expect, it } from "vitest";
import { parseCampaign, parseServeRequest } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { MAX_REGIONS, campaignMatches, regionsOf, requestRegionTag } from "../src/regions.ts";
import { handleServe } from "../src/serve.ts";

const body = (targetTags: unknown) => ({ name: "Geo test", cpmMicros: "2000000", budgetMicros: "10000000", targetTags });

describe("region targeting", () => {
  it("requires a region match on top of any context match", () => {
    const rustInGermany = ["lang:rust", "geo:DE"];
    expect(campaignMatches(rustInGermany, ["lang:rust", "geo:DE"])).toBe(true);
    expect(campaignMatches(rustInGermany, ["lang:rust", "geo:US"])).toBe(false);
    expect(campaignMatches(rustInGermany, ["lang:python", "geo:DE"])).toBe(false);
    expect(campaignMatches(rustInGermany, ["lang:rust"])).toBe(false);
    // Regions alone, contexts alone, and neither.
    expect(campaignMatches(["geo:US", "geo:CA"], ["lang:go", "geo:CA"])).toBe(true);
    expect(campaignMatches(["lang:go"], ["lang:go", "geo:IN"])).toBe(true);
    expect(campaignMatches([], ["geo:IN"])).toBe(true);
  });

  it("reads the country from the edge header only, ignoring unknown ones", () => {
    expect(requestRegionTag("de")).toBe("geo:DE");
    expect(requestRegionTag("XX")).toBeNull();
    expect(requestRegionTag("T1")).toBeNull();
    expect(requestRegionTag(undefined)).toBeNull();
  });

  it("keeps campaign countries, drops made-up ones, and refuses too many", () => {
    expect(parseCampaign(body(["lang:rust", "geo:DE", "geo:ZZ", "geo:de"]))?.targetTags).toEqual(["lang:rust", "geo:DE"]);
    expect(regionsOf(["lang:rust", "geo:DE", "geo:FR"])).toEqual(["DE", "FR"]);
    const many = ["US", "CA", "GB", "IE", "DE", "AT", "CH", "FR", "ES", "PT", "IT", "NL", "BE", "LU", "DK", "SE", "NO", "FI", "IS", "PL", "CZ", "SK", "HU", "RO", "BG", "GR", "HR", "SI", "EE", "LV", "LT", "CY", "MT", "TR", "IL", "AE", "SA", "QA", "IN", "PK", "BD", "LK", "NP", "SG", "MY", "TH", "VN", "PH", "ID", "JP", "KR", "TW", "HK", "AU", "NZ", "BR", "AR", "MX", "CL", "CO", "PE"];
    expect(many.length).toBeGreaterThan(MAX_REGIONS);
    expect(parseCampaign(body(many.map((code) => `geo:${code}`)))).toBeNull();
  });

  it("never lets the client claim a region in a serve request", () => {
    expect(parseServeRequest({ tags: ["lang:rust", "geo:DE"], themeKind: "dark", count: 1 })?.tags).toEqual(["lang:rust"]);
  });

  it("serves a region-targeted campaign only where it was bought", async () => {
    const store = createMemoryStore();
    await store.putCampaign({ campaignId: "camp-de", advertiserId: "adv-1", name: "DE", createdAt: 0, cpmMicros: 8_000_000n, budgetMicros: 1_000_000n, targetTags: ["lang:rust", "geo:DE"], status: "active" });
    await store.putCreative({ creativeId: "c-de", campaignId: "camp-de", advertiser: "Acme", headline: "Hallo", body: null, clickUrl: "https://acme.test/x", logoLight: "https://cdn.test/l.png", logoDark: "https://cdn.test/d.png", status: "approved" });
    let n = 0;
    const deps = { store, clock: { now: () => 5_000 }, ids: { next: (p: string) => `${p}-${++n}` }, random: () => 0 };

    const inGermany = await handleServe(deps, "u-1", { tags: ["lang:rust", "geo:DE"], themeKind: "dark", count: 1 });
    const elsewhere = await handleServe(deps, "u-2", { tags: ["lang:rust", "geo:US"], themeKind: "dark", count: 1 });
    const unknown = await handleServe(deps, "u-3", { tags: ["lang:rust"], themeKind: "dark", count: 1 });

    expect(inGermany.creatives.map((c) => c.creativeId)).toEqual(["c-de"]);
    expect(elsewhere.creatives.filter((c) => c.creativeId === "c-de")).toEqual([]);
    expect(unknown.creatives.filter((c) => c.creativeId === "c-de")).toEqual([]);
  });
});
