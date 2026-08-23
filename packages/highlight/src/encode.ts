/**
 * Semantic tokens, in the shape Monaco reads them.
 *
 * Monaco does not take a list of tokens. It takes a flat array of integers, five per token,
 * each one *relative to the token before it*: how many lines down, how many characters
 * along, how long, what type, which modifiers. The relative encoding is what keeps a large
 * file's token array small, and it is also a reliable source of off-by-one bugs - which is
 * exactly why it lives here, as a pure function with tests, rather than inline in a
 * provider that can only be exercised by opening an editor.
 *
 * Two rules the format demands and does not enforce:
 *
 * - Tokens must be sorted by position. An out-of-order token produces a negative delta,
 *   and Monaco renders the rest of the file's colouring somewhere it does not belong.
 * - A token may not span lines. Anything multi-line has to be split per line first, or the
 *   length runs off the end of its row.
 */
import { tokenIndex, type TokenType } from "./legend.ts";

export interface Token {
  /** Zero-based, as tree-sitter and Monaco's semantic tokens both count. */
  readonly line: number;
  readonly column: number;
  readonly length: number;
  readonly type: TokenType;
}

/**
 * Sort, drop what cannot be encoded, and delta-encode.
 *
 * Sorting here rather than trusting the caller: a tree walk produces tokens in tree order,
 * which is document order for most grammars and not for all of them, and the failure is
 * silent and ugly.
 */
export function encodeTokens(tokens: readonly Token[]): Uint32Array {
  const usable = tokens
    .filter((token) => token.length > 0 && tokenIndex(token.type) >= 0)
    .slice()
    .sort((a, b) => a.line - b.line || a.column - b.column);

  const data = new Uint32Array(usable.length * 5);

  let previousLine = 0;
  let previousColumn = 0;
  let at = 0;

  for (const token of usable) {
    const deltaLine = token.line - previousLine;
    // The column delta restarts on every new line, which is the part everybody gets wrong.
    const deltaColumn = deltaLine === 0 ? token.column - previousColumn : token.column;

    // Two tokens at the same position would encode a zero-width step and confuse the
    // renderer; the first one wins, which matches "outermost node decides".
    if (deltaLine === 0 && deltaColumn < 0) continue;

    data[at] = deltaLine;
    data[at + 1] = deltaColumn;
    data[at + 2] = token.length;
    data[at + 3] = tokenIndex(token.type);
    data[at + 4] = 0;
    at += 5;

    previousLine = token.line;
    previousColumn = token.column;
  }

  return at === data.length ? data : data.slice(0, at);
}
