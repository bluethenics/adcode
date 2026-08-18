/**
 * Per-UID request ceilings.
 *
 * Spec §9: anonymous UIDs are free and unlimited to mint, so this is not a defence
 * against a determined attacker - it is a ceiling on how fast any one identity can cost
 * us money or reads. The load-bearing protection is still that a receipt only pays when
 * it matches a serve the server itself issued.
 *
 * Fixed windows rather than a sliding log: a sliding window needs per-request storage,
 * and the thing being protected does not justify that. The known cost is that a caller
 * can send `requestsPerWindow` at the end of one window and again at the start of the
 * next; for a ceiling measured in hundreds that is not worth the extra machinery.
 */
import type { ServingConfig, Store } from "./store.ts";

export function windowStartFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/**
 * Records the request and says whether it is allowed.
 *
 * A ceiling of zero means unlimited, so the limiter can be switched off from config
 * without a deploy.
 */
export async function checkRate(
  store: Store,
  config: ServingConfig,
  uid: string,
  now: number,
): Promise<boolean> {
  if (config.requestsPerWindow <= 0) return true;

  const windowStart = windowStartFor(now, config.rateWindowMs);
  const count = await store.bumpRequestCount(uid, windowStart);
  return count <= config.requestsPerWindow;
}
