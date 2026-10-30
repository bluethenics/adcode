/**
 * `PaymentProvider` against Dodo Payments.
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT. Written from the published API reference; nobody has
 * run it against real Dodo credentials, so treat the request shape as a first draft until
 * a test-mode payment has actually completed. Everything above this port - the funding
 * webhook, idempotent crediting, budget reservation - is covered by tests that need no
 * account at all.
 *
 * The internal credit-order id goes into metadata. Webhooks resolve that server-authored
 * order rather than trusting an advertiser id or amount supplied by the provider event.
 */
import type { CheckoutRequest, CheckoutSession, PaymentProvider } from "../src/payments.ts";
import { microsToMinorUnits } from "../src/payments.ts";
import { planById } from "../src/aiPlans.ts";

const TIMEOUT_MS = 15_000;

function baseUrl(): string {
  // Test mode unless explicitly told otherwise, so a missing env var cannot take real money.
  return process.env["DODO_MODE"] === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";
}
function productId(product: NonNullable<CheckoutRequest["product"]>): string | undefined {
  return ({ advertiser: process.env["DODO_PRODUCT_ID"], "ai-tokens": process.env["DODO_AI_PRODUCT_ID"], "ai-wallet": process.env["DODO_WALLET_PRODUCT_ID"],
    "plan-weekly": process.env["DODO_PLAN_WEEKLY_ID"], "plan-monthly": process.env["DODO_PLAN_MONTHLY_ID"], "plan-pro": process.env["DODO_PLAN_PRO_ID"] })[product];
}

export function createDodoProvider(): PaymentProvider {
  const checked = new Map<string, number>();
  const ready = async (product: NonNullable<CheckoutRequest["product"]>): Promise<boolean> => {
    const apiKey = process.env["DODO_API_KEY"];
    const selected = productId(product);
    if (!apiKey?.trim() || !selected?.trim()) return false;
    if (!product.startsWith("plan-")) return true;
    if ((checked.get(selected) ?? 0) > Date.now()) return true;
    try {
      const response = await fetch(`${baseUrl()}/products/${encodeURIComponent(selected)}`, {
        headers: { authorization: `Bearer ${apiKey}` }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) { console.warn("Dodo plan preflight rejected", { product, status: response.status }); return false; }
      const data = await response.json() as { price?: { type?: string; currency?: string; price?: number; payment_frequency_count?: number; payment_frequency_interval?: string } };
      const plan = planById(product.slice(5));
      const price = data.price;
      const valid = plan !== null && price?.type === "recurring_price" && price.currency === "USD" && price.price === plan.priceCents &&
        price.payment_frequency_count === 1 && price.payment_frequency_interval?.toLowerCase() === plan.interval;
      if (!valid) { console.warn("Dodo plan price mismatch", { product, price }); return false; }
      checked.set(selected, Date.now() + 60_000);
      return true;
    } catch { console.warn("Dodo plan preflight unavailable", { product }); return false; }
  };
  return {
    async getSubscription(subscriptionId) {
      const apiKey = process.env["DODO_API_KEY"];
      if (!apiKey?.trim()) return null;
      try {
        const response = await fetch(`${baseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
          headers: { authorization: `Bearer ${apiKey}` }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return response.ok ? await response.json() : null;
      } catch { return null; }
    },
    canCreateCheckout: ready,
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession | null> {
      const apiKey = process.env["DODO_API_KEY"];
      const selectedProductId = productId(request.product ?? "advertiser");
      const subscription = request.product?.startsWith("plan-") === true;
      if (!apiKey?.trim() || !selectedProductId?.trim()) return null;

      try {
        if (subscription && !await ready(request.product!)) return null;
        const response = await fetch(`${baseUrl()}/checkouts`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            return_url: request.returnUrl,
            cancel_url: request.cancelUrl,
            product_cart: [
              {
                product_id: selectedProductId,
                quantity: 1,
                ...(subscription ? {} : { amount: microsToMinorUnits(request.amountMicros) }),
              },
            ],
            customer: { name: request.advertiserName, email: request.advertiserEmail },
            billing_address: { country: request.billingCountry },
            metadata: { ...request.metadata, orderId: request.orderId },
            ...(request.product === "ai-wallet" ? { feature_flags: { allow_discount_code: false, allow_currency_selection: false } } : {}),
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) return null;

        const parsed = (await response.json()) as Record<string, unknown>;
        const sessionId = parsed["session_id"];
        const checkoutUrl = parsed["checkout_url"];

        if (typeof sessionId !== "string" || typeof checkoutUrl !== "string") return null;
        return { sessionId, checkoutUrl };
      } catch {
        return null;
      }
    },
    async customerPortal(customerId, returnUrl) {
      const apiKey = process.env["DODO_API_KEY"];
      if (!apiKey?.trim() || customerId.length === 0) return null;
      try {
        const response = await fetch(`${baseUrl()}/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`, {
          method: "POST", headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const parsed = await response.json() as Record<string, unknown>;
        return typeof parsed["link"] === "string" && parsed["link"].startsWith("https://") ? parsed["link"] : null;
      } catch { return null; }
    },
  };
}
