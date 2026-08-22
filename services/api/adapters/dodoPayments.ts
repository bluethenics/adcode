/**
 * `PaymentProvider` against Dodo Payments.
 *
 * UNVERIFIED AGAINST A LIVE ACCOUNT. Written from the published API reference; nobody has
 * run it against real Dodo credentials, so treat the request shape as a first draft until
 * a test-mode payment has actually completed. Everything above this port - the funding
 * webhook, idempotent crediting, budget reservation - is covered by tests that need no
 * account at all.
 *
 * The `advertiserId` goes into `metadata`, and that is what the webhook reads back to
 * decide whose balance to raise. It is the only link between a payment and an account,
 * so it must be set on every checkout.
 *
 * The reference marks POST /payments deprecated in favour of Checkout Sessions. It is
 * used here because its request and response shapes are documented in full; moving to
 * sessions later changes this file and nothing above it.
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
        const response = await fetch(`${baseUrl()}/payments`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            payment_link: true,
            return_url: request.returnUrl,
            product_cart: [
              {
                product_id: productId,
                quantity: 1,
                amount: microsToMinorUnits(request.amountMicros),
              },
            ],
            customer: { name: request.advertiserName, email: request.advertiserEmail },
            billing: { country: request.billingCountry },
            metadata: { advertiserId: request.advertiserId },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) return null;

        const parsed = (await response.json()) as Record<string, unknown>;
        const paymentId = parsed["payment_id"];
        const paymentLink = parsed["payment_link"];

        if (typeof paymentId !== "string" || typeof paymentLink !== "string") return null;
        return { paymentId, paymentLink };
      } catch {
        return null;
      }
    },
  };
}
