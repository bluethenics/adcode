/**
 * Git and search, bound to the open workspace.
 *
 * Both are rebuilt when the workspace changes, and both fail soft: a directory that is
 * not a repository, or a git that is not installed, has to leave the editor working.
 */
import { createGit, nodeGitExec, type Git } from "@adcode/git";
import { appendOutput, appendOutputEvent } from "./output.ts";
import { createWorkspaceSearch, rankCandidates, type WorkspaceSearch } from "@adcode/search";
import { currentWorkspace } from "./workspace.ts";

let bound: { root: string; git: Git; search: WorkspaceSearch } | null = null;

function services(): { git: Git; search: WorkspaceSearch } | null {
  const workspace = currentWorkspace();
  if (workspace === null) return null;

  if (bound === null || bound.root !== workspace.root) {
    bound = {
      root: workspace.root,
      git: createGit({ exec: loggingGitExec, root: workspace.root }),
      search: createWorkspaceSearch({ root: workspace.root }),
    };
  }

  return { git: bound.git, search: bound.search };
}

/**
 * `nodeGitExec`, with every invocation written to the Output panel.
 *
 * A decorator rather than a change inside `@adcode/git`: the package is deliberately free
 * of any dependency on the app, and logging is an app concern. This is also the single
 * choke point through which every git command in the editor passes, so wrapping it here
 * means no call site can forget.
 *
 * Failures print git's own stderr. That is the whole value - "why did my push fail" is
 * answered by git and by nothing we could write instead.
 */
const loggingGitExec: typeof nodeGitExec = {
  async run(args, options) {
    appendOutputEvent("git", `git ${args.join(" ")}`);
    const result = await nodeGitExec.run(args, options);
    if (result.code !== 0) {
      appendOutput("git", result.stderr === "" ? result.stdout : result.stderr);
      appendOutputEvent("git", `exited ${result.code}`);
    }
    return result;
  },
};

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
