/**
 * What a parse node means, in colour.
 *
 * A tree-sitter grammar gives you a tree of node types - `string_literal`, `comment`,
 * `type_identifier` - and nothing about how to paint them. The usual answer is the grammar
 * author's `highlights.scm` query file, which the prebuilt wasm packages do not ship, so
 * this is that mapping written out as a table.
 *
 * Writing it by hand turns out to be an advantage rather than a compromise. The node type
 * names are strikingly consistent across grammars - almost every language calls a comment
 * `comment` and a string `string` - so one table covers eleven languages with a short
 * per-language section for the places they genuinely differ.
 *
 * The tables are `Map`s rather than object literals, and that is not a style preference: a
 * node type arrives from a parser, and `TABLE["valueOf"]` on a plain object is a lookup
 * *hit* that returns a function off `Object.prototype`. A property test found it by
 * generating exactly that string.
 *
 * **Keywords are the interesting case.** tree-sitter does not have a `keyword` node type.
 * Keywords appear as *anonymous* nodes whose type is the literal text: the `const` in a
 * declaration is a node of type `"const"`. So the rule is structural rather than a list -
 * an anonymous node made of letters is a keyword - and it works for every language without
 * anybody enumerating their keywords.
 */
import type { TokenType } from "./legend.ts";

/** Node types that mean the same thing in every grammar that has them. */
const UNIVERSAL = new Map<string, TokenType>(Object.entries({
  comment: "comment",
  line_comment: "comment",
  block_comment: "comment",
  doc_comment: "comment",

  string: "string",
  string_literal: "string",
  raw_string_literal: "string",
  interpreted_string_literal: "string",
  char_literal: "string",
  character_literal: "string",
  string_fragment: "string",
  template_string: "string",
  quoted_attribute_value: "string",
  attribute_value: "string",

  number: "number",
  integer: "number",
  float: "number",
  float_literal: "number",
  integer_literal: "number",
  number_literal: "number",
  decimal_integer_literal: "number",
  int_literal: "number",
  imaginary_literal: "number",

  regex: "regexp",
  regex_pattern: "regexp",

  type_identifier: "type",
  primitive_type: "type",
  predefined_type: "type",
  type_parameter: "typeParameter",

  property_identifier: "property",
  field_identifier: "property",
  shorthand_property_identifier: "property",
  shorthand_property_identifier_pattern: "property",

  decorator: "decorator",
  escape_sequence: "string",
}));

/**
 * Node types whose meaning depends on the language.
 *
 * Kept small on purpose. Every entry here is a place a grammar genuinely disagrees with the
 * others, not a place this table could have been more thorough.
 */
const PER_LANGUAGE_SOURCE: Record<string, Record<string, TokenType>> = {
  python: {
    identifier: "variable",
    // Python has no separate type node; a class name is just an identifier, so the parent
    // is what distinguishes it. Handled in `tokenFor` rather than here.
    none: "keyword",
    true: "keyword",
    false: "keyword",
  },
  rust: {
    identifier: "variable",
    macro_invocation: "macro",
    lifetime: "typeParameter",
    self: "keyword",
  },
  go: {
    package_identifier: "namespace",
    label_name: "property",
  },
  java: {
    void_type: "type",
    integral_type: "type",
    floating_point_type: "type",
    boolean_type: "type",
  },
  c: {
    preproc_arg: "macro",
    system_lib_string: "string",
  },
  css: {
    tag_name: "type",
    class_name: "class",
    id_name: "variable",
    property_name: "property",
    plain_value: "string",
    unit: "number",
    at_keyword: "keyword",
    color_value: "number",
  },
  html: {
    tag_name: "type",
    attribute_name: "property",
    text: "string",
    erroneous_end_tag_name: "type",
  },
  json: {
    // A JSON key is a string node, but colouring keys and values identically is the one
    // thing that makes JSON hard to skim.
    pair: "property",
  },
};

const PER_LANGUAGE = new Map<string, Map<string, TokenType>>(
  Object.entries(PER_LANGUAGE_SOURCE).map(([language, table]) => [
    language,
    new Map(Object.entries(table)),
  ]),
);

/** Anonymous nodes made only of letters are this language's keywords. */
const KEYWORD_SHAPE = /^[a-z_][a-z_0-9]*$/;

/**
 * Parents that turn a bare identifier into something more specific.
 *
 * This is what lets a table of node types produce function and type colouring in languages
 * whose grammars call every name an `identifier`.
 */
const BY_PARENT = new Map<string, TokenType>(Object.entries({
  function_declaration: "function",
  function_definition: "function",
  function_declarator: "function",
  function_item: "function",
  method_definition: "method",
  method_declaration: "method",
  call_expression: "function",
  call: "function",
  class_declaration: "class",
  class_definition: "class",
  class_specifier: "class",
  struct_item: "struct",
  struct_specifier: "struct",
  interface_declaration: "interface",
  enum_declaration: "enum",
  enum_item: "enum",
  enum_specifier: "enum",
  type_alias_declaration: "type",
  type_declaration: "type",
  namespace_declaration: "namespace",
  package_clause: "namespace",
  formal_parameters: "parameter",
  parameter: "parameter",
  parameters: "parameter",
  parameter_declaration: "parameter",
  required_parameter: "parameter",
  optional_parameter: "parameter",
}));

export interface NodeShape {
  readonly type: string;
  /** tree-sitter's own distinction: named nodes are grammar rules, anonymous ones are text. */
  readonly named: boolean;
  readonly parentType?: string | undefined;
}

/**
 * The token type for a node, or `null` to leave it to Monaco.
 *
 * `null` is a real answer and the common one: most nodes are structure rather than
 * something to paint, and emitting a token for every node would both flood the editor and
 * override the colouring Monaco already does well.
 */
export function tokenFor(languageId: string, node: NodeShape): TokenType | null {
  // Anonymous nodes are the literal text of the grammar - keywords, operators, punctuation.
  if (!node.named) {
    return KEYWORD_SHAPE.test(node.type) ? "keyword" : null;
  }

  const perLanguage = PER_LANGUAGE.get(languageId)?.get(node.type);
  if (perLanguage !== undefined) return perLanguage;

  const universal = UNIVERSAL.get(node.type);
  if (universal !== undefined) return universal;

  if (node.type === "identifier" && node.parentType !== undefined) {
    const byParent = BY_PARENT.get(node.parentType);
    if (byParent !== undefined) return byParent;
  }

  return null;
}

/**
 * Whether a node's children are worth visiting.
 *
 * A string's insides are not: an escape sequence inside a string is already coloured by the
 * string, and descending into one produces overlapping tokens that Monaco renders as a
 * visible seam. Same for comments.
 */
export function isOpaque(type: string): boolean {
  return (
    type === "comment" ||
    type === "line_comment" ||
    type === "block_comment" ||
    type === "string" ||
    type === "string_literal" ||
    type === "raw_string_literal"
  );
}
