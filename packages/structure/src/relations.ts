/**
 * What a symbol has to do with the rest of the project.
 *
 * Clicking a function and being shown where it goes is the difference between reading code
 * and searching it. Two questions, and they are not the same question:
 *
 * - **What does this call?** Answered from the function's own body, which the outline
 *   already delimits. No search, no index, no waiting.
 * - **Who calls this?** Answered from a project-wide search for the name, with every hit
 *   classified so the list is not forty rows of the word appearing in a comment.
 *
 * Everything here is pure. The search itself belongs to the shell - it has the workspace,
 * the ignore rules, and the cancellation - and it hands each hit back to `classifyReference`
 * to be judged. That split is what lets the judging be tested against a string.
 *
 * **On honesty.** This is not a compiler and does not resolve scope. Two files can each
 * define `handle`, and a search for it finds both. The panel says "matches by name", and
 * saying so is what makes the feature safe to trust: a tool that quietly implies it
 * resolved something it guessed at is worse than one that shows its working.
 */
import { grammarFor } from "./grammar.ts";
import { declarationOn } from "./outline.ts";

export type RelationKind = "definition" | "call" | "import" | "reference";

export interface RelationHit {
  readonly kind: RelationKind;
  /** Workspace-relative, as the search returns it. */
  readonly path: string;
  readonly line: number;
  readonly column: number;
  /** The line the hit is on, trimmed, for the row's second line. */
  readonly text: string;
}

