import { describe, it, expect } from "vitest";
import {
  verifyWebhook,
  sign,
  parseFundingEvent,
  decodeSecret,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../src/billing.ts";

const SECRET = "whsec_dGVzdC1zZWNyZXQtdmFsdWUtZm9yLXNpZ25pbmc=";
const NOW = 1_760_000_000;
const BODY = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_1" } });

const headersFor = (body = BODY, id = "evt_1", ts = String(NOW)) => ({
  id,
  timestamp: ts,
  signature: `v1,${sign(SECRET, id, ts, body)}`,
});

describe("decodeSecret", () => {
  it("strips the whsec_ prefix before decoding", () => {
    expect(decodeSecret(SECRET)).toEqual(decodeSecret(SECRET.slice("whsec_".length)));
  });

  it("produces the key bytes, not the printable form", () => {
    // Signing with the printable secret is the classic Standard Webhooks mistake, and it
    // fails in a way that looks like the sender being wrong.
    expect(decodeSecret(SECRET).toString("utf8")).not.toContain("whsec_");
  });
});

describe("verifyWebhook", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyWebhook(SECRET, headersFor(), BODY, NOW)).toEqual({ ok: true });
  });

  it("accepts a bare signature without the v1 prefix", () => {
    const headers = { id: "evt_1", timestamp: String(NOW), signature: sign(SECRET, "evt_1", String(NOW), BODY) };
    expect(verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({ ok: true });
  });

  it("accepts when any one of several signatures matches, so a secret can be rotated", () => {
    const good = sign(SECRET, "evt_1", String(NOW), BODY);
    const headers = { id: "evt_1", timestamp: String(NOW), signature: `v1,AAAAdatathatisnotit= v1,${good}` };
    expect(verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({ ok: true });
  });

  it("refuses a body that changed after signing", () => {
    const tampered = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_2" } });
    expect(verifyWebhook(SECRET, headersFor(), tampered, NOW)).toEqual({
      ok: false,
      reason: "bad-signature",
    });
  });

  it("refuses a signature made with the wrong secret", () => {
    const headers = {
      id: "evt_1",
      timestamp: String(NOW),
      signature: `v1,${sign("whsec_b3RoZXItc2VjcmV0", "evt_1", String(NOW), BODY)}`,
    };
    expect(verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses a replay from outside the tolerance window", () => {
    const old = String(NOW - WEBHOOK_TOLERANCE_SECONDS - 1);
    expect(verifyWebhook(SECRET, headersFor(BODY, "evt_1", old), BODY, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("refuses a timestamp too far in the future", () => {
    const ahead = String(NOW + WEBHOOK_TOLERANCE_SECONDS + 1);
    expect(verifyWebhook(SECRET, headersFor(BODY, "evt_1", ahead), BODY, NOW)).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("accepts one right at the edge of the window", () => {
    const edge = String(NOW - WEBHOOK_TOLERANCE_SECONDS);
    expect(verifyWebhook(SECRET, headersFor(BODY, "evt_1", edge), BODY, NOW)).toEqual({ ok: true });
  });

  it("refuses a signature bound to a different event id", () => {
    const headers = { ...headersFor(), id: "evt_other" };
    expect(verifyWebhook(SECRET, headers, BODY, NOW)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses missing headers", () => {
    expect(verifyWebhook(SECRET, { id: undefined, timestamp: "1", signature: "x" }, BODY, NOW)).toEqual({
      ok: false,
      reason: "missing-headers",
    });
    expect(verifyWebhook(SECRET, { id: "e", timestamp: undefined, signature: "x" }, BODY, NOW)).toEqual({
      ok: false,
      reason: "missing-headers",
    });
    expect(verifyWebhook(SECRET, { id: "e", timestamp: "1", signature: undefined }, BODY, NOW)).toEqual({
      ok: false,
      reason: "missing-headers",
    });
  });

  it("refuses a timestamp that is not a number", () => {
    expect(verifyWebhook(SECRET, headersFor(BODY, "evt_1", "soon"), BODY, NOW)).toEqual({
      ok: false,
      reason: "bad-timestamp",
    });
  });
});

describe("parseFundingEvent", () => {
  const event = (over: Record<string, unknown> = {}) => ({
    type: "payment.succeeded",
    data: {
      payload_type: "Payment",
      payment_id: "pay_abc",
      total_amount: 5000,
      currency: "USD",
      metadata: { advertiserId: "adv-1" },
      ...over,
    },
  });

  it("converts the smallest currency unit into micros", () => {
    // $50.00 arrives as 5000 cents, which is 50_000_000 micros.
    expect(parseFundingEvent(event())).toEqual({
      paymentId: "pay_abc",
      advertiserId: "adv-1",
      amountMicros: 50_000_000n,
      currency: "USD",
    });
  });

  it("ignores an event type we do not fund on", () => {
    expect(parseFundingEvent({ ...event(), type: "payment.failed" })).toBeNull();
    expect(parseFundingEvent({ ...event(), type: "subscription.active" })).toBeNull();
  });

  it("ignores a payment with no advertiser attached", () => {
    expect(parseFundingEvent(event({ metadata: {} }))).toBeNull();
    expect(parseFundingEvent(event({ metadata: { advertiserId: "" } }))).toBeNull();
  });

  it("refuses a zero, negative, or fractional amount", () => {
    expect(parseFundingEvent(event({ total_amount: 0 }))).toBeNull();
    expect(parseFundingEvent(event({ total_amount: -100 }))).toBeNull();
    expect(parseFundingEvent(event({ total_amount: 12.5 }))).toBeNull();
  });

  it("refuses junk", () => {
    expect(parseFundingEvent(null)).toBeNull();
    expect(parseFundingEvent("payment.succeeded")).toBeNull();
    expect(parseFundingEvent({ type: "payment.succeeded" })).toBeNull();
  });
});
