import { describe, it, expect, beforeEach } from "vitest";
import { handleServe } from "../src/serve.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => 5_000 },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: ["lang:rust"],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: "A tool for Rust teams",
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });
});

describe("handleServe", () => {
  it("returns a matching creative", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toHaveLength(1);
    expect(res.creatives[0]?.creativeId).toBe("c-1");
    expect(res.creatives[0]?.headline).toBe("Ship faster");
  });

  it("writes a serve record, so the matching receipt can later be trusted", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(await store.findServe("u-1", "c-1", 5_500)).not.toBeNull();
  });

  it("gives that record a TTL from config", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    const beyondTtl = 5_000 + DEFAULT_CONFIG.serveTtlMs + 1;
    expect(await store.findServe("u-1", "c-1", beyondTtl)).toBeNull();
  });

  it("reports the same TTL to the client that it enforces", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives[0]?.ttlMs).toBe(DEFAULT_CONFIG.serveTtlMs);
  });

  it("serves nothing when the kill switch is on", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("writes no serve record when the kill switch is on", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(await store.findServe("u-1", "c-1", 5_500)).toBeNull();
  });

  it("serves nothing when no campaign matches the tags", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:php"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("skips a campaign with no approved creative", async () => {
    await store.putCreative({
      creativeId: "c-1",
      campaignId: "camp-1",
      advertiser: "Acme",
      headline: "Ship faster",
      body: null,
      clickUrl: "https://acme.test/x",
      logoLight: "https://cdn.test/l.png",
      logoDark: "https://cdn.test/d.png",
      status: "pending",
    });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("never exceeds the count asked for", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 0 });
    expect(res.creatives).toEqual([]);
  });

  it("serves nothing to a campaign that has exhausted its budget", async () => {
    await store.addSpend("camp-1", 1_000_000n);
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });
});
