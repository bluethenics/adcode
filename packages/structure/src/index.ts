/**
 * Reading the shape of a file, and what it has to do with the rest of the project.
 *
 * No DOM, no Electron, no Node. Everything in here is a function of a string and a language
 * id, which is what lets twenty languages' worth of structure rules be tested in
 * milliseconds instead of by opening an editor and looking.
 */
export { grammarFor, supportedLanguages, GRAMMARS, type Grammar, type Rule } from "./grammar.ts";

export {
  declarationOn,
  nodeAtLine,
  outlineOf,
  outlineSupported,
  walkOutline,
} from "./outline.ts";

export {
  describeElement,
  markupElements,
  markupOutline,
  VOID_ELEMENTS,
  type MarkupElement,
} from "./markup.ts";

export {
  declarationsIn,
  elementMatches,
  searchPatternFor,
  selectorTargets,
  styleOutline,
  type SelectorTarget,
  type TargetKind,
} from "./styles.ts";

export {
  callsWithin,
  canClassify,
  classifyReference,
  referenceGlobFor,
  referencePattern,
  sortRelations,
  type CallSite,
  type RelationHit,
  type RelationKind,
} from "./relations.ts";

export { closingTagFor, completeClosingTag, supportsTagClosing } from "./tags.ts";

export { pairedTagAt, type PairedTag, type TagNameSpan } from "./pairedTags.ts";

export { todoMarksIn, type TodoKeyword, type TodoMark } from "./todos.ts";
export { scanComments, type CommentSpan } from "./comments.ts";
export { commentTonesIn, type Tone, type TonedComment } from "./commentTones.ts";

export {
  describeEntry,
  HIDDEN_DIRECTORIES,
  projectKinds,
  whereToStart,
  type PathNote,
} from "./folders.ts";

export {
  identifierFrom,
  languagesWithScaffolds,
  scaffoldFor,
  type Scaffold,
} from "./scaffolds.ts";

export type { OutlineNode, SymbolKind } from "./types.ts";

export {
  definedClasses,
  missingClasses,
  rulesForElement,
  styleRules,
  unusedSelectors,
  type MissingClass,
  type StyleRule,
} from "./styleLinks.ts";
