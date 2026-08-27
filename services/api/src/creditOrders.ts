import { parseCountry, parseFundingAmount, type PaymentProvider } from "./payments.ts";
import type { Clock, CreditOrderRecord, IdGen, Store } from "./store.ts";

export interface CreditCheckoutDeps {
  store: Store;
  payments: PaymentProvider;
  clock: Clock;
  ids: IdGen;
  siteOrigin: string;
}

export interface CreditCheckoutBody {
  amountMicros: unknown;
  billingCountry: unknown;
  email: unknown;
}

export type CreditCheckoutOutcome =
  | { ok: true; value: { orderId: string; sessionId: string; checkoutUrl: string } }
  | { ok: false; status: 400 | 404 | 502; error: string };

export async function createCreditCheckout(
  deps: CreditCheckoutDeps,
  uid: string,
  body: CreditCheckoutBody,
): Promise<CreditCheckoutOutcome> {
  const amountMicros = parseFundingAmount(body.amountMicros);
  const billingCountry = parseCountry(body.billingCountry);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (amountMicros === null || billingCountry === null || email.length === 0) {
    return { ok: false, status: 400, error: "malformed checkout" };
  }

  const advertiser = await deps.store.advertiserForOwner(uid);
  if (advertiser === null) return { ok: false, status: 404, error: "advertiser-not-found" };

  const now = deps.clock.now();
  const order: CreditOrderRecord = {
    orderId: deps.ids.next("ord"),
    advertiserId: advertiser.advertiserId,
    amountMicros,
    currency: "USD",
    billingCountry,
    customerEmail: email,
    status: "pending",
    providerSessionId: null,
    checkoutUrl: null,
    providerPaymentId: null,
    createdAt: now,
    updatedAt: now,
  };
  await deps.store.createCreditOrder(order);

  const session = await deps.payments.createCheckout({
    orderId: order.orderId,
    advertiserId: advertiser.advertiserId,
    advertiserName: advertiser.name,
    advertiserEmail: email,
    billingCountry,
    amountMicros,
    returnUrl: `${deps.siteOrigin}/portal?checkout=success&order=${encodeURIComponent(order.orderId)}`,
    cancelUrl: `${deps.siteOrigin}/portal?checkout=cancelled&order=${encodeURIComponent(order.orderId)}`,
  });

  if (session === null) {
    await deps.store.putCreditOrder({ ...order, status: "failed", updatedAt: deps.clock.now() });
    return { ok: false, status: 502, error: "payment provider unavailable" };
  }

  await deps.store.putCreditOrder({
    ...order,
    status: "checkout_created",
    providerSessionId: session.sessionId,
    checkoutUrl: session.checkoutUrl,
    updatedAt: deps.clock.now(),
  });
  return { ok: true, value: { orderId: order.orderId, ...session } };
}
