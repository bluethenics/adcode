import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchHandler } from "../src/fetchHandler.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";
import { DEFAULT_PAID_CONFIG } from "../src/paidTokens.ts";
import { handleFundingWebhook } from "../src/funding.ts";
import { sign } from "../src/billing.ts";
import type { TokenVerifier } from "../src/auth.ts";
import type { CheckoutRequest, PaymentProvider } from "../src/payments.ts";

const verifier: TokenVerifier = {
  async verify(token) {
    if (token === "admin") return { uid: "admin-1", claims: { email: "admin@adcode.test", email_verified: true } };
    if (token === "user") return { uid: "user", claims: { email: "user@adcode.test", email_verified: true } };
    if (token === "unverified") return { uid: "nov", claims: { email: "nov@adcode.test", email_verified: false } };
    return null;
  },
};

describe("buying AI tokens", () => {
  let store: ReturnType<typeof createMemoryStore>;
  let checkouts: CheckoutRequest[];
  let handle: ReturnType<typeof createFetchHandler>;
  const make = (payments: PaymentProvider) => createFetchHandler({ store, verifier, clock: { now: () => 1000 }, payments, siteOrigin: "https://adcode.test", tagflow: { apiKey: "k" } });
  const call = (path: string, token?: string, data?: unknown) => handle(new Request(`https://adcode.test/v1${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }));
  const paidOn = (enabled: boolean) => store.putTagflowConfig({ config: { ...DEFAULT_TAGFLOW_CONFIG, paid: { ...DEFAULT_PAID_CONFIG, enabled } }, updatedAt: 0, updatedBy: "setup" });

  beforeEach(async () => {
    store = createMemoryStore(); checkouts = [];
    await store.addAdmin({ email: "admin@adcode.test", addedBy: "setup", addedAt: 0 });
    await paidOn(true);
    handle = make({ async createCheckout(request) { checkouts.push(request); return { sessionId: "cs_1", checkoutUrl: "https://checkout.test/cs_1" }; } });
  });

  it("opens a Dodo checkout for a pack at its price, on the AI-tokens product", async () => {
    const response = await call("/ai/tokens/checkout", "user", { pack: "140m", billingCountry: "DE" });
    expect(response.status).toBe(200);
    const { orderId, checkoutUrl } = await response.json() as { orderId: string; checkoutUrl: string };
    expect(orderId.startsWith("ait_")).toBe(true);
    expect(checkoutUrl).toBe("https://checkout.test/cs_1");
    expect(checkouts[0]).toMatchObject({ orderId, product: "ai-tokens", amountMicros: 25_000_000n, billingCountry: "DE", advertiserEmail: "user@adcode.test", returnUrl: `https://adcode.test/ai-tokens?order=${orderId}` });
    expect((await store.listTokenActivity("user")).orders[0]).toMatchObject({ orderId, tokens: 140_000_000, priceCents: 2500, status: "pending", checkoutSession: "cs_1" });
  });

  it("refuses an unknown pack, a bad country, an unverified account, and a switched-off feature", async () => {
    expect((await call("/ai/tokens/checkout", "user", { pack: "1b", billingCountry: "DE" })).status).toBe(400);
    expect((await call("/ai/tokens/checkout", "user", { pack: "50m", billingCountry: "Germany" })).status).toBe(400);
    expect((await call("/ai/tokens/checkout", "unverified", { pack: "50m", billingCountry: "DE" })).status).toBe(403);
    expect((await call("/ai/tokens/checkout", undefined, { pack: "50m", billingCountry: "DE" })).status).toBe(401);
    await paidOn(false);
    expect((await call("/ai/tokens/checkout", "user", { pack: "50m", billingCountry: "DE" })).status).toBe(409);
    expect(checkouts).toHaveLength(0);
  });

  it("refuses a sixth unpaid checkout inside ten minutes, so one account cannot flood Dodo", async () => {
    for (let i = 0; i < 5; i++) expect((await call("/ai/tokens/checkout", "user", { pack: "50m", billingCountry: "DE" })).status).toBe(200);
    const refused = await call("/ai/tokens/checkout", "user", { pack: "50m", billingCountry: "DE" });
    expect(refused.status).toBe(429);
    expect(checkouts).toHaveLength(5);
  });

  it("answers not-configured when Dodo has no AI product", async () => {
    handle = make({ async createCheckout() { return null; } });
    const response = await call("/ai/tokens/checkout", "user", { pack: "50m", billingCountry: "DE" });
    expect(response.status).toBe(503);
    expect((await store.listTokenActivity("user")).orders).toHaveLength(0);
  });

  it("shows the account its orders and balance", async () => {
    await store.grantTokens("user", 5, "admin-1", "hi", 1);
    const view = await (await call("/ai/tokens/orders", "user")).json() as { tokens: { purchased: number }; ledger: unknown[]; orders: unknown[] };
    expect(view.tokens.purchased).toBe(5);
    expect(view.ledger).toHaveLength(1);
    expect(view.orders).toEqual([]);
  });

  it("lets only an administrator grant tokens and read sales", async () => {
    expect((await call("/admin/ai-tokens/grant", "user", { uid: "user", tokens: 5, note: "x" })).status).toBe(403);
    expect((await call("/admin/ai-tokens/grant", "admin", { uid: "user", tokens: 5, note: "x" })).status).toBe(200);
    expect((await call("/admin/ai-tokens/grant", "admin", { uid: "user", tokens: 1.5, note: "x" })).status).toBe(400);
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(5);
    const sales = await call("/admin/ai-tokens/sales?days=30", "admin");
    expect(sales.status).toBe(200);
    expect(await sales.json()).toEqual({ days: [] });
  });
});

