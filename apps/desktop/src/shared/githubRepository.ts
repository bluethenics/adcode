export const GITHUB_DESTINATIONS = {
  code: "",
  pulls: "/pulls",
  "new-pull-request": "/compare?expand=1",
  issues: "/issues",
  "new-issue": "/issues/new/choose",
  actions: "/actions",
  projects: "/projects",
  discussions: "/discussions",
  releases: "/releases",
  wiki: "/wiki",
  security: "/security",
  insights: "/pulse",
  settings: "/settings",
} as const;

export type GitHubDestination = keyof typeof GITHUB_DESTINATIONS;

/**
 * The one reading of "is this remote a github.com repository" in the app.
 *
 * Source Control and Team used to carry a regex each, and Team's was the narrower one: it
 * refused `ssh://git@github.com/...`, an `https://name@github.com/...` remote that credential
 * helpers write, and any capital letter in the host. So Source Control listed a project as on
 * GitHub while Team said to connect it to GitHub - the same remote, two answers.
 */
const GITHUB_REMOTE = /^(?:https:\/\/(?:[^/@\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i;

/** The owner and repository of a github.com remote, as written; null for anything else. */
export function githubRepositoryParts(remote: string): { readonly owner: string; readonly name: string } | null {
  const match = GITHUB_REMOTE.exec(remote.trim());
  if (match === null || match[1] === undefined || match[2] === undefined || match[2] === "." || match[2] === "..") return null;
  return { owner: match[1], name: match[2] };
}

/** `owner/repo`, lower-cased - the identity a shared project is keyed by - or null. */
export function githubRepositoryName(remote: string): string | null {
  const parts = githubRepositoryParts(remote);
  return parts === null ? null : `${parts.owner}/${parts.name}`.toLowerCase();
}

/** Build an HTTPS destination from a configured GitHub remote, never an arbitrary URL. */
export function githubRepositoryUrl(remote: string, destination: string): string | null {
  if (!Object.hasOwn(GITHUB_DESTINATIONS, destination)) return null;
  const parts = githubRepositoryParts(remote);
  if (parts === null) return null;
  return `https://github.com/${parts.owner}/${parts.name}${GITHUB_DESTINATIONS[destination as GitHubDestination]}`;
}

/** What to say when a pasted address is not a github.com repository - the same words everywhere. */
export const GITHUB_ADDRESS_HELP = "That isn't a github.com repository address. On GitHub, open the repository, press the green Code button and copy the HTTPS address - it looks like https://github.com/you/project.git.";

/**
 * What a person pastes, turned into a remote URL git can use - or null when it is not a
 * github.com repository. The browser's address bar gives `github.com/owner/repo` or
 * `https://github.com/owner/repo/tree/main`; both are what they meant, so both are accepted.
 */
export function githubRemoteFromInput(input: string): string | null {
  let text = input.trim();
  if (/^(?:www\.)?github\.com\//i.test(text)) text = `https://${text}`;
  text = text.replace(/^http:\/\//i, "https://").replace(/^https:\/\/www\./i, "https://");
  const page = /^(https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/(?:tree|blob|pulls?|issues|actions|wiki)(?:\/.*)?$/i.exec(text);
  if (page?.[1]) text = page[1];
  const parts = githubRepositoryParts(text);
  if (parts === null) return null;
  // An SSH remote stays SSH: the person who pasted one has keys set up for it.
  if (/^(?:git@|ssh:\/\/)/i.test(text)) return text;
  return `https://github.com/${parts.owner}/${parts.name}.git`;
}
