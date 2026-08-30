/**
 * Fitting a path into a space too small for it.
 *
 * Used by the status bar corner and by the recent folders in the File menu, both of which
 * exist to answer the same question: which of the several checkouts of this project is
 * this? That answer lives at the end of the path, so the front is what gives way.
 *
 * CSS cannot do this. `text-overflow: ellipsis` only trims the end, which turns every deep
 * path into `E:\Users\user\Documents\…`, and the `direction: rtl` trick that moves the
 * ellipsis also reorders the neutral characters a path is made of - so `E:\` can come out
 * on the wrong side of it.
 *
 * Pure, and tested, for the reason `layoutSizes.ts` is: it is a handful of arithmetic that
 * is tedious to check by eye and cheap to check in milliseconds.
 */

/**
 * `path`, at most `max` characters, with whole trailing segments kept.
 *
 * A single segment longer than the budget is cut mid-word rather than dropped, because a
 * row that says nothing is worse than one that says half a name.
 */
export function shortenPath(path: string, max = 44): string {
  if (path.length <= max) return path;

  // Split *before* each separator, so every piece carries its own leading one and the
  // result reads as a path fragment rather than a name with a stray separator on it.
  const parts = path.split(/(?=[\\/])/);
  let tail = "";

  for (let at = parts.length - 1; at >= 0; at -= 1) {
    const next = `${parts[at]}${tail}`;
    // The ellipsis costs one character, and it is always there once anything is dropped.
    if (next.length + 1 > max) break;
    tail = next;
  }

  return `…${tail === "" ? path.slice(-(max - 1)) : tail}`;
}

/** Compare workspace roots without making POSIX paths case-insensitive. */
export function sameWorkspacePath(first: string | null, second: string | null): boolean {
  if (first === null || second === null) return first === second;
  const normalize = (value: string): string => value.replace(/\\/g, "/").replace(/\/+$/, "");
  const left = normalize(first);
  const right = normalize(second);
  const windowsLike = /^[a-z]:\//i.test(left) || /^[a-z]:\//i.test(right);
  return windowsLike ? left.toLocaleLowerCase() === right.toLocaleLowerCase() : left === right;
}
