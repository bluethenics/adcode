import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DAY_MS, sourceFactsFrom } from "../src/referrals.ts";
import {
  DEFAULT_REFERRAL_CONFIG,
  type AttributionRecord,
  type CreditOrderRecord,
  type RefCodeRecord,
  type Store,
} from "../src/store.ts";

const DAY = "2026-10-06";
const START = Date.parse(`${DAY}T00:00:00.000Z`);
const NOON = START + DAY_MS / 2;
const NOW = START + DAY_MS + 3_600_000;

const code = (value: string, ownerUid: string | null, createdAt = START - 10 * DAY_MS): RefCodeRecord => ({
  code: value, ownerUid, label: "", active: true, showName: true, createdAt,
});

const attribution = (subjectKind: "user" | "advertiser", subjectId: string, referrerUid: string | null, codeValue = "samcode1"): AttributionRecord => ({
  subjectKind, subjectId, code: codeValue, referrerUid, how: "paste", claimedAt: START - DAY_MS,
});

let receiptSeq = 0;
async function view(store: Store, uid: string, campaignId: string, costMicros: bigint, at = NOON): Promise<void> {
  await store.createReceiptIfAbsent({
    receiptId: `r-${++receiptSeq}`, uid, creativeId: "cr", campaignId, outcome: "impression",
    creditedMicros: costMicros / 2n, costMicros, createdAt: at,
  });
}

/** Sam invited `viewer`; Kim brought advertiser `adv-x`. */
async function world(store: Store): Promise<void> {
  for (const uid of ["sam", "kim", "viewer", "stranger"]) {
    await store.putUser({ uid, status: "active", createdAt: START - 20 * DAY_MS });
  }
  for (const [advertiserId, campaignId] of [["adv-x", "camp-x"], ["adv-o", "camp-o"]] as const) {
    await store.putAdvertiser({ advertiserId, name: advertiserId, ownerUids: ["boss"], status: "active", fundedMicros: 0n, reservedMicros: 0n, createdAt: START - 30 * DAY_MS });
    await store.putCampaign({ campaignId, advertiserId, name: campaignId, createdAt: START - 30 * DAY_MS, cpmMicros: 8_000_000n, budgetMicros: 1_000_000_000n, targetTags: [], status: "active" });
  }
  await store.createRefCode(code("samcode1", "sam"));
  await store.createRefCode(code("kimcode1", "kim"));
  await store.createAttribution(attribution("user", "viewer", "sam"));
  await store.createAttribution(attribution("advertiser", "adv-x", "kim", "kimcode1"));
}

