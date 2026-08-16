/**
 * Fuzzy matching for the file-open palette.
 *
 * Brief §4 lists fuzzy file open; §7 budgets it at "first results < 100ms" over 50,000
 * files. Those two together rule out the obvious implementation - a full
 * Smith-Waterman-style alignment over every candidate is O(n·m) per path and blows the
 * budget long before 50,000 files.
 *
 * Three things keep it inside the budget, and each was measured rather than assumed:
 *
 * 1. A cheap subsequence pre-filter rejects most candidates in about the length of the
 *    path.
 * 2. Nothing on the hot path allocates. `candidate.toLowerCase()` and `candidate[i]`
 *    both allocate per call, and at 50,000 candidates those allocations *are* the
 *    runtime.
 * 3. Match positions are computed only for the handful of candidates that reach the
 *    result list, since they exist for highlighting and nothing else.
 *
 * Pure: no I/O, no clock.
 */

export interface FuzzyMatch {
  readonly score: number;
  /** Indices in the candidate that matched, for highlighting. */
  readonly positions: readonly number[];
}

export interface RankedCandidate {
  readonly value: string;
  readonly score: number;
  readonly positions: readonly number[];
}

/**
 * `/ \ _ - . space` as char codes.
 *
 * A direct comparison chain rather than a `Set`: this is called once per character of
 * every candidate scanned, and at that volume `Set.has` is measurably slower than six
 * integer compares.
 */
function isSeparatorCode(code: number): boolean {
  return code === 47 || code === 92 || code === 95 || code === 45 || code === 46 || code === 32;
}

/**
 * Consecutive outweighs a boundary deliberately. Rewarding boundary gaps is what makes
 * "gsc" find `get-session-config`, but taken alone it also made `a-b-c-x` outrank `abc`
 * for the query "abc" - and a contiguous run of the exact characters typed is the
 * strongest evidence there is.
 */
const SCORE_CONSECUTIVE = 14;
const SCORE_WORD_BOUNDARY = 10;
const SCORE_CAMEL_BOUNDARY = 9;
const SCORE_FILENAME = 6;
const SCORE_START_OF_FILENAME = 14;
const PENALTY_GAP = 2;
const PENALTY_LEADING = 1;

const NO_MATCH = Number.NEGATIVE_INFINITY;

