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

/**
 * How long an unpaid order stays in the portal before it is written off.
 *
 * A provider's checkout session expires long before this - Dodo's inside a day - so a
 * payment cannot legitimately arrive against an order this old. The window is generous
 * anyway: cancelling early would send a late-but-real payment to `review_required`
 * instead of crediting it, and a stale row in a list is a smaller problem than that.
 */
const ABANDONED_ORDER_MS = 7 * 86_400_000;

export async function createCreditCheckout(
  deps: CreditCheckoutDeps,
  uid: string,
  body: CreditCheckoutBody,
): Promise<CreditCheckoutOutcome> {
  const amountMicros = parseFundingAmount(body.amountMicros);
  const billingCountry = parseCountry(body.billingCountry);
  if (amountMicros === null || billingCountry === null) {
    return { ok: false, status: 400, error: "malformed checkout" };
  }

  const advertiser = await deps.store.advertiserForOwner(uid);
  if (advertiser === null) return { ok: false, status: 404, error: "advertiser-not-found" };

  /*
   * The billing address is the one on the account, not the one in the request body.
   *
   * It never gated money - the webhook resolves the server-authored order by id and reads
   * nothing the caller supplied - but it is the customer record at the payment provider
   * and the address a receipt goes to, and the session already carries an address somebody
   * verified. A caller-supplied one is only used when the account has none, which is what
   * an anonymous editor account looks like.
   */
  const account = await deps.store.getUser(uid);
  const supplied = typeof body.email === "string" ? body.email.trim() : "";
  const email = account?.email ?? supplied;
  if (email.length === 0) return { ok: false, status: 400, error: "malformed checkout" };

  const now = deps.clock.now();

  // Abandoned checkouts otherwise accumulate against the advertiser forever - every one is
  // a row the portal lists and a link nobody will use again.
  for (const stale of await deps.store.listCreditOrders(advertiser.advertiserId)) {
    const abandoned =
      (stale.status === "pending" || stale.status === "checkout_created") &&
      now - stale.createdAt > ABANDONED_ORDER_MS;
    if (abandoned) {
      await deps.store.putCreditOrder({ ...stale, status: "cancelled", updatedAt: now });
    }
  }
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