describe("referral store (in memory)", () => {
  let store: ReturnType<typeof createMemoryStore>;
  beforeEach(() => {
    store = createMemoryStore();
  });

  it("starts with the published terms and keeps whatever an admin saves", async () => {
    expect(await store.getReferralConfig()).toEqual(DEFAULT_REFERRAL_CONFIG);
    const next = { ...DEFAULT_REFERRAL_CONFIG, userPercent: 12n, houseAdvertiserIds: ["adv-house"] };
    await store.putReferralConfig(next);
    expect(await store.getReferralConfig()).toEqual(next);
  });

  it("gives each code to one owner, and each owner one code", async () => {
    expect(await store.createRefCode(code("k7p4qzm", "sam"))).toBe(true);
    expect(await store.createRefCode(code("k7p4qzm", "kim"))).toBe(false);
    expect(await store.createRefCode(code("other23", "sam"))).toBe(false);
    expect(await store.refCodeForOwner("sam")).toEqual(code("k7p4qzm", "sam"));
    expect(await store.getRefCode("k7p4qzm")).toEqual(code("k7p4qzm", "sam"));
    expect(await store.getRefCode("missing")).toBeNull();
  });

  it("lets two requests race to make an owner's code and keeps exactly one", async () => {
    const results = await Promise.all([store.createRefCode(code("aaaaaaa", "sam")), store.createRefCode(code("bbbbbbb", "sam"))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.refCodeForOwner("sam"))?.code).toMatch(/^(aaaaaaa|bbbbbbb)$/);
  });

  it("allows many campaign codes and lists only those, newest first", async () => {
    await store.createRefCode(code("threads-oct06", null, 2));
    await store.createRefCode(code("x-ad-3", null, 3));
    await store.createRefCode(code("k7p4qzm", "sam", 4));
    expect((await store.listCampaignCodes()).map((c) => c.code)).toEqual(["x-ad-3", "threads-oct06"]);
  });

  it("changes a code's label, switch and name preference, and nothing else", async () => {
    await store.createRefCode(code("threads-oct06", null));
    expect(await store.updateRefCode("threads-oct06", { label: "Store launch", active: false })).toEqual({
      ...code("threads-oct06", null), label: "Store launch", active: false,
    });
    expect((await store.updateRefCode("threads-oct06", { showName: false }))?.showName).toBe(false);
    expect(await store.updateRefCode("missing", { label: "x" })).toBeNull();
  });

  it("keeps the first claim and refuses every later one", async () => {
    expect(await store.createAttribution(attribution("user", "viewer", "sam"))).toBe(true);
    expect(await store.createAttribution(attribution("user", "viewer", "kim"))).toBe(false);
    expect((await store.getAttribution("user", "viewer"))?.referrerUid).toBe("sam");
    expect(await store.getAttribution("advertiser", "viewer")).toBeNull();
  });

  it("pays a day once, however many times it is settled", async () => {
    await world(store);
    await view(store, "viewer", "camp-x", 8000n);

    expect(await store.settleReferrals(DAY, NOW)).toEqual({ referrers: 2, micros: 1200n });
    expect(await store.getBalance("sam")).toEqual({ availableMicros: 800n, lifetimeMicros: 800n, pendingWithdrawalMicros: 0n });
    expect(await store.getBalance("kim")).toEqual({ availableMicros: 400n, lifetimeMicros: 400n, pendingWithdrawalMicros: 0n });

    expect(await store.settleReferrals(DAY, NOW + 1)).toEqual({ referrers: 0, micros: 0n });
    const both = await Promise.all([store.settleReferrals(DAY, NOW + 2), store.settleReferrals(DAY, NOW + 3)]);
    expect(both).toEqual([{ referrers: 0, micros: 0n }, { referrers: 0, micros: 0n }]);
    expect((await store.getBalance("sam")).availableMicros).toBe(800n);

    const [entry] = (await store.listEntries("sam", { limit: 10, cursor: null })).rows;
    expect(entry).toMatchObject({ entryId: `referral:sam:${DAY}`, kind: "referral", micros: 800n, refId: DAY });
  });

  it("pays nothing on the house advertiser or an advertiser whose payment was disputed", async () => {
    await world(store);
    await store.putReferralConfig({ ...DEFAULT_REFERRAL_CONFIG, houseAdvertiserIds: ["adv-o"] });
    await view(store, "viewer", "camp-o", 8000n);
    const disputed: CreditOrderRecord = {
      orderId: "o1", advertiserId: "adv-x", amountMicros: 10_000_000n, currency: "USD", billingCountry: "GB", customerEmail: "a@b.c",
      status: "disputed", providerSessionId: null, checkoutUrl: null, providerPaymentId: null, createdAt: START, updatedAt: START,
    };
    await store.createCreditOrder(disputed);
    await view(store, "stranger", "camp-x", 8000n);

    expect(await store.settleReferrals(DAY, NOW)).toEqual({ referrers: 0, micros: 0n });
  });

  it("sums up what a referrer brought and earned", async () => {
    await world(store);
    await view(store, "viewer", "camp-o", 8000n);
    await store.recordMilestones("viewer", [{ name: "welcome_shown", at: START - DAY_MS }, { name: "turn_ok", at: START }]);
    await store.settleReferrals(DAY, NOW);

    expect(await store.referralSummary("sam", NOW)).toEqual({ claimed: 1, seen: 1, cameBack: 1, advertisers: 0, earnedMicros: 800n, last30Micros: 800n });
    expect(await store.referralSummary("kim", NOW)).toEqual({ claimed: 0, seen: 0, cameBack: 0, advertisers: 1, earnedMicros: 0n, last30Micros: 0n });
  });

  it("reports the same facts the pure function computes, with what was really paid", async () => {
    await world(store);
    await view(store, "viewer", "camp-o", 8000n);
    await store.settleReferrals(DAY, NOW);

    const facts = await store.referralSourceFacts(START - 30 * DAY_MS);
    const viewer = facts.find((f) => f.subjectId === "viewer");
    expect(viewer).toMatchObject({ code: "samcode1", referrerUid: "sam", grossMicros: 8000n, creditedMicros: 4000n, paidMicros: 800n });
    // Accounts nobody claimed are the Unknown row.
    expect(facts.filter((f) => f.code === null).map((f) => f.subjectId).sort()).toEqual(["kim", "sam", "stranger"]);
    expect(facts).toEqual(
      sourceFactsFrom({
        since: START - 30 * DAY_MS,
        users: [
          { uid: "sam", status: "active", createdAt: START - 20 * DAY_MS },
          { uid: "kim", status: "active", createdAt: START - 20 * DAY_MS },
          { uid: "viewer", status: "active", createdAt: START - 20 * DAY_MS },
          { uid: "stranger", status: "active", createdAt: START - 20 * DAY_MS },
        ],
        attributions: [attribution("user", "viewer", "sam"), attribution("advertiser", "adv-x", "kim", "kimcode1")],
        sightings: [],
        receipts: [{ receiptId: "x", uid: "viewer", creativeId: "cr", campaignId: "camp-o", outcome: "impression", creditedMicros: 4000n, costMicros: 8000n, createdAt: NOON }],
        campaignAdvertiser: new Map([["camp-x", "adv-x"], ["camp-o", "adv-o"]]),
        houseAdvertiserIds: [],
        shares: [{ day: DAY, referrerUid: "sam", subjectKind: "user", subjectId: "viewer", baseMicros: 8000n, shareMicros: 800n }],
      }),
    );
  });

  it("says who invited an account and whom it invited", async () => {
    await world(store);
    expect(await store.referralsForUser("viewer")).toEqual({ invitedBy: attribution("user", "viewer", "sam"), invited: [] });
    expect(await store.referralsForUser("sam")).toEqual({ invitedBy: null, invited: [attribution("user", "viewer", "sam")] });
  });

  it("forgets everything on reset", async () => {
    await world(store);
    store.reset();
    expect(await store.getRefCode("samcode1")).toBeNull();
    expect(await store.getAttribution("user", "viewer")).toBeNull();
    expect(await store.getReferralConfig()).toEqual(DEFAULT_REFERRAL_CONFIG);
  });
});
