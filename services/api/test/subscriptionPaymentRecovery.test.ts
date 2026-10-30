import { describe, expect, it, vi } from "vitest";
import { handleFundingWebhook } from "../src/funding.ts";
import { sign } from "../src/billing.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const now = Date.parse("2026-10-29T12:00:00Z");
const secret = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";

async function setup(currency = "USD", amount = 210) {
  const store = createMemoryStore();
  await store.putUser({ uid: "buyer", status: "active", createdAt: 0, linkedAt: 0 });
  const data = { subscription_id: "sub_weekly", status: "active", product_id: "pdt_weekly", customer: { customer_id: "cus_buyer" },
    metadata: { uid: "buyer", plan: "weekly" }, next_billing_date: new Date(now + 7 * 86_400_000).toISOString() };
  const getSubscription = vi.fn(async (): Promise<unknown> => data);
  const deps = { store, clock: { now: () => now }, webhookSecret: secret, subscriptionProducts: { weekly: "pdt_weekly" }, payments: { getSubscription, createCheckout: async () => null } };
  const raw = JSON.stringify({ type: "payment.succeeded", timestamp: new Date(now).toISOString(), data: {
    payment_id: "pay_weekly", subscription_id: "sub_weekly", total_amount: amount, currency, status: "succeeded",
    customer: { customer_id: "cus_buyer" }, metadata: { orderId: "aip_weekly" },
  } });
  const timestamp = String(now / 1000);
  const headers = { id: "payment-event", timestamp, signature: `v1,${sign(secret, "payment-event", timestamp, raw)}` };
  return { store, deps, data, getSubscription, raw, headers };
}

describe("subscription activation from successful payments", () => {
  it.each([["USD", 210], ["AED", 1375]])("recovers a %s payment using the authoritative product and period", async (currency, amount) => {
    const s = await setup(currency, amount);
    await handleFundingWebhook(s.deps, s.headers, s.raw);
    expect(s.getSubscription).toHaveBeenCalledWith("sub_weekly");
    expect((await s.store.getAiPlanState("buyer", now)).plan).toMatchObject({ id: "weekly", source: "subscription", endsAt: now + 7 * 86_400_000 });
    expect(await handleFundingWebhook(s.deps, s.headers, s.raw)).toMatchObject({ ok: true, reason: "duplicate" });
  });
  it("requests redelivery when Dodo cannot confirm the subscription", async () => {
    const s = await setup(); s.getSubscription.mockResolvedValue(null);
    expect(await handleFundingWebhook(s.deps, s.headers, s.raw)).toMatchObject({ ok: false, status: 503 });
    expect((await s.store.getAiPlanState("buyer", now)).plan).toBeNull();
  });
  it("rejects customer mismatches and never looks up an unsigned payment", async () => {
    const s = await setup(); s.data.customer.customer_id = "someone-else";
    expect(await handleFundingWebhook(s.deps, s.headers, s.raw)).toMatchObject({ ok: false, reason: "subscription-mismatch" });
    s.getSubscription.mockClear();
    expect(await handleFundingWebhook(s.deps, { ...s.headers, signature: "v1,forged" }, s.raw)).toMatchObject({ ok: false, status: 400 });
    expect(s.getSubscription).not.toHaveBeenCalled();
  });
});
