import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";
import type { TokenVerifier } from "../src/auth.ts";
import {
  assessIdentity,
  CUSTOM_DOMAIN_FAST_CARDS,
  emailDomain,
  isDisposable,
  isPublicMailbox,
  mailboxKey,
  TOO_FAST_PER_DAY,
} from "../src/earningReview.ts";
import { evaluateEligibility } from "../src/withdrawals.ts";

const verifier: TokenVerifier = { async verify(token) { return { uid: token, claims: {} }; } };
const NOW = Date.parse("2026-11-24T12:00:00Z");
const zeekendConfig = { id: "zeekend", name: "Zeekend", provider: "zeekend" as const, enabled: true, priority: 5, viewPayoutMicros: "0", clickPayoutMicros: "0", zeekend: { placementId: "chat-main" } };
const none = { domainAccounts: 1, mailboxAccounts: 1 };

describe("who an address belongs to", () => {
  it("reads the domain and folds a mailbox's dots and plus tags", () => {
    expect(emailDomain(" Alice@Example.COM ")).toBe("example.com");
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(mailboxKey("A.Lice+ads1@gmail.com")).toBe("alice@gmail.com");
    expect(mailboxKey("alice@googlemail.com")).toBe("alice@gmail.com");
    // Only Gmail ignores dots; elsewhere they are a different mailbox.
    expect(mailboxKey("a.lice+x@outlook.com")).toBe("a.lice@outlook.com");
  });

  it("tells public mailboxes from custom domains, and not by name alone", () => {
    expect(isPublicMailbox("gmail.com")).toBe(true);
    expect(isPublicMailbox("hotmail.co.uk")).toBe(true);
    expect(isPublicMailbox("yahoo.fr")).toBe(true);
    expect(isPublicMailbox("gmail.xyz")).toBe(false);
    expect(isPublicMailbox("acme-farm.com")).toBe(false);
    expect(isDisposable("mailinator.com")).toBe(true);
    expect(isDisposable("inbox.mailinator.com")).toBe(true);
    expect(isDisposable("gmail.com")).toBe(false);
  });
});

describe("what gets an account looked at", () => {
  it("leaves Gmail and anonymous accounts alone, however much they earn", () => {
    expect(assessIdentity({ email: "dev@gmail.com", signals: { domainAccounts: 9_000, mailboxAccounts: 1 }, trusted: false, cardsToday: 300 })).toEqual([]);
    expect(assessIdentity({ email: undefined, signals: none, trusted: false })).toEqual([]);
  });

  it("holds a throwaway inbox and a mailbox behind two accounts", () => {
    expect(assessIdentity({ email: "x@yopmail.com", signals: none, trusted: false })).toEqual(["disposable-email"]);
    expect(assessIdentity({ email: "a.l.i.c.e@gmail.com", signals: { domainAccounts: 9, mailboxAccounts: 2 }, trusted: false })).toEqual(["duplicate-mailbox"]);
  });

  it("holds a custom domain several accounts share, or that earns fast - unless an administrator trusted it", () => {
    expect(assessIdentity({ email: "a@farm.example", signals: { domainAccounts: 2, mailboxAccounts: 1 }, trusted: false })).toEqual([]);
    expect(assessIdentity({ email: "a@farm.example", signals: { domainAccounts: 3, mailboxAccounts: 1 }, trusted: false })).toEqual(["custom-domain-shared"]);
    expect(assessIdentity({ email: "me@mysite.dev", signals: none, trusted: false, cardsToday: CUSTOM_DOMAIN_FAST_CARDS })).toEqual(["custom-domain-fast"]);
    expect(assessIdentity({ email: "a@uni.edu", signals: { domainAccounts: 40, mailboxAccounts: 1 }, trusted: true, cardsToday: 200 })).toEqual([]);
  });
});

