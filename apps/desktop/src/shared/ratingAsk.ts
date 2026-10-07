/**
 * Asking for a Microsoft Store rating - once, at a good time, and never for a reward.
 *
 * Store rules forbid rewarding ratings, so this offers nothing and asks only someone who
 * has already had a good experience: installed from the Store, ADCode has built something
 * for them, and they have come back on at least three different days. Whatever they answer,
 * it is never asked again.
 */

export const STORE_REVIEW_URL = "ms-windows-store://review/?ProductId=9MSW2N027GJX";

const MIN_DAYS = 3;
const KEEP_DAYS = 10;

export function shouldAskForRating(input: {
  fromStore: boolean;
  activeDays: readonly string[];
  firstValueAt: number | null;
  asked: boolean;
}): boolean {
  return input.fromStore && !input.asked && input.firstValueAt !== null && new Set(input.activeDays).size >= MIN_DAYS;
}

/** Today's UTC day added once, keeping only the most recent few - all the rule needs. */
export function recordActiveDay(days: readonly string[], today: string): string[] {
  if (days.includes(today)) return [...days];
  return [...days, today].slice(-KEEP_DAYS);
}
