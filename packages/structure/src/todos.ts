/**
 * The notes you leave yourself.
 *
 * `TODO`, `FIXME`, `HACK`, `XXX`, `NOTE`. A note you cannot find is a note you did not
 * leave, and these are precisely the comments you want to trip over later.
 *
 * **Only inside comments, and that is the whole difficulty.** Highlighting every occurrence
 * of the word is what makes this feature annoying rather than useful - a test asserting the
 * string `"TODO"`, a regex hunting for it, a piece of prose in a docstring, all lit up like
 * unfinished work. So the text is walked with enough state to know whether a given column
 * is inside a comment: quotes are tracked so a `//` inside a string does not start one, and
 * block comments are tracked across lines.
 *
 * It is not a parser and does not pretend to be. Template literals containing `${"//"}`,
 * and regex literals containing a quote, can still fool it. The cost of being wrong is one
 * highlighted word, which is why an approximation is the right size of answer here - and
 * why the approximation is documented rather than quietly relied on.
 */
import { grammarFor } from "./grammar.ts";

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

/** Block comment delimiters by language family. */
interface BlockStyle {
  readonly open: string;
  readonly close: string;
}

function blockStylesFor(languageId: string): readonly BlockStyle[] {
  if (["html", "xml", "handlebars", "razor", "markdown", "vue", "svelte", "astro"].includes(languageId)) {
    return [{ open: "<!--", close: "-->" }];
  }
  if (["python"].includes(languageId)) {
    return [
      { open: '"""', close: '"""' },
      { open: "'''", close: "'''" },
    ];
  }
  if (["lua"].includes(languageId)) return [{ open: "--[[", close: "]]" }];
  if (["ruby", "shell", "powershell", "yaml", "ini", "dockerfile"].includes(languageId)) return [];

  // The C family, and everything that borrowed its comments - which is most of the list.
  return [{ open: "/*", close: "*/" }];
}

/** Where the comment on this line begins, or -1. Zero-based index into `line`. */
function lineCommentStart(line: string, markers: readonly string[]): number {
  if (markers.length === 0) return -1;

  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote !== null) {
      // A backslash escapes the next character, so `"\""` does not end the string early.
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }

    /*
     * Markers are tested before quotes are entered, not after.
     *
     * Python's `"""` begins with a quote character. Checking quotes first meant the scanner
     * entered a string at the first `"` and never saw the delimiter it was looking for, so
     * every docstring was invisible. Strings are still protected, because the quote state
     * above short-circuits this loop while one is open.
     */
    for (const marker of markers) {
      if (line.startsWith(marker, index)) return index;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
  }

  return -1;
}

function marksIn(text: string, line: number, offset: number, out: TodoMark[]): void {
  KEYWORD_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = KEYWORD_PATTERN.exec(text)) !== null) {
    const keyword = match[0] as TodoKeyword;
    const startColumn = offset + match.index + 1;
    out.push({ keyword, line, startColumn, endColumn: startColumn + keyword.length });
  }
}

/**
 * One line of code: record any notes in the comment it starts, if it starts one.
 *
 * Returns the block comment left hanging at the end of the line, so the caller can carry it
 * to the next one. Returning it rather than assigning a captured variable is not only
 * tidier - TypeScript cannot follow a closure that writes to the variable its caller is
 * narrowing, and the first version of this failed to compile for exactly that reason.
 */
function scanCode(
  source: string,
  line: number,
  offset: number,
  lineMarkers: readonly string[],
  blocks: readonly BlockStyle[],
  out: TodoMark[],
): BlockStyle | null {
  const commentAt = lineCommentStart(source, lineMarkers);

  let blockAt = -1;
  let blockStyle: BlockStyle | null = null;
  for (const style of blocks) {
    const at = lineCommentStart(source, [style.open]);
    if (at !== -1 && (blockAt === -1 || at < blockAt)) {
      blockAt = at;
      blockStyle = style;
    }
  }

  // Whichever comes first wins: `/* ... */ // note` and `// /* not a block */` are both
  // decided by which delimiter the line reaches first.
  if (commentAt !== -1 && (blockAt === -1 || commentAt < blockAt)) {
    marksIn(source.slice(commentAt), line, offset + commentAt, out);
    return null;
  }

  if (blockAt === -1 || blockStyle === null) return null;

  const after = blockAt + blockStyle.open.length;
  const closeAt = source.indexOf(blockStyle.close, after);

  if (closeAt === -1) {
    marksIn(source.slice(after), line, offset + after, out);
    return blockStyle;
  }

  marksIn(source.slice(after, closeAt), line, offset + after, out);

  const resume = closeAt + blockStyle.close.length;
  return scanCode(source.slice(resume), line, offset + resume, lineMarkers, blocks, out);
}

/**
 * Every note in the file, in reading order.
 *
 * An unknown language gets an empty list rather than a guess: without knowing what starts a
 * comment there is no way to tell a note from the word appearing in code, and the guess
 * would be wrong in exactly the noisy direction.
 */
export function todoMarksIn(text: string, languageId: string): readonly TodoMark[] {
  const grammar = grammarFor(languageId);
  if (grammar === null) return [];

  const lineMarkers = grammar.lineComment;
  const blocks = blockStylesFor(languageId);

  const marks: TodoMark[] = [];
  let openBlock: BlockStyle | null = null;

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;

    if (openBlock === null) {
      openBlock = scanCode(raw, line, 0, lineMarkers, blocks, marks);
      continue;
    }

    const style = openBlock;
    const closeAt = raw.indexOf(style.close);

    if (closeAt === -1) {
      // Still inside the comment; the whole line is note-bearing.
      marksIn(raw, line, 0, marks);
      continue;
    }

    marksIn(raw.slice(0, closeAt), line, 0, marks);

    // The rest of the line is ordinary code again, and may open another comment.
    const after = closeAt + style.close.length;
    openBlock = scanCode(raw.slice(after), line, after, lineMarkers, blocks, marks);
  }

  return marks;
}
