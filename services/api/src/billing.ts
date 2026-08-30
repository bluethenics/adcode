/**
 * Verifying that a webhook really came from Dodo Payments.
 *
 * Dodo signs webhooks to the Standard Webhooks specification: three headers -
 * `webhook-id`, `webhook-timestamp`, `webhook-signature` - and an HMAC-SHA256 over
 * `{id}.{timestamp}.{rawBody}` keyed by the endpoint secret.
 *
 * Three things matter here and each is a way to lose money if it is wrong.
 *
 * The signature is verified over the **raw** body, before parsing. Re-serialising JSON
 * changes the bytes, and a signature checked against different bytes than were signed
 * verifies nothing.
 *
 * Comparison is constant time. A byte-at-a-time compare leaks the expected signature to
 * anyone willing to measure the response.
 *
 * The timestamp is bounded. Without that, a signature captured once is valid forever, and
 * an attacker who sees one funding webhook can replay it to mint balance.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far out of step with us a webhook's clock may be before it is refused. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

export type WebhookRejection =
  | "missing-headers"
  | "bad-timestamp"
  | "stale"
  | "bad-signature"
  | "malformed";

/**
 * The secret as Dodo issues it: `whsec_` then base64.
 *
 * The prefix is stripped and the rest base64-decoded before use. Signing with the
 * printable form instead of the decoded key produces signatures that never match, which
 * is a genuinely miserable thing to debug.
 */
export function decodeSecret(secret: string): Buffer {
  const body = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(body, "base64");
}

export function sign(secret: string, id: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", decodeSecret(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, which would itself be a timing signal;
  // the lengths are compared first and the result is a plain false.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  rawBody: string,
  nowSeconds: number,
): { ok: true } | { ok: false; reason: WebhookRejection } {
  const { id, timestamp, signature } = headers;
  if (
    id === undefined ||
    timestamp === undefined ||
    signature === undefined ||
    id.length === 0 ||
    signature.length === 0
  ) {
    return { ok: false, reason: "missing-headers" };
  }

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "bad-timestamp" };
  if (Math.abs(nowSeconds - sent) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const expected = sign(secret, id, timestamp, rawBody);

  /*
   * The header carries one or more space-separated `v1,<base64>` pairs, so a secret can
   * be rotated without downtime: both the old and new signature arrive, and either
   * matching is enough.
   */
  const candidates = signature
    .split(" ")
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part))
    .filter((part) => part.length > 0);

  const matched = candidates.some((candidate) => constantTimeEquals(candidate, expected));
  return matched ? { ok: true } : { ok: false, reason: "bad-signature" };
}
