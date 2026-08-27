/**
 * The notes you leave yourself.
 *
 * `TODO`, `FIXME`, `HACK`, `XXX`, `NOTE`. A note you cannot find is a note you did not
 * leave, and these are precisely the comments you want to trip over later.
 *
 * **Only inside comments, and that is the whole difficulty.** Highlighting every occurrence
 * of the word is what makes this feature annoying rather than useful - a test asserting the
 * string `"TODO"`, a regex hunting for it, a piece of prose in a docstring, all lit up like
 * unfinished work. Knowing which columns are inside a comment is `comments.ts`'s job; this
 * file decides what the words in them mean.
 */
import { scanComments } from "./comments.ts";

export type TodoKeyword = "TODO" | "FIXME" | "HACK" | "XXX" | "NOTE";

export interface TodoMark {
  readonly keyword: TodoKeyword;
  /** One-based, as the editor counts. */
  readonly line: number;
  readonly startColumn: number;
  /** Exclusive. */
  readonly endColumn: number;
}

const KEYWORDS: readonly TodoKeyword[] = ["TODO", "FIXME", "HACK", "XXX", "NOTE"];

/**
 * Uppercase only, and followed by a boundary.
 *
 * Lowercase `todo` is an ordinary English word and a common variable name; the convention
 * everybody actually writes is shouted. The boundary keeps `TODOS` and `XXXVI` out.
 */
const KEYWORD_PATTERN = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "g");

/**
 * Every note in the file, in reading order.
 *
 * An unknown language gets an empty list rather than a guess: without knowing what starts a
 * comment there is no way to tell a note from the word appearing in code, and the guess
 * would be wrong in exactly the noisy direction.
 */
export function todoMarksIn(text: string, languageId: string): readonly TodoMark[] {
  const marks: TodoMark[] = [];

  scanComments(text, languageId, (span) => {
    KEYWORD_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = KEYWORD_PATTERN.exec(span.text)) !== null) {
      const keyword = match[0] as TodoKeyword;
      const startColumn = span.offset + match.index + 1;
      marks.push({ keyword, line: span.line, startColumn, endColumn: startColumn + keyword.length });
    }
  });

  return marks;
}
