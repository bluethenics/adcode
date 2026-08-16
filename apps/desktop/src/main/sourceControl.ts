/**
 * Git and search, bound to the open workspace.
 *
 * Both are rebuilt when the workspace changes, and both fail soft: a directory that is
 * not a repository, or a git that is not installed, has to leave the editor working.
 */
import { createGit, nodeGitExec, type Git } from "@adcode/git";
import { createWorkspaceSearch, rankCandidates, type WorkspaceSearch } from "@adcode/search";
import { currentWorkspace } from "./workspace.ts";

let bound: { root: string; git: Git; search: WorkspaceSearch } | null = null;

function services(): { git: Git; search: WorkspaceSearch } | null {
  const workspace = currentWorkspace();
  if (workspace === null) return null;

  if (bound === null || bound.root !== workspace.root) {
    bound = {
      root: workspace.root,
      git: createGit({ exec: nodeGitExec, root: workspace.root }),
      search: createWorkspaceSearch({ root: workspace.root }),
    };
  }

  return { git: bound.git, search: bound.search };
}

export function gitForWorkspace(): Git | null {
  return services()?.git ?? null;
}

export function searchForWorkspace(): WorkspaceSearch | null {
  return services()?.search ?? null;
}

/**
 * The file list behind Ctrl+P, cached.
 *
 * §7 budgets first results at under 100ms over 50,000 files, and the ranking pass gets
 * nowhere near that - but walking the tree on every keystroke would. The list is walked
 * once and reused until the workspace changes or the cache is invalidated.
 */
let fileCache: { root: string; files: string[]; at: number } | null = null;
const CACHE_TTL_MS = 30_000;

export async function workspaceFiles(): Promise<string[]> {
  const workspace = currentWorkspace();
  const search = searchForWorkspace();
  if (workspace === null || search === null) return [];

  const cached = fileCache;
  if (cached !== null && cached.root === workspace.root && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.files;
  }

  const files = await search.listFiles();
  fileCache = { root: workspace.root, files, at: Date.now() };
  return files;
}

export function invalidateFileCache(): void {
  fileCache = null;
}

export async function quickOpen(query: string, limit = 50): Promise<
  Array<{ path: string; positions: readonly number[] }>
> {
  const files = await workspaceFiles();
  return rankCandidates(query, files, limit).map((result) => ({
    path: result.value,
    positions: result.positions,
  }));
}
