/**
 * Formatting, with nothing to install.
 *
 * The editor asks a language server first wherever one is running - it knows the language
 * better than this package does. This is what happens on a machine with nothing installed,
 * which is the case the settings row promises to cover, and it is the difference between
 * "formatting works" and "formatting works once you have set up a toolchain".
 *
 * Two levels of ambition, chosen per language and stated plainly:
 *
 * - **Re-printed** - JSON and CSS. Their grammars are small and unambiguous, so the output
 *   is a function of the parsed structure and is completely regular.
 * - **Re-indented** - the brace languages, markup, and Markdown. Whitespace at the front of
 *   lines is fixed; nothing else moves. A formatter that only moves whitespace cannot
 *   change what a program means, which matters more than matching Prettier.
 *
 * Every printer is idempotent, and that is enforced by property tests rather than asserted
 * here.
 */
import { formatCss } from "./css.ts";
import { formatJson } from "./json.ts";
import { formatMarkdown } from "./markdown.ts";
import { formatMarkup, markupSupported } from "./markup.ts";
import { reindent, reindentSupported } from "./reindent.ts";
import { DEFAULT_OPTIONS, type FormatOptions } from "./types.ts";

export { DEFAULT_OPTIONS, type FormatOptions } from "./types.ts";
export { organizeImports, organizeSupported } from "./imports.ts";

const CSS_LANGUAGES = new Set(["css", "scss", "less"]);
const JSON_LANGUAGES = new Set(["json", "jsonc"]);

/**
 * Can this package format that language at all?
 *
 * Asked by the editor before it offers the command, so a language nothing here handles says
 * so rather than running a formatter that returns the file unchanged and looks broken.
 */
export function formatSupported(languageId: string): boolean {
  return (
    JSON_LANGUAGES.has(languageId) ||
    CSS_LANGUAGES.has(languageId) ||
    markupSupported(languageId) ||
    reindentSupported(languageId) ||
    languageId === "markdown"
  );
}

/**
 * Format, or return the text unchanged.
 *
 * Never throws and never empties a file. A formatter that mangles what it could not parse
 * is the reason people are afraid to turn format-on-save on.
 */
export function format(
  text: string,
  languageId: string,
  options: FormatOptions = DEFAULT_OPTIONS,
): string {
  try {
    // JSON before the brace languages, which also claim it - re-printing is the better
    // answer where it is available.
    if (JSON_LANGUAGES.has(languageId)) return formatJson(text, options);
    if (CSS_LANGUAGES.has(languageId)) return formatCss(text, options);
    if (languageId === "markdown") return formatMarkdown(text, options);
    if (markupSupported(languageId)) return formatMarkup(text, options);
    if (reindentSupported(languageId)) return reindent(text, options);
    return text;
  } catch {
    return text;
  }
}
