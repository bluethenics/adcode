/**
 * Colouring code by reading it, rather than by pattern-matching the words.
 *
 * Monaco's own tokenizer is a set of regular expressions per language. It is fast and it is
 * wrong in the places that are hard: a keyword inside a string, a nested template literal,
 * a generic that looks like a comparison. A real parse tree is not confused by any of them.
 *
 * This package is the pure half - which node types mean what, and how to encode the result
 * for Monaco. Loading the WebAssembly grammars and walking the tree belongs to the shell,
 * because that part needs the DOM and a network fetch and cannot be tested against a string.
 *
 * Grammars that fail to load are not an error anywhere in this design. The editor keeps the
 * colouring it already had, which is the tokenizer that has been shipping all along.
 */
export { TOKEN_TYPES, tokenIndex, type TokenType } from "./legend.ts";
export { encodeTokens, type Token } from "./encode.ts";
export { isOpaque, tokenFor, type NodeShape } from "./mapping.ts";

/**
 * The languages a grammar is shipped for.
 *
 * Kept here rather than read from the directory so the renderer knows what to try without a
 * round trip, and so the list is visible next to the mapping table that has to support it.
 * `scripts/grammars.mjs` copies exactly this set.
 */
export const GRAMMAR_LANGUAGES: readonly string[] = [
  "typescript",
  "tsx",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "css",
  "html",
  "json",
];

/**
 * The grammar file for a Monaco language id, or null.
 *
 * The two vocabularies do not match: Monaco calls JSX `javascript` and TSX
 * `typescript`, while tree-sitter has separate grammars for each, and picking the wrong one
 * produces a parse tree full of errors for a perfectly valid file.
 */
export function grammarFileFor(languageId: string): string | null {
  const direct = GRAMMAR_LANGUAGES.includes(languageId) ? languageId : null;
  if (direct !== null) return `tree-sitter-${direct}.wasm`;

  // A Map, for the same reason mapping.ts uses them: a language id is arbitrary text.
  const aliases = new Map<string, string>(Object.entries({
    javascriptreact: "tsx",
    typescriptreact: "tsx",
    jsonc: "json",
    scss: "css",
    less: "css",
    xml: "html",
    handlebars: "html",
  }));

  const alias = aliases.get(languageId);
  return alias === undefined ? null : `tree-sitter-${alias}.wasm`;
}
