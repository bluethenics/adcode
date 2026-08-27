import { describe, it, expect, beforeEach } from "vitest";
import { createReceiptQueue } from "../src/receiptQueue.ts";
import { RECEIPT_QUEUE_CAP, type Receipt } from "../src/types.ts";
import { FakeFileStore } from "./fakes.ts";

const receipt = (receiptId: string, shownAt = 1_700_000_000_000): Receipt => ({
  receiptId,
  creativeId: "cr-1",
  shownAt,
  dwellMs: 5_000,
  themeKind: "dark",
  outcome: "impression",
});

let store: FakeFileStore;

beforeEach(() => {
  store = new FakeFileStore();
});

describe("enqueue", () => {
  it("holds what it is given, in order", async () => {
    const queue = createReceiptQueue({ store });
    await queue.enqueue(receipt("r1"));
    await queue.enqueue(receipt("r2"));

    expect((await queue.all()).map((r) => r.receiptId)).toEqual(["r1", "r2"]);
    expect(await queue.size()).toBe(2);
  });

  it("dedupes by receiptId", async () => {
    // The receipt ID is the idempotency key the server dedupes on (§10), so holding
    // two copies locally would only ever waste a request.
    const queue = createReceiptQueue({ store });
    await queue.enqueue(receipt("r1"));
    await queue.enqueue(receipt("r1"));

    expect(await queue.size()).toBe(1);
  });

  it("caps at 500 and drops oldest first", async () => {
    // §9: "Queue to disk, capped at 500, oldest dropped."
    const queue = createReceiptQueue({ store });
    for (let i = 0; i < RECEIPT_QUEUE_CAP + 20; i++) await queue.enqueue(receipt(`r${i}`));

    const all = await queue.all();
    expect(all).toHaveLength(RECEIPT_QUEUE_CAP);
    expect(all[0]!.receiptId).toBe("r20");
    expect(all.at(-1)!.receiptId).toBe(`r${RECEIPT_QUEUE_CAP + 19}`);
  });
});

describe("persistence", () => {
  it("survives a restart", async () => {
    // §9: flush on reconnect. A queue that forgets on quit loses the user real money.
    const first = createReceiptQueue({ store });
    await first.enqueue(receipt("r1"));
    await first.enqueue(receipt("r2"));

    const revived = createReceiptQueue({ store });
    await revived.load();

    expect((await revived.all()).map((r) => r.receiptId)).toEqual(["r1", "r2"]);
  });

  it("starts empty when there is nothing on disk", async () => {
    const queue = createReceiptQueue({ store });
    await queue.load();
    expect(await queue.size()).toBe(0);
  });

  it("starts empty rather than throwing when the file is corrupt", async () => {
    // §9: an ad-side failure may never degrade anything else. A corrupt queue file
    // costs at worst a few unreported receipts.
    await store.write("ads/receipts.json", new TextEncoder().encode("{not json"));

    const queue = createReceiptQueue({ store });
    await expect(queue.load()).resolves.toBeUndefined();
    expect(await queue.size()).toBe(0);
  });

  it("discards entries that are not well-formed receipts", async () => {
    await store.write(
      "ads/receipts.json",
      new TextEncoder().encode(JSON.stringify([receipt("good"), { receiptId: 42 }, null])),
    );

    const queue = createReceiptQueue({ store });
    await queue.load();

    expect((await queue.all()).map((r) => r.receiptId)).toEqual(["good"]);
  });
});

describe("ack", () => {
  it("removes only the acked ids", async () => {
    const queue = createReceiptQueue({ store });
    await queue.enqueue(receipt("r1"));
    await queue.enqueue(receipt("r2"));
    await queue.enqueue(receipt("r3"));

    await queue.ack(["r1", "r3"]);

    expect((await queue.all()).map((r) => r.receiptId)).toEqual(["r2"]);
  });

  it("ignores ids it does not hold", async () => {
    const queue = createReceiptQueue({ store });
    await queue.enqueue(receipt("r1"));

    await expect(queue.ack(["nope"])).resolves.toBeUndefined();
    expect(await queue.size()).toBe(1);
  });

  it("persists the removal", async () => {
    const queue = createReceiptQueue({ store });
    await queue.enqueue(receipt("r1"));
    await queue.enqueue(receipt("r2"));
    await queue.ack(["r1"]);

    const revived = createReceiptQueue({ store });
    await revived.load();

    expect((await revived.all()).map((r) => r.receiptId)).toEqual(["r2"]);
  });
});
