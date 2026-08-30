/**
 * What a check says when it has finished.
 *
 * Eleven features in §4 were reachable only as a switch in Settings, and the reason was
 * always the same: the work they do had no way to be asked for, and no way to answer. A
 * merge-conflict resolver that draws buttons over conflict markers is useless to somebody
 * who does not know whether they have any conflicts.
 *
 * So a check is two things - the findings, and the sentence to say about them. The empty
 * sentence is the one that matters. "No merge conflicts" is a result; silence is a bug
 * report waiting to happen, because a check that finds nothing and a check that never ran
 * look identical from the outside.
 *
 * Pure: no DOM, no Electron, no I/O. The commands in `main.ts` supply findings from the
 * engines in `packages/`, and the panels decide where to draw them.
 */

/** One thing a check found, positioned so a panel row can open it. */
export interface CheckFinding {
  readonly path: string;
  /** One-based, like every other line number the user is shown. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

/**
 * How one check talks about its results.
 *
 * Three forms rather than one with a count interpolated, because English does not
 * pluralise by adding a number: "1 file has merge conflicts" and "2 files have merge
 * conflicts" differ in two places, and the empty case is not a count at all.
 */
export interface CheckSpec {
  readonly title: string;
  /** Said when the check found nothing. This is the sentence the feature exists for. */
  readonly empty: string;
  readonly one: string;
  readonly many: (count: number) => string;
}

export interface CheckOutcome {
  readonly findings: readonly CheckFinding[];
  readonly message: string;
}

/**
 * What to say about a count.
 *
 * Separate from `outcomeFor` because half the checks never build findings: "how many
 * commits touch this file" is answered by the length of a list the caller already has, and
 * fabricating placeholder findings to count them back out again would be a lie told to a
 * type signature.
 */
export function messageFor(spec: CheckSpec, count: number): string {
  return count === 0 ? spec.empty : count === 1 ? spec.one : spec.many(count);
}

export function outcomeFor(spec: CheckSpec, findings: readonly CheckFinding[]): CheckOutcome {
  return { findings, message: messageFor(spec, findings.length) };
}

/** Every check that can report "nothing here", and the words it uses to say so. */
export const CHECKS = {
  conflicts: {
    title: "Merge conflicts",
    empty: "No merge conflicts - nothing to resolve.",
    one: "1 file has merge conflicts.",
    many: (count) => `${count} files have merge conflicts.`,
  },
  todos: {
    title: "TODOs and FIXMEs",
    empty: "No TODO or FIXME comments here.",
    one: "1 TODO or FIXME.",
    many: (count) => `${count} TODO and FIXME comments.`,
  },
  spelling: {
    title: "Spelling in comments",
    empty: "No misspellings in comments.",
    one: "1 misspelling in a comment.",
    many: (count) => `${count} misspellings in comments.`,
  },
  unusedCss: {
    title: "Unused CSS rules",
    empty: "Every rule matches something.",
    one: "1 rule matches nothing.",
    many: (count) => `${count} rules match nothing.`,
  },
  missingClasses: {
    title: "Classes nothing defines",
    empty: "Every class is defined.",
    one: "1 class is used but never defined.",
    many: (count) => `${count} classes are used but never defined.`,
  },
  localHistory: {
    title: "Local history",
    empty: "No local versions of this file yet.",
    one: "1 local version of this file.",
    many: (count) => `${count} local versions of this file.`,
  },
  timeline: {
    title: "File timeline",
    empty: "No commits touch this file yet.",
    one: "1 commit touches this file.",
    many: (count) => `${count} commits touch this file.`,
  },
  recover: {
    title: "Unsaved work",
    empty: "Nothing to recover - every file is saved.",
    one: "1 file has unsaved work to recover.",
    many: (count) => `${count} files have unsaved work to recover.`,
  },
} satisfies Readonly<Record<string, CheckSpec>>;

/** A git status entry, as the renderer already receives it. */
interface StatusEntry {
  readonly path: string;
  readonly isConflicted: boolean;
}

/**
 * The conflicted files in a working tree.
 *
 * `git status` already reports this on every entry, so asking "do I have conflicts" costs
 * nothing beyond the refresh the panel does anyway - there is no second git call, and no
 * reading of file contents to hunt for `<<<<<<<`.
 *
 * The message says what to do rather than what git called it. "UU" is accurate and means
 * nothing to the person who has just been told their merge failed.
 */
export function conflictFindings(entries: readonly StatusEntry[]): readonly CheckFinding[] {
  return entries
    .filter((entry) => entry.isConflicted)
    .map((entry) => ({
      path: entry.path,
      line: 1,
      column: 1,
      message: "Both sides changed this file. Open it to keep yours, keep theirs, or keep both.",
    }));
}
