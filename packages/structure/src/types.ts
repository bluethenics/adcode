/**
 * What a file's shape is made of.
 *
 * One node type for every language, deliberately. The alternative - a Python shape, an
 * HTML shape, a CSS shape - means the panel that draws them needs a branch per language
 * and gains one every time a language is added, which is how a feature like this stops
 * being extended after the third language.
 *
 * The kinds below are the LSP `SymbolKind` set where one fits, because that is the
 * vocabulary every other tool already uses, plus four that it has no word for: `element`
 * for a markup tag, `selector` and `at-rule` for the two things a stylesheet is built
 * from, and `heading` for a document. Inventing those is cheaper than pretending an
 * `<h1>` is a `class`.
 */

export type SymbolKind =
  | "module"
  | "namespace"
  | "class"
  | "struct"
  | "interface"
  | "enum"
  | "function"
  | "method"
  | "constructor"
  | "property"
  | "variable"
  | "constant"
  | "type"
  | "macro"
  | "import"
  | "element"
  | "selector"
  | "at-rule"
  | "heading"
  | "key";

/**
 * One entry in the tree.
 *
 * `line` and `endLine` are one-based and inclusive, as a person counts them and as every
 * editor displays them. `endLine` is what makes relations possible at all: "what does this
 * function call" is a question about the lines between `line` and `endLine`, and without
 * the closing line there is nothing to search inside.
 *
 * `detail` is the part of the declaration that is not the name - a parameter list, a base
 * class, the rest of a compound selector. Kept separate rather than baked into `name` so
 * the panel can dim it, and so a search for a symbol by name does not have to strip it
 * back off.
 */
export interface OutlineNode {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly detail: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly children: readonly OutlineNode[];
}

/** A node under construction, before its end is known. Internal to the engines. */
export interface MutableNode {
  kind: SymbolKind;
  name: string;
  detail: string;
  line: number;
  column: number;
  endLine: number;
  children: MutableNode[];
}

export function finish(node: MutableNode): OutlineNode {
  return {
    kind: node.kind,
    name: node.name,
    detail: node.detail,
    line: node.line,
    column: node.column,
    endLine: node.endLine,
    children: node.children.map(finish),
  };
}
