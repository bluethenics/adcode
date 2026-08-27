import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { NormalizedProviderEvent } from "../src/providerEvents.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(async () => {
  store = createMemoryStore();
  await store.putAdvertiser({
    advertiserId: "adv-1",
    name: "Acme",
    ownerUids: ["u-1"],
    status: "active",
    fundedMicros: 0n,
    reservedMicros: 0n,
    createdAt: 1,
  });
  await store.createCreditOrder({
    orderId: "ord-1",
    advertiserId: "adv-1",
    amountMicros: 50_000_000n,
    currency: "USD",
    billingCountry: "US",
    customerEmail: "billing@acme.test",
    status: "checkout_created",
    providerSessionId: "chk_1",
    checkoutUrl: "https://checkout.test/1",
    providerPaymentId: null,
    createdAt: 1,
    updatedAt: 1,
  });
});

const purchase = (webhookId = "evt_1"): NormalizedProviderEvent => ({
  type: "purchase",
  webhookId,
  paymentId: "pay_1",
  sessionId: "chk_1",
  orderId: "ord-1",
  amountMicros: 50_000_000n,
  currency: "USD",
});

describe("advertiser credit event application", () => {
  it("credits an exact stored order once across webhook and payment duplicates", async () => {
    expect(await store.applyCreditEvent(purchase())).toMatchObject({ applied: true });
    expect(await store.applyCreditEvent(purchase())).toMatchObject({ applied: false, reason: "duplicate" });
    expect(await store.applyCreditEvent(purchase("evt_other"))).toMatchObject({
      applied: false,
      reason: "duplicate",
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
  });

  it("quarantines a mismatched amount instead of trusting provider metadata", async () => {
    expect(await store.applyCreditEvent({ ...purchase(), amountMicros: 500_000_000n })).toMatchObject({
      applied: false,
      reason: "review_required",
    });
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("review_required");
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
  });

  it("removes credits for a refund and suspends an advertiser whose commitments exceed credits", async () => {
    await store.applyCreditEvent(purchase());
    const advertiser = await store.getAdvertiser("adv-1");
    await store.putAdvertiser({ ...advertiser!, reservedMicros: 45_000_000n });
    await store.applyCreditEvent({
      type: "refund",
      webhookId: "evt_ref",
      refundId: "ref_1",
      paymentId: "pay_1",
      amountMicros: 20_000_000n,
    });

    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(30_000_000n);
    expect((await store.getAdvertiser("adv-1"))?.status).toBe("suspended");
  });

  it("restores only the credits removed by a won dispute", async () => {
    await store.applyCreditEvent(purchase());
    await store.applyCreditEvent({
      type: "dispute-opened",
      webhookId: "evt_open",
      disputeId: "dp_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
    await store.applyCreditEvent({
      type: "dispute-release",
      webhookId: "evt_won",
      disputeId: "dp_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
  });
});
