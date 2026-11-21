/**
 * `@adcode/git` in the browser host: the package itself, with `createGit` answering from GitHub.
 *
 * vite.browserHost.config.ts points `@adcode/git` here. Everything else the package exports
 * (argument checks, conflict markers, types) is the real thing; only the part that runs the git
 * program is replaced, by githubGit.ts.
 */
import type { Git, GitDeps } from "../../../../packages/git/src/index.ts";
import type { GitHubApi } from "./githubApi.ts";
import { createGitHubGit } from "./githubGit.ts";

export * from "../../../../packages/git/src/index.ts";

let api: GitHubApi | null = null;

/** The GitHub routes source control uses; set once by hostMain.ts. */
export function useGitHubApi(value: GitHubApi): void {
  api = value;
}

export function createGit(deps: GitDeps): Git {
  return createGitHubGit({
    root: deps.root,
    api: () => {
      if (api === null) throw new Error("GitHub is not ready yet. Try again in a moment.");
      return api;
    },
  });
}
