/**
 * What the Vibe sidebar says about the project, as plain data.
 *
 * The sidebar's badges are the only place a Vibe user sees that an agent is still working
 * or that changes are waiting, so the rules for "needs you" live here - pure, with no DOM
 * or IPC - where they can be tested against every task state rather than eyeballed.
 */
import type { AiWorkspaceTaskStateView, AiWorkspaceTaskView, RecentFolderView } from "../../shared/api.ts";

/** Still moving: nothing for the user to do yet, but worth a spinner. */
const WORKING: ReadonlySet<AiWorkspaceTaskStateView> = new Set(["preparing", "running", "applying", "rolling-back"]);
/** Stopped and waiting on a person: review it, resolve it, resume it or look at the failure. */
const WAITING: ReadonlySet<AiWorkspaceTaskStateView> = new Set(["review", "conflict", "paused", "failed"]);

type TaskLike = Pick<AiWorkspaceTaskView, "state" | "changedPaths">;
/** The parts of `GitStatusView` the sidebar reads; only how many entries, not what they are. */
interface GitLike {
  readonly isRepo: boolean;
  readonly branch: string | null;
  readonly hasConflicts: boolean;
  readonly entries: readonly unknown[];
}

export interface VibeTaskSummary {
  readonly working: number;
  readonly waiting: number;
  /** Short text for the badge; empty hides it. */
  readonly badge: string;
  /** Whether the badge should draw attention rather than just count. */
  readonly attention: boolean;
  /** The full sentence for the accessible name and tooltip. */
  readonly description: string;
}

export function summarizeVibeTasks(tasks: readonly TaskLike[]): VibeTaskSummary {
  const working = tasks.filter((task) => WORKING.has(task.state)).length;
  const waiting = tasks.filter((task) => WAITING.has(task.state) && (task.state !== "review" || task.changedPaths.length > 0)).length;
  const parts: string[] = [];
  if (working > 0) parts.push(`${working} working`);
  if (waiting > 0) parts.push(`${waiting} waiting for you`);
  return {
    working,
    waiting,
    badge: waiting > 0 ? String(waiting) : working > 0 ? String(working) : "",
    attention: waiting > 0,
    description: parts.length === 0 ? (tasks.length === 0 ? "No tasks yet" : "All tasks settled") : parts.join(", "),
  };
}

export interface VibeChangeSummary {
  /** AI proposals whose files have not reached the project yet. */
  readonly proposals: number;
  /** Files changed in the working tree but not committed. */
  readonly uncommitted: number;
  readonly badge: string;
  readonly attention: boolean;
  readonly description: string;
}

export function summarizeVibeChanges(git: GitLike | null, tasks: readonly TaskLike[]): VibeChangeSummary {
  const proposals = tasks.filter((task) => (task.state === "review" || task.state === "conflict") && task.changedPaths.length > 0).length;
  const uncommitted = git?.isRepo ? git.entries.length : 0;
  const parts: string[] = [];
  if (proposals > 0) parts.push(`${proposals} AI proposal${proposals === 1 ? "" : "s"} to review`);
  if (uncommitted > 0) parts.push(`${uncommitted} uncommitted file${uncommitted === 1 ? "" : "s"}`);
  if (git?.hasConflicts) parts.push("conflicts need attention");
  return {
    proposals,
    uncommitted,
    // Proposals first: they are the changes that have not landed yet, and the ones a Vibe
    // user is most likely to be waiting on.
    badge: proposals > 0 ? String(proposals) : uncommitted > 0 ? formatCount(uncommitted) : "",
    attention: proposals > 0 || git?.hasConflicts === true,
    description: parts.length === 0 ? (git?.isRepo ? "Working tree clean" : "No changes to review") : parts.join(", "),
  };
}

/** The line under the project name: branch and how much is uncommitted. */
export function describeVibeProject(root: string | null, git: GitLike | null): string {
  if (root === null) return "Choose a folder to start";
  if (git === null) return "Loading…";
  if (!git.isRepo) return "Not a Git repository";
  const branch = git.branch ?? "Detached HEAD";
  if (git.hasConflicts) return `${branch} · conflicts`;
  const count = git.entries.length;
  return count === 0 ? `${branch} · clean` : `${branch} · ${formatCount(count)} changed`;
}

/** The last path segment, whichever separator the platform used. */
export function projectName(root: string | null): string {
  if (root === null) return "No project open";
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/** Recent projects for the switcher: the current one left out, newest first, capped. */
export function recentProjectsFor(recents: readonly RecentFolderView[], root: string | null, limit = 6): readonly RecentFolderView[] {
  const current = root === null ? null : normalize(root);
  return recents.filter((folder) => normalize(folder.path) !== current).slice(0, limit);
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function formatCount(value: number): string {
  return value > 99 ? "99+" : String(value);
}
