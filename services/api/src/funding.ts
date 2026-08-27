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
import type { Clock, Store } from "./store.ts";

export interface FundingDeps {
  store: Store;
  clock: Clock;
  /** The endpoint secret Dodo issues, `whsec_`-prefixed. */
  webhookSecret: string;
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

  const event = parseProviderEvent(parsed, headers.id ?? "");
  if (event === null) {
    // Not an event we fund on. 200, so the provider stops retrying something we are
    // deliberately ignoring.
    return { ok: true, credited: false, reason: "ignored" };
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
