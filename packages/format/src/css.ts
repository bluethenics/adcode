/**
 * CSS, SCSS and LESS.
 *
 * Re-printed from a scan rather than re-indented, because CSS's structure is entirely in
 * its braces and semicolons - which makes it one of the few languages where a formatter can
 * be both simple and complete.
 *
 * Nesting is handled by counting braces, which is what makes SCSS and LESS come out right
 * for free. `@media` blocks and nested selectors are the same shape as a top-level rule as
 * far as this is concerned.
 *
 * Three things are preserved exactly: comments, string contents, and the order of
 * declarations. Sorting properties is an editorial decision, and a formatter that reordered
 * `border` and `border-radius` would silently change what the page looks like.
 */
import { indentOf, type FormatOptions } from "./types.ts";

interface Emitter {
  readonly lines: string[];
  blankPending: boolean;
}

function emit(out: Emitter, options: FormatOptions, depth: number, text: string): void {
  if (text.length === 0) return;

  /*
   * At most one blank line, and never where it would look like a mistake: at the top of the
   * file, directly after an opening brace, or directly before a closing one. The last of
   * those is what a nested rule produces - the inner `}` sets the flag, and the outer `}`
   * arrives next.
   */
  if (out.blankPending && out.lines.length > 0 && !text.startsWith("}")) {
    const previous = out.lines[out.lines.length - 1] ?? "";
    if (previous.trim() !== "" && !previous.trim().endsWith("{")) out.lines.push("");
  }
  out.blankPending = false;

  out.lines.push(`${indentOf(options, depth)}${text}`);
}

/** Collapse the whitespace inside a selector or declaration without touching strings. */
function tidy(chunk: string): string {
  let result = "";
  let quote: string | null = null;
  let space = false;

  for (const character of chunk) {
    if (quote !== null) {
      result += character;
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      space = false;
      continue;
    }

    if (/\s/.test(character)) {
      space = true;
      continue;
    }

    // A comma in a selector list wants no space before it and one after.
    if (character === "," && result.endsWith(" ")) result = result.slice(0, -1);
    if (space && result.length > 0 && !result.endsWith(",")) result += " ";
    else if (space && result.endsWith(",")) result += " ";

    space = false;
    result += character;
  }

  return result.trim();
}

/** `color:red` and `color :  red` both become `color: red`. */
function tidyDeclaration(chunk: string): string {
  const tidied = tidy(chunk);
  const colon = tidied.indexOf(":");
  if (colon === -1) return tidied;

  const property = tidied.slice(0, colon).trimEnd();
  const value = tidied.slice(colon + 1).trim();
  return value.length === 0 ? `${property}:` : `${property}: ${value}`;
}

export function formatCss(text: string, options: FormatOptions): string {
  const out: Emitter = { lines: [], blankPending: false };

  let depth = 0;
  let chunk = "";
  let quote: string | null = null;

  const flushDeclaration = (): void => {
    const declaration = tidyDeclaration(chunk);
    chunk = "";
    if (declaration.length === 0) return;
    // Already terminated - adding another would grow one `;` per format, which is exactly
    // the non-idempotence this package is shaped around avoiding.
    emit(out, options, depth, declaration.endsWith(";") ? declaration : `${declaration};`);
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;

    if (quote !== null) {
      chunk += character;
      if (character === "\\") {
        chunk += text[index + 1] ?? "";
        index += 1;
      } else if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      chunk += character;
      continue;
    }

    // Comments are lifted out whole and put on their own line, keeping their text exactly.
    if (character === "/" && text[index + 1] === "*") {
      const close = text.indexOf("*/", index + 2);
      const end = close === -1 ? text.length : close + 2;
      const comment = text.slice(index, end);

      const before = tidy(chunk);
      chunk = "";
      if (before.length > 0) emit(out, options, depth, before);
      emit(out, options, depth, comment);

      index = end - 1;
      continue;
    }

    // A `//` comment is legal in SCSS and LESS, and is left alone the same way.
    if (character === "/" && text[index + 1] === "/") {
      let end = text.indexOf("\n", index);
      if (end === -1) end = text.length;

      const before = tidy(chunk);
      chunk = "";
      if (before.length > 0) emit(out, options, depth, before);
      emit(out, options, depth, text.slice(index, end).trimEnd());

      index = end - 1;
      continue;
    }

    if (character === "{") {
      const selector = tidy(chunk);
      chunk = "";
      emit(out, options, depth, `${selector} {`.trim());
      depth += 1;
      continue;
    }

    if (character === "}") {
      flushDeclaration();
      depth = Math.max(0, depth - 1);
      emit(out, options, depth, "}");
      // A closing brace ends a rule, and rules are separated by a blank line.
      out.blankPending = true;
      continue;
    }

    if (character === ";") {
      flushDeclaration();
      continue;
    }

    if (character === "\n") {
      // A blank line in the source is a paragraph break the author meant; one is kept.
      if (chunk.trim().length === 0 && text[index + 1] === "\n") out.blankPending = true;
      chunk += " ";
      continue;
    }

    chunk += character;
  }

  /*
   * An unterminated string means the file is mid-edit or not CSS at all.
   *
   * Returning it untouched is the same policy the JSON printer uses for input it cannot
   * parse: a formatter that rewrites what it did not understand is the reason people are
   * afraid of format-on-save.
   */
  if (quote !== null) return text;

  flushDeclaration();

  return out.lines.join(options.lineEnding) + options.lineEnding;
}
