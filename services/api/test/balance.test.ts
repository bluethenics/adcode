import { describe, it, expect, beforeEach } from "vitest";
import { handleBalance, handleLedger } from "../src/balance.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { LedgerEntry } from "../src/ledger.ts";

let store: ReturnType<typeof createMemoryStore>;

const entry = (id: string, micros: bigint, createdAt: number): LedgerEntry => ({
  entryId: id,
  uid: "u-1",
  kind: "impression",
  micros,
  refId: null,
  createdAt,
  description: `Ad ${id}`,
});

beforeEach(() => {
  store = createMemoryStore();
});

describe("handleBalance", () => {
  it("returns zeros for a user with no history", async () => {
    expect(await handleBalance(store, "u-new")).toEqual({
      availableMicros: "0",
      lifetimeMicros: "0",
    });
  });

  it("returns micros as decimal strings, never numbers", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 4_000n, 1));
    const res = await handleBalance(store, "u-1");
    expect(res).toEqual({ availableMicros: "4000", lifetimeMicros: "4000" });
    expect(typeof res.availableMicros).toBe("string");
  });

  it("survives a value above 2^53, where a JS number would have lost precision", async () => {
    const huge = 9_007_199_254_740_993n;
    await store.appendEntryAndUpdateBalance({ ...entry("e-big", huge, 1), kind: "adjustment" });
    expect((await handleBalance(store, "u-1")).availableMicros).toBe("9007199254740993");
  });
});

describe("handleLedger", () => {
  it("returns rows newest first with a stringified amount", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 1_000n, 1));
    await store.appendEntryAndUpdateBalance(entry("e-2", 2_000n, 2));

    const res = await handleLedger(store, "u-1", { limit: 10, cursor: null });
    expect(res.rows.map((r) => r.entryId)).toEqual(["e-2", "e-1"]);
    expect(res.rows[0]?.micros).toBe("2000");
    expect(res.rows[0]?.description).toBe("Ad e-2");
    expect(res.nextCursor).toBeNull();
  });

  it("paginates", async () => {
    for (let i = 1; i <= 3; i++) await store.appendEntryAndUpdateBalance(entry(`e-${i}`, 100n, i));

    const first = await handleLedger(store, "u-1", { limit: 2, cursor: null });
    expect(first.rows).toHaveLength(2);
    // The cursor is the last row returned, not the next one to come.
    expect(first.nextCursor).toBe("e-2");

    const second = await handleLedger(store, "u-1", { limit: 2, cursor: first.nextCursor });
    expect(second.rows.map((r) => r.entryId)).toEqual(["e-1"]);
  });

  it("returns nothing for a user with no entries", async () => {
    expect(await handleLedger(store, "u-none", { limit: 10, cursor: null })).toEqual({
      rows: [],
      nextCursor: null,
    });
  });

  it("never leaks the owning uid onto the wire", async () => {
    await store.appendEntryAndUpdateBalance(entry("e-1", 1_000n, 1));
    const res = await handleLedger(store, "u-1", { limit: 10, cursor: null });
    expect(res.rows[0]).not.toHaveProperty("uid");
  });
});