describe("earning while held", () => {
  async function ready() {
    const store = createMemoryStore();
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    // A live key: cards from a connection with a test key, or none, pay nobody (adNetworks.ts servesTestCards).
    const encryption = Buffer.alloc(32, 9).toString("base64");
    const { encryptAdNetworkKey } = await import("../src/adNetworkCrypto.ts");
    await store.adNetworks!.putKey("zeekend", encryptAdNetworkKey("zeekend", "pub_live_abc123XYZ", encryption));
    let now = NOW;
    const api = createFetchHandler({ store, clock: { now: () => now }, verifier, adNetworks: { encryptionKeys: () => [encryption] } });
    const earn = async (uid: string, slotId: string) => (await api(new Request("https://api.example.com/v1/sponsored/earn", { method: "POST", headers: { authorization: `Bearer ${uid}`, "content-type": "application/json" }, body: JSON.stringify({ network: "zeekend", slotId }) }))).json() as Promise<Record<string, unknown>>;
    const user = async (uid: string, email: string) => store.putUser({ uid, status: "active", createdAt: NOW - 30 * 86_400_000, email, emailVerified: true });
    return { store, earn, user, tick: (ms: number) => { now += ms; } };
  }

  it("holds the third account on one custom domain at its first card, and pays the first two", async () => {
    const { store, earn, user, tick } = await ready();
    await user("farm-1", "one@catchall.example");
    await user("farm-2", "two@catchall.example");
    expect((await earn("farm-1", "slot_farm0001"))["credited"]).toBe(true);
    expect((await earn("farm-2", "slot_farm0002"))["credited"]).toBe(true);
    await user("farm-3", "three@catchall.example");
    tick(60_000);
    const held = await earn("farm-3", "slot_farm0003");
    expect(held).toMatchObject({ credited: false, reason: "review" });
    expect((await store.earningReviews!.get("farm-3"))?.reasons).toEqual(["custom-domain-shared"]);
    // The first two are looked at again at their next day's first card.
    tick(86_400_000);
    expect((await earn("farm-1", "slot_farm0004"))["reason"]).toBe("review");
  });

  it("refuses conversion and payout while held, and lets everything through once cleared", async () => {
    const { store, earn, user } = await ready();
    await user("throw", "x@mailinator.com");
    expect((await earn("throw", "slot_thrw0001"))["reason"]).toBe("review");
    const { handleConversionQuote } = await import("../src/earningsConversionRoutes.ts");
    expect((await handleConversionQuote(store, "throw", NOW)).body["blocked"]).toBe("review");
    await store.earningReviews!.decide({ uid: "throw", status: "cleared", adminUid: "admin", note: null, now: NOW });
    expect((await earn("throw", "slot_thrw0002"))["credited"]).toBe(true);
    // Cleared stays cleared: the same identity is not held again.
    expect((await handleConversionQuote(store, "throw", NOW)).body["blocked"]).not.toBe("review");
  });

  it("pays one screen's worth of cards a minute, however many tabs claim them", async () => {
    const { earn, user, tick } = await ready();
    await user("tabs", "me@gmail.com");
    const results: unknown[] = [];
    for (let i = 0; i < 6; i++) results.push((await earn("tabs", `slot_tabs000${i}`))["reason"] ?? "credited");
    expect(results).toEqual(["credited", "credited", "credited", "too-fast", "too-fast", "too-fast"]);
    tick(60_000);
    expect((await earn("tabs", "slot_tabs0010"))["credited"]).toBe(true);
  });

  it("holds an account that keeps sending cards too fast all day", async () => {
    const { store, earn, user, tick } = await ready();
    await user("bot", "bot@gmail.com");
    let last: Record<string, unknown> = {};
    for (let minute = 0; last["reason"] !== "review" && minute < 60; minute++) {
      for (let i = 0; i < 4; i++) last = await earn("bot", `slot_bot${minute}x${i}`);
      tick(60_000);
    }
    expect(last["reason"]).toBe("review");
    expect((await store.earningReviews!.get("bot"))?.reasons).toEqual(["too-fast"]);
    expect(TOO_FAST_PER_DAY).toBeGreaterThan(10);
  });
});

describe("the admin queue", () => {
  it("lists held accounts with what they earned, and trusting a domain clears its people", async () => {
    const store = createMemoryStore();
    await store.adNetworks!.put(zeekendConfig as never, "admin", NOW);
    for (const uid of ["u1", "u2", "u3", "u4"]) await store.putUser({ uid, status: "active", createdAt: NOW, email: `${uid}@acme.example`, emailVerified: true });
    for (const uid of ["u3", "u4"]) await store.earningReviews!.flag({ uid, reasons: ["custom-domain-shared"], email: `${uid}@acme.example`, domain: "acme.example", now: NOW, reopen: false });
    const { handleListEarningReviews, handleDecideEarningReview } = await import("../src/earningReviewRoutes.ts");
    const clock = { now: () => NOW };
    const listed = await handleListEarningReviews({ store, clock }, "admin", "review");
    expect((listed.body["reviews"] as unknown[]).length).toBe(2);
    const decided = await handleDecideEarningReview({ store, clock }, "admin", "u3", { status: "cleared", trustDomain: true });
    expect(decided.body["trustedDomain"]).toBe("acme.example");
    expect((await store.earningReviews!.get("u4"))?.status).toBe("cleared");
    expect(await store.earningReviews!.isTrustedDomain("acme.example")).toBe(true);
    expect((await handleDecideEarningReview({ store, clock }, "admin", "u3", { status: "maybe" })).status).toBe(400);
  });
});

describe("the payout checklist", () => {
  it("shows the review line only while an account is held", () => {
    const base = { user: { uid: "x", status: "active" as const, createdAt: 0, emailVerified: true }, balance: { availableMicros: 100_000_000n, pendingWithdrawalMicros: 0n, lifetimeMicros: 100_000_000n } as never, profile: null, pending: null, now: NOW };
    expect(evaluateEligibility(base).rules.some((rule) => rule.id === "earnings-review")).toBe(false);
    const held = evaluateEligibility({ ...base, underReview: true });
    expect(held.rules.find((rule) => rule.id === "earnings-review")?.ok).toBe(false);
    expect(held.eligible).toBe(false);
  });
});
