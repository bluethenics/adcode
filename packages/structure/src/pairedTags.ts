/**
 * The other half of a tag.
 *
 * Rename `<section>` to `<article>` and the `</section>` further down has to follow, or the
 * page breaks somewhere that gives no hint where. Markup is the language where a mismatch
 * raises no error - it silently swallows the rest of the document - so the edit that
 * forgets the partner is the one that costs an afternoon.
 *
 * Pure, and on the keystroke path, for the same reason `tags.ts` is: this runs while
 * somebody is typing a tag name, and anything here that touched a language server would be
 * felt as latency.
 *
 * **What it does not do.** It matches by nesting depth over the tags it can see, not by
 * parsing HTML the way a browser does. Unclosed `<p>` and `<li>` - legal in HTML, common in
 * the wild - will throw the depth off, and when the count does not come out cleanly this
 * returns `null` rather than guessing. A rename that silently changes the wrong closing tag
 * is far worse than one that changes nothing.
 */

/** A tag name's span, one-based, as the editor counts. */
export interface TagNameSpan {
  readonly line: number;
  readonly startColumn: number;
  /** Exclusive, so `endColumn - startColumn` is the name's length. */
  readonly endColumn: number;
}

export interface PairedTag {
  readonly name: string;
  /** The tag the cursor is in. */
  readonly self: TagNameSpan;
  /** The one that has to change with it. */
  readonly partner: TagNameSpan;
}

interface Tag {
  readonly kind: "open" | "close" | "self";
  readonly name: string;
  readonly span: TagNameSpan;
}

/** Elements that never have a closing tag, so never have a partner to rename. */
const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** A tag name: letters, then letters, digits, hyphens, dots and colons. */
const NAME_START = /[A-Za-z]/;
const NAME_REST = /[A-Za-z0-9\-.:_]/;

/**
 * Every tag in the text, with the exact span of each name.
 *
 * Written here rather than reused from `markup.ts` because that tokenizer reports where an
 * element *starts* and this needs where its name starts and stops - the span is the thing
 * being edited, and a column that is off by one renames `div` to `divarticle`.
 */
function scanTags(text: string): Tag[] {
  const tags: Tag[] = [];

  let line = 1;
  let column = 1;
  let index = 0;

  const advance = (count: number): void => {
    for (let step = 0; step < count; step += 1) {
      if (text[index] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      index += 1;
    }
  };

  while (index < text.length) {
    if (text[index] !== "<") {
      advance(1);
      continue;
    }

    // `<!-- -->`, `<!doctype>` and `<?xml?>` carry no tag name worth renaming. Skipped
    // wholesale so a `<div>` written inside a comment is never offered as a partner.
    const next = text[index + 1];
    if (next === "!" || next === "?") {
      const close = text.indexOf(">", index);
      if (close === -1) break;
      advance(close - index + 1);
      continue;
    }

    const closing = next === "/";
    advance(closing ? 2 : 1);

    const first = text[index];
    if (first === undefined || !NAME_START.test(first)) continue;

    const nameLine = line;
    const nameStart = column;

    let name = "";
    while (index < text.length) {
      const character = text[index];
      if (character === undefined || !NAME_REST.test(character)) break;
      name += character;
      advance(1);
    }

    const span: TagNameSpan = { line: nameLine, startColumn: nameStart, endColumn: nameStart + name.length };

    // Find this tag's `>` to learn whether it closed itself. Attribute values can contain
    // one, so quoted spans are skipped rather than searched.
    let selfClosing = false;
    let quote: string | null = null;
    while (index < text.length) {
      const character = text[index];
      if (quote !== null) {
        if (character === quote) quote = null;
        advance(1);
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        advance(1);
        continue;
      }
      if (character === ">") {
        selfClosing = text[index - 1] === "/";
        advance(1);
        break;
      }
      advance(1);
    }

    const kind = closing ? "close" : selfClosing || VOID.has(name.toLowerCase()) ? "self" : "open";
    tags.push({ kind, name, span });
  }

  return tags;
}

const within = (span: TagNameSpan, line: number, column: number): boolean =>
  span.line === line && column >= span.startColumn && column <= span.endColumn;

/**
 * The tag the cursor is in, and the one that must change with it.
 *
 * `null` whenever the answer is not certain: the cursor is not in a tag name, the tag has
 * no partner, or the nesting does not resolve.
 */
export function pairedTagAt(text: string, line: number, column: number): PairedTag | null {
  const tags = scanTags(text);

  const index = tags.findIndex((tag) => tag.kind !== "self" && within(tag.span, line, column));
  if (index === -1) return null;

  const cursorTag = tags[index];
  if (cursorTag === undefined) return null;

  if (cursorTag.kind === "open") {
    // Forwards, counting our own name in and out again, so `<div><div></div></div>` pairs
    // the outer with the outer.
    let depth = 0;
    for (let step = index + 1; step < tags.length; step += 1) {
      const tag = tags[step];
      if (tag === undefined || tag.name !== cursorTag.name) continue;

      if (tag.kind === "open") depth += 1;
      else if (tag.kind === "close") {
        if (depth === 0) return { name: cursorTag.name, self: cursorTag.span, partner: tag.span };
        depth -= 1;
      }
    }
    return null;
  }

  let depth = 0;
  for (let step = index - 1; step >= 0; step -= 1) {
    const tag = tags[step];
    if (tag === undefined || tag.name !== cursorTag.name) continue;

    if (tag.kind === "close") depth += 1;
    else if (tag.kind === "open") {
      if (depth === 0) return { name: cursorTag.name, self: cursorTag.span, partner: tag.span };
      depth -= 1;
    }
  }
  return null;
}
