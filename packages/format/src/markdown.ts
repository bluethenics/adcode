/**
 * Markdown.
 *
 * The lightest touch of any printer here, because in Markdown almost every character is
 * meaningful and several of the things a formatter would "obviously" tidy are load-bearing:
 *
 * - **Two trailing spaces are a line break.** Stripping trailing whitespace - the most
 *   ordinary formatting operation there is - silently reflows the rendered document. So a
 *   line ending in exactly two spaces keeps them, and every other trailing run is removed.
 * - **Indentation inside a list is structure.** Re-indenting to a fixed width would reparent
 *   nested items, so indentation is left entirely alone.
 * - **A fenced code block is not Markdown.** Everything between the fences is passed
 *   through untouched, including blank lines and trailing spaces.
 *
 * What is left: blank lines around headings, no runs of blank lines, and a final newline.
 */
import { toLines, type FormatOptions } from "./types.ts";

const FENCE = /^(\s*)(```+|~~~+)/;
const HEADING = /^\s{0,3}#{1,6}\s/;

export function formatMarkdown(text: string, options: FormatOptions): string {
  const lines = toLines(text);
  const out: string[] = [];

  let fence: string | null = null;
  let blanks = 0;

  for (const raw of lines) {
    const fenceMatch = FENCE.exec(raw);

    if (fence !== null) {
      out.push(raw);
      // Only a fence of at least the opening length closes it, which is how a ``` inside a
      // ```` block stays content.
      if (fenceMatch !== null && (fenceMatch[2] ?? "").startsWith(fence)) fence = null;
      blanks = 0;
      continue;
    }

    if (fenceMatch !== null) {
      if (out.length > 0 && blanks === 0) out.push("");
      out.push(raw.trimEnd());
      fence = fenceMatch[2] ?? "```";
      blanks = 0;
      continue;
    }

    if (raw.trim().length === 0) {
      blanks += 1;
      if (blanks === 1 && out.length > 0) out.push("");
      continue;
    }

    // A heading wants air above it, and gets exactly one line of it.
    if (HEADING.test(raw) && out.length > 0 && blanks === 0) out.push("");
    blanks = 0;

    // The two-space hard break, kept. Everything else trailing goes.
    const hardBreak = /[^ ] {2}$/.test(raw);
    out.push(hardBreak ? `${raw.trimEnd()}  ` : raw.trimEnd());

    if (HEADING.test(raw)) {
      out.push("");
      blanks = 1;
    }
  }

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join(options.lineEnding) + options.lineEnding;
}
