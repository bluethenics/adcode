/**
 * What a formatter is, here.
 *
 * Every printer in this package is `(text, options) => string`. No file handles, no
 * language server, no editor - which is what lets six languages' worth of formatting be
 * tested against strings, and what lets the one property that matters be checked
 * exhaustively: **formatting twice must equal formatting once.**
 *
 * A formatter that is not idempotent is a formatter that fights the user. Every save
 * produces a different file, every diff is noise, and two people with the same settings
 * produce different output. It is the first thing tested here and the reason several of
 * these printers are deliberately less ambitious than they could be.
 */

export interface FormatOptions {
  /** Spaces per level. Ignored when `useTabs`. */
  readonly indentWidth: number;
  readonly useTabs: boolean;
  /** What to end lines with. A file is normalised to one or the other, never both. */
  readonly lineEnding: "\n" | "\r\n";
}

export const DEFAULT_OPTIONS: FormatOptions = {
  indentWidth: 2,
  useTabs: false,
  lineEnding: "\n",
};

/** One level of indentation, repeated. */
export function indentOf(options: FormatOptions, depth: number): string {
  if (depth <= 0) return "";
  return options.useTabs ? "\t".repeat(depth) : " ".repeat(depth * options.indentWidth);
}

/** Split into lines regardless of what the file currently uses. */
export function toLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/**
 * Rejoin, ending with exactly one newline.
 *
 * A missing final newline and a run of blank ones at the end are both things every
 * formatter should settle, and settling them in one place means no printer has to remember.
 */
export function joinLines(lines: readonly string[], options: FormatOptions): string {
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]?.trim() === "") trimmed.pop();
  return trimmed.join(options.lineEnding) + options.lineEnding;
}
