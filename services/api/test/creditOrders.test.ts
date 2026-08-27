import { beforeEach, describe, expect, it } from "vitest";
import { createCreditCheckout } from "../src/creditOrders.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { PaymentProvider } from "../src/payments.ts";

let store: ReturnType<typeof createMemoryStore>;
let providerRequest: unknown;
let failProvider = false;
const payments: PaymentProvider = {
  async createCheckout(request) {
    providerRequest = request;
    return failProvider
      ? null
      : { sessionId: "chk_1", checkoutUrl: "https://checkout.test/1" };
  },
};

beforeEach(async () => {
  store = createMemoryStore();
  providerRequest = null;
  failProvider = false;
  await store.putAdvertiser({
    advertiserId: "adv-1",
    name: "Acme",
    ownerUids: ["u-1"],
    status: "active",
    fundedMicros: 0n,
    reservedMicros: 0n,
    createdAt: 1,
  });
});

const deps = () => ({
  store,
  payments,
  clock: { now: () => 1000 },
  ids: { next: () => "ord-1" },
  siteOrigin: "https://adcode.dev",
});

describe("createCreditCheckout", () => {
  it("persists the order before creating and returning a Checkout Session", async () => {
    const result = await createCreditCheckout(deps(), "u-1", {
      amountMicros: "50000000",
      billingCountry: "US",
      email: "billing@acme.test",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        orderId: "ord-1",
        sessionId: "chk_1",
        checkoutUrl: "https://checkout.test/1",
      },
    });
    expect(providerRequest).toMatchObject({ orderId: "ord-1", advertiserId: "adv-1" });
    expect(await store.getCreditOrder("ord-1")).toMatchObject({
      status: "checkout_created",
      providerSessionId: "chk_1",
      amountMicros: 50_000_000n,
    });
  });

  it("marks an order failed without issuing credits when Dodo is unavailable", async () => {
    failProvider = true;
    expect(
      await createCreditCheckout(deps(), "u-1", {
        amountMicros: "50000000",
        billingCountry: "US",
        email: "billing@acme.test",
      }),
    ).toEqual({ ok: false, status: 502, error: "payment provider unavailable" });
    expect(await store.getCreditOrder("ord-1")).toMatchObject({ status: "failed" });
    expect((await store.getAdvertiser("adv-1"))?.fundedMicros).toBe(0n);
  });

  it("refuses malformed amounts and users who do not own an advertiser", async () => {
    expect(
      await createCreditCheckout(deps(), "u-1", {
        amountMicros: "1000",
        billingCountry: "US",
        email: "billing@acme.test",
      }),
    ).toEqual({ ok: false, status: 400, error: "malformed checkout" });
    expect(
      await createCreditCheckout(deps(), "someone-else", {
        amountMicros: "50000000",
        billingCountry: "US",
        email: "billing@acme.test",
      }),
    ).toEqual({ ok: false, status: 404, error: "advertiser-not-found" });
  });

  it("allows one $1 block but refuses less than the advertised minimum", async () => {
    const accepted = await createCreditCheckout(deps(), "u-1", {
      amountMicros: "1000000",
      billingCountry: "US",
      email: "billing@acme.test",
    });
    expect(accepted.ok).toBe(true);
    expect(providerRequest).toMatchObject({ amountMicros: 1_000_000n });

    expect(
      await createCreditCheckout(deps(), "u-1", {
        amountMicros: "990000",
        billingCountry: "US",
        email: "billing@acme.test",
      }),
    ).toEqual({ ok: false, status: 400, error: "malformed checkout" });
  });
});
