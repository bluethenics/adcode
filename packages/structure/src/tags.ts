/**
 * Closing the tag you just opened.
 *
 * Type `<h1>` and `</h1>` should already be there, with the cursor between them. It is the
 * single most-missed convenience in an editor without it, and it is missed *loudly*:
 * markup is the one language where forgetting a closing token does not raise an error, it
 * silently swallows the rest of the page.
 *
 * Two rules, and both are one pure function of the text to the left of the cursor:
 *
 * - Typing `>` at the end of an opening tag inserts the matching closing tag.
 * - Typing `/` after a `<` completes the innermost tag that is still open.
 *
 * Pure because this sits on the keystroke path. It runs on every `>` and every `/` the user
 * types in a markup file, and anything that reaches the disk, the DOM or a language server
 * from here would be felt as typing latency - which §7 does not permit and which nobody
 * would tolerate anyway.
 */
import { VOID_ELEMENTS } from "./markup.ts";

/**
 * Languages where an angle bracket means a tag.
 *
 * JSX is in the list because `.jsx` and `.tsx` open as `javascript` and `typescript`, and
 * a React file is markup for most of its length. The cost of being wrong in the other
 * direction - a generic `Map<string, number>` in a `.ts` file - is handled by the tag-name
 * check below rather than by excluding the language, because excluding it would mean React
 * users get none of this.
 */
const TAG_LANGUAGES: ReadonlySet<string> = new Set([
  "html", "xml", "handlebars", "razor", "javascript", "typescript", "php", "markdown",
  "vue", "svelte", "astro",
]);

/**
 * Languages where `<` means a tag and nothing else.
 *
 * The complement - JavaScript and TypeScript - is where `<` is ambiguous, and is the only
 * place the extra guard below has to run.
 */
const MARKUP_NATIVE: ReadonlySet<string> = new Set([
  "html", "xml", "handlebars", "razor", "php", "markdown", "vue", "svelte", "astro",
]);

export function supportsTagClosing(languageId: string): boolean {
  return TAG_LANGUAGES.has(languageId);
}

/** A tag name: a letter, then the characters HTML and JSX allow, including `.` for `<Foo.Bar>`. */
const TAG_NAME = /^([A-Za-z][\w:.-]*)/;

/**
 * The closing tag to insert after the `>` the user just typed, or null.
 *
 * `textBeforeCursor` is everything on the line up to and including that `>`. A line is
 * enough: an opening tag split across lines is rare, and reading the whole document on
 * every keystroke to catch it would trade a real cost for a rare convenience.
 */
export function closingTagFor(textBeforeCursor: string, languageId: string): string | null {
  if (!supportsTagClosing(languageId)) return null;
  if (!textBeforeCursor.endsWith(">")) return null;

  const open = textBeforeCursor.lastIndexOf("<", textBeforeCursor.length - 2);
  if (open === -1) return null;

  const inner = textBeforeCursor.slice(open + 1, textBeforeCursor.length - 1);

  // `</div>` is already a closing tag, `<!-- -->` and `<!doctype>` are not tags at all,
  // and `<?php ?>` is a processing instruction.
  if (inner.startsWith("/") || inner.startsWith("!") || inner.startsWith("?")) return null;

  // `<br />` closed itself.
  if (inner.endsWith("/")) return null;

  /*
   * An odd number of quotes means the `>` is inside an attribute value, not ending the tag.
   *
   * `<a title="a > b"` is mid-attribute, and inserting `</a>` there puts a closing tag in
   * the middle of a string. Counting is enough: the quote that would make it even has not
   * been typed yet.
   */
  const doubles = (inner.match(/"/g) ?? []).length;
  const singles = (inner.match(/'/g) ?? []).length;
  if (doubles % 2 === 1 || singles % 2 === 1) return null;

  const name = TAG_NAME.exec(inner)?.[1];
  if (name === undefined) return null;

  if (VOID_ELEMENTS.has(name.toLowerCase())) return null;

  /*
   * A generic, not a tag.
   *
   * `Map<string, number>` in a TypeScript file ends in `>` and has a name after the `<`,
   * and auto-closing it produces `Map<string, number></string,>`. What separates the two is
   * that a tag's name is followed by whitespace, `/` or nothing - never by a comma, and
   * never by anything that is not a legal attribute start.
   */
  const afterName = inner.slice(name.length);
  if (afterName.length > 0 && !/^[\s/]/.test(afterName)) return null;

  /*
   * `function id<T>` survives the test above, because `T` is a whole legal tag name with
   * nothing after it. What gives it away is the character *before* the `<`: JSX elements
   * begin a value, so they follow a space, a bracket, an operator or the start of the line,
   * while a type parameter list is glued to the identifier it belongs to.
   *
   * Applied only where both readings are possible. In an HTML file there are no generics,
   * and `x<b>` in body text is rare enough that refusing to close a tag over it would cost
   * more than it saves.
   */
  if (!MARKUP_NATIVE.has(languageId)) {
    const previous = textBeforeCursor[open - 1];
    if (previous !== undefined && /[\w$)\]]/.test(previous)) return null;
  }

  return `</${name}>`;
}

/**
 * The rest of the closing tag after the user typed `</`, or null.
 *
 * Returned without the leading `</` - the user has already typed that - so the caller
 * inserts exactly what is missing. The innermost unclosed element wins, which is what
 * "close this" means when three are open.
 */
export function completeClosingTag(textBeforeCursor: string, languageId: string): string | null {
  if (!supportsTagClosing(languageId)) return null;
  if (!textBeforeCursor.endsWith("</")) return null;

  const before = textBeforeCursor.slice(0, -2);
  const stack: string[] = [];

  for (const match of before.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const closing = match[1] === "/";
    const name = match[2] ?? "";
    const attributes = match[3] ?? "";

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at !== -1) stack.length = at;
      continue;
    }

    if (attributes.trimEnd().endsWith("/")) continue;
    if (VOID_ELEMENTS.has(name.toLowerCase())) continue;

    stack.push(name);
  }

  const innermost = stack.at(-1);
  return innermost === undefined ? null : `${innermost}>`;
}
