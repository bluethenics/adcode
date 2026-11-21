/**
 * The cloud Worker's GitHub routes (apps/cloud/src/githubWorkspace.ts), from the browser host.
 *
 * GitHub's sign-in and API refuse calls from a web page, so the cloud Worker makes them: it
 * keeps the person's GitHub token encrypted on its side and never hands it to the browser. The
 * worker shares the page's origin, so these are ordinary same-origin requests with the person's
 * ADCode sign-in token.
 */
export interface GitHubRepoSummary {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canPush: boolean;
  readonly htmlUrl: string;
}

export interface GitHubTreeFile {
  readonly path: string;
  readonly sha: string;
  readonly size: number;
}

export interface GitHubTree {
  readonly repo: string;
  readonly ref: string;
  readonly commit: string;
  readonly files: readonly GitHubTreeFile[];
  readonly truncated: boolean;
}

export interface PullRequestInput {
  readonly repo: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly title: string;
  readonly body: string;
  readonly files: readonly { readonly path: string; readonly content: string | null }[];
}

export interface GitHubApi {
  status(): Promise<{ connected: boolean; login: string | null }>;
  start(): Promise<{ userCode: string; verificationUri: string; expiresAt: number; intervalMs: number }>;
  poll(): Promise<{ state: "pending" | "connected" | "expired" | "denied"; login?: string; retryAfterMs?: number }>;
  disconnect(): Promise<void>;
  repos(page: number): Promise<{ repos: GitHubRepoSummary[]; nextPage: number | null }>;
  tree(repo: string, ref: string): Promise<GitHubTree>;
  file(repo: string, commit: string, path: string): Promise<{ path: string; sha: string; content: string; bytes: number }>;
  pullRequest(input: PullRequestInput): Promise<{ url: string; branch: string; number: number }>;
}

/** A refusal from the GitHub routes, with the code the Worker gave (`github-not-connected`, `too-large`...). */
export class GitHubError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface GitHubApiDeps {
  /** The page's origin; the routes are under `/api/github/`. */
  readonly origin: string;
  /** The person's ADCode sign-in token, or null when nobody is signed in. */
  readonly token: () => Promise<string | null>;
  readonly fetcher?: typeof fetch;
}

export function createGitHubApi(deps: GitHubApiDeps): GitHubApi {
  const fetcher = deps.fetcher ?? fetch;
  async function call<T>(path: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<T> {
    const token = await deps.token();
    if (token === null) throw new GitHubError("Sign in to ADCode to use GitHub.", "unauthenticated", 401);
    let response: Response;
    try {
      response = await fetcher(`${deps.origin}/api${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new GitHubError("Couldn't reach GitHub. Check your connection and try again.", "network", 0);
    }
    const data = (await response.json().catch(() => null)) as { error?: { code?: unknown; message?: unknown } } | null;
    if (!response.ok) {
      const message = typeof data?.error?.message === "string" ? data.error.message : "GitHub couldn't complete this request. Try again.";
      const code = typeof data?.error?.code === "string" ? data.error.code : response.status === 401 ? "unauthenticated" : "github-unavailable";
      throw new GitHubError(message, code, response.status);
    }
    return data as T;
  }
  const query = (path: string, params: Record<string, string>): string => `${path}?${new URLSearchParams(params).toString()}`;
  return {
    status: () => call("/github/status"),
    start: () => call("/github/start", "POST"),
    poll: () => call("/github/poll", "POST"),
    disconnect: async () => { await call("/github/disconnect", "POST"); },
    repos: (page) => call(query("/github/repos", { page: String(page) })),
    tree: (repo, ref) => call(query("/github/tree", { repo, ref })),
    file: (repo, commit, path) => call(query("/github/file", { repo, ref: commit, path })),
    pullRequest: (input) => call("/github/pull-request", "POST", input),
  };
}

/** `owner/name` and an optional branch from what a person pasted: an address or `owner/name`. */
export function parseRepository(input: string): { repo: string; branch: string | null } | null {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const plain = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(text);
  if (plain !== null) return { repo: `${plain[1]}/${plain[2]}`, branch: null };
  let url: URL;
  try { url = new URL(text.startsWith("github.com/") ? `https://${text}` : text); } catch { return null; }
  if (url.protocol !== "https:" || (url.hostname !== "github.com" && url.hostname !== "www.github.com")) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts as [string, string];
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name.replace(/\.git$/, ""))) return null;
  const branch = parts[2] === "tree" && parts.length > 3 ? decodeURIComponent(parts.slice(3).join("/")) : null;
  return { repo: `${owner}/${name.replace(/\.git$/, "")}`, branch };
}
