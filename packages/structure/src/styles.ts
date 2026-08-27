/**
 * Reading a stylesheet, and answering the question a stylesheet cannot answer about itself.
 *
 * "What am I styling?" is the question every CSS file provokes and none of them contain the
 * answer to. A rule says `.card__title--muted { … }` and the only way to find out what that
 * is, in every editor, is to guess a search term and read the hits. That is a strange gap:
 * the information exists, it is in the markup two directories away, and nothing goes and
 * gets it.
 *
 * This module is the going and getting, split in two so both halves stay pure:
 *
 * - `styleOutline` reads the rules out of the stylesheet.
 * - `selectorTargets` reduces a selector to the tokens worth searching a project for, and
 *   `elementMatches` decides whether a given element is actually one of them.
 *
 * The split matters because searching is I/O and matching is not. The renderer runs the
 * search it already has, and hands each candidate back here to be judged - so the judging
 * is testable against a string of HTML, with no workspace and no disk.
 */
import type { MarkupElement } from "./markup.ts";
import type { MutableNode, OutlineNode } from "./types.ts";
import { finish } from "./types.ts";

/* ── The outline half ─────────────────────────────────────────────────────── */

/**
 * Blank out comments and strings, keeping every character's position.
 *
 * A brace inside `content: "{"` is not a brace, and a rule inside `/* … *\/` is not a rule.
 * Both are replaced with spaces rather than removed so line and column numbers survive.
 */
