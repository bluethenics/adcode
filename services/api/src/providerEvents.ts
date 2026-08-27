export type NormalizedProviderEvent =
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
