/**
 * Ad safety (adSafety.ts, 2026-11-26): a new advertiser's first card waits for a person, cards
 * pay only verified accounts, an administrator can pause a network and release held earnings,
 * and the Imprezia relay refuses other sites and has a ceiling for everybody together.
 */
import { describe, expect, it } from "vitest";
import { createCampaign, createAdvertiser, createCreative } from "../src/advertisers.ts";
import { parseCampaign, parseCreative } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { handleSetCreativeStatus } from "../src/admin.ts";
import { creativeNeedsReview, createMemoryEarningHoldStore, DEFAULT_AD_SAFETY, parseAdSafety, parseHoldRelease, UNVERIFIED_CARD_MESSAGE } from "../src/adSafety.ts";
import { relayImprezia } from "../src/impreziaProxy.ts";
import type { TokenVerifier } from "../src/auth.ts";

const NOW = Date.UTC(2026, 10, 26);

describe("the settings", () => {
  it("defaults to reviewing new advertisers and paying only verified accounts", () => {
    expect(DEFAULT_AD_SAFETY).toMatchObject({ creativeReview: "new-advertisers", cardsNeedVerifiedEmail: true });
  });
  it("holds a card for review by the chosen rule", () => {
    expect(creativeNeedsReview({ creativeReview: "all" }, true)).toBe(true);
    expect(creativeNeedsReview({ creativeReview: "new-advertisers" }, false)).toBe(true);
    expect(creativeNeedsReview({ creativeReview: "new-advertisers" }, true)).toBe(false);
    expect(creativeNeedsReview({ creativeReview: "auto" }, false)).toBe(false);
  });
  it("accepts only the offered choices", () => {
    expect(parseAdSafety({ creativeReview: "all", cardsNeedVerifiedEmail: false })).toEqual({ creativeReview: "all", cardsNeedVerifiedEmail: false });
    expect(parseAdSafety({ creativeReview: "everyone", cardsNeedVerifiedEmail: true })).toBeNull();
    expect(parseAdSafety({ creativeReview: "all", cardsNeedVerifiedEmail: "yes" })).toBeNull();
    expect(parseAdSafety(null)).toBeNull();
  });
  it("releases one account or all, never something in between", () => {
    expect(parseHoldRelease({ uid: "u1" })).toEqual({ uid: "u1", reason: "zeekend-review" });
    expect(parseHoldRelease({ all: true })).toEqual({ uid: null, reason: "zeekend-review" });
    expect(parseHoldRelease({ uid: "u1", all: true })).toBeNull();
    expect(parseHoldRelease({})).toBeNull();
    expect(parseHoldRelease({ uid: "../x" })).toBeNull();
  });
});

