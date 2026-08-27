/**
 * Where the comments are.
 *
 * Two features need the same hard question answered - is this column inside a comment, or
 * is it code that merely looks like one? `todos.ts` answered it first, for `TODO` and its
 * four siblings, and kept the walker to itself. Comment tones (`// !`, `// ?`) need the
 * identical walk, and a second copy of a scanner this fiddly would drift from the first
 * one within a release.
 *
 * So the walk lives here and reports what it finds; deciding what a comment *means* is the
 * caller's business.
 *
 * **It is not a parser and does not pretend to be.** Quotes are tracked so a `//` inside a
 * string does not open a comment, and block comments are carried across lines - but a
 * template literal containing `${"//"}`, or a regex literal containing a quote, can still
 * fool it. The cost of being wrong is one mis-coloured comment, which is why an
 * approximation is the right size of answer here, and why it is written down rather than
 * quietly relied on.
 */
import { grammarFor } from "./grammar.ts";

/** One run of comment text, delimiters excluded. */
export interface CommentSpan {
  /** The comment's text with its opening delimiter removed. */
  readonly text: string;
  /** One-based, as the editor counts. */
  readonly line: number;
  /** Zero-based index into the line where `text` begins. */
  readonly offset: number;
  /**
   * Zero-based index of the delimiter that opened this comment.
   *
   * Equal to `offset` when the span continues a block comment from a previous line, which
   * has no delimiter of its own. Tones colour from here so the `//` is coloured too;
   * keyword hunting ignores it.
   */
  readonly delimiterOffset: number;
  /**
   * The delimiter itself - `"//"`, `"#"`, `"/*"`. Empty on a continuation line.
   *
   * Reported rather than left to be inferred from `offset - delimiterOffset`: a caller
   * that wants to recognise a repeat of it needs the characters, and reconstructing them
   * from a length means guessing, which gets `#` wrong everywhere outside the C family.
   */
  readonly delimiter: string;
  /** False when this span continues a block comment opened on an earlier line. */
  readonly opensComment: boolean;
  /**
   * Which delimiter opened it.
   *
   * Tones need this and notes do not: a block comment's text begins with `*` by
   * convention the moment `/*` is stripped, so a tone that trusted the first character
   * would mark every documented function in the project.
   */
  readonly kind: "line" | "block";
}

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

/**
 * One line of code: report the comment it starts, if it starts one.
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
  visit: (span: CommentSpan) => void,
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
    const marker = lineMarkers.find((candidate) => source.startsWith(candidate, commentAt)) ?? "";
    const after = commentAt + marker.length;
    visit({
      text: source.slice(after),
      line,
      offset: offset + after,
      delimiterOffset: offset + commentAt,
      delimiter: marker,
      opensComment: true,
      kind: "line",
    });
    return null;
  }

  if (blockAt === -1 || blockStyle === null) return null;

  const after = blockAt + blockStyle.open.length;
  const closeAt = source.indexOf(blockStyle.close, after);

  if (closeAt === -1) {
    visit({
      text: source.slice(after),
      line,
      offset: offset + after,
      delimiterOffset: offset + blockAt,
      delimiter: blockStyle.open,
      opensComment: true,
      kind: "block",
    });
    return blockStyle;
  }

  visit({
    text: source.slice(after, closeAt),
    line,
    offset: offset + after,
    delimiterOffset: offset + blockAt,
    delimiter: blockStyle.open,
    opensComment: true,
    kind: "block",
  });

  const resume = closeAt + blockStyle.close.length;
  return scanCode(source.slice(resume), line, offset + resume, lineMarkers, blocks, visit);
}

/**
 * Walk every comment in the file, in reading order.
 *
 * An unknown language is walked as nothing at all rather than guessed at: without knowing
 * what starts a comment there is no way to tell a note from the word appearing in code, and
 * the guess would be wrong in exactly the noisy direction.
 */
export function scanComments(
  text: string,
  languageId: string,
  visit: (span: CommentSpan) => void,
): void {
  const grammar = grammarFor(languageId);
  if (grammar === null) return;

  const lineMarkers = grammar.lineComment;
  const blocks = blockStylesFor(languageId);

  let openBlock: BlockStyle | null = null;

  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;

    if (openBlock === null) {
      openBlock = scanCode(raw, line, 0, lineMarkers, blocks, visit);
      continue;
    }

    const style = openBlock;
    const closeAt = raw.indexOf(style.close);

    if (closeAt === -1) {
      // Still inside the comment; the whole line is comment text.
      visit({ text: raw, line, offset: 0, delimiterOffset: 0, delimiter: "", opensComment: false, kind: "block" });
      continue;
    }

    visit({
      text: raw.slice(0, closeAt),
      line,
      offset: 0,
      delimiterOffset: 0,
      delimiter: "",
      opensComment: false,
      kind: "block",
    });

    // The rest of the line is ordinary code again, and may open another comment.
    const after = closeAt + style.close.length;
    openBlock = scanCode(raw.slice(after), line, after, lineMarkers, blocks, visit);
  }
}
