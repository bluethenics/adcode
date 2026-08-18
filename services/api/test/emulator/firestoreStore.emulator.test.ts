/**
 * The only tests that need external tooling. Run with `npm run test:emulator`.
 *
 * They check exactly what the adapter is responsible for and nothing else: that micros
 * survive the round trip as exact integers, that the append is atomic, and that receipt
 * creation is genuinely idempotent under Firestore's semantics rather than the memory
 * store's. Everything above the port is already covered without a cloud project.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFirestoreStore } from "../../adapters/firestoreStore.ts";
import type { Store } from "../../src/store.ts";

let store: Store;

beforeEach(() => {
  process.env["FIRESTORE_EMULATOR_HOST"] ??= "127.0.0.1:8080";
  process.env["GCLOUD_PROJECT"] ??= "adcode-test";
  store = createFirestoreStore();
});

describe("micros survive the round trip exactly", () => {
  it("preserves a value far above 2^53, where a JS number would have lost precision", async () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const uid = `u-precision-${Date.now()}`;

    await store.appendEntryAndUpdateBalance({
      entryId: `e-${Date.now()}`,
      uid,
      kind: "adjustment",
      micros: huge,
      refId: null,
      createdAt: Date.now(),
      description: "precision probe",
    });

    expect((await store.getBalance(uid)).availableMicros).toBe(huge);
  });
});

describe("receipt idempotency under Firestore", () => {
  it("creates once and refuses the replay", async () => {
    const receiptId = `r-${Date.now()}`;
    const record = {
      receiptId,
      uid: "u-1",
      creativeId: "c-1",
      outcome: "impression",
      creditedMicros: 4_000n,
    };

    expect(await store.createReceiptIfAbsent(record)).toBe(true);
    expect(await store.createReceiptIfAbsent(record)).toBe(false);
  });
});

describe("the append is atomic", () => {
  it("refuses a duplicate entry id and leaves the balance intact", async () => {
    const stamp = Date.now();
    const entry = {
      entryId: `e-dup-${stamp}`,
      uid: `u-dup-${stamp}`,
      kind: "impression" as const,
      micros: 1_000n,
      refId: null,
      createdAt: stamp,
      description: "dup probe",
    };

    await store.appendEntryAndUpdateBalance(entry);
    await expect(store.appendEntryAndUpdateBalance(entry)).rejects.toThrow(/already exists/i);
    expect((await store.getBalance(entry.uid)).availableMicros).toBe(1_000n);
  });
});

describe("sharded spend sums back to the total", () => {
  it("accumulates across whatever shards it lands on", async () => {
    const campaignId = `camp-${Date.now()}`;
    for (let i = 0; i < 12; i++) await store.addSpend(campaignId, 1_000n);
    expect(await store.getSpend(campaignId)).toBe(12_000n);
  });
});
