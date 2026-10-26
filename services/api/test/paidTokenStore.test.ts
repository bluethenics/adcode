import { describe, expect, it } from "vitest";
import { createTagflowMemoryStore } from "../src/tagflowMemoryStore.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../src/tagflowConfig.ts";

const limits = DEFAULT_TAGFLOW_CONFIG.limits;
type Memory = ReturnType<typeof createTagflowMemoryStore>;
const reserve = (store: Memory, id: string, tokens: number, now = 1000) =>
  store.reserveTagflow({ unlimited: true, id, uid: "u", day: "2026-10-21", minute: 1, tokens, costMicros: 0, limits, paid: { freeWeeklyTokens: 100, now } });
const settle = (store: Memory, id: string, used: number, failed = false) =>
  store.settleTagflow(id, { inputTokens: failed ? 0 : used, outputTokens: 0, costMicros: 0, estimated: false, failed });
const order = (orderId: string) => ({ orderId, uid: "u", packId: "50m", priceCents: 1000, tokens: 1000, status: "pending" as const, checkoutSession: "cs_1", providerPaymentId: null, createdAt: 1, paidAt: null });
const purchase = { type: "purchase" as const, webhookId: "wh_1", orderId: "ait_1", paymentId: "pay_1", sessionId: "cs_1", amountMicros: 10_000_000n, now: 5 };

describe("paid tokens in the memory store", () => {
  it("uses the free week, then refuses until tokens are bought", async () => {
    const store = createTagflowMemoryStore();
    expect(await reserve(store, "a", 100)).toBe("ok");
    await settle(store, "a", 100);
    expect(await reserve(store, "b", 10)).toBe("paid-limit");
    expect((await store.getPaidTokens("u")).free).toMatchObject({ usedTokens: 100, reservedTokens: 0 });
  });

  it("credits a purchase once, however often Dodo sends it", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    expect(await store.applyTokenEvent(purchase)).toBe("credited");
    expect(await store.applyTokenEvent(purchase)).toBe("duplicate");
    expect(await store.applyTokenEvent({ ...purchase, webhookId: "wh_2" })).toBe("duplicate");
    expect((await store.getPaidTokens("u")).balance).toEqual({ purchased: 1000, reserved: 0 });
    const activity = await store.listTokenActivity("u");
    expect(activity.orders[0]).toMatchObject({ status: "paid", providerPaymentId: "pay_1", paidAt: 5 });
    expect(activity.ledger.map((row) => [row.kind, row.delta])).toEqual([["purchase", 1000]]);
  });

  it("charges purchased tokens after the free week and records the usage", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    await store.applyTokenEvent(purchase);
    expect(await reserve(store, "a", 300)).toBe("ok");
    await settle(store, "a", 250);
    expect((await store.getPaidTokens("u")).balance).toEqual({ purchased: 850, reserved: 0 });
    expect((await store.listTokenActivity("u")).ledger.map((row) => [row.kind, row.delta])).toEqual([["usage", -150], ["purchase", 1000]]);
  });

  it("refunds what is left of an order, and ignores a refund that is not ours", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    await store.applyTokenEvent(purchase);
    expect(await store.applyTokenEvent({ type: "refund", webhookId: "wh_r", orderId: null, paymentId: "pay_other", sessionId: null, amountMicros: 10_000_000n, now: 6 })).toBe("not-ai-tokens");
    expect(await store.applyTokenEvent({ type: "refund", webhookId: "wh_r2", orderId: null, paymentId: "pay_1", sessionId: null, amountMicros: 10_000_000n, now: 6 })).toBe("refunded");
    expect((await store.getPaidTokens("u")).balance.purchased).toBe(0);
  });

  it("treats a purchase for an order it never made as not ours", async () => {
    const store = createTagflowMemoryStore();
    expect(await store.applyTokenEvent({ ...purchase, orderId: "adv_1" })).toBe("not-ai-tokens");
  });

  it("grants tokens with a note, and a failed request charges nothing", async () => {
    const store = createTagflowMemoryStore();
    await store.grantTokens("u", 500, "admin-1", "sorry for the outage", 3);
    expect(await reserve(store, "a", 400)).toBe("ok");
    await settle(store, "a", 0, true);
    expect((await store.getPaidTokens("u")).balance).toEqual({ purchased: 500, reserved: 0 });
    expect((await store.listTokenActivity("u")).ledger[0]).toMatchObject({ kind: "grant", delta: 500, note: "sorry for the outage" });
  });

  it("sums sales by day", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    await store.applyTokenEvent({ ...purchase, now: Date.parse("2026-10-21T10:00:00Z") });
    expect(await store.tokenSales(0)).toEqual([{ day: "2026-10-21", orders: 1, revenueCents: 1000, tokensSold: 1000, tokensUsed: 0 }]);
  });
});

describe("paid tokens: review findings", () => {
  it("holds a payment that does not match its order for review, never crediting it", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    expect(await store.applyTokenEvent({ ...purchase, amountMicros: 1_000_000n })).toBe("review");
    expect(await store.applyTokenEvent({ ...purchase, webhookId: "wh_2", sessionId: "cs_other" })).toBe("review");
    expect((await store.getPaidTokens("u")).balance.purchased).toBe(0);
  });

  it("takes tokens back on a chargeback and gives them back when the dispute is won", async () => {
    const store = createTagflowMemoryStore();
    await store.createTokenOrder(order("ait_1"));
    await store.applyTokenEvent(purchase);
    expect(await store.applyTokenEvent({ type: "dispute-opened", webhookId: "wh_d", orderId: null, paymentId: "pay_1", sessionId: null, amountMicros: 10_000_000n, now: 6 })).toBe("refunded");
    expect((await store.getPaidTokens("u")).balance.purchased).toBe(0);
    expect(await store.applyTokenEvent({ type: "dispute-release", webhookId: "wh_r", orderId: null, paymentId: "pay_1", sessionId: null, amountMicros: 10_000_000n, now: 7 })).toBe("credited");
    expect((await store.getPaidTokens("u")).balance.purchased).toBe(1000);
  });

  it("releases paid holds without charging when a free model answered", async () => {
    const store = createTagflowMemoryStore();
    await store.grantTokens("u", 1000, "admin-1", "", 1);
    expect(await reserve(store, "a", 500)).toBe("ok");
    await store.settleTagflow("a", { inputTokens: 450, outputTokens: 0, costMicros: 0, estimated: false, failed: false, tokenCharge: 0 });
    expect(await store.getPaidTokens("u")).toMatchObject({ balance: { purchased: 1000, reserved: 0 }, free: { usedTokens: 0, reservedTokens: 0 } });
  });
});
