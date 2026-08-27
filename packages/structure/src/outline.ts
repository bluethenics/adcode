/**
 * One engine, every language.
 *
 * `outlineOf` is the whole public surface: a Monaco language id and a file's text in, a
 * tree of declarations out. Everything below it is the three ways a language can nest -
 * braces, indentation, or not at all - plus the dispatch to the two dedicated scanners for
 * markup and stylesheets, whose shapes are not line-shaped at all.
 *
 * **Comments and strings are blanked before anything is matched.** Not deleted - replaced
 * with spaces, one for one, so every index still points where it pointed. That single
 * decision removes the largest class of wrong rows there is: a commented-out function is
 * not in the outline, a brace inside `"}"` does not close a block, and `# def foo` in a
 * Python comment is not a function. Deleting instead of blanking would give the same
 * matches and the wrong column for every one of them.
 */
import { NOT_A_DECLARATION, grammarFor, type Grammar, type Rule } from "./grammar.ts";
import { markupOutline } from "./markup.ts";
import { styleOutline } from "./styles.ts";
import type { MutableNode, OutlineNode, SymbolKind } from "./types.ts";
import { finish } from "./types.ts";

/**
 * Kinds that can hold other declarations, for the indentation engine.
 *
 * The brace engine does not need this list - a brace is the evidence. Indented languages
 * have no such marker, so without it `MAX_RETRIES = 5` at column zero would become the
 * parent of every function below it in the file.
 */
const CONTAINER_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  "module", "namespace", "class", "struct", "interface", "enum", "function", "method",
  "constructor", "macro", "key",
]);

interface ScannedLine {
  /** One-based. */
  readonly number: number;
  readonly raw: string;
  /** `raw` with comments and string bodies blanked, same length. */
  readonly code: string;
}

/**
 * Split into lines with the noise blanked out.
 *
 * Block comments and Python's triple-quoted strings carry across lines, so this is a small
 * state machine rather than a per-line replace. Both of them routinely contain example
 * code - a docstring showing how to call the function it documents is the single most
 * common shape in Python - and matching inside one produces a row for a function that does
 * not exist.
 */
function scan(text: string, grammar: Grammar, languageId: string): ScannedLine[] {
  const hasBlockComments = grammar.lineComment.includes("//") || grammar.model === "style";
  const hasTripleQuotes = languageId === "python";

  const lines = text.split("\n");
  const scanned: ScannedLine[] = [];

  let inBlockComment = false;
  let openTriple: string | null = null;

  for (const [index, raw] of lines.entries()) {
    let code = "";
    let at = 0;

    while (at < raw.length) {
      const rest = raw.slice(at);

      if (inBlockComment) {
        const end = rest.indexOf("*/");
        if (end === -1) {
          code += " ".repeat(rest.length);
          at = raw.length;
        } else {
          code += " ".repeat(end + 2);
          at += end + 2;
          inBlockComment = false;
        }
        continue;
      }

      if (openTriple !== null) {
        const end = rest.indexOf(openTriple);
        if (end === -1) {
          code += " ".repeat(rest.length);
          at = raw.length;
        } else {
          code += " ".repeat(end + 3);
          at += end + 3;
          openTriple = null;
        }
        continue;
      }

      if (hasTripleQuotes && (rest.startsWith('"""') || rest.startsWith("'''"))) {
        openTriple = rest.slice(0, 3);
        code += "   ";
        at += 3;
        continue;
      }

      if (hasBlockComments && rest.startsWith("/*")) {
        inBlockComment = true;
        code += "  ";
        at += 2;
        continue;
      }

      const comment = grammar.lineComment.find((token) => rest.startsWith(token));
      if (comment !== undefined) {
        code += " ".repeat(rest.length);
        at = raw.length;
        continue;
      }

      const quote = rest[0];
      if (quote === '"' || quote === "'" || quote === "`") {
        // The opening quote is kept so a rule that anchors on one still matches; only the
        // body is blanked, which is what stops a brace or a comment marker inside a string
        // from being read as syntax.
        let cursor = 1;
        while (cursor < rest.length) {
          if (rest[cursor] === "\\") {
            cursor += 2;
            continue;
          }
          if (rest[cursor] === quote) break;
          cursor += 1;
        }

        const span = Math.min(cursor + 1, rest.length);
        code += quote + " ".repeat(Math.max(0, span - 2)) + (cursor < rest.length ? quote : "");
        at += span;
        continue;
      }

      code += raw[at] ?? "";
      at += 1;
    }

    scanned.push({ number: index + 1, raw, code: code.padEnd(raw.length, " ") });
  }

  return scanned;
}

interface Match {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly detail: string;
  readonly column: number;
}

