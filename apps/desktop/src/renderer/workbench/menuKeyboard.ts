/**
 * Where a keystroke lands inside an open menu.
 *
 * The rules are Windows' own, and they are older than any of us: arrows wrap, Home and
 * End go to the ends, a letter jumps to the row that claims it - and if exactly one row
 * claims it, the row runs rather than merely lighting up. That last clause is the one
 * people feel without being able to name it: Alt, F, S saves, and it saves on the S.
 *
 * Pure, like `altMenuActivation.ts` and `layoutSizes.ts`. Every rule here is about
 * ordering and about which rows are skipped, and both are things a browserless test can
 * hold still while the DOM around them changes.
 */
import { mnemonicOf, stripMnemonic } from "../../shared/menuModel.ts";

export interface MenuRow {
  /** The label as the model writes it, mnemonic marker and all. */
  readonly label: string;
  /** Absent means choosable. Only an explicit `false` takes a row out of the walk. */
  readonly enabled?: boolean;
}

export interface LetterMatch {
  readonly index: number;
  /**
   * True when one row alone claims the letter, which is Windows' signal to run it rather
   * than just move to it.
   */
  readonly unique: boolean;
}

const choosable = (row: MenuRow | undefined): boolean => row !== undefined && row.enabled !== false;

/**
 * One row along, wrapping, skipping anything that cannot be chosen.
 *
 * `from` of -1 means nothing is focused yet - Down lands on the first row and Up on the
 * last, which is what Alt followed by an arrow has to do.
 */
export function stepIndex(rows: readonly MenuRow[], from: number, delta: number): number {
  if (rows.length === 0) return -1;
  if (!rows.some(choosable)) return from;
  if (from < 0) return edgeIndex(rows, delta > 0 ? "first" : "last");

  let at = from;
  // Bounded by the row count, so a panel of separators cannot spin here.
  for (let step = 0; step < rows.length; step += 1) {
    at = (at + delta + rows.length) % rows.length;
    if (choosable(rows[at])) return at;
  }

  return from;
}

/** The first or last row that can actually be chosen, or -1 if there is none. */
export function edgeIndex(rows: readonly MenuRow[], edge: "first" | "last"): number {
  const live = rows.flatMap((row, at) => (choosable(row) ? [at] : []));
  if (live.length === 0) return -1;

  return edge === "first" ? live[0]! : live.at(-1)!;
}

/**
 * The row a letter selects, and whether it is the only claimant.
 *
 * Marked rows are collected first and, if any exist, they alone compete: a menu holding
 * "Save All" and "&Save" gives S to the marked one. The first-letter fallback exists for
 * rows that carry no marker at all - which is every recent folder, since those labels are
 * folder names rather than anything this application wrote.
 */
export function matchLetter(
  rows: readonly MenuRow[],
  char: string,
  from: number,
): LetterMatch | null {
  const wanted = char.toLowerCase();
  if (wanted.length !== 1) return null;

  const marked: number[] = [];
  const starting: number[] = [];

  rows.forEach((row, at) => {
    if (!choosable(row)) return;

    const key = mnemonicOf(row.label);
    if (key === wanted) marked.push(at);
    // A row with a marker for some other letter has already had its say, so it does not
    // also get to answer for the letter it happens to begin with.
    else if (key === null && stripMnemonic(row.label).trimStart().slice(0, 1).toLowerCase() === wanted) {
      starting.push(at);
    }
  });

  const pool = marked.length > 0 ? marked : starting;
  if (pool.length === 0) return null;
  if (pool.length === 1) return { index: pool[0]!, unique: true };

  // Several claimants: the letter cycles between them, and never activates on its own.
  return { index: pool.find((at) => at > from) ?? pool[0]!, unique: false };
}
