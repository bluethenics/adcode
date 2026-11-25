/**
 * Partner sponsored notifications: what the card is chosen from, and when the next one is due.
 * Zeekend or Imprezia fills each one, by the admin's split; the sponsored page asks the other
 * when the first has no card (2026-11-25), so the cadence here is the same with two partners.
 *
 * Pure, so the pacing that people judge the product on is tested without Electron. `ads.ts`
 * wires it to the window and the timer.
 */

/** Longer than a direct card's 8s: the partner's card loads in its frame first. */
export const PARTNER_DISMISS_MS = 12_000;
/** After no partner had a card, ask again this soon rather than waiting out a whole tick. */
export const PARTNER_RETRY_MS = 20_000;
/** Never wake the tick sooner than this, however close the next slot is. */
export const MIN_TICK_DELAY_MS = 1_000;

/**
 * How soon to ask Zeekend again after `empties` empty answers in a row: 20s, then 40s, then
 * longer - which the regular tick caps at a minute, as often as the slot was asked before.
 */
export function partnerRetryDelay(empties: number): number {
  return PARTNER_RETRY_MS * 2 ** Math.min(Math.max(0, Math.floor(empties)), 6);
}

/**
 * How long until the ad tick should run again.
 *
 * Cards come back to back at the chosen frequency: the tick wakes when the next slot opens
 * (`nextSlotAt`), not up to a whole tick later. A slot Zeekend left empty is asked again after
 * `PARTNER_RETRY_MS`. A slot that is already open but was held back by something else - an
 * unfocused window, a debug session, the settle period after launch - waits a regular tick,
 * which is what catches those changes. Never longer than that tick, never shorter than a second.
 */
export function nextTickDelay(now: number, nextSlotAt: number, tickMs: number, retryAt: number | null = null): number {
  const opening = nextSlotAt > now ? nextSlotAt : Number.POSITIVE_INFINITY;
  const due = Math.min(opening, retryAt ?? Number.POSITIVE_INFINITY, now + tickMs);
  return Math.max(MIN_TICK_DELAY_MS, Math.min(tickMs, due - now));
}

/**
 * The one-way hashed session id the sponsored page sends with a counted card, or undefined for
 * anything else (an older page, the phone page, a malformed value). Same rule as the server's
 * parseConversationId (services/api adIntegrity.ts); it is never a chat's own id.
 */
export function partnerConversationId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
}

/** The body of the claim for one counted partner card; `conversationId` only when there is one. */
export function partnerEarnBody(slotId: string, conversationId?: string): { network: "imprezia" | "zeekend"; slotId: string; conversationId?: string } {
  const conversation = partnerConversationId(conversationId);
  return { network: slotId.startsWith("slot_imp_") ? "imprezia" : "zeekend", slotId, ...(conversation === undefined ? {} : { conversationId: conversation }) };
}
