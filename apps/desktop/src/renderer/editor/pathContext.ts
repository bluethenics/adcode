/**
 * Is the cursor inside a filename, and how much of it has been typed?
 *
 * Pure, and separate from the Monaco provider, because this is the part with all the
 * judgement in it and none of the I/O. Getting it wrong in either direction is annoying in
 * a way the user will blame on the editor: too eager and a file list pops up every time
 * anybody types a quote, too shy and the one feature that stops mistyped imports never
 * appears.
 *
 * The rule is that a path context needs *both* an unclosed quote and a reason to think the
 * string is a path - it either already looks like one, or the code around it says it is.
 * A bare `"hello"` is not offered a directory listing.
 */

export interface PathContext {
  /** What has been typed inside the quotes so far. May be empty. */
  readonly prefix: string;
  /** The directory part of the prefix - everything up to and including the last slash. */
  readonly directory: string;
  /** The partial filename after the last slash. */
  readonly partial: string;
}

/**
 * Statements whose string argument is a path even before it looks like one.
 *
 * This is what makes `import "` offer something useful immediately, rather than waiting for
 * the user to type `./` first.
 */
const PATH_KEYWORDS =
  /(?:^|[\s({[,=])(?:import|export|require|from|include|include_once|require_once|src|href|url|open|load|readFile|writeFile|resolve|join)\s*(?:\(|=|:)?\s*$/i;

/** Attributes in markup whose value is a path. */
const PATH_ATTRIBUTES = /(?:src|href|srcset|poster|data|action|content|import|url)\s*=\s*$/i;

/** Looks like a path already: has a slash, or starts a relative walk. */
const LOOKS_LIKE_PATH = /^(?:\.{1,2}\/|\/|~\/)|\//;

/** The quote that is still open on this line, and where its content starts. */
function openQuote(line: string): { quote: string; contentAt: number } | null {
  let quote: string | null = null;
  let contentAt = -1;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote !== null) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = null;
        contentAt = -1;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      contentAt = index + 1;
    }
  }

  return quote === null ? null : { quote, contentAt };
}

/**
 * The path being typed at the cursor, or `null`.
 *
 * `textBeforeCursor` is the current line up to the cursor - not the whole file. A path
 * literal that spans lines is not a thing, and reading the whole file here would put a
 * scan on the keystroke path for no gain.
 */
export function pathContextAt(textBeforeCursor: string): PathContext | null {
  const open = openQuote(textBeforeCursor);
  if (open === null) return null;

  const prefix = textBeforeCursor.slice(open.contentAt);

  // A newline or a quote inside the candidate means the scan went wrong somewhere; a path
  // has neither.
  if (/[\n"'`]/.test(prefix)) return null;

  const before = textBeforeCursor.slice(0, open.contentAt - 1);
  const invited =
    LOOKS_LIKE_PATH.test(prefix) || PATH_KEYWORDS.test(before) || PATH_ATTRIBUTES.test(before);

  if (!invited) return null;

  const lastSlash = prefix.lastIndexOf("/");
  const directory = lastSlash === -1 ? "" : prefix.slice(0, lastSlash + 1);
  const partial = lastSlash === -1 ? prefix : prefix.slice(lastSlash + 1);

  return { prefix, directory, partial };
}
