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

/** Build an HTTPS destination from a configured GitHub remote, never an arbitrary URL. */
export function githubRepositoryUrl(remote: string, destination: string): string | null {
  if (!Object.hasOwn(GITHUB_DESTINATIONS, destination)) return null;
  const match = /^(?:https:\/\/(?:[^/@\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(remote.trim());
  if (match === null || match[2] === "." || match[2] === "..") return null;
  return `https://github.com/${match[1]}/${match[2]}${GITHUB_DESTINATIONS[destination as GitHubDestination]}`;
}