/** One name called inside a body, and the first line that calls it. */
export interface CallSite {
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Words that are followed by a parenthesis and are not calls.
 *
 * Without this, "what does this function call" answers `if`, `for`, `while` and `switch`
 * for every function in every C-family language - which is to say, it answers nothing.
 */
const NOT_A_CALL: ReadonlySet<string> = new Set([
  "if", "for", "while", "switch", "catch", "return", "sizeof", "typeof", "do", "else",
  "function", "fn", "def", "func", "sub", "class", "struct", "enum", "match", "when",
  "with", "await", "yield", "new", "delete", "throw", "assert", "in", "and", "or", "not",
  "try", "except", "finally", "elif", "case", "default", "lambda", "print",
]);

const IDENTIFIER_CALL = /\b(?<name>[A-Za-z_$][\w$]*)\s*\(/g;

/**
 * Every distinct name called between two lines, in the order they first appear.
 *
 * Source order, not alphabetical. A function's calls in the order it makes them is a
 * readable summary of what it does; the same names sorted is a glossary.
 */
export function callsWithin(
  text: string,
  startLine: number,
  endLine: number,
  exclude: string,
): CallSite[] {
  const lines = text.split("\n");
  const calls: CallSite[] = [];
  const seen = new Set<string>();

  const first = Math.max(1, startLine);
  const last = Math.min(lines.length, endLine);

  for (let number = first; number <= last; number++) {
    const line = lines[number - 1];
    if (line === undefined) continue;

    // Strings and comments blanked the cheap way. The full scanner needs a grammar and a
    // whole file to carry its block-comment state across; this runs over one body and only
    // has to avoid the obvious false positives.
    const code = line
      .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (match) =>
        " ".repeat(match.length),
      )
      .replace(/(\/\/|#|--).*$/, (match) => " ".repeat(match.length));

    for (const match of code.matchAll(IDENTIFIER_CALL)) {
      const name = match.groups?.["name"] ?? "";
      if (name.length === 0 || name === exclude) continue;
      if (NOT_A_CALL.has(name) || seen.has(name)) continue;

      seen.add(name);
      calls.push({ name, line: number, column: (match.index ?? 0) + 1 });
    }
  }

  return calls;
}

/** The regex a project-wide search should run to find every mention of a symbol. */
export function referencePattern(name: string): string {
  return `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
}

/**
 * Which languages' files are worth searching for a symbol from this one.
 *
 * A TypeScript symbol can be referenced from a `.tsx`, a `.js`, and - through a template -
 * an `.html`. Searching every file in the project instead would find the symbol's name in
 * the lock file and in the minified bundle, which is how a useful list becomes an unusable
 * one. Returned as a glob for the search panel's `include` box.
 */
export function referenceGlobFor(languageId: string): string {
  const globs: Readonly<Record<string, string>> = {
    typescript: "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,vue,svelte,html}",
    javascript: "**/*.{js,jsx,mjs,cjs,ts,tsx,vue,svelte,html}",
    python: "**/*.{py,pyi,pyw}",
    c: "**/*.{c,h}",
    cpp: "**/*.{cpp,cc,cxx,hpp,hh,h,c}",
    "objective-c": "**/*.{m,mm,h}",
    java: "**/*.java",
    csharp: "**/*.{cs,cshtml,razor}",
    kotlin: "**/*.{kt,kts,java}",
    swift: "**/*.swift",
    go: "**/*.go",
    rust: "**/*.rs",
    ruby: "**/*.{rb,rake,erb}",
    php: "**/*.{php,phtml}",
    shell: "**/*.{sh,bash,zsh}",
    powershell: "**/*.{ps1,psm1}",
    lua: "**/*.lua",
    dart: "**/*.dart",
    scala: "**/*.{scala,sc}",
    css: "**/*.{html,htm,vue,svelte,jsx,tsx,js,ts,php,erb,hbs}",
    scss: "**/*.{html,htm,vue,svelte,jsx,tsx,js,ts,php,erb,hbs}",
    less: "**/*.{html,htm,vue,svelte,jsx,tsx,js,ts,php,erb,hbs}",
    html: "**/*.{html,htm,css,scss,less,js,ts,jsx,tsx}",
  };

  return globs[languageId] ?? "";
}

const IMPORT_LINE =
  /^\s*(?:import\b|from\b|export\b.*\bfrom\b|require\s*\(|#\s*(?:include|import)\b|use\b|using\b|@use\b|@import\b|load\b)/;

/**
 * What one search hit actually is.
 *
 * Order matters. A definition can also look like a call (`function handle(x)` contains
 * `handle(`), and an import can contain both - so the most specific test runs first and the
 * general `reference` is what is left when nothing else fits.
 */
export function classifyReference(
  name: string,
  languageId: string,
  lineText: string,
  column: number,
): RelationKind {
  /*
   * An import names a symbol; it does not define one.
   *
   * The grammars class `#include <vector>` and `import { render } from "./view"` as
   * declarations, because for the outline they are - they are the rows a reader wants at
   * the top of a file. Here they are the opposite of a definition, and letting the kind
   * through unchecked marks every `#include` as the place a symbol is defined.
   */
  const declared = declarationOn(languageId, lineText);
  if (declared !== null && declared.name === name && declared.kind !== "import") {
    return "definition";
  }

  if (IMPORT_LINE.test(lineText)) return "import";

  // A call is the name with a `(` after it, allowing for the space some styles put there.
  // Read from the hit's own column rather than from the first occurrence on the line, so
  // `handle(handle)` is judged at the position the search actually found.
  const after = lineText.slice(Math.max(0, column - 1) + name.length);
  if (/^\s*[(<]/.test(after)) return "call";

  return "reference";
}

/**
 * Does this language have a grammar good enough to classify hits?
 *
 * Without one, every hit would come back `reference` - which is not wrong, but a list where
 * every row says the same word has stopped grouping anything. The panel drops the grouping
 * and shows a plain list instead.
 */
export function canClassify(languageId: string): boolean {
  const grammar = grammarFor(languageId);
  return grammar !== null && grammar.rules.length > 0;
}

/** Rows first, and within a kind, by file then line. What the panel renders. */
export function sortRelations(hits: readonly RelationHit[]): RelationHit[] {
  const order: Record<RelationKind, number> = {
    definition: 0,
    call: 1,
    reference: 2,
    import: 3,
  };

  return [...hits].sort(
    (a, b) =>
      order[a.kind] - order[b.kind] || a.path.localeCompare(b.path) || a.line - b.line,
  );
}
