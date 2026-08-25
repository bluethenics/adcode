/**
 * Comments that mean different things, coloured differently.
 *
 * The convention Better Comments popularised, and the reason it is one of the most
 * installed editor extensions there is: a warning, an open question, and a line of
 * commented-out code are three different kinds of writing that all render identically
 * grey. One character at the front is enough to tell them apart, and costs nothing to
 * anyone who never types it.
 *
 *   `// ! ` something dangerous
 *   `// ? ` an open question
 *   `// * ` the part worth reading first
 *   `// //` code that has been commented out
 *
 * Whether a column is inside a comment at all is `comments.ts`'s question; this file only
 * decides what the first character of one means.
 */
import { scanComments } from "./comments.ts";

export type Tone = "alert" | "query" | "highlight" | "muted";

export interface TonedComment {
  readonly tone: Tone;
  /** One-based, as the editor counts. */
  readonly line: number;
  /** At the delimiter, so the `//` is coloured along with the text. */
  readonly startColumn: number;
  /** Exclusive. */
  readonly endColumn: number;
}

function toneOf(text: string, delimiter: string): Tone | null {
  const body = text.trimStart();
  if (body.length === 0) return null;

  /*
   * Commented-out code, tested first.
   *
   * `// // const old = 1` starts with the line-comment delimiter again, and in the C
   * family that delimiter starts with `/`. Testing the single characters first would
   * never reach this - not because `/` is claimed by one of them, but because the order
   * would then depend on which character happened to be checked first, and an ordering
   * that works by luck stops working the next time somebody adds a tone.
   */
  if (delimiter.length > 0 && body.startsWith(delimiter)) return "muted";

  if (body.startsWith("!")) return "alert";
  if (body.startsWith("?")) return "query";
  if (body.startsWith("*")) return "highlight";

  return null;
}

/**
 * Every toned comment in the file, in reading order.
 *
 * **Line comments only.** A block comment's text begins with `*` the moment `/*` is
 * stripped, which is the JSDoc convention rather than anybody asking for a highlight - so
 * reading the first character of a block would paint every documented function in this
 * project green. A feature that lights up most of a codebase on the day it ships is a
 * feature that gets switched off on the same day, so blocks are left alone entirely.
 */
export function commentTonesIn(text: string, languageId: string): readonly TonedComment[] {
  const toned: TonedComment[] = [];

  scanComments(text, languageId, (span) => {
    if (span.kind !== "line" || !span.opensComment) return;

    const tone = toneOf(span.text, span.delimiter);
    if (tone === null) return;

    toned.push({
      tone,
      line: span.line,
      startColumn: span.delimiterOffset + 1,
      endColumn: span.offset + span.text.length + 1,
    });
  });

  return toned;
}
