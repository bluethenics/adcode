import { describe, it, expect, beforeEach } from "vitest";
import { handleReceipts } from "../src/receipts.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { SubmittedReceipt } from "../src/contract.ts";

const NOW = 100_000;
let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => NOW },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const receipt = (over: Partial<SubmittedReceipt> = {}): SubmittedReceipt => ({
  receiptId: "r-1",
  creativeId: "c-1",
  shownAt: NOW - 5_000,
  dwellMs: 4_200,
  themeKind: "dark",
  outcome: "impression",
  ...over,
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    name: "camp-1 campaign",
    createdAt: 0,
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: [],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: null,
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });
  await store.recordServe({
    serveId: "s-1",
    uid: "u-1",
    creativeId: "c-1",
    campaignId: "camp-1",
    servedAt: NOW - 10_000,
    expiresAt: NOW + 10_000,
    maxBidCpmMicros: 8_000_000n,
    clearingCpmMicros: 5_010_000n,
    costMicros: 5_010n,
  });
});

describe("handleReceipts", () => {
  it("credits the user from the clearing price captured on the serve", async () => {
    // $5.01 clearing CPM = 5010 micros per impression; 50% truncates to 2505 micros.
    const res = await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    expect(res.acked).toEqual(["r-1"]);

    const balance = await store.getBalance("u-1");
    expect(balance.availableMicros).toBe(2_505n);
    expect(balance.lifetimeMicros).toBe(2_505n);
  });

  it("charges the campaign the full cost, not the user's share", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    expect(await store.getSpend("camp-1")).toBe(5_010n);
  });

  it("is idempotent - a replayed receipt acks but pays once", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    const second = await handleReceipts(deps(), "u-1", { receipts: [receipt()] });

    expect(second.acked).toEqual(["r-1"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(2_505n);
  });

  it("does not double-charge the campaign on a replay", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    expect(await store.getSpend("camp-1")).toBe(5_010n);
  });

  it("acks but does not pay a receipt with no matching serve", async () => {
    // The forged-receipt case. Acking is deliberate: the client must be able to clear its
    // queue, and telling an attacker which receipts were disbelieved helps only them.
    const res = await handleReceipts(deps(), "u-1", {
      receipts: [receipt({ receiptId: "r-9", creativeId: "cnonexistent" })],
    });
    expect(res.acked).toEqual(["r-9"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("acks but does not pay against another user's serve", async () => {
    const res = await handleReceipts(deps(), "u-2", { receipts: [receipt({ receiptId: "r-2" })] });
    expect(res.acked).toEqual(["r-2"]);
    expect((await store.getBalance("u-2")).availableMicros).toBe(0n);
  });

  it("acks but does not pay a dismissal", async () => {
    const res = await handleReceipts(deps(), "u-1", {
      receipts: [receipt({ receiptId: "r-3", outcome: "dismissed" })],
    });
    expect(res.acked).toEqual(["r-3"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("acks but does not pay an implausible dwell", async () => {
    const res = await handleReceipts(deps(), "u-1", {
      receipts: [receipt({ receiptId: "r-4", dwellMs: 5 })],
    });
    expect(res.acked).toEqual(["r-4"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("acks but does not pay against an expired serve", async () => {
    const late = { ...deps(), clock: { now: () => NOW + 50_000 } };
    const res = await handleReceipts(late, "u-1", { receipts: [receipt({ receiptId: "r-5" })] });
    expect(res.acked).toEqual(["r-5"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(0n);
  });

  it("records a click as a click, not an impression", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt({ outcome: "click" })] });
    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows[0]?.kind).toBe("click");
  });

  it("writes a human-readable description onto the ledger row", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows[0]?.description).toBe("Ad from Acme, 4.2s");
  });

  it("links the ledger entry back to the receipt that caused it", async () => {
    await handleReceipts(deps(), "u-1", { receipts: [receipt()] });
    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows[0]?.refId).toBe("r-1");
  });

  it("handles a batch, paying only the receipts that earn", async () => {
    await store.recordServe({
      serveId: "s-2",
      uid: "u-1",
      creativeId: "c-1",
      campaignId: "camp-1",
      servedAt: NOW,
      expiresAt: NOW + 10_000,
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 5_010_000n,
      costMicros: 5_010n,
    });
    const res = await handleReceipts(deps(), "u-1", {
      receipts: [receipt({ receiptId: "r-a" }), receipt({ receiptId: "r-b", outcome: "dismissed" })],
    });
    expect(res.acked).toEqual(["r-a", "r-b"]);
    expect((await store.getBalance("u-1")).availableMicros).toBe(2_505n);
  });

  it("acks an empty batch", async () => {
    expect(await handleReceipts(deps(), "u-1", { receipts: [] })).toEqual({ acked: [] });
  });
});
