import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { LedgerEntry } from "../src/ledger.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

const entry = (entryId: string, micros: bigint): LedgerEntry => ({
  entryId,
  uid: "u-1",
  kind: "impression",
  micros,
  refId: null,
  createdAt: 1,
  description: "Ad",
});

describe("receipt idempotency", () => {
  it("creates a receipt once and refuses the second attempt", async () => {
    const record = {
      receiptId: "r-1",
      uid: "u-1",
      creativeId: "c-1",
      outcome: "impression",
      creditedMicros: 2000n,
    };
    expect(await store.createReceiptIfAbsent(record)).toBe(true);
    expect(await store.createReceiptIfAbsent(record)).toBe(false);
  });
});

describe("appendEntryAndUpdateBalance", () => {
  it("keeps the balance cache equal to the fold of the entries", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 2000n));
    await store.appendEntryAndUpdateBalance(entry("e-2", 3000n));

    const balance = await store.getBalance("u-1");
    expect(balance.availableMicros).toBe(5000n);
    expect(balance.lifetimeMicros).toBe(5000n);
  });

  it("refuses to append the same entry id twice", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 2000n));
    await expect(store.appendEntryAndUpdateBalance(entry("e-1", 2000n))).rejects.toThrow(/already exists/i);
  });

  it("keeps one user's balance out of another's", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 2000n));
    await store.appendEntryAndUpdateBalance({ ...entry("e-2", 9000n), uid: "u-2" });

    expect((await store.getBalance("u-1")).availableMicros).toBe(2000n);
    expect((await store.getBalance("u-2")).availableMicros).toBe(9000n);
  });
});

describe("listEntries", () => {
  it("returns newest first and paginates by cursor", async () => {
    for (let i = 1; i <= 5; i++) {
      await store.appendEntryAndUpdateBalance({ ...entry(`e-${i}`, 100n), createdAt: i });
    }

    const page1 = await store.listEntries("u-1", { limit: 2, cursor: null });
    expect(page1.rows.map((r) => r.entryId)).toEqual(["e-5", "e-4"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await store.listEntries("u-1", { limit: 2, cursor: page1.nextCursor });
    expect(page2.rows.map((r) => r.entryId)).toEqual(["e-3", "e-2"]);
  });

  it("reports no next cursor on the last page", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 100n));
    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.nextCursor).toBeNull();
  });

  it("never returns another user's entries", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 100n));
    await store.appendEntryAndUpdateBalance({ ...entry("e-2", 100n), uid: "u-2" });

    const page = await store.listEntries("u-1", { limit: 10, cursor: null });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.uid).toBe("u-1");
  });
});

describe("serve records", () => {
  it("finds an unexpired serve for the right uid and creative", async () => {
    await store.recordServe({ serveId: "s-1", uid: "u-1", creativeId: "c-1", servedAt: 1000, expiresAt: 2000 });

    expect(await store.findServe("u-1", "c-1", 1500)).not.toBeNull();
    expect(await store.findServe("u-1", "c-1", 2500)).toBeNull();
    expect(await store.findServe("u-2", "c-1", 1500)).toBeNull();
    expect(await store.findServe("u-1", "c-9", 1500)).toBeNull();
  });
});

describe("spend", () => {
  it("accumulates across shards", async () => {
    await store.addSpend("camp-1", 1000n);
    await store.addSpend("camp-1", 500n);
    expect(await store.getSpend("camp-1")).toBe(1500n);
  });

  it("reports zero for a campaign that has never served", async () => {
    expect(await store.getSpend("camp-unknown")).toBe(0n);
  });
});

describe("campaign matching", () => {
  const campaign = {
    campaignId: "camp-1",
    advertiserId: "adv-1",
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: ["lang:rust"],
    status: "active" as const,
  };

  it("returns a campaign whose tags intersect", async () => {
    await store.putCampaign(campaign);
    expect(await store.activeCampaignsFor(["lang:rust"])).toHaveLength(1);
    expect(await store.activeCampaignsFor(["lang:php"])).toHaveLength(0);
  });

  it("returns an untargeted campaign to everyone", async () => {
    await store.putCampaign({ ...campaign, campaignId: "house", targetTags: [] });
    expect(await store.activeCampaignsFor(["lang:php"])).toHaveLength(1);
  });

  it("never returns a paused campaign", async () => {
    await store.putCampaign({ ...campaign, status: "paused" });
    expect(await store.activeCampaignsFor(["lang:rust"])).toHaveLength(0);
  });
});