describe("a new advertiser's first card", () => {
  const CAMPAIGN = { name: "Rust developers", cpmMicros: "8000000", budgetMicros: "50000000", targetTags: ["lang:rust"] };
  const CREATIVE = { advertiser: "Acme", headline: "Ship faster", body: "A tool for Rust teams", clickUrl: "https://acme.test/x", logoLight: "https://cdn.test/l.png", logoDark: "https://cdn.test/d.png" };

  async function funded() {
    const store = createMemoryStore();
    let counter = 0;
    const deps = { store, clock: { now: () => NOW }, ids: { next: (p: string) => `${p}-${++counter}` } };
    await createAdvertiser(deps, "u-1", { name: "Acme" });
    const advertiser = (await store.advertiserForOwner("u-1"))!;
    await store.putAdvertiser({ ...advertiser, fundedMicros: 100_000_000n });
    const campaign = await createCampaign(deps, "u-1", parseCampaign(CAMPAIGN)!);
    if (!campaign.ok) throw new Error("no campaign");
    return { store, deps, advertiser, campaignId: campaign.value.campaignId };
  }

  it("waits for an administrator, and goes live when approved", async () => {
    const { store, deps, advertiser, campaignId } = await funded();
    const first = await createCreative(deps, "u-1", parseCreative({ ...CREATIVE, campaignId })!, "https://api.test");
    expect(first.ok && first.value.status).toBe("pending");
    const status = async () => (await store.campaignsForAdvertiser(advertiser.advertiserId)).find((one) => one.campaignId === campaignId)?.status;
    expect(await status()).toBe("paused");
    expect(await store.creativesForCampaign(campaignId)).toHaveLength(0);

    await handleSetCreativeStatus({ store, clock: { now: () => NOW } } as never, "admin", first.ok ? first.value.creativeId : "", "approved");
    expect(await status()).toBe("active");
    expect(await store.creativesForCampaign(campaignId)).toHaveLength(1);

    // A known advertiser's next card goes live without waiting.
    const second = await createCreative(deps, "u-1", parseCreative({ ...CREATIVE, campaignId, headline: "Ship even faster" })!, "https://api.test");
    expect(second.ok && second.value.status).toBe("approved");
  });

  it("goes live at once when the administrator chose automatic approval", async () => {
    const { store, deps, campaignId } = await funded();
    await store.adSafety!.put({ creativeReview: "auto", cardsNeedVerifiedEmail: true }, "admin", NOW);
    const first = await createCreative(deps, "u-1", parseCreative({ ...CREATIVE, campaignId })!, "https://api.test");
    expect(first.ok && first.value.status).toBe("approved");
  });

  it("always waits when every card is reviewed", async () => {
    const { store, deps, campaignId } = await funded();
    await store.adSafety!.put({ creativeReview: "all", cardsNeedVerifiedEmail: true }, "admin", NOW);
    await createCreative(deps, "u-1", parseCreative({ ...CREATIVE, campaignId })!, "https://api.test");
    const pending = (await store.allCreativesForCampaign(campaignId))[0]!;
    await handleSetCreativeStatus({ store, clock: { now: () => NOW } } as never, "admin", pending.creativeId, "approved");
    const next = await createCreative(deps, "u-1", parseCreative({ ...CREATIVE, campaignId, headline: "Again" })!, "https://api.test");
    expect(next.ok && next.value.status).toBe("pending");
  });
});

describe("over HTTP", () => {
  const verifier: TokenVerifier = {
    async verify(token) {
      if (token === "boss") return { uid: "boss", claims: { email: "boss@example.com", email_verified: true } };
      return { uid: token, claims: {} };
    },
  };
  async function api() {
    const store = createMemoryStore();
    await store.addAdmin({ email: "boss@example.com", addedBy: "seed", addedAt: NOW });
    const handle = createFetchHandler({ store, clock: { now: () => NOW }, verifier });
    return { store, handle };
  }
  const earn = (uid: string) => new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" }, body: JSON.stringify({ network: "zeekend", slotId: "slot_verify001" }) });
  const admin = (path: string, init: RequestInit = {}) => new Request(`https://api.example.com/v1/admin/${path}`, { ...init, headers: { authorization: "Bearer boss", "content-type": "application/json", ...(init.headers ?? {}) } });

  it("pays no card to an account without a verified email, and says why", async () => {
    const { handle } = await api();
    const body = await (await handle(earn("anon1"))).json() as { credited: boolean; reason: string; message: string };
    expect(body).toEqual({ credited: false, reason: "verify", message: UNVERIFIED_CARD_MESSAGE });
  });

  it("lets an administrator read and change the switches", async () => {
    const { handle } = await api();
    const read = await (await handle(admin("ad-safety"))).json() as { settings: { creativeReview: string; cardsNeedVerifiedEmail: boolean } };
    expect(read.settings).toMatchObject({ creativeReview: "new-advertisers", cardsNeedVerifiedEmail: true });
    const saved = await handle(admin("ad-safety", { method: "PUT", body: JSON.stringify({ creativeReview: "all", cardsNeedVerifiedEmail: false }) }));
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as { settings: { updatedBy: string } }).settings).toMatchObject({ creativeReview: "all", cardsNeedVerifiedEmail: false, updatedBy: "boss" });
    // Off: an unverified account reaches the next check (no network configured here).
    const body = await (await handle(earn("anon2"))).json() as { reason: string };
    expect(body.reason).toBe("no-network");
    expect((await handle(admin("ad-safety", { method: "PUT", body: JSON.stringify({ creativeReview: "nobody" }) }))).status).toBe(400);
  });

  it("refuses the switches to anybody but an administrator", async () => {
    const { handle } = await api();
    const response = await handle(new Request("https://api.example.com/v1/admin/ad-safety", { headers: { authorization: "Bearer someone" } }));
    expect(response.status).toBe(403);
  });

  it("pauses a network by hand, shows it, and resumes it", async () => {
    const { handle } = await api();
    expect(((await (await handle(admin("ad-integrity/zeekend/pause", { method: "POST", body: JSON.stringify({ note: "partner dispute" }) }))).json()) as { opened: boolean }).opened).toBe(true);
    const read = await (await handle(admin("ad-safety"))).json() as { breakers: { network: string; open: boolean; reason: string }[]; alerts: { reason: string }[] };
    expect(read.breakers).toContainEqual(expect.objectContaining({ network: "zeekend", open: true, reason: "manual" }));
    expect(read.alerts[0]?.reason).toBe("manual");
    expect(((await (await handle(admin("ad-integrity/zeekend/reset", { method: "POST" }))).json()) as { closed: boolean }).closed).toBe(true);
  });

  it("lists held earnings and releases one account, then the rest", async () => {
    const { store, handle } = await api();
    const hold = (uid: string, micros: string) => ({ uid, reason: "zeekend-review", heldMicros: micros, sourceMicros: micros, alreadySpentMicros: "0", placedAt: NOW, placedBy: "boss", note: null });
    (store as { earningHolds?: unknown }).earningHolds = createMemoryEarningHoldStore([hold("a", "500"), hold("b", "2000"), hold("c", "40")]);
    const listed = await (await handle(admin("earning-holds"))).json() as { accounts: number; heldMicros: string; holds: { uid: string }[] };
    expect(listed).toMatchObject({ accounts: 3, heldMicros: "2540" });
    expect(listed.holds.map((one) => one.uid)).toEqual(["b", "a", "c"]);
    expect(await (await handle(admin("earning-holds/release", { method: "POST", body: JSON.stringify({ uid: "b" }) }))).json()).toEqual({ released: 1 });
    expect(await (await handle(admin("earning-holds/release", { method: "POST", body: JSON.stringify({ all: true }) }))).json()).toEqual({ released: 2 });
    expect((await handle(admin("earning-holds/release", { method: "POST", body: JSON.stringify({}) }))).status).toBe(400);
  });
});

