/**
 * The vocabulary of things a token can be.
 *
 * These are the standard semantic token types every editor and language server already
 * agrees on, which is why they are used verbatim rather than invented: a theme written for
 * any other editor colours these correctly, and a language server publishing the same names
 * lines up with the tree-sitter output without translation.
 *
 * The order is the wire format. Monaco's semantic tokens are numbers indexing into this
 * array, so appending is safe and reordering is not.
 */
export const TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

/** The index Monaco expects for a token type, or -1 for one this legend has no word for. */
export function tokenIndex(type: TokenType): number {
  return TOKEN_TYPES.indexOf(type);
}