function blankNoise(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

/** `  .a,\n  .b  ` becomes `.a, .b`, which is what the panel should show on one row. */
function tidySelector(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The rules and at-rules in a stylesheet, nested as they nest.
 *
 * SCSS and Less nest for real, and plain CSS now does too, so the brace depth is the tree.
 * Declarations are not listed: a rule with twelve properties would be a twelve-row subtree
 * that says nothing the rule's own body does not, and the outline exists to be shorter than
 * the file. The one exception is a custom property defined at the top level, which is a
 * name other files refer to - the same reason a `const` is in a JavaScript outline.
 */
export function styleOutline(text: string): OutlineNode[] {
  const source = blankNoise(text);
  const lines = source.split("\n");
  const original = text.split("\n");

  const roots: MutableNode[] = [];
  const stack: { readonly depth: number; readonly node: MutableNode }[] = [];

  let depth = 0;
  // A selector can be written across several lines before its `{`. Text is accumulated here
  // until the brace arrives, which is what makes a multi-line selector list one row rather
  // than three unrecognisable fragments.
  let pending = "";
  let pendingLine = 0;

  const attach = (node: MutableNode): void => {
    const parent = stack.at(-1);
    if (parent === undefined) roots.push(node);
    else parent.node.children.push(node);
  };

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    let rest = line;

    /*
     * Three characters end a piece of selector text: `{` starts its block, `}` ends the
     * enclosing one, and `;` ends a declaration - which is the one everybody forgets. Without
     * the semicolon case, `color: red;` two lines above a nested rule is still sitting in
     * `pending` when the nested rule's brace arrives, and the outline shows a rule called
     * "color: red; .b".
     */
    while (rest.length > 0) {
      const positions = [rest.indexOf("{"), rest.indexOf("}"), rest.indexOf(";")].map((at) =>
        at === -1 ? Number.MAX_SAFE_INTEGER : at,
      );
      const next = Math.min(...positions);

      if (next === Number.MAX_SAFE_INTEGER) {
        if (pending.trim().length === 0 && rest.trim().length > 0) pendingLine = lineNumber;
        pending += ` ${rest}`;
        break;
      }

      const character = rest[next];
      const before = rest.slice(0, next);
      rest = rest.slice(next + 1);

      if (character === ";") {
        pending = "";
        pendingLine = 0;
        continue;
      }

      if (character === "{") {
        if (pending.trim().length === 0 && before.trim().length > 0) pendingLine = lineNumber;
        // Joined with a space, not concatenated: the newline between `.a,` and `.b` is the
        // only thing separating them, and losing it renders the row as `.a,.b`. In CSS a
        // newline *is* whitespace, so a space is also the correct reading of `.a\n.b`.
        const selector = tidySelector(`${pending} ${before}`);

        if (selector.length > 0) {
          const node: MutableNode = {
            kind: selector.startsWith("@") ? "at-rule" : "selector",
            name: selector,
            detail: "",
            line: pendingLine === 0 ? lineNumber : pendingLine,
            column: 1,
            endLine: lineNumber,
            children: [],
          };

          attach(node);
          stack.push({ depth, node });
        }

        depth += 1;
        pending = "";
        pendingLine = 0;
        continue;
      }

      depth = Math.max(0, depth - 1);
      while (stack.length > 0 && (stack.at(-1)?.depth ?? 0) >= depth) {
        const entry = stack.pop();
        if (entry !== undefined) entry.node.endLine = lineNumber;
      }

      pending = "";
      pendingLine = 0;
    }

    // A custom property at the top level of `:root` is a name the rest of the project uses
    // by hand, so it earns a row the way an exported constant does.
    const custom = /^\s*(--[\w-]+)\s*:\s*([^;]*)/.exec(line);
    if (custom !== null && custom[1] !== undefined) {
      attach({
        kind: "variable",
        name: custom[1],
        detail: (custom[2] ?? "").trim(),
        line: lineNumber,
        column: (original[index] ?? "").indexOf("--") + 1,
        endLine: lineNumber,
        children: [],
      });
    }
  }

  const lastLine = lines.length;
  for (const entry of stack) entry.node.endLine = lastLine;

  return roots.map(finish);
}

/**
 * The declarations inside a rule, as written.
 *
 * Shown beside "what this styles", because the two questions arrive together: knowing that
 * `.card` lands on three elements is only half of what the reader wanted, and the other
 * half is what it does to them. Returned as raw `property: value` pairs rather than
 * rewritten into prose - CSS declarations are already the clearest available statement of
 * what they do, and a translation layer here would add a way to be wrong for no gain.
 */
export function declarationsIn(text: string, startLine: number, endLine: number): string[] {
  const lines = blankNoise(text).split("\n").slice(startLine, endLine);
  const declarations: string[] = [];

  for (const line of lines) {
    // A nested rule's own declarations belong to it, not to this one.
    if (line.includes("{")) break;

    for (const part of line.split(";")) {
      const match = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(part);
      if (match !== null) declarations.push(`${match[1]}: ${match[2]}`);
    }
  }

  return declarations;
}

/* ── The matching half ────────────────────────────────────────────────────── */

export type TargetKind = "class" | "id" | "tag";

export interface SelectorTarget {
  readonly kind: TargetKind;
  readonly name: string;
}

/**
 * What a selector is worth searching a project for.
 *
 * Only the **rightmost** compound is returned, and that is the whole trick. `.page .card
 * .title` styles a `.title`; searching a project for `page` finds every page in it. The
 * subject of a selector is its last compound, so that is what goes to the search, and the
 * ancestor parts are only ever used to disqualify a hit afterwards.
 *
 * Pseudo-classes, pseudo-elements, attribute selectors and combinators are stripped: none
 * of them appear in markup as text, so none of them can be searched for. A selector that
 * reduces to nothing searchable - `* > :first-child` - returns an empty list, and the
 * caller says so rather than searching for everything.
 */
export function selectorTargets(selector: string): SelectorTarget[] {
  // One selector at a time. A list is several rules sharing a body, and their subjects are
  // unrelated - `.a, .b` needs both, not the last one.
  const compounds = selector
    .split(",")
    .map((part) => lastCompound(part))
    .filter((part) => part.length > 0);

  const targets: SelectorTarget[] = [];
  const seen = new Set<string>();

  for (const compound of compounds) {
    for (const target of compoundTargets(compound)) {
      const key = `${target.kind}:${target.name}`;
      if (seen.has(key)) continue;

      seen.add(key);
      targets.push(target);
    }
  }

  return targets;
}

function lastCompound(selector: string): string {
  const cleaned = selector
    // `:hover`, `::before`, `:not(.x)` - the argument goes with the pseudo-class, because
    // `.a:not(.b)` is about `.a` and treating `.b` as a target would search for the thing
    // the rule explicitly excludes.
    .replace(/::?[\w-]+(\([^)]*\))?/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .trim();

  const parts = cleaned.split(/[\s>+~]+/).filter((part) => part.length > 0);
  return parts.at(-1) ?? "";
}

function compoundTargets(compound: string): SelectorTarget[] {
  const targets: SelectorTarget[] = [];

  for (const match of compound.matchAll(/([.#]?)([A-Za-z_-][\w-]*)/g)) {
    const marker = match[1] ?? "";
    const name = match[2] ?? "";
    if (name.length === 0) continue;

    if (marker === ".") targets.push({ kind: "class", name });
    else if (marker === "#") targets.push({ kind: "id", name });
    // A bare tag name is only worth searching for when it is the entire compound. In
    // `div.card` the class is the specific part, and `div` would drag in every division
    // in the project as a false positive.
    else if (compound === name) targets.push({ kind: "tag", name });
  }

  return targets;
}

/**
 * Does this element satisfy the selector's rightmost compound?
 *
 * Deliberately *not* a full selector match. Ancestor combinators would need the element's
 * whole chain of parents, which means parsing every candidate file into a tree - and this
 * runs over search hits from a project-wide sweep. Matching the subject is the check that
 * removes the false positives that actually occur: a class name that also appears in a
 * comment, in a string, or as part of a longer word.
 *
 * The consequence is stated in the panel rather than hidden: these are elements the rule
 * *can* apply to, and a descendant selector may narrow it further.
 */
export function elementMatches(element: MarkupElement, selector: string): boolean {
  const compound = lastCompound(selector.split(",")[0] ?? selector);
  if (compound.length === 0) return false;

  const targets = compoundTargets(compound);
  if (targets.length === 0) return false;

  return targets.every((target) => {
    if (target.kind === "class") return element.classes.includes(target.name);
    if (target.kind === "id") return element.id === target.name;
    return element.tag === target.name.toLowerCase();
  });
}

/**
 * A search pattern that finds candidate markup for a target.
 *
 * Word-bounded on purpose. `card` without boundaries matches `cardboard`, `.card-header`
 * and the word "card" in a paragraph of copy, and a panel whose list is mostly wrong is
 * one the reader stops opening. The precise judgement still happens in `elementMatches`;
 * this only has to be narrow enough that the search is worth running.
 */
export function searchPatternFor(target: SelectorTarget): string {
  if (target.kind === "id") return `\\bid\\s*=\\s*["']?${escapeRegex(target.name)}\\b`;
  if (target.kind === "class") return `\\b${escapeRegex(target.name)}\\b`;
  return `<${escapeRegex(target.name)}\\b`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
