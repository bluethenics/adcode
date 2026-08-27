/**
 * Merge-conflict markers: finding them, and resolving them.
 *
 * Brief §4's Git group lists "merge-conflict resolution `on`". Doing that by shelling
 * out to a merge tool would hand the user off to another program; doing it by rewriting
 * the file in place keeps the resolution inside the editor, where the conflict is.
 *
 * Pure text in, pure text out - no git, no filesystem, no Electron. The renderer decides
 * where to draw the buttons; this decides what pressing one does.
 */

/** One conflict region, with one-based line numbers into the file it came from. */
export interface ConflictBlock {
  /** The `<<<<<<<` line. */
  readonly startLine: number;
  /** The `=======` line. */
  readonly separatorLine: number;
  /** The `>>>>>>>` line. */
  readonly endLine: number;
  /** Whatever followed `<<<<<<<`, usually a branch name or `HEAD`. */
  readonly currentLabel: string;
  readonly incomingLabel: string;
  readonly current: readonly string[];
  readonly incoming: readonly string[];
}

export type Resolution = "current" | "incoming" | "both";

// Git writes exactly seven characters, at the start of a line. Matching fewer would
// flag ordinary text - a row of `======` under a heading is a Markdown file, not a
// conflict - and matching anywhere on the line would flag this very comment.
const START = /^<{7}(?: (.*))?$/;
const SEPARATOR = /^={7}$/;
const END = /^>{7}(?: (.*))?$/;
// diff3-style merges add an ancestor section between the two sides.
const BASE = /^\|{7}(?: (.*))?$/;

export function hasConflictMarkers(text: string): boolean {
  for (const line of splitLines(text)) {
    if (START.test(line)) return true;
  }
  return false;
}

/**
 * Every well-formed conflict in the file, in the order they appear.
 *
 * A start marker with no separator, or a separator with no end, is not a conflict - it
 * is a file that happens to contain the characters. Half a conflict is skipped rather
 * than guessed at, because guessing here means corrupting someone's merge.
 */
export function findConflicts(text: string): ConflictBlock[] {
  const lines = splitLines(text);
  const blocks: ConflictBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const startMatch = START.exec(lines[index] ?? "");
    if (startMatch === null) {
      index++;
      continue;
    }

    const current: string[] = [];
    const incoming: string[] = [];

    let cursor = index + 1;
    let separator = -1;
    let inBase = false;

    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor] ?? "";

      if (SEPARATOR.test(line)) {
        separator = cursor;
        break;
      }

      // A nested start marker means the first one was never a conflict opener.
      if (START.test(line)) break;

      if (BASE.test(line)) {
        inBase = true;
        continue;
      }

      if (!inBase) current.push(line);
    }

    if (separator === -1) {
      index++;
      continue;
    }

    let end = -1;
    for (cursor = separator + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor] ?? "";

      if (END.test(line)) {
        end = cursor;
        break;
      }

      if (START.test(line) || SEPARATOR.test(line)) break;

      incoming.push(line);
    }

    if (end === -1) {
      index++;
      continue;
    }

    const endMatch = END.exec(lines[end] ?? "");

    blocks.push({
      startLine: index + 1,
      separatorLine: separator + 1,
      endLine: end + 1,
      currentLabel: startMatch[1] ?? "",
      incomingLabel: endMatch?.[1] ?? "",
      current,
      incoming,
    });

    index = end + 1;
  }

  return blocks;
}

/**
 * Replace one conflict block with the chosen side.
 *
 * The block's line numbers must still describe the text, which is why callers resolving
 * several blocks work from the last one backwards: taking a side changes how many lines
 * the file has, and everything below the edit shifts.
 */
export function applyResolution(text: string, block: ConflictBlock, choice: Resolution): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(text);

  const start = block.startLine - 1;
  const end = block.endLine - 1;

  // A block from a different revision of the file would splice at the wrong offset and
  // silently eat unrelated lines, so refuse rather than damage the file.
  if (
    start < 0 ||
    end >= lines.length ||
    !START.test(lines[start] ?? "") ||
    !END.test(lines[end] ?? "")
  ) {
    return text;
  }

  const replacement =
    choice === "current"
      ? block.current
      : choice === "incoming"
        ? block.incoming
        : [...block.current, ...block.incoming];

  const resolved = [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)];
  return resolved.join(eol);
}

/** Split on either line ending, without losing a trailing empty line. */
function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}
