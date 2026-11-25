/**
 * A calm first half hour for somebody new (2026-11-24).
 *
 * A fresh install used to open with everything at once: sign-in, the welcome tour, the "What do
 * you want to build?" sheet, then within seven seconds the pin card, the sponsored-cards notice
 * and the usage-signals notice, with partner notifications and every live service notice landing
 * in the corner on top. New people said it was overwhelming, and most of it was not for them -
 * the usage-signals card announces a change to people who used the app before 2.6.3.
 *
 * Now a new person gets sign-in, then (on the desktop) the tour, and then the app. For the first
 * half hour after that nothing else arrives on its own: no corner cards, no partner
 * notifications, no service notices that are not warnings. After it, one thing at a time.
 *
 * "New" is decided once, on the launch that welcomes them, and remembered as a time. Somebody
 * who used ADCode before this existed has no record, so nothing changes for them.
 */
export const FIRST_WELCOME_KEY = "adcode.welcome.firstAt.v1";

/** How long the first welcome stays quiet. */
export const CALM_START_MS = 30 * 60_000;

/** Between two service notices held back during the calm start, so they arrive one at a time. */
export const HELD_NOTICE_GAP_MS = 20_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

const store = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

/** Records that this launch welcomed somebody new. The first record stands. */
export function markFirstWelcome(now: number, storage: Storage | null = store()): void {
  try {
    if (storage !== null && storage.getItem(FIRST_WELCOME_KEY) === null) storage.setItem(FIRST_WELCOME_KEY, String(now));
  } catch { /* Storage off: they get the app as it was. */ }
}

/** How much of the calm start is left, in ms; 0 for anybody not new or past it. */
export function calmRemaining(now: number, storage: Storage | null = store()): number {
  let raw: string | null = null;
  try { raw = storage?.getItem(FIRST_WELCOME_KEY) ?? null; } catch { return 0; }
  const at = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.min(CALM_START_MS, at + CALM_START_MS - now));
}

/** True while somebody new is in their first quiet half hour. */
export const inCalmStart = (now: number, storage: Storage | null = store()): boolean => calmRemaining(now, storage) > 0;

/**
 * Runs `show` for each held item, one at a time, once the calm start is over. Returns whether it
 * held anything: false means show them now.
 */
export function holdUntilCalm<T>(items: readonly T[], show: (item: T) => void, now: number, storage: Storage | null = store(), schedule: (run: () => void, ms: number) => void = (run, ms) => { globalThis.setTimeout(run, ms); }): boolean {
  const left = calmRemaining(now, storage);
  if (left <= 0) return false;
  items.forEach((item, index) => schedule(() => show(item), left + index * HELD_NOTICE_GAP_MS));
  return true;
}
