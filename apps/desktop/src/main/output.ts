/**
 * Log channels, and the ring buffer behind them.
 *
 * Every channel here is a place the main process already produced text and then threw it
 * away: the language server's stderr was read and discarded to stop the pipe filling, git
 * printed the reason a push failed into a string nobody kept, the dev server's output only
 * reached the preview drawer. None of it was reachable from the editor, so "why did that
 * not work" had no answer to look up.
 *
 * **History, not just a live feed.** The panel is almost always opened *after* the
 * interesting line was printed - nobody watches an empty Output tab hoping something goes
 * wrong. A language server that failed at startup does not fail again because somebody
 * finally looked, so the last few hundred lines per channel are kept and replayed.
 *
 * The buffer is bounded per channel rather than in total: a chatty dev server must not be
 * able to push git's one useful error line out of the history.
 */
import type { OutputChannelId, OutputLine } from "../shared/api.ts";

/**
 * Lines kept per channel.
 *
 * Enough for a stack trace and the build that preceded it; small enough that four
 * channels of it is not worth thinking about.
 */
const MAX_LINES = 500;

const history = new Map<OutputChannelId, string[]>();

/** Set by `ipc.ts` once a window exists. Before that, lines are recorded and not sent. */
let sink: ((line: OutputLine) => void) | null = null;

export function setOutputSink(next: ((line: OutputLine) => void) | null): void {
  sink = next;
}

/**
 * Record and broadcast some output.
 *
 * Splits on newlines so the buffer holds lines rather than whatever arbitrary chunk
 * boundaries a pipe happened to produce - otherwise trimming the history to a line count
 * would cut a message in half.
 */
export function appendOutput(channel: OutputChannelId, text: string): void {
  if (text === "") return;

  const lines = history.get(channel) ?? [];
  // A trailing newline is a terminator, not an empty line; `split` disagrees.
  for (const line of text.replace(/\n$/, "").split("\n")) lines.push(line);

  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  history.set(channel, lines);

  sink?.({ channel, text });
}

/** A timestamped line, for the channels that report events rather than stream output. */
export function appendOutputEvent(channel: OutputChannelId, text: string): void {
  const at = new Date().toISOString().slice(11, 19);
  appendOutput(channel, `[${at}] ${text}`);
}

/** Everything kept, oldest first, for a panel that has just opened. */
export function outputHistory(): OutputLine[] {
  const lines: OutputLine[] = [];
  for (const [channel, kept] of history) {
    for (const text of kept) lines.push({ channel, text });
  }
  return lines;
}

/** Testing seam. Nothing in the app clears output - a log you can lose is not a log. */
export function resetOutput(): void {
  history.clear();
}
