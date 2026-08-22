import { describe, it, expect, beforeEach } from "vitest";
import { handleFundingWebhook } from "../src/funding.ts";
import { sign } from "../src/billing.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
const NOW_MS = 1_760_000_000_000;
const NOW_S = String(Math.floor(NOW_MS / 1000));

let store: ReturnType<typeof createMemoryStore>;
const deps = () => ({ store, clock: { now: () => NOW_MS }, webhookSecret: SECRET });

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "payment.succeeded",
    data: {
      payload_type: "Payment",
      payment_id: "pay_abc",
      total_amount: 5000,
      currency: "USD",
      metadata: { advertiserId: "adv-1" },
      ...over,
    },
  });

const headers = (raw: string, id = "evt_1") => ({
  id,
  timestamp: NOW_S,
  signature: `v1,${sign(SECRET, id, NOW_S, raw)}`,
});

beforeEach(async () => {
  store = createMemoryStore();
  await store.putAdvertiser({
    advertiserId: "adv-1",
    name: "Acme",
    ownerUids: ["u-1"],
    status: "active",
    fundedMicros: 0n,
    reservedMicros: 0n,
    createdAt: 0,
  });
});

describe("handleFundingWebhook", () => {
  it("credits the advertiser when a payment settles", async () => {
    const raw = body();
    const result = await handleFundingWebhook(deps(), headers(raw), raw);

    expect(result).toEqual({ ok: true, credited: true, reason: "credited" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
  });

  it("credits once when the provider retries the same event", async () => {
    const raw = body();
    await handleFundingWebhook(deps(), headers(raw), raw);
    const again = await handleFundingWebhook(deps(), headers(raw), raw);

    expect(again).toEqual({ ok: true, credited: false, reason: "duplicate" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(50_000_000n);
  });

  it("credits twice for two genuinely different events", async () => {
    const raw = body();
    await handleFundingWebhook(deps(), headers(raw, "evt_1"), raw);
    await handleFundingWebhook(deps(), headers(raw, "evt_2"), raw);

    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(100_000_000n);
  });

  it("refuses a forged signature with 400, so the provider stops retrying", async () => {
    const raw = body();
    const bad = { id: "evt_x", timestamp: NOW_S, signature: "v1,notarealsignature" };

    const result = await handleFundingWebhook(deps(), bad, raw);
    expect(result).toEqual({ ok: false, status: 400, reason: "bad-signature" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
  });

  it("refuses a replayed capture from outside the timestamp window", async () => {
    const raw = body();
    const old = String(Math.floor(NOW_MS / 1000) - 3600);
    const stale = { id: "evt_1", timestamp: old, signature: `v1,${sign(SECRET, "evt_1", old, raw)}` };

    const result = await handleFundingWebhook(deps(), stale, raw);
    expect(result).toEqual({ ok: false, status: 400, reason: "stale" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
  });

  it("does not credit when the body was altered after signing", async () => {
    const signedFor = body();
    const tampered = body({ total_amount: 5_000_000 });

    const result = await handleFundingWebhook(deps(), headers(signedFor), tampered);
    expect(result).toEqual({ ok: false, status: 400, reason: "bad-signature" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
  });

  it("acknowledges an event type it does not fund on", async () => {
    const raw = JSON.stringify({ type: "payment.failed", data: { payment_id: "p" } });
    const result = await handleFundingWebhook(deps(), headers(raw), raw);

    expect(result).toEqual({ ok: true, credited: false, reason: "ignored" });
  });

  it("acknowledges a payment for an advertiser that does not exist here", async () => {
    const raw = body({ metadata: { advertiserId: "adv-unknown" } });
    const result = await handleFundingWebhook(deps(), headers(raw), raw);

    expect(result).toEqual({ ok: true, credited: false, reason: "ignored" });
  });

  it("leaves the reservation alone - funding adds spending power, it does not commit it", async () => {
    const raw = body();
    await handleFundingWebhook(deps(), headers(raw), raw);

    const advertiser = await store.getAdvertiser("adv-1");
    expect(advertiser?.reservedMicros).toBe(0n);
  });

  it("records the payment id, so a credit can be traced to a payment", async () => {
    const raw = body();
    await handleFundingWebhook(deps(), headers(raw), raw);

    const funding = await store.listFunding("adv-1");
    expect(funding).toHaveLength(1);
    expect(funding[0]?.paymentId).toBe("pay_abc");
    expect(funding[0]?.amountMicros).toBe(50_000_000n);
  });
});
