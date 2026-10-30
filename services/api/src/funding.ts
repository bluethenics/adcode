/**
 * Crediting an advertiser when a payment settles.
 *
 * The webhook is the only path that increases `fundedMicros`, and it is the one place in
 * the system where an outside party's message creates spending power. Three gates, in
 * this order:
 *
 *   1. The signature must verify over the raw bytes (`billing.ts`).
 *   2. The event must be one we fund on, naming an advertiser we know.
 *   3. The event id must not have been processed before.
 *
 * Providers retry on any non-2xx, so a handler that credits before checking (3) turns a
 * network blip into invented money. The funding record is created first and the balance
 * raised only if that create won.
 */
import { verifyWebhook, type WebhookHeaders } from "./billing.ts";
import { parseProviderEvent } from "./providerEvents.ts";
import { PLANS, type PlanId } from "./aiPlans.ts";
import { TOKEN_ORDER_PREFIX } from "./paidTokens.ts";
import { WALLET_ORDER_PREFIX } from "./modelWallet.ts";
import { parseReceiptPayment } from "./purchaseReceiptPayments.ts";
import type { Clock, Store } from "./store.ts";
import type { PaymentProvider } from "./payments.ts";

export interface FundingDeps {
  store: Store;
  clock: Clock;
  /** The endpoint secret Dodo issues, `whsec_`-prefixed. */
  webhookSecret: string;
  /** Configured provider products; overrides environment secrets in tests. */
  subscriptionProducts?: Partial<Record<PlanId, string>>;
  payments?: PaymentProvider;
}

export type FundingOutcome =
  | { ok: true; credited: boolean; reason: "credited" | "duplicate" | "ignored" }
  | { ok: false; status: number; reason: string };

export async function handleFundingWebhook(
  deps: FundingDeps,
  headers: WebhookHeaders,
  rawBody: string,
): Promise<FundingOutcome> {
  const nowMs = deps.clock.now();

  const verified = verifyWebhook(deps.webhookSecret, headers, rawBody, Math.floor(nowMs / 1000));
  if (!verified.ok) {
    // 400, never 500: a 5xx tells the provider to retry, and a bad signature will never
    // become good on a retry.
    return { ok: false, status: 400, reason: verified.reason };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, reason: "malformed" };
  }

  // Persist actual signed charge facts even when subscription fulfilment arrives in
  // another webhook. A journal failure must never hold back what the buyer paid for:
  // fulfilment runs first, then the failure reaches the provider as a retryable server
  // error, and the financial application below is idempotent across that retry.
  const receiptPayment = parseReceiptPayment(parsed, headers.id ?? "", nowMs);
  let journalFailed = false;
  if (receiptPayment && deps.store.recordReceiptPayment) {
    try { await deps.store.recordReceiptPayment(receiptPayment); } catch { journalFailed = true; }
  }
  let outcome: FundingOutcome;
  if (receiptPayment?.subscriptionId) {
    // payment.succeeded can arrive without subscription.active, and can be discounted
    // or paid in another currency. Never infer a plan or paid period from its amount.
    const subscription = await deps.payments?.getSubscription?.(receiptPayment.subscriptionId);
    if (!subscription || typeof subscription !== "object") return { ok: false, status: 503, reason: "subscription-sync" };
    const data = subscription as Record<string, unknown>;
    const customer = data["customer"] as Record<string, unknown> | undefined;
    if (data["subscription_id"] !== receiptPayment.subscriptionId || customer?.["customer_id"] !== receiptPayment.customerId) {
      return { ok: false, status: 503, reason: "subscription-mismatch" };
    }
    const status = data["status"];
    const kind = status === "active" ? "active" : status === "cancelled" ? "cancelled" : status === "on_hold" ? "on_hold" : status === "failed" ? "failed" : status === "expired" ? "expired" : null;
    if (kind === null) return { ok: false, status: 503, reason: "subscription-state" };
    // A fresh server read must not be timestamped as the older payment event.
    outcome = await fund(deps, { type: `subscription.${kind}`, timestamp: new Date(nowMs).toISOString(), data },
      { ...headers, id: `subscription-sync:${receiptPayment.paymentId}` }, nowMs);
  } else outcome = await fund(deps, parsed, headers, nowMs);
  return journalFailed && outcome.ok ? { ok: false, status: 503, reason: "receipt-journal" } : outcome;
}