describe("the Dodo webhook and AI-token orders", () => {
  const SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
  const NOW_MS = 1_760_000_000_000;
  const NOW_S = String(Math.floor(NOW_MS / 1000));
  const signed = (raw: string, id: string) => ({ id, timestamp: NOW_S, signature: `v1,${sign(SECRET, id, NOW_S, raw)}` });
  const paid = (orderId: string, paymentId = "pay_1") => JSON.stringify({ type: "payment.succeeded", data: { payload_type: "Payment", payment_id: paymentId, checkout_session_id: "cs_1", total_amount: 1000, currency: "USD", metadata: { orderId } } });
  const refunded = (paymentId: string) => JSON.stringify({ type: "refund.succeeded", data: { payload_type: "Refund", refund_id: "rf_1", payment_id: paymentId, amount: 1000, currency: "USD" } });

  let store: ReturnType<typeof createMemoryStore>;
  const deps = () => ({ store, clock: { now: () => NOW_MS }, webhookSecret: SECRET });
  beforeEach(async () => {
    store = createMemoryStore();
    await store.createTokenOrder({ orderId: "ait_1", uid: "user", packId: "50m", priceCents: 1000, tokens: 50_000_000, status: "pending", checkoutSession: "cs_1", providerPaymentId: null, createdAt: 1, paidAt: null });
  });

  it("credits an ait_ order through the token path and leaves advertiser credit alone", async () => {
    const advertiser = vi.spyOn(store, "applyCreditEvent");
    const raw = paid("ait_1");
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw)).toMatchObject({ ok: true, credited: true });
    expect(advertiser).not.toHaveBeenCalled();
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(50_000_000);
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_2"), raw)).toMatchObject({ ok: true, credited: false, reason: "duplicate" });
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(50_000_000);
  });

  it("ignores a purchase for an ait_ order it never created", async () => {
    const raw = paid("ait_unknown");
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw)).toMatchObject({ ok: true, credited: false, reason: "ignored" });
  });

  it("does not credit a payment whose amount does not match the pack", async () => {
    const raw = JSON.stringify({ type: "payment.succeeded", data: { payload_type: "Payment", payment_id: "pay_1", checkout_session_id: "cs_1", total_amount: 100, currency: "USD", metadata: { orderId: "ait_1" } } });
    expect(await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw)).toMatchObject({ ok: true, credited: false });
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(0);
  });

  it("takes tokens back on a chargeback for a token payment, without touching advertiser credit", async () => {
    const raw = paid("ait_1");
    await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw);
    const advertiser = vi.spyOn(store, "applyCreditEvent");
    const dispute = JSON.stringify({ type: "dispute.opened", data: { payload_type: "Dispute", dispute_id: "dp_1", payment_id: "pay_1", amount: 1000, currency: "USD" } });
    await handleFundingWebhook(deps(), signed(dispute, "evt_d1"), dispute);
    expect(advertiser).not.toHaveBeenCalled();
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(0);
    const won = JSON.stringify({ type: "dispute.won", data: { payload_type: "Dispute", dispute_id: "dp_1", payment_id: "pay_1", amount: 1000, currency: "USD" } });
    await handleFundingWebhook(deps(), signed(won, "evt_d2"), won);
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(50_000_000);
  });

  it("takes back an AI-token refund, and hands every other refund to advertiser credit", async () => {
    const raw = paid("ait_1");
    await handleFundingWebhook(deps(), signed(raw, "evt_1"), raw);
    const advertiser = vi.spyOn(store, "applyCreditEvent");
    const ours = refunded("pay_1");
    await handleFundingWebhook(deps(), signed(ours, "evt_r1"), ours);
    expect(advertiser).not.toHaveBeenCalled();
    expect((await store.getPaidTokens("user")).balance.purchased).toBe(0);
    const theirs = refunded("pay_advertiser");
    await handleFundingWebhook(deps(), signed(theirs, "evt_r2"), theirs);
    expect(advertiser).toHaveBeenCalledTimes(1);
  });
});
