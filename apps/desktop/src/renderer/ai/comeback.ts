/**
 * What an empty chat says to somebody coming back.
 *
 * Measured 17 November 2026: of 4,244 people seen in the app, 67% were seen on one day only and
 * 180 on seven or more. The ones who return come back to unfinished work, so the Continue card
 * says *why* that conversation is worth reopening - it is waiting on them, or their last message
 * never got its answer - instead of a generic "pick up where you left off". And somebody on a run
 * of days is told so, once, in the greeting: a streak is only a reason to come back if you know
 * you have one.
 *
 * Pure: no DOM, no storage.
 */
export interface ContinueMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at?: number;
}

/** "3 hours ago", "yesterday", "5 days ago": coarse on purpose. */
export function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${String(minutes)} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${String(hours)} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 14) return `${String(days)} days ago`;
  return `${String(Math.round(days / 7))} weeks ago`;
}

/** The line under "Continue ...": why this one, in a few words. */
export function continueHint(messages: readonly ContinueMessage[], updatedAt: number, now: number): string {
  const last = messages.at(-1);
  if (last === undefined) return "Pick up where you left off";
  if (last.role === "user") return "Your last message has no answer yet - send it again";
  const tail = last.text.trim().slice(-400);
  if (/\?\s*$/.test(tail) || /\b(should I|do you want|would you like|which (one|option)|let me know)\b/i.test(tail)) return "It is waiting on your answer";
  return `Last worked on ${ago(updatedAt, now)}`;
}

/** The greeting's second line on a run of days, or null when there is nothing worth saying. */
export function streakLine(currentStreak: number, activeToday: boolean): string | null {
  if (currentStreak < 2) return null;
  return activeToday
    ? `${String(currentStreak)} days in a row.`
    : `${String(currentStreak)}-day streak - one message today keeps it going.`;
}
