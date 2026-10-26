import { afterEach, describe, expect, it, vi } from "vitest";
import { createDodoProvider } from "../adapters/dodoPayments.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["DODO_API_KEY"];
  delete process.env["DODO_PRODUCT_ID"];
  delete process.env["DODO_PLAN_WEEKLY_ID"];
  delete process.env["DODO_PLAN_MONTHLY_ID"];
  delete process.env["DODO_PLAN_PRO_ID"];
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


describe("Dodo subscriptions adapter", () => {
  it("uses the configured subscription product without a dynamic price and preserves identity", async () => {
    process.env["DODO_API_KEY"] = "test_replacement_key";
    process.env["DODO_PLAN_PRO_ID"] = "pdt_pro";
    expect(createDodoProvider().canCreateCheckout!("plan-pro")).toBe(true);
    const mock = vi.fn(async () => new Response(JSON.stringify({ session_id: "chk_plan", checkout_url: "https://checkout.dodo/plan" })));
    vi.stubGlobal("fetch", mock);
    expect(await createDodoProvider().createCheckout({ product: "plan-pro", orderId: "aip_1", advertiserId: "user", advertiserName: "User", advertiserEmail: "user@test.dev", billingCountry: "US", amountMicros: 19_000_000n, returnUrl: "https://adcode.test/ai-tokens", cancelUrl: "https://adcode.test/ai-tokens", metadata: { uid: "user", plan: "pro", orderId: "untrusted-override" } })).toMatchObject({ sessionId: "chk_plan" });
    const init = (mock.mock.calls as unknown as [string, RequestInit][])[0]![1];
    const body = JSON.parse(String(init.body));
    expect(body.product_cart).toEqual([{ product_id: "pdt_pro", quantity: 1 }]);
    expect(body.metadata).toEqual({ uid: "user", plan: "pro", orderId: "aip_1" });
  });

  it("does not fall back to advertiser products when a plan product is missing", async () => {
    process.env["DODO_API_KEY"] = "test_replacement_key";
    process.env["DODO_PRODUCT_ID"] = "pdt_advertiser";
    expect(createDodoProvider().canCreateCheckout!("plan-weekly")).toBe(false);
    const mock = vi.fn(); vi.stubGlobal("fetch", mock);
    expect(await createDodoProvider().createCheckout({ product: "plan-weekly", orderId: "aip_1", advertiserId: "user", advertiserName: "User", advertiserEmail: "user@test.dev", billingCountry: "US", amountMicros: 3_000_000n, returnUrl: "https://adcode.test/ai-tokens", cancelUrl: "https://adcode.test/ai-tokens" })).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });

  it("opens a short-lived portal session with an encoded customer and return URL", async () => {
    process.env["DODO_API_KEY"] = "test_replacement_key";
    const mock = vi.fn(async () => new Response(JSON.stringify({ link: "https://customer.dodo/portal" })));
    vi.stubGlobal("fetch", mock);
    const returnUrl = "https://adcode.test/ai-tokens?from=portal";
    expect(await createDodoProvider().customerPortal!("cus_1/path", returnUrl)).toBe("https://customer.dodo/portal");
    expect(mock).toHaveBeenCalledWith(`https://test.dodopayments.com/customers/cus_1%2Fpath/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`, expect.objectContaining({ method: "POST" }));
  });
});
