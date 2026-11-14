/**
 * Zeekend's sponsored notifications: what the card is chosen from, and when the next one is due.
 *
 * Pure, so the pacing that people judge the product on is tested without Electron. `ads.ts`
 * wires it to the window and the timer.
 */

/** Longer than a direct card's 8s: Zeekend's card loads in its frame first. */
export const PARTNER_DISMISS_MS = 12_000;
/** After Zeekend had no card, ask again this soon rather than waiting out a whole tick. */
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

export interface PartnerExchange {
  readonly request: string;
  readonly response: string;
}

/**
 * What Zeekend picks a notification's card from: the project's topic tags in plain words and
 * nothing else - no file names, paths, code or project name, the same tags ADCode's own ads
 * are targeted by.
 *
 * Zeekend matches a conversation to products, so the exchange reads as one about the
 * person's working day rather than a list of cloud services, which it has nothing for. The
 * wording turns with each notification so a session does not ask the same question twice.
 */
export function partnerExchange(topics: readonly string[], turn: number): PartnerExchange {
  const named = topics.length === 0 ? "software" : topics.slice(0, 6).join(", ");
  const asks = [
    `I spend long days building a ${named} project at my desk. What gear would make the work more comfortable?`,
    `I'm a developer working on a ${named} project. What would help me focus and stay productive through the day?`,
    `What's worth buying for a programmer who works on ${named} code for hours at a time?`,
  ] as const;
  const answers = [
    `For long ${named} sessions: a comfortable keyboard and mouse, a good monitor, noise-cancelling headphones, a supportive chair, and something that reminds you to take breaks.`,
    `For deep ${named} work: a quiet setup with good headphones, a second screen, a desk that fits you, a watch or timer for breaks, and tools that keep you organised.`,
    `People who write ${named} all day get the most from ergonomic peripherals, a sharp display, good audio, a backpack for the laptop, and gadgets that keep their desk tidy.`,
  ] as const;
  const index = (Math.max(1, Math.floor(turn)) - 1) % asks.length;
  return { request: asks[index]!, response: answers[index]! };
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