function foldCode(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function isWordBoundary(candidate: string, index: number): boolean {
  if (index === 0) return true;
  return isSeparatorCode(candidate.charCodeAt(index - 1));
}

function isCamelBoundary(candidate: string, index: number): boolean {
  if (index === 0) return false;

  const previous = candidate.charCodeAt(index - 1);
  const current = candidate.charCodeAt(index);
  return previous >= 97 && previous <= 122 && current >= 65 && current <= 90;
}

/** One reverse scan for both separators, rather than two full `lastIndexOf` passes. */
function filenameStartOf(candidate: string): number {
  for (let i = candidate.length - 1; i >= 0; i--) {
    const code = candidate.charCodeAt(i);
    if (code === 47 || code === 92) return i + 1;
  }
  return 0;
}

function foldQuery(query: string): number[] {
  const folded: number[] = [];
  for (let i = 0; i < query.length; i++) folded.push(foldCode(query.charCodeAt(i)));
  return folded;
}

/** Cheap rejection: is the query a subsequence of the candidate? No allocation. */
function isSubsequenceFolded(queryFolded: readonly number[], candidate: string): boolean {
  if (queryFolded.length === 0) return true;
  if (queryFolded.length > candidate.length) return false;

  let q = 0;
  for (let c = 0; c < candidate.length; c++) {
    if (foldCode(candidate.charCodeAt(c)) === queryFolded[q]) {
      q += 1;
      if (q === queryFolded.length) return true;
    }
  }
  return false;
}

/**
 * Walk the match once, scoring it - and record positions only when asked.
 *
 * `out` is null on the hot path, where only the score decides whether a candidate is
 * worth keeping, and non-null for the few that end up on screen.
 */
function walk(queryFolded: readonly number[], candidate: string, out: number[] | null): number {
  const filenameStart = filenameStartOf(candidate);

  let score = 0;
  let cursor = 0;
  let previousMatch = -1;
  let firstPosition = 0;

  for (let q = 0; q < queryFolded.length; q++) {
    const wanted = queryFolded[q]!;
    let chosen = -1;

    // If the very next character continues the run, take it and look no further.
    //
    // Without this the boundary preference could skip a contiguous match in favour of a
    // later boundary and then fail to find the query's remaining characters - so
    // "button.ts" did not match `src/button.ts` at all, because `t` jumped to the `t`
    // after the dot and the second `t` had nothing left to match. A false negative, not
    // merely a bad rank.
    if (
      previousMatch !== -1 &&
      cursor < candidate.length &&
      foldCode(candidate.charCodeAt(cursor)) === wanted
    ) {
      chosen = cursor;
    } else {
      let firstMatch = -1;

      for (let c = cursor; c < candidate.length; c++) {
        if (foldCode(candidate.charCodeAt(c)) !== wanted) continue;
        if (firstMatch === -1) firstMatch = c;

        // A genuine boundary is the only thing worth passing up an earlier match for.
        // An earlier version also stopped at `c >= filenameStart`, which is trivially
        // true for a path with no directory, so the search short-circuited on the first
        // hit and `gascon` outranked `get-session-config` for "gsc".
        if (isWordBoundary(candidate, c) || isCamelBoundary(candidate, c)) {
          chosen = c;
          break;
        }

        // Bounded, so a pathological candidate cannot make this quadratic.
        if (c - firstMatch > 24) break;
      }

      if (chosen === -1) chosen = firstMatch;
    }

    if (chosen === -1) return NO_MATCH;

    const wordBoundary = isWordBoundary(candidate, chosen);
    const camelBoundary = isCamelBoundary(candidate, chosen);
    const onBoundary = wordBoundary || camelBoundary;

    if (previousMatch !== -1 && chosen === previousMatch + 1) score += SCORE_CONSECUTIVE;
    if (wordBoundary) score += SCORE_WORD_BOUNDARY;
    if (camelBoundary) score += SCORE_CAMEL_BOUNDARY;
    if (chosen >= filenameStart) score += SCORE_FILENAME;
    if (chosen === filenameStart) score += SCORE_START_OF_FILENAME;

    // A gap that lands on a word boundary is not a gap - it is an acronym, which is
    // exactly what the user typed. Penalising it was what made a short dense match beat
    // the initials of a long descriptive name.
    if (!onBoundary && previousMatch !== -1 && chosen > previousMatch + 1) {
      score -= Math.min(PENALTY_GAP * (chosen - previousMatch - 1), 12);
    }

    if (q === 0) firstPosition = chosen;
    if (out !== null) out.push(chosen);

    previousMatch = chosen;
    cursor = chosen + 1;
  }

  // A leading run of unmatched characters is weak evidence; a shorter path with the same
  // matches is the better answer.
  score -= Math.min(PENALTY_LEADING * firstPosition, 10);
  score -= Math.floor(candidate.length / 40);

  return score;
}

export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  if (typeof query !== "string" || typeof candidate !== "string") return null;
  if (query.length === 0) return { score: 0, positions: [] };

  const folded = foldQuery(query);
  if (!isSubsequenceFolded(folded, candidate)) return null;

  const positions: number[] = [];
  const score = walk(folded, candidate, positions);
  return score === NO_MATCH ? null : { score, positions };
}

/**
 * Rank candidates, best first.
 *
 * `limit` bounds the returned list, not the work: every candidate is still tested,
 * because the best match may be the last one walked.
 */
export function rankCandidates(
  query: string,
  candidates: readonly string[],
  limit = 100,
): RankedCandidate[] {
  if (query.length === 0) {
    return candidates.slice(0, limit).map((value) => ({ value, score: 0, positions: [] }));
  }

  const queryFolded = foldQuery(query);

  // Ties break on the shorter path: with equal evidence, the less deeply nested file is
  // almost always the one meant.
  const isBetter = (aScore: number, aLength: number, bScore: number, bLength: number): boolean =>
    aScore !== bScore ? aScore > bScore : aLength < bLength;

  // A bounded insert rather than collecting every match and sorting. When a query matches
  // most of the tree - exactly the 50,000-file case §7 budgets - sorting every match
  // costs more than finding the answer did.
  const values: string[] = [];
  const scores: number[] = [];

  for (const value of candidates) {
    if (!isSubsequenceFolded(queryFolded, value)) continue;

    const score = walk(queryFolded, value, null);
    if (score === NO_MATCH) continue;

    const full = values.length === limit;
    if (full && !isBetter(score, value.length, scores[limit - 1]!, values[limit - 1]!.length)) {
      continue;
    }

    let index = values.length;
    while (index > 0 && isBetter(score, value.length, scores[index - 1]!, values[index - 1]!.length)) {
      index -= 1;
    }

    values.splice(index, 0, value);
    scores.splice(index, 0, score);

    if (values.length > limit) {
      values.pop();
      scores.pop();
    }
  }

  // Positions are only needed for what is actually shown, so they are computed here.
  return values.map((value, index) => {
    const positions: number[] = [];
    walk(queryFolded, value, positions);
    return { value, score: scores[index]!, positions };
  });
}
