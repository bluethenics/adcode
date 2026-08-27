/**
 * Spell checking, for the parts of a file that are prose.
 *
 * Comments only. A typo in a comment is invisible to every other tool in the editor - the
 * compiler does not read them, the linter does not read them, and the reviewer skims them -
 * so it is the one place a misspelling survives indefinitely. Code is left alone because
 * an identifier is not misspelled, it is *named*, and the only honest thing to say about
 * `kubelet` is nothing.
 *
 * The words it knows about, and why the list works the way it does, are in
 * `corrections.ts`. Which columns are inside a comment is `@adcode/structure`'s question,
 * answered by the same walker the TODO badges and comment tones use.
 */
import { scanComments } from "@adcode/structure";
import { CORRECTIONS } from "./corrections.ts";

export { CORRECTIONS } from "./corrections.ts";

export interface Misspelling {
  /** As written, capitalisation and all. */
  readonly word: string;
  /** The fix, capitalised to match what was written. */
  readonly suggestion: string;
  /** One-based, as the editor counts. */
  readonly line: number;
  readonly startColumn: number;
  /** Exclusive. */
  readonly endColumn: number;
}

export interface Word {
  readonly word: string;
  /** Zero-based index into the text it was found in. */
  readonly offset: number;
}

/**
 * The words in a run of text, as a programmer wrote them.
 *
 * Three alternatives in one pattern, and the order matters:
 *
 *   `[A-Z]+(?![a-z])`  an acronym - `HTTP` in `HTTPRequest`, stopping before the `R` that
 *                      belongs to the next word rather than swallowing it
 *   `[A-Z][a-z]+`      an ordinary capitalised word
 *   `[a-z]+`           a lowercase run
 *
 * Digits and punctuation match nothing, so `sha256` yields `sha` and `0xFF` yields `FF`
 * without either being special-cased. That also means separators need no handling at all:
 * `snake_case`, `kebab-case` and `camelCase` all fall out of the same pattern.
 */
const WORD_PATTERN = /[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+/g;

export function splitWords(text: string): readonly Word[] {
  const words: Word[] = [];

  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    words.push({ word: match[0], offset: match.index });
  }

  return words;
}

/**
 * Restore the shape of the word that was actually typed.
 *
 * `Recieve` should be offered `Receive`, not `receive` - a suggestion that fixes the
 * spelling and breaks the sentence is a suggestion nobody applies. Three cases cover
 * everything the word pattern can produce, because it never returns mixed case.
 */
function matchCase(written: string, suggestion: string): string {
  if (written === written.toLowerCase()) return suggestion;
  if (written === written.toUpperCase()) return suggestion.toUpperCase();

  return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
}

/**
 * Every misspelling in the file's comments, in reading order.
 *
 * A language whose comments ADCode cannot find yields nothing, rather than a guess about
 * where the prose is.
 */
export function misspellingsIn(text: string, languageId: string): readonly Misspelling[] {
  const found: Misspelling[] = [];

  scanComments(text, languageId, (span) => {
    for (const { word, offset } of splitWords(span.text)) {
      const suggestion = CORRECTIONS[word.toLowerCase()];
      if (suggestion === undefined) continue;

      const startColumn = span.offset + offset + 1;
      found.push({
        word,
        suggestion: matchCase(word, suggestion),
        line: span.line,
        startColumn,
        endColumn: startColumn + word.length,
      });
    }
  });

  return found;
}
