/**
 * Reading the shape of a page.
 *
 * Two callers, one scanner. The Structure view draws the tag tree; the stylesheet side
 * asks "which of these elements does `.card .title` select". Both need the same three
 * facts about every tag - its name, its id, and its classes - and computing them twice
 * from two scanners is how the outline and the selector match end up disagreeing about
 * what is on the page.
 *
 * Elements are named the way browser dev tools name them: `div#hero.card.is-open`. That
 * shape is not decoration. The whole point of clicking a selector is to recognise the
 * element it lands on, and `div` on its own is not recognisable in a file with sixty of
 * them.
 */
import type { MutableNode, OutlineNode } from "./types.ts";
import { finish } from "./types.ts";

/**
 * Elements that never have a closing tag.
 *
 * Treating one as a container is not a cosmetic error: a single `<br>` would swallow the
 * entire rest of the document as its children, and the outline would show one row where
 * the page has forty. This list is HTML's, fixed by the spec, and is also what stops the
 * editor auto-inserting `</br>` when you type `<br>`.
 */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr",
  // Not HTML void elements, but self-closing in every SVG in the wild, and an SVG opened
  // in this editor is markup like any other.
  "path", "circle", "rect", "line", "ellipse", "polygon", "polyline", "stop", "use",
]);

export interface MarkupElement {
  readonly tag: string;
  readonly id: string | null;
  readonly classes: readonly string[];
  /** One-based, as the editor counts. */
  readonly line: number;
  readonly column: number;
}

/** `div#hero.card` - what the element would be called in dev tools. */
export function describeElement(element: Pick<MarkupElement, "tag" | "id" | "classes">): string {
  const id = element.id === null ? "" : `#${element.id}`;
  const classes = element.classes.map((name) => `.${name}`).join("");
  return `${element.tag}${id}${classes}`;
}

interface Token {
  readonly kind: "open" | "close" | "self";
  readonly tag: string;
  readonly attributes: string;
  readonly line: number;
  readonly column: number;
}

/*
 * Comments, doctypes and processing instructions are removed before anything else looks at
 * the text - blanked to spaces rather than deleted, so every later index still points at
 * the character it pointed at before, which is what keeps the line numbers true.
 *
 * A commented-out `<div>` is not on the page, and an outline that lists it is describing a
 * document the browser will never build.
 */
function blankNonMarkup(text: string): string {
  return text.replace(/<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

const TAG = /<(?<slash>\/?)(?<tag>[A-Za-z][\w:.-]*)(?<attributes>(?:"[^"]*"|'[^']*'|[^>"'])*?)(?<selfClose>\/?)>/g;

function tokenise(text: string): Token[] {
  const source = blankNonMarkup(text);
  const tokens: Token[] = [];

  // Line and column are derived by counting newlines up to the match. Recomputed from a
  // running cursor rather than by slicing the whole prefix each time, which would make
  // this quadratic on exactly the large generated HTML files it needs to survive.
  let line = 1;
  let lineStart = 0;
  let scanned = 0;

  for (const match of source.matchAll(TAG)) {
    const index = match.index;

    for (let i = scanned; i < index; i++) {
      if (source[i] === "\n") {
        line += 1;
        lineStart = i + 1;
      }
    }
    scanned = index;

    const groups = match.groups ?? {};
    const tag = groups["tag"] ?? "";
    const attributes = groups["attributes"] ?? "";
    const closing = groups["slash"] === "/";
    const selfClosing = groups["selfClose"] === "/" || VOID_ELEMENTS.has(tag.toLowerCase());

    tokens.push({
      kind: closing ? "close" : selfClosing ? "self" : "open",
      tag,
      attributes,
      line,
      column: index - lineStart + 1,
    });
  }

  return tokens;
}

function attributeValue(attributes: string, name: string): string | null {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = pattern.exec(attributes);
  if (match === null) return null;

  return match[2] ?? match[3] ?? match[4] ?? null;
}

function toElement(token: Token): MarkupElement {
  const classAttribute = attributeValue(token.attributes, "class") ?? "";

  return {
    tag: token.tag.toLowerCase(),
    id: attributeValue(token.attributes, "id"),
    classes: classAttribute.split(/\s+/).filter((name) => name.length > 0),
    line: token.line,
    column: token.column,
  };
}

/** Every element in the document, in source order, flattened. */
export function markupElements(text: string): MarkupElement[] {
  return tokenise(text)
    .filter((token) => token.kind !== "close")
    .map(toElement);
}

/**
 * The tag tree.
 *
 * A close tag that matches nothing on the stack is ignored rather than treated as an
 * error, and an unclosed tag is closed by its parent's close. Both are the normal state of
 * a file being typed into, and the panel has to keep drawing while that is true.
 */
export function markupOutline(text: string): OutlineNode[] {
  const roots: MutableNode[] = [];
  // The tag is carried beside the node rather than read back off `node.name`, which is the
  // dev-tools description: `startsWith("div")` on `divider#x` is true, and that mistake
  // closes the wrong element and re-parents everything after it.
  const stack: { readonly tag: string; readonly node: MutableNode }[] = [];

  const attach = (node: MutableNode): void => {
    const parent = stack.at(-1);
    if (parent === undefined) roots.push(node);
    else parent.node.children.push(node);
  };

  for (const token of tokenise(text)) {
    if (token.kind === "close") {
      // Unwind to the matching open, so a stray `</div>` inside a `<p>` does not leave the
      // rest of the page nested one level too deep for the rest of the file.
      const closing = token.tag.toLowerCase();
      const at = stack.findLastIndex((entry) => entry.tag === closing);
      if (at === -1) continue;

      for (let i = stack.length - 1; i >= at; i--) {
        const entry = stack[i];
        if (entry !== undefined) entry.node.endLine = token.line;
      }
      stack.length = at;
      continue;
    }

    const element = toElement(token);
    const node: MutableNode = {
      kind: "element",
      name: describeElement(element),
      detail: "",
      line: element.line,
      column: element.column,
      endLine: element.line,
      children: [],
    };

    attach(node);
    if (token.kind === "open") stack.push({ tag: element.tag, node });
  }

  // Whatever is still open at the end of the file runs to the end of the file. A page being
  // typed into always has at least one of these, and leaving their `endLine` on the opening
  // line would tell the relations view that a `<body>` is one line long.
  const lastLine = text.split("\n").length;
  for (const entry of stack) entry.node.endLine = lastLine;

  return roots.map(finish);
}
