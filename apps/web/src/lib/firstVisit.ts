/**
 * A first visit to the site is quiet (2026-11-24).
 *
 * Somebody arriving for the first time used to get the release bar across the top, Buck
 * sliding in at 1.4 s and talking at 2.3 s, and on every page they opened a new tip - all
 * before they had read a line. For the first ten minutes of their first visit the release bar
 * stays away (a release is not news to somebody who has never seen the site) and Buck waits,
 * tucked in his corner, until he is asked.
 */
export const FIRST_VISIT_KEY = "adcode.site.firstVisitAt";
export const FIRST_VISIT_QUIET_MS = 10 * 60_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** Records the first visit, and says whether this moment is still inside its quiet start. */
export function firstVisitQuiet(now: number = Date.now(), storage?: Storage): boolean {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(FIRST_VISIT_KEY);
    if (raw === null) {
      store.setItem(FIRST_VISIT_KEY, String(now));
      return true;
    }
    const at = Number(raw);
    return Number.isFinite(at) && now - at < FIRST_VISIT_QUIET_MS;
  } catch {
    // Storage off: no way to tell a first visit, so the site behaves as it always did.
    return false;
  }
}
