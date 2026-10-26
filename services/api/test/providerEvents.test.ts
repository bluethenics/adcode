import { describe, expect, it } from "vitest";
import { parseProviderEvent } from "../src/providerEvents.ts";

describe("parseProviderEvent", () => {
  it("normalizes a purchase linked only by the internal order id", () => {
    expect(
      parseProviderEvent(
        {
          type: "payment.succeeded",
          data: {
            payment_id: "pay_1",
            checkout_session_id: "chk_1",
            total_amount: 5000,
            currency: "USD",
            metadata: { orderId: "ord-1" },
          },
        },
        "evt_1",
      ),
    ).toEqual({
      type: "purchase",
      webhookId: "evt_1",
      paymentId: "pay_1",
      sessionId: "chk_1",
      orderId: "ord-1",
      amountMicros: 50_000_000n,
      currency: "USD",
    });
  });

  it("normalizes successful refunds and dispute transitions", () => {
    expect(
      parseProviderEvent(
        { type: "refund.succeeded", data: { refund_id: "ref_1", payment_id: "pay_1", amount: 2000 } },
        "evt_2",
      ),
    ).toMatchObject({ type: "refund", refundId: "ref_1", amountMicros: 20_000_000n });
    expect(
      parseProviderEvent(
        { type: "dispute.opened", data: { dispute_id: "dp_1", payment_id: "pay_1", amount: 5000 } },
        "evt_3",
      ),
    ).toMatchObject({ type: "dispute-opened", disputeId: "dp_1" });
    expect(
      parseProviderEvent(
        { type: "dispute.won", data: { dispute_id: "dp_1", payment_id: "pay_1", amount: 5000 } },
        "evt_4",
      ),
    ).toMatchObject({ type: "dispute-release", disputeId: "dp_1" });
  });

  it("accepts Dodo's nested object envelope and string dispute amount", () => {
    expect(
      parseProviderEvent(
        {
          type: "dispute.lost",
          data: { object: { dispute_id: "dp_2", payment_id: "pay_2", amount: "2500" } },
        },
        "evt_5",
      ),
    ).toMatchObject({ type: "dispute-final", disputeId: "dp_2", amountMicros: 25_000_000n });
  });
});


describe("subscription provider events", () => {
  it("parses all supported subscription transitions without a payment amount", () => {
    for (const kind of ["active", "renewed", "plan_changed", "on_hold", "cancelled", "failed", "expired"]) {
      const event = parseProviderEvent({ type: `subscription.${kind}`, timestamp: "2026-10-24T12:00:00Z", data: { subscription_id: "sub_1", product_id: "pdt_pro", customer: { customer_id: "cus_1" }, metadata: { uid: "user", plan: "pro" }, status: kind, next_billing_date: "2026-11-24T12:00:00Z", cancel_at_next_billing_date: true } }, `evt_${kind}`);
      expect(event).toMatchObject({ type: "subscription", kind, productId: "pdt_pro", uid: "user", plan: "pro", periodEnd: Date.parse("2026-11-24T12:00:00Z"), occurredAt: Date.parse("2026-10-24T12:00:00Z"), cancelAtPeriodEnd: true });
    }
  });
  it("does not invent an account, plan or billing period from malformed fields", () => {
    expect(parseProviderEvent({ type: "subscription.active", data: { subscription_id: "sub_1", metadata: { uid: "*", plan: "gold" }, next_billing_date: "invalid" } }, "evt_1")).toMatchObject({ uid: null, plan: null, periodEnd: 0 });
    expect(parseProviderEvent({ type: "subscription.updated", data: { subscription_id: "sub_1" } }, "evt_2")).toBeNull();
  });
});
