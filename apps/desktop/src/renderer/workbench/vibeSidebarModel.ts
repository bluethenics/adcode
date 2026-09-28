/**
 * What the Vibe sidebar says about the project, as plain data.
 *
 * The Changes badge is the only place a Vibe user sees what has changed or what is waiting
 * to be applied, so the rules for "needs you" live here - pure, with no DOM or IPC -
 * where they can be tested against every task state rather than eyeballed.
 */
import type { AiWorkspaceTaskView, RecentFolderView } from "../../shared/api.ts";

type TaskLike = Pick<AiWorkspaceTaskView, "state" | "changedPaths">;
/** The parts of `GitStatusView` the sidebar reads; only how many entries, not what they are. */
interface GitLike {
  readonly isRepo: boolean;
  /** A repository git refuses until the folder is trusted. */
  readonly untrusted?: boolean;
  readonly branch: string | null;
  readonly hasConflicts: boolean;
  readonly entries: readonly unknown[];
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
  if (proposals > 0) parts.push(`${proposals} AI task${proposals === 1 ? "" : "s"} waiting to apply`);
  if (uncommitted > 0) parts.push(`${uncommitted} uncommitted file${uncommitted === 1 ? "" : "s"}`);
  if (git?.hasConflicts) parts.push("conflicts need attention");
  return {
    proposals,
    uncommitted,
    // Waiting changes first (Review mode, or a Team result): they have not landed yet, and a Vibe
    // user who asked to review them is waiting on them.
    badge: proposals > 0 ? String(proposals) : uncommitted > 0 ? formatCount(uncommitted) : "",
    attention: proposals > 0 || git?.hasConflicts === true,
    description: parts.length === 0 ? (git?.isRepo ? "Working tree clean" : "No changes") : parts.join(", "),
  };
}

/** The line under the project name: branch and how much is uncommitted. */
export function describeVibeProject(root: string | null, git: GitLike | null): string {
  if (root === null) return "Choose a folder to start";
  if (git === null) return "Loading…";
  if (!git.isRepo) return git.untrusted === true ? "Git needs your OK" : "Not a Git repository";
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

/** The pages Vibe's centre switches between. Everything else opens as a floating panel. */
export type VibePage = "chat" | "agents" | "tools";

export const VIBE_PAGES: readonly { readonly id: VibePage; readonly label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "agents", label: "Agents" },
  { id: "tools", label: "Tools" },
];

/** A routed or remembered page name, or Chat when it is not one this build knows. */
export function parseVibePage(value: string | null | undefined): VibePage {
  return VIBE_PAGES.some((page) => page.id === value) ? (value as VibePage) : "chat";
}
