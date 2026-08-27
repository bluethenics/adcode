import { afterEach, describe, expect, it, vi } from "vitest";
import { createDodoProvider } from "../adapters/dodoPayments.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["DODO_API_KEY"];
  delete process.env["DODO_PRODUCT_ID"];
});

describe("Dodo Checkout Sessions adapter", () => {
  it("posts a dynamic-price cart to /checkouts and maps the hosted checkout URL", async () => {
    process.env["DODO_API_KEY"] = "test_replacement_key";
    process.env["DODO_PRODUCT_ID"] = "pdt_credits";
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ session_id: "chk_1", checkout_url: "https://checkout.dodo/1" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createDodoProvider().createCheckout({
      orderId: "ord-1",
      advertiserId: "adv-1",
      advertiserName: "Acme",
      advertiserEmail: "billing@acme.test",
      billingCountry: "US",
      amountMicros: 50_000_000n,
      returnUrl: "https://adcode.dev/portal/billing?checkout=success",
      cancelUrl: "https://adcode.dev/portal/billing?checkout=cancelled",
    });

    expect(result).toEqual({ sessionId: "chk_1", checkoutUrl: "https://checkout.dodo/1" });
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0] ?? ["", {}];
    expect(url).toBe("https://test.dodopayments.com/checkouts");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      product_cart: [{ product_id: "pdt_credits", quantity: 1, amount: 5000 }],
      billing_address: { country: "US" },
      metadata: { orderId: "ord-1" },
    });
  });
});
