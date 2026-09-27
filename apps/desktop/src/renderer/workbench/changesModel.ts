/**
 * What the Changes panel says about the working tree, as plain data.
 *
 * The panel is for someone who wants their work saved, not a lesson in Git's index. So the
 * checkbox reads "include in the commit": while nothing is staged every file is included,
 * and a commit takes them all; once anything is ticked, only the ticked files go. The
 * rules live here, with no DOM or IPC, so they are tested rather than eyeballed.
 */
import type { GitStatusView } from "../../shared/api.ts";

export type ChangeEntry = GitStatusView["entries"][number];
export type IncludeState = "checked" | "partial" | "unchecked";

const isStaged = (entry: ChangeEntry): boolean => entry.staged !== "none";
export const isNewFile = (entry: ChangeEntry): boolean =>
  entry.worktree === "untracked" || (entry.staged === "added" && entry.worktree !== "deleted");

/** How the row's checkbox reads, given everything else in the list. */
export function includeState(entry: ChangeEntry, entries: readonly ChangeEntry[]): IncludeState {
  if (!entries.some(isStaged)) return "checked";
  if (!isStaged(entry)) return "unchecked";
  return entry.worktree === "none" ? "checked" : "partial";
}

export interface CommitScope {
  /** "all": nothing is staged, so the commit stages and takes every file. */
  readonly mode: "all" | "staged";
  readonly count: number;
  /** A conflict is unresolved; nothing should be committed until it is. */
  readonly blocked: boolean;
}

export function commitScope(entries: readonly ChangeEntry[]): CommitScope {
  const staged = entries.filter(isStaged).length;
  return {
    mode: staged === 0 ? "all" : "staged",
    count: staged === 0 ? entries.length : staged,
    blocked: entries.some((entry) => entry.isConflicted),
  };
}

/** A plain, true commit message for people who would rather not write one. */
export function defaultCommitMessage(entries: readonly ChangeEntry[]): string {
  if (entries.length === 0) return "Update project";
  const verbFor = (entry: ChangeEntry): string =>
    isNewFile(entry) ? "Add" : entry.worktree === "deleted" || entry.staged === "deleted" ? "Remove" : "Update";
  const verbs = new Set(entries.map(verbFor));
  const verb = verbs.size === 1 ? [...verbs][0]! : "Update";
  const names = entries.map((entry) => entry.path);
  if (names.length === 1) return `${verb} ${names[0]}`;
  if (names.length === 2) return `${verb} ${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${verb} ${names[0]}, ${names[1]} and ${rest} more file${rest === 1 ? "" : "s"}`;
}

export interface RevertPlan {
  /** Take the file out of the index first, so staged edits are reverted too. */
  readonly unstage: boolean;
  /** Put a tracked file back as it was at the last commit. */
  readonly restore: boolean;
  /** A file the last commit never had goes to the Recycle Bin, where it can be recovered. */
  readonly trash: boolean;
}

export function revertPlan(entry: ChangeEntry): RevertPlan {
  const fresh = isNewFile(entry);
  return { unstage: isStaged(entry), restore: !fresh, trash: fresh };
}

export function changeTotals(entries: readonly ChangeEntry[]): { added: number; removed: number } {
  return {
    added: entries.reduce((sum, entry) => sum + (entry.added ?? 0), 0),
    removed: entries.reduce((sum, entry) => sum + (entry.removed ?? 0), 0),
  };
}

export interface DiffLine {
  readonly kind: "hunk" | "add" | "del" | "context";
  readonly text: string;
}

/** The hunks of a unified diff, each line tagged for colour; git's file headers left out. */
export function diffLines(text: string, limit = 400): { lines: DiffLine[]; truncated: boolean } {
  const lines: DiffLine[] = [];
  let inHunk = false;
  let truncated = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (line.startsWith("diff --git")) inHunk = false;
    if (!inHunk || line.startsWith("\\")) continue;
    if (lines.length === limit) { truncated = true; break; }
    const kind = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "context";
    lines.push({ kind, text: line });
  }
  // A trailing newline leaves one empty context line that is not part of the file.
  if (lines.at(-1)?.kind === "context" && lines.at(-1)?.text === "") lines.pop();
  return { lines, truncated };
}
