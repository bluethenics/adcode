/**
 * The time under a chat message.
 *
 * It used to be relative - "just now", "3m ago" - but the label is drawn once, when the bubble
 * is made, and nothing redraws it, so every message read "just now" for as long as the chat
 * stayed open. A clock time is true for ever: 14:32 today, Yesterday 14:32, Mon 14:32 within
 * the week, 12 Nov, 14:32 before that (with the year once it is not this one). The full date
 * is on hover.
 */

const DAY_MS = 86_400_000;

export function formatMessageTime(at: number, now: number = Date.now(), locales?: string | string[]): { text: string; title: string } {
  const date = new Date(at);
  const title = date.toLocaleString(locales, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const clock = date.toLocaleTimeString(locales, { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  // A clock a little ahead of this machine's (a message from the phone) still reads as today.
  if (at >= startOfToday) return { text: clock, title };
  if (at >= startOfToday - DAY_MS) return { text: `Yesterday ${clock}`, title };
  if (at >= startOfToday - 6 * DAY_MS) return { text: `${date.toLocaleDateString(locales, { weekday: "short" })} ${clock}`, title };
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString(locales, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  return { text: `${day}, ${clock}`, title };
}
