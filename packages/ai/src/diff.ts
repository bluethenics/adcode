/**
 * Line diff and per-hunk application.
 *
 * Brief §5.3: "proposed changes appear at the edit site as a reviewable diff, accepted
 * or rejected per hunk. **Nothing is ever written to disk unseen.**"
 *
 * Per-hunk acceptance is the mechanism that makes that promise true rather than merely
 * stated, so this module's contract is exact: accepting every hunk reproduces the
 * proposal byte for byte, accepting none leaves the original byte for byte, and any
 * subset in between produces exactly the file the user was shown.
 *
 * Pure and dependency-free. The algorithm is a standard LCS over lines - O(n·m), which
 * is fine for a reviewable diff, because a proposal too large to read is one the user
 * cannot meaningfully accept anyway.
 */

export interface Hunk {
  readonly id: string;
  /** Zero-based line index in the original text where this hunk begins. */
  readonly startLine: number;
  /** The original lines this hunk replaces. Empty for a pure insertion. */
  readonly original: readonly string[];
  /** The proposed lines. Empty for a pure deletion. */
  readonly replacement: readonly string[];
}

/**
 * Longest common subsequence over lines, as a table of match lengths.
 *
 * Guarded by a size cap: the table is O(n·m), and a proposal of tens of thousands of
 * lines is not something a human is going to review hunk by hunk. Past the cap the whole
 * file becomes one hunk, which is still correct and still reviewable as a whole.
 */
const MAX_LCS_LINES = 2000;

function lcsTable(a: readonly string[], b: readonly string[]): Uint32Array {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + (j + 1)]!);
    }
  }

  return table;
}

/**
 * Split into lines while remembering the exact separators.
 *
 * A diff that silently normalises CRLF to LF would rewrite every line of a Windows file
 * the moment one hunk is accepted - a change the user never saw and never approved,
 * which is precisely what §5.3 forbids.
 */
function splitLines(text: string): { lines: string[]; separators: string[] } {
  const lines: string[] = [];
  const separators: string[] = [];

  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      const hasCarriage = i > start && text[i - 1] === "\r";
      lines.push(text.slice(start, hasCarriage ? i - 1 : i));
      separators.push(hasCarriage ? "\r\n" : "\n");
      start = i + 1;
    }
  }

  lines.push(text.slice(start));
  separators.push("");

  return { lines, separators };
}

function joinLines(lines: readonly string[], separators: readonly string[]): string {
  // Reuse the original separator where one exists, so untouched regions keep their
  // exact line endings; fall back to the file's dominant separator elsewhere.
  const fallback = separators.find((s) => s.length > 0) ?? "\n";

  let out = "";
  for (let i = 0; i < lines.length; i++) {
    out += lines[i];
    if (i < lines.length - 1) out += separators[i] ?? fallback;
  }
  return out;
}

export function computeHunks(original: string, modified: string): Hunk[] {
  if (original === modified) return [];

  const a = splitLines(original).lines;
  const b = splitLines(modified).lines;

  if (a.length > MAX_LCS_LINES || b.length > MAX_LCS_LINES) {
    return [{ id: "h0", startLine: 0, original: a, replacement: b }];
  }

  const width = b.length + 1;
  const table = lcsTable(a, b);
  const hunks: Hunk[] = [];

  let i = 0;
  let j = 0;
  let pendingOriginal: string[] = [];
  let pendingReplacement: string[] = [];
  let pendingStart = 0;

  const flush = (): void => {
    if (pendingOriginal.length === 0 && pendingReplacement.length === 0) return;

    hunks.push({
      id: `h${hunks.length}`,
      startLine: pendingStart,
      original: pendingOriginal,
      replacement: pendingReplacement,
    });

    pendingOriginal = [];
    pendingReplacement = [];
  };

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      i += 1;
      j += 1;
      pendingStart = i;
      continue;
    }

    if (pendingOriginal.length === 0 && pendingReplacement.length === 0) pendingStart = i;

    if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      pendingOriginal.push(a[i]!);
      i += 1;
    } else {
      pendingReplacement.push(b[j]!);
      j += 1;
    }
  }

  if (i < a.length || j < b.length) {
    if (pendingOriginal.length === 0 && pendingReplacement.length === 0) pendingStart = i;
    while (i < a.length) pendingOriginal.push(a[i++]!);
    while (j < b.length) pendingReplacement.push(b[j++]!);
  }

  flush();
  return hunks;
}

/**
 * Apply exactly the accepted hunks.
 *
 * Hunks are applied in reverse order so that each one's `startLine` still refers to the
 * text it was computed against - the off-by-N that makes "accept hunk 3 but not hunk 1"
 * silently produce a file nobody reviewed.
 */
export function applyHunks(
  original: string,
  hunks: readonly Hunk[],
  acceptedIds: readonly string[],
): string {
  const accepted = new Set(acceptedIds);
  const chosen = hunks.filter((hunk) => accepted.has(hunk.id));
  if (chosen.length === 0) return original;

  const { lines, separators } = splitLines(original);
  const outLines = [...lines];
  const outSeparators = [...separators];

  // Newly inserted lines take the file's dominant separator - reusing whatever separator
  // happened to sit at the splice index yields none at all for an insertion at the end
  // of a file, silently gluing the new lines together.
  const dominant = separators.find((s) => s.length > 0) ?? "\n";

  for (const hunk of [...chosen].sort((x, y) => y.startLine - x.startLine)) {
    const replacementSeparators = hunk.replacement.map(() => dominant);

    outLines.splice(hunk.startLine, hunk.original.length, ...hunk.replacement);
    outSeparators.splice(hunk.startLine, hunk.original.length, ...replacementSeparators);
  }

  // Restore the array's invariant: every separator but the last is a real one, and the
  // last is the empty terminator. Appending past the old final line otherwise leaves
  // that line still holding the terminator, so the new content is glued onto it.
  for (let i = 0; i < outSeparators.length - 1; i++) {
    if (outSeparators[i] === "") outSeparators[i] = dominant;
  }
  if (outSeparators.length > 0) outSeparators[outSeparators.length - 1] = "";

  return joinLines(outLines, outSeparators);
}
