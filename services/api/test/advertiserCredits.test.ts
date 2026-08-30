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

/**
 * The branches that run when money goes back.
 *
 * Every one of these would have passed before the fix if it had only asserted the
 * advertiser's balance - which is all the existing tests did. The order's own status was
 * being computed from the advertiser's whole balance compared against a single order's
 * amount, so it is the status assertions below that carry the regression.
 */
describe("reversals are accounted per order", () => {
  /** A second paid order, so the advertiser's balance is no longer one order's worth. */
  async function secondOrder(): Promise<void> {
    await store.createCreditOrder({
      orderId: "ord-2",
      advertiserId: "adv-1",
      amountMicros: 50_000_000n,
      currency: "USD",
      billingCountry: "US",
      customerEmail: "billing@acme.test",
      status: "checkout_created",
      providerSessionId: "chk_2",
      checkoutUrl: "https://checkout.test/2",
      providerPaymentId: null,
      createdAt: 1,
      updatedAt: 1,
    });
    await store.applyCreditEvent({
      type: "purchase",
      webhookId: "evt_p2",
      paymentId: "pay_2",
      sessionId: "chk_2",
      orderId: "ord-2",
      amountMicros: 50_000_000n,
      currency: "USD",
    });
  }

  it("marks a fully refunded order reversed even when the advertiser still holds money", async () => {
    await store.applyCreditEvent(purchase());
    await secondOrder();
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(100_000_000n);

    await store.applyCreditEvent({
      type: "refund",
      webhookId: "evt_r1",
      refundId: "ref_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });

    // The advertiser still has $50 from the other order, which is what used to make this
    // read as `paid`: 50_000_000 < 50_000_000 is false.
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("reversed");
    expect((await store.getCreditOrder("ord-2"))?.status).toBe("paid");
  });

  it("marks a partly refunded order partially_reversed", async () => {
    await store.applyCreditEvent(purchase());
    await store.applyCreditEvent({
      type: "refund",
      webhookId: "evt_r1",
      refundId: "ref_1",
      paymentId: "pay_1",
      amountMicros: 20_000_000n,
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(30_000_000n);
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("partially_reversed");
  });

  it("never lets a refund take back more than the order was worth", async () => {
    await store.applyCreditEvent(purchase());
    await secondOrder();

    // A $500 refund against a $50 order. The old ceiling was the advertiser's whole
    // balance, so this emptied the account and took the other order's money with it.
    await store.applyCreditEvent({
      type: "refund",
      webhookId: "evt_r1",
      refundId: "ref_1",
      paymentId: "pay_1",
      amountMicros: 500_000_000n,
    });

    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("reversed");
    expect((await store.getCreditOrder("ord-2"))?.status).toBe("paid");
  });

  it("settles a lost chargeback as reversed, not as paid", async () => {
    await store.applyCreditEvent(purchase());
    await secondOrder();
    await store.applyCreditEvent({
      type: "dispute-opened",
      webhookId: "evt_d1",
      disputeId: "dis_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("disputed");

    await store.applyCreditEvent({
      type: "dispute-final",
      webhookId: "evt_d2",
      disputeId: "dis_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });

    // The money left when the dispute opened, so nothing moves here - but the order used
    // to fall through to a recompute that landed on `paid` for the event that means the
    // chargeback was lost.
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("reversed");
  });

  it("gives the money back and restores the order when a dispute is won", async () => {
    await store.applyCreditEvent(purchase());
    await store.applyCreditEvent({
      type: "dispute-opened",
      webhookId: "evt_d1",
      disputeId: "dis_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);

    await store.applyCreditEvent({
      type: "dispute-release",
      webhookId: "evt_d3",
      disputeId: "dis_1",
      paymentId: "pay_1",
      amountMicros: 50_000_000n,
    });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
    expect((await store.getCreditOrder("ord-1"))?.status).toBe("paid");
  });
});