describe("the Imprezia relay", () => {
  const deps = (counts = new Map<string, number>(), globalPerMinute?: number) => ({
    adNetworks: undefined,
    bump: async (bucket: string) => { const n = (counts.get(bucket) ?? 0) + 1; counts.set(bucket, n); return n; },
    now: () => NOW,
    allowedOrigins: ["https://adcode.bluethenics.com"],
    ...(globalPerMinute === undefined ? {} : { globalPerMinute }),
  });
  const request = (origin?: string, ip = "8.8.8.8") => ({ method: "POST", path: "/v1/monetize/append", body: "{}", contentType: "application/json", sdkVersion: undefined, sdkPlatform: "browser", userAgent: undefined, ip, ...(origin === undefined ? {} : { origin }) });

  it("refuses another site's page, and lets its own page, sandboxed frames and beacons through", async () => {
    expect((await relayImprezia(deps(), request("https://evil.example"))).status).toBe(403);
    // Allowed callers reach the key lookup; with no connection saved that answers not-configured.
    for (const origin of ["https://adcode.bluethenics.com", "null", undefined]) expect((await relayImprezia(deps(), request(origin))).status).toBe(503);
  });

  it("has one ceiling for everybody together, and a small one for callers with no address", async () => {
    const counts = new Map<string, number>();
    const tight = deps(counts, 3);
    const statuses = [];
    for (let index = 0; index < 4; index++) statuses.push((await relayImprezia(tight, request(undefined, `8.8.8.${index + 1}`))).status);
    expect(statuses).toEqual([503, 503, 503, 429]);
    const unlocated = deps();
    const answers = [];
    for (let index = 0; index < 31; index++) answers.push((await relayImprezia(unlocated, request(undefined, "10.0.0.1"))).status);
    expect(answers.at(-1)).toBe(429);
    expect(answers.filter((status) => status === 429)).toHaveLength(1);
  });
});
