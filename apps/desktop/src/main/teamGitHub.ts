/**
 * Is the open project ready to be a Team project - and if not, what is the next step?
 *
 * Team keys a shared project by its github.com repository, so "Share this project" needs one.
 * Until 2.6.6 every reason it could not find one came out as the same sentence - "Connect the
 * open project's Git repository to GitHub" - including for a folder with no Git repository at
 * all, a folder Git refuses to read (FAT32 and USB drives), and a machine without Git. Nothing
 * in Team offered a way to do it either, so the button looked broken. Each reason now has its
 * own state and its own next step, and the Team card walks through them.
 *
 * Plain TypeScript with its dependencies passed in, so the rules are testable without Electron.
 */
import type { RepoState } from "@adcode/git";
import { GITHUB_ADDRESS_HELP, githubRemoteFromInput, githubRepositoryName } from "../shared/githubRepository.ts";
import type { TeamGitHubReadiness } from "../shared/api.ts";

export interface TeamGitHubDeps {
  /** The open folder, or null when none is. */
  readonly root: string | null;
  readonly repoState: () => Promise<RepoState>;
  readonly remotes: () => Promise<readonly { readonly name: string; readonly url: string }[]>;
  /** Whether a git binary runs at all; asked only when the folder looks like it has no repository. */
  readonly gitInstalled: () => Promise<boolean>;
}

function folderName(root: string): string {
  return root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || root;
}

function host(url: string): string {
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)/i.exec(url.trim());
  return match?.[1] ?? url;
}

export async function teamGitHubReadiness(deps: TeamGitHubDeps): Promise<TeamGitHubReadiness> {
  if (deps.root === null) {
    return { state: "no-folder", folder: "", message: "Open the project folder you want to share first, then press Share this project again." };
  }
  const folder = folderName(deps.root);
  const state = await deps.repoState();
  if (state === "untrusted") {
    return {
      state: "untrusted", folder,
      message: `Git doesn't trust "${folder}" yet - common on USB and FAT32 drives - so ADCode can't read its GitHub connection. Press Trust this folder if you know where it came from.`,
    };
  }
  if (state === "none") {
    if (!await deps.gitInstalled()) {
      return { state: "no-git", folder, message: "Git isn't installed, and Team needs it to connect a project to GitHub. Install Git from git-scm.com, restart ADCode, then press Share this project again." };
    }
    return {
      state: "not-repo", folder,
      message: `"${folder}" isn't tracked by Git yet, so it has no GitHub repository to share. Press Start tracking, then connect it to a repository on GitHub.`,
    };
  }
  const remotes = await deps.remotes();
  for (const remote of remotes) {
    const repository = githubRepositoryName(remote.url);
    if (repository !== null) return { state: "ready", folder, repository, remote: remote.name, message: `Connected to github.com/${repository}.` };
  }
  if (remotes.length === 0) {
    return {
      state: "no-remote", folder,
      message: `"${folder}" isn't connected to GitHub yet. Make an empty repository on GitHub, then paste its address here and press Connect.`,
    };
  }
  const hosts = [...new Set(remotes.map((remote) => host(remote.url)))].join(", ");
  return {
    state: "other-remote", folder, remotes: remotes.map((remote) => remote.name),
    message: `"${folder}" pushes to ${hosts}, not github.com, and Team works with GitHub repositories. Make one on GitHub and paste its address here - your existing remote stays as it is.`,
  };
}

/**
 * The remote to add for a pasted GitHub address. `origin` when the name is free - every
 * hosting guide assumes it - and otherwise a name that does not replace the person's
 * existing remote, which may point somewhere they still push to.
 */
export function teamGitHubRemotePlan(
  input: string,
  remotes: readonly { readonly name: string; readonly url: string }[],
): { readonly ok: true; readonly name: string; readonly url: string } | { readonly ok: false; readonly message: string } {
  const url = githubRemoteFromInput(input);
  if (url === null) {
    return { ok: false, message: GITHUB_ADDRESS_HELP };
  }
  const taken = new Set(remotes.map((remote) => remote.name));
  const name = ["origin", "github", "github-team"].find((candidate) => !taken.has(candidate));
  if (name === undefined) return { ok: false, message: "This repository already has remotes called origin, github and github-team. Connect GitHub from Source Control instead, where you can see them." };
  return { ok: true, name, url };
}
