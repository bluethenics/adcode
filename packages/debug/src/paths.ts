/**
 * File paths and the URLs the inspector uses for them.
 *
 * This is a small file with a bad reputation, because Windows makes every naive version of
 * it wrong. `file:///E:/a/b.ts` has three slashes and a drive letter; `E:\a\b.ts` has a
 * backslash and no scheme; and the inspector will hand back either depending on how the
 * script was loaded. A breakpoint set on a path that does not match the URL Node reports is
 * a breakpoint that silently never hits, which is the worst failure a debugger has.
 *
 * Pure, and tested against both platforms' spellings, because the machine running the tests
 * is not always the machine that has the bug.
 */

/** Percent-encode the characters a URL path may not carry literally. */
function encodeSegments(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}

/**
 * An absolute path as the inspector spells it.
 *
 * Windows drive letters are upper-cased: Node reports `file:///E:/...`, and a breakpoint
 * requested for `file:///e:/...` matches nothing at all.
 */
export function pathToFileUrl(absolute: string): string {
  const slashed = absolute.split("\\").join("/");

  const withDrive = /^([a-zA-Z]):\//.exec(slashed);
  if (withDrive !== null) {
    const drive = (withDrive[1] ?? "").toUpperCase();
    return `file:///${drive}:${encodeSegments(slashed.slice(2))}`;
  }

  return `file://${encodeSegments(slashed)}`;
}

/**
 * Back again, or null when this is not a file at all.
 *
 * Node reports frames inside its own internals as bare names like `node:internal/modules`,
 * and a debugger that turns those into paths sends the user to a file that does not exist.
 */
export function fileUrlToPath(url: string): string | null {
  if (!url.startsWith("file://")) return null;

  const withoutScheme = decodeURIComponent(url.slice("file://".length));

  // `file:///E:/a` leaves `/E:/a`; the leading slash is part of the URL, not the path.
  const drive = /^\/([a-zA-Z]):\//.exec(withoutScheme);
  if (drive !== null) {
    // Three characters, not two: `/E:` is the leading slash, the letter, and the colon.
    // Slicing two left the colon behind and produced `E::pp`.
    return `${(drive[1] ?? "").toUpperCase()}:${withoutScheme.slice(3).split("/").join("\\")}`;
  }

  return withoutScheme;
}

/**
 * Do two paths refer to the same file?
 *
 * Case-insensitively on Windows, where `E:\A` and `e:\a` are one file, and exactly
 * everywhere else, where they are two.
 */
export function samePath(a: string, b: string, platform: string): boolean {
  const normalise = (value: string): string => value.split("\\").join("/");
  const left = normalise(a);
  const right = normalise(b);

  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