async function fund(deps: FundingDeps, parsed: unknown, headers: WebhookHeaders, nowMs: number): Promise<FundingOutcome> {
  const event = parseProviderEvent(parsed, headers.id ?? "");
  if (event === null) {
    // Not an event we fund on. 200, so the provider stops retrying something we are
    // deliberately ignoring.
    return { ok: true, credited: false, reason: "ignored" };
  }

  if (event.type === "subscription") {
    const products = deps.subscriptionProducts ?? { weekly: process.env["DODO_PLAN_WEEKLY_ID"], monthly: process.env["DODO_PLAN_MONTHLY_ID"], pro: process.env["DODO_PLAN_PRO_ID"] };
    const productPlan = PLANS.find((plan) => products[plan.id] !== undefined && products[plan.id] === event.productId)?.id ?? null;
    // Other subscriptions on the same merchant account must never mint an ADCode plan.
    // Metadata was authored by our checkout, but is still checked against the configured
    // provider product and a known account before it can grant access. The product
    // is authoritative: portal plan changes may retain the original metadata.plan.
    const uid = event.uid !== null && await deps.store.getUser(event.uid) !== null ? event.uid : null;
    const plan = productPlan;
    const result = await deps.store.applySubscriptionEvent({ webhookId: event.webhookId, type: event.kind,
      subscriptionId: event.subscriptionId, uid, plan, customerId: event.customerId,
      status: event.status, periodEnd: event.periodEnd, cancelAtPeriodEnd: event.cancelAtPeriodEnd, now: nowMs,
      ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }) });
    return { ok: true, credited: false, reason: result === "duplicate" ? "duplicate" : "ignored" };
  }

  /*
   * AI-token orders first. A purchase is ours by its `ait_` order id; a refund or dispute names
   * only the payment, so the token path is asked first and passes back anything that is not one
   * of its orders - an advertiser refund is never applied twice and never lost. A chargeback
   * takes back what is left of the tokens, and a won dispute gives it back, as for advertisers.
   */
  const walletPurchase = event.type === "purchase" && event.orderId.startsWith(WALLET_ORDER_PREFIX);
  if (event.type === "purchase" || event.type === "refund" || event.type === "dispute-opened" || event.type === "dispute-release") {
    if (walletPurchase || event.type !== "purchase") {
      const wallet = await deps.store.applyWalletEvent({ type: event.type, webhookId: event.type === "refund" ? `wallet-refund:${event.refundId}` : event.type === "dispute-opened" ? `wallet-dispute-opened:${event.disputeId}` : event.type === "dispute-release" ? `wallet-dispute-release:${event.disputeId}` : event.webhookId, orderId: event.type === "purchase" ? event.orderId : null, paymentId: event.paymentId, sessionId: event.type === "purchase" ? event.sessionId : null, amountMicros: event.amountMicros, ...(event.type === "purchase" && event.taxMicros !== undefined ? { taxMicros: event.taxMicros } : {}), now: nowMs });
      if (wallet !== "not-ai-tokens" || walletPurchase) return { ok: true, credited: wallet === "credited" && event.type === "purchase", reason: wallet === "duplicate" ? "duplicate" : wallet === "credited" && event.type === "purchase" ? "credited" : "ignored" };
    }
  }
  const tokenPurchase = event.type === "purchase" && event.orderId.startsWith(TOKEN_ORDER_PREFIX);
  const tokenType = event.type === "purchase" || event.type === "refund" || event.type === "dispute-opened" || event.type === "dispute-release" ? event.type : null;
  if (tokenType !== null && (tokenPurchase || event.type !== "purchase")) {
    const tokens = await deps.store.applyTokenEvent({
      type: tokenType,
      webhookId: event.webhookId,
      orderId: event.type === "purchase" ? event.orderId : null,
      paymentId: event.paymentId,
      sessionId: event.type === "purchase" ? event.sessionId : null,
      amountMicros: event.amountMicros,
      now: nowMs,
    });
    if (tokens === "credited") return { ok: true, credited: event.type === "purchase", reason: event.type === "purchase" ? "credited" : "ignored" };
    if (tokens === "duplicate") return { ok: true, credited: false, reason: "duplicate" };
    // "review": recorded for an administrator; not credited, and not retried by Dodo.
    if (tokens === "refunded" || tokens === "review" || tokenPurchase) return { ok: true, credited: false, reason: "ignored" };
  }

  const result = await deps.store.applyCreditEvent(event);
  if (!result.applied) {
    return {
      ok: true,
      credited: false,
      reason: result.reason === "duplicate" ? "duplicate" : "ignored",
    };
  }
  return { ok: true, credited: event.type === "purchase", reason: event.type === "purchase" ? "credited" : "ignored" };
}
