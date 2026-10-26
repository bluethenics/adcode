import { planById, type PlanId } from "./aiPlans.ts";
import type { SubscriptionEvent } from "./tagflowTypes.ts";

export type NormalizedProviderEvent =
  | {
      type: "subscription";
      webhookId: string;
      kind: SubscriptionEvent["type"];
      subscriptionId: string;
      productId: string | null;
      uid: string | null;
      plan: PlanId | null;
      customerId: string | null;
      status: string;
      periodEnd: number;
      cancelAtPeriodEnd: boolean;
      occurredAt?: number;
    }
  | {
      type: "purchase";
      webhookId: string;
      paymentId: string;
      sessionId: string;
      orderId: string;
      amountMicros: bigint;
      currency: "USD";
    }
  | {
      type: "refund";
      webhookId: string;
      refundId: string;
      paymentId: string;
      amountMicros: bigint;
    }
  | {
      type: "dispute-opened" | "dispute-final" | "dispute-release";
      webhookId: string;
      disputeId: string;
      paymentId: string;
      amountMicros: bigint;
    };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const id = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const amount = (data: Record<string, unknown>): bigint | null => {
  const value = data["amount"] ?? data["total_amount"];
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value) * 10_000n;
  }
  return typeof value === "string" && /^[1-9][0-9]*$/.test(value)
    ? BigInt(value) * 10_000n
    : null;
};

export function parseProviderEvent(
  raw: unknown,
  webhookId: string,
): NormalizedProviderEvent | null {
  const envelope = record(raw);
  const dataEnvelope = record(envelope?.["data"]);
  const data = record(dataEnvelope?.["object"]) ?? dataEnvelope;
  const eventType = envelope?.["type"];
  if (data === null || typeof eventType !== "string" || webhookId.length === 0) return null;

  // Subscription fulfilment uses the paid period, not a payment amount or delivery time.
  if (eventType.startsWith("subscription.")) {
    const kind = eventType.slice("subscription.".length);
    if (!["active", "renewed", "plan_changed", "on_hold", "cancelled", "failed", "expired"].includes(kind)) return null;
    const subscriptionId = id(data["subscription_id"]);
    if (subscriptionId === null) return null;
    const metadata = record(data["metadata"]);
    const uid = id(metadata?.["uid"]);
    const planId = id(metadata?.["plan"]);
    const period = typeof data["next_billing_date"] === "string" ? Date.parse(data["next_billing_date"]) : NaN;
    const occurredAt = typeof envelope?.["timestamp"] === "string" ? Date.parse(envelope["timestamp"]) : NaN;
    return { type: "subscription", webhookId, kind: kind as SubscriptionEvent["type"], subscriptionId,
      productId: id(data["product_id"]),
      uid: uid !== null && uid.length <= 128 && uid !== "*" ? uid : null,
      plan: planId === null ? null : planById(planId)?.id ?? null,
      customerId: id(record(data["customer"])?.["customer_id"]), status: id(data["status"]) ?? kind,
      periodEnd: Number.isSafeInteger(period) && period > 0 ? period : 0,
      cancelAtPeriodEnd: data["cancel_at_next_billing_date"] === true,
      ...(Number.isSafeInteger(occurredAt) && occurredAt > 0 ? { occurredAt } : {}) };
  }

  const amountMicros = amount(data);
  if (amountMicros === null) return null;

  if (eventType === "payment.succeeded") {
    const metadata = record(data["metadata"]);
    const paymentId = id(data["payment_id"]);
    const sessionId = id(data["checkout_session_id"] ?? data["session_id"]);
    const orderId = id(metadata?.["orderId"]);
    const currency = data["currency"];
    if (paymentId === null || sessionId === null || orderId === null || currency !== "USD") return null;
    return { type: "purchase", webhookId, paymentId, sessionId, orderId, amountMicros, currency };
  }

  if (eventType === "refund.succeeded") {
    const refundId = id(data["refund_id"]);
    const paymentId = id(data["payment_id"]);
    return refundId === null || paymentId === null
      ? null
      : { type: "refund", webhookId, refundId, paymentId, amountMicros };
  }

  if (eventType.startsWith("dispute.")) {
    const disputeId = id(data["dispute_id"]);
    const paymentId = id(data["payment_id"]);
    if (disputeId === null || paymentId === null) return null;
    const type =
      eventType === "dispute.opened"
        ? "dispute-opened"
        : eventType === "dispute.won" || eventType === "dispute.cancelled"
          ? "dispute-release"
          : eventType === "dispute.accepted" || eventType === "dispute.lost"
            ? "dispute-final"
            : null;
    return type === null ? null : { type, webhookId, disputeId, paymentId, amountMicros };
  }

  return null;
}
