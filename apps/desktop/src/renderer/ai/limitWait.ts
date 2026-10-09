/**
 * What the chat says while it waits out a usage limit.
 *
 * Asked for: "when users hit usage limits auto continue after it resetting like Claude". The
 * turn does not end: it waits for the window to reset and sends the same request again. So
 * the card says three things - the limit is reached, when it resets, and that nothing needs
 * doing - and counts down to it. Pure, so the words are tested as written.
 */

/** "3:00 PM", or "Sat 3:00 PM" when the reset is not today. */
function resetLabel(resetsAt: number, now: number): string {
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date(now).toDateString()
    ? time
    : `${at.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export function limitWaitHeadline(provider: string, resetsAt: number, now: number): string {
  return `${provider} usage limit reached · resets at ${resetLabel(resetsAt, now)} · continuing automatically`;
}

/** "Continuing in 4h 59m", then minutes and seconds, then "Continuing now…". */
export function limitWaitCountdown(resetsAt: number, now: number): string {
  const seconds = Math.ceil((resetsAt - now) / 1000);
  if (seconds <= 0) return "Continuing now…";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `Continuing in ${String(hours)}h ${String(minutes)}m`;
  if (minutes > 0) return `Continuing in ${String(minutes)}m ${String(rest)}s`;
  return `Continuing in ${String(rest)}s`;
}
