/**
 * Git for the IDE, over the git CLI.
 *
 * Brief §4's Git group - gutter diff decorations, blame, stage/unstage/commit, branch
 * switcher, file timeline - plus init, clone, push, and pull.
 *
 * No Electron and no DOM: the exec seam is injected, so every operation is testable
 * against a real repository in a temp directory.
 */
export { createGit, type Git, type GitDeps } from "./git.ts";
export { nodeGitExec } from "./nodeExec.ts";
export { isSafeCloneUrl, isSafePathArg, isSafeRef } from "./argSafety.ts";
export {
  applyResolution,
  findConflicts,
  hasConflictMarkers,
  type ConflictBlock,
  type Resolution,
} from "./conflicts.ts";
export type {
  BlameLine,
  FileChange,
  GitBranch,
  GitCommit,
  GitCommitDetail,
  GitCommitFile,
  GitExec,
  GitExecResult,
  GitRemote,
  GitResult,
  GitStatus,
  GitStatusEntry,
  LineChange,
} from "./types.ts";
