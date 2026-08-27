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

const TIMEOUT_MS = 15_000;

function baseUrl(): string {
  // Test mode unless explicitly told otherwise, so a missing env var cannot take real money.
  return process.env["DODO_MODE"] === "live"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";
}

export function createDodoProvider(): PaymentProvider {
  return {
    async createCheckout(request: CheckoutRequest): Promise<CheckoutSession | null> {
      const apiKey = process.env["DODO_API_KEY"];
      const productId = process.env["DODO_PRODUCT_ID"];
      if (apiKey === undefined || productId === undefined) return null;

      try {
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
                product_id: productId,
                quantity: 1,
                amount: microsToMinorUnits(request.amountMicros),
              },
            ],
            customer: { name: request.advertiserName, email: request.advertiserEmail },
            billing_address: { country: request.billingCountry },
            metadata: { orderId: request.orderId },
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
  };
}