/**
 * The first rule that claims this line, or null. Keywords never claim one.
 *
 * **Decided on the blanked line, read off the raw one.** The two are the same length by
 * construction, so a pattern that matches one matches the other in the same place - but
 * blanking is what makes the decision trustworthy (a `{` inside a string is not a brace)
 * and the raw text is the only place the *answer* survives. A JSON key and a
 * `describe("…")` title both live inside string literals: judged on the blanked line and
 * also read from it, every one of them comes back as a row of spaces.
 */
function matchLine(code: string, raw: string, rules: readonly Rule[]): Match | null {
  const trimmed = code.trimStart();
  if (trimmed.length === 0) return null;

  const rawTrimmed = raw.trimStart();

  for (const rule of rules) {
    const decided = rule.pattern.exec(trimmed);
    if (decided === null) continue;

    // Falls back to the blanked match if the raw line somehow does not match the same rule,
    // which keeps a strange line producing a dull row rather than no row at all.
    const found = rule.pattern.exec(rawTrimmed) ?? decided;

    const name = (found.groups?.["name"] ?? "").trim();
    if (name.length === 0) continue;
    if (NOT_A_DECLARATION.has(name)) continue;

    // Column from the original line, not the blanked one: they are the same length by
    // construction, so the index is valid, and the raw text is what the editor will show.
    const at = raw.indexOf(name);

    return {
      kind: rule.kind,
      name,
      detail: (found.groups?.["detail"] ?? "").trim(),
      column: at === -1 ? 1 : at + 1,
    };
  }

  return null;
}

const netBraces = (code: string): number =>
  (code.match(/\{/g) ?? []).length - (code.match(/\}/g) ?? []).length;

/**
 * Braces decide the nesting.
 *
 * A declaration whose line opens a block becomes the parent of everything until that block
 * closes; one that does not - a `const`, a prototype, a one-line function - is a leaf. That
 * is the entire rule, and it is why this works identically for C, Rust, Go and JavaScript
 * without any of them being special-cased.
 */
function braceOutline(lines: readonly ScannedLine[], rules: readonly Rule[]): OutlineNode[] {
  const roots: MutableNode[] = [];
  const stack: { readonly openDepth: number; readonly node: MutableNode }[] = [];

  let depth = 0;

  for (const line of lines) {
    const found = matchLine(line.code, line.raw, rules);
    const before = depth;

    let node: MutableNode | null = null;

    if (found !== null) {
      node = {
        kind: found.kind,
        name: found.name,
        detail: found.detail,
        line: line.number,
        column: found.column,
        endLine: line.number,
        children: [],
      };

      const parent = stack.at(-1);
      if (parent === undefined) roots.push(node);
      else parent.node.children.push(node);
    }

    depth += netBraces(line.code);

    if (node !== null && depth > before) stack.push({ openDepth: before, node });

    while (stack.length > 0 && (stack.at(-1)?.openDepth ?? 0) >= depth) {
      const entry = stack.pop();
      if (entry !== undefined) entry.node.endLine = line.number;
    }
  }

  const lastLine = lines.at(-1)?.number ?? 1;
  for (const entry of stack) entry.node.endLine = lastLine;

  return roots.map(finish);
}

/** Leading whitespace, with a tab counted as one level rather than one column. */
function indentOf(raw: string): number {
  const match = /^[\t ]*/.exec(raw);
  const leading = match === null ? "" : match[0];

  let width = 0;
  for (const character of leading) width += character === "\t" ? 4 : 1;
  return width;
}

/**
 * Indentation decides the nesting.
 *
 * Python, Ruby, Elixir and YAML. A node's children are the declarations indented further
 * than it, and its `endLine` is the last line with any content before the indentation comes
 * back out - not the line that ends it, which would put the blank lines between two
 * functions inside the first one and make "what does this call" read past its own body.
 */
function indentOutline(lines: readonly ScannedLine[], rules: readonly Rule[]): OutlineNode[] {
  const roots: MutableNode[] = [];
  const stack: { readonly indent: number; readonly node: MutableNode }[] = [];

  let lastContentLine = 1;

  for (const line of lines) {
    if (line.code.trim().length === 0) continue;

    const indent = indentOf(line.raw);

    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) {
      const entry = stack.pop();
      if (entry !== undefined) entry.node.endLine = lastContentLine;
    }

    lastContentLine = line.number;

    const found = matchLine(line.code, line.raw, rules);
    if (found === null) continue;

    const node: MutableNode = {
      kind: found.kind,
      name: found.name,
      detail: found.detail,
      line: line.number,
      column: found.column,
      endLine: line.number,
      children: [],
    };

    const parent = stack.at(-1);
    if (parent === undefined) roots.push(node);
    else parent.node.children.push(node);

    if (CONTAINER_KINDS.has(found.kind)) stack.push({ indent, node });
  }

  for (const entry of stack) entry.node.endLine = lastContentLine;

  return roots.map(finish);
}

