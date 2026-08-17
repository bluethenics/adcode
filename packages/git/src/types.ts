/**
 * Shared types for the git package. No logic.
 *
 * Brief §4's Git group: gutter diff decorations, blame, stage/unstage/commit UI, branch
 * switcher, merge-conflict resolution, file timeline - plus the plumbing the user asked
 * for directly: init, clone, push, pull.
 */

export interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** The seam that keeps this package testable and free of Electron. */
export interface GitExec {
  run(args: readonly string[], options: { cwd: string }): Promise<GitExecResult>;
}

export type FileChange = "none" | "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitStatusEntry {
  readonly path: string;
  /** What is staged for the next commit. */
  readonly staged: FileChange;
  /** What has changed since staging. */
  readonly worktree: FileChange;
  readonly isConflicted: boolean;
}

export interface GitStatus {
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly entries: readonly GitStatusEntry[];
  readonly isClean: boolean;
  readonly hasConflicts: boolean;
}

export interface GitBranch {
  readonly name: string;
  readonly current: boolean;
  readonly upstream: string | null;
}

export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly subject: string;
  readonly author: string;
  /** ISO date, so the UI can format it without parsing git's own formats. */
  readonly date: string;
}

/** One file as a commit changed it. */
export interface GitCommitFile {
  readonly path: string;
  readonly kind: FileChange;
  readonly added: number;
  readonly removed: number;
}

/**
 * A commit, opened.
 *
 * `body` is separate from `subject` because they are read differently: the subject is a
 * row in a list, the body is prose that only matters once the commit is open.
 */
export interface GitCommitDetail extends GitCommit {
  readonly body: string;
  readonly files: readonly GitCommitFile[];
}

export interface GitRemote {
  readonly name: string;
  readonly url: string;
}

/** One contiguous run of changed lines, for §4's gutter decorations. */
export interface LineChange {
  readonly kind: "added" | "modified" | "deleted";
  /** One-based first line in the working file. */
  readonly startLine: number;
  readonly lineCount: number;
}

export interface BlameLine {
  readonly line: number;
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly summary: string;
}

/** Every mutating operation returns this instead of throwing (§9's shape). */
export interface GitResult {
  readonly ok: boolean;
  readonly message: string;
}