/** No nesting at all: SQL, Dockerfiles, ini. Every match is a sibling. */
function flatOutline(lines: readonly ScannedLine[], rules: readonly Rule[]): OutlineNode[] {
  const nodes: MutableNode[] = [];

  for (const line of lines) {
    const found = matchLine(line.code, line.raw, rules);
    if (found === null) continue;

    // Each entry runs until the next one starts, so a section in an ini file covers its
    // keys and "what is in here" has an answer.
    const previous = nodes.at(-1);
    if (previous !== undefined) previous.endLine = Math.max(previous.line, line.number - 1);

    nodes.push({
      kind: found.kind,
      name: found.name,
      detail: found.detail,
      line: line.number,
      column: found.column,
      endLine: line.number,
      children: [],
    });
  }

  const last = nodes.at(-1);
  if (last !== undefined) last.endLine = lines.at(-1)?.number ?? last.line;

  return nodes.map(finish);
}

/**
 * Markdown, by heading level.
 *
 * `#` through `######` nest by number, and a heading's end is where the next heading at its
 * level or shallower begins - which is exactly what a reader means by "this section".
 */
function headingOutline(lines: readonly ScannedLine[]): OutlineNode[] {
  const roots: MutableNode[] = [];
  const stack: { readonly level: number; readonly node: MutableNode }[] = [];

  let fenced = false;

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line.raw)) {
      fenced = !fenced;
      continue;
    }
    // A `# comment` on the first line of a fenced shell block is not a heading, and a
    // README full of shell examples is otherwise mostly headings.
    if (fenced) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.raw);
    if (heading === null) continue;

    const level = (heading[1] ?? "").length;

    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) {
      const entry = stack.pop();
      if (entry !== undefined) entry.node.endLine = Math.max(entry.node.line, line.number - 1);
    }

    const node: MutableNode = {
      kind: "heading",
      name: heading[2] ?? "",
      detail: "",
      line: line.number,
      column: 1,
      endLine: line.number,
      children: [],
    };

    const parent = stack.at(-1);
    if (parent === undefined) roots.push(node);
    else parent.node.children.push(node);

    stack.push({ level, node });
  }

  const lastLine = lines.at(-1)?.number ?? 1;
  for (const entry of stack) entry.node.endLine = lastLine;

  return roots.map(finish);
}

/** Can ADCode read this language's shape? The panel says so plainly when it cannot. */
export function outlineSupported(languageId: string): boolean {
  return grammarFor(languageId) !== null;
}

/**
 * What, if anything, this single line declares.
 *
 * The relations view needs it: a search hit sitting on the line that *defines* the symbol
 * is not a use of it, and listing the definition among its own callers is the fastest way
 * to make the feature look broken. Exported rather than duplicated there, so "what counts
 * as a declaration" has exactly one answer per language.
 */
export function declarationOn(
  languageId: string,
  lineText: string,
): { readonly kind: SymbolKind; readonly name: string } | null {
  const grammar = grammarFor(languageId);
  if (grammar === null || grammar.rules.length === 0) return null;

  const [scanned] = scan(lineText, grammar, languageId);
  if (scanned === undefined) return null;

  const found = matchLine(scanned.code, scanned.raw, grammar.rules);
  return found === null ? null : { kind: found.kind, name: found.name };
}

export function outlineOf(languageId: string, text: string): OutlineNode[] {
  const grammar = grammarFor(languageId);
  if (grammar === null) return [];

  if (grammar.model === "markup") return markupOutline(text);
  if (grammar.model === "style") return styleOutline(text);

  const lines = scan(text, grammar, languageId);

  if (grammar.model === "heading") return headingOutline(lines);
  if (grammar.model === "indent") return indentOutline(lines, grammar.rules);
  if (grammar.model === "flat") return flatOutline(lines, grammar.rules);

  return braceOutline(lines, grammar.rules);
}

/** Depth-first walk, for the panel's filtering and for finding a node by line. */
export function walkOutline(nodes: readonly OutlineNode[]): OutlineNode[] {
  const all: OutlineNode[] = [];

  const visit = (node: OutlineNode): void => {
    all.push(node);
    for (const child of node.children) visit(child);
  };

  for (const node of nodes) visit(node);
  return all;
}

/**
 * The innermost node containing a line, or null.
 *
 * What keeps the panel's highlight on the thing the cursor is actually inside. Innermost
 * rather than outermost: being told you are in `Widget` when you are in `Widget.render` is
 * information you already had.
 */
export function nodeAtLine(nodes: readonly OutlineNode[], line: number): OutlineNode | null {
  let best: OutlineNode | null = null;

  for (const node of walkOutline(nodes)) {
    if (line < node.line || line > node.endLine) continue;
    if (best === null || node.line >= best.line) best = node;
  }

  return best;
}
