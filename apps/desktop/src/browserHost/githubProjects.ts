/**
 * GitHub repositories as projects in the browser host (2026-11-21).
 *
 * Opening a repository copies its text files at one commit into the in-tab file system, and a
 * second, hidden copy beside it: the base. Everything git-like on the web - the Changes list,
 * diffs, discard, "commit" - compares the project with its base (githubGit.ts). Changes go back
 * to GitHub as a pull request on a fresh branch, through the cloud Worker, so nothing is ever
 * pushed to the branch the person opened.
 *
 * Files are what GitHub's API serves as text, up to 256 KB each; anything else is left out and
 * listed, so nobody is surprised by a missing image later.
 */
import * as vfs from "./shims/vfs.ts";
import { GitHubError, parseRepository, type GitHubApi } from "./githubApi.ts";

export const GITHUB_HOME = "/home/adcode/.adcode/github";
const REGISTRY = `${GITHUB_HOME}/projects.json`;
/** Requests for file contents in flight at once while opening a repository. */
const IMPORT_CONCURRENCY = 8;

export interface PullRequestRecord { readonly url: string; readonly number: number; readonly branch: string; readonly title: string; readonly at: number }

export interface GitHubProjectMeta {
  readonly id: string;
  readonly root: string;
  readonly repo: string;
  readonly branch: string;
  readonly commit: string;
  readonly importedAt: number;
  /** Files left out of the copy: binary, larger than GitHub's text limit, or unreadable. */
  readonly skipped: readonly string[];
  /** GitHub listed more files than one copy takes. */
  readonly truncated: boolean;
  readonly pullRequests: readonly PullRequestRecord[];
}

const decoder = new TextDecoder();
const readText = (path: string): string => decoder.decode(vfs.readFileSync(path) as Uint8Array);

function registry(): Record<string, string> {
  try { return JSON.parse(readText(REGISTRY)) as Record<string, string>; } catch { return {}; }
}

/** The GitHub project a folder is, or null when it was not opened from GitHub. */
export function projectMeta(root: string): GitHubProjectMeta | null {
  const id = registry()[vfs.normalizePath(root)];
  if (id === undefined) return null;
  try { return JSON.parse(readText(`${GITHUB_HOME}/${id}/meta.json`)) as GitHubProjectMeta; } catch { return null; }
}

export function saveMeta(meta: GitHubProjectMeta): void {
  vfs.mkdirSync(`${GITHUB_HOME}/${meta.id}`, { recursive: true });
  vfs.writeFileSync(`${GITHUB_HOME}/${meta.id}/meta.json`, JSON.stringify(meta, null, 2));
  vfs.writeFileSync(REGISTRY, JSON.stringify({ ...registry(), [vfs.normalizePath(meta.root)]: meta.id }, null, 2));
}

export const baseDir = (meta: Pick<GitHubProjectMeta, "id">): string => `${GITHUB_HOME}/${meta.id}/base`;

/** Folders that are never part of a change: installed packages and build output git ignores anyway. */
const IGNORED = /(^|\/)(node_modules|\.git|\.next|dist|build|\.cache|\.turbo|coverage)(\/|$)/;

/** A project's files by path relative to its root, for comparing with the base. */
export function workingFiles(root: string): Map<string, string> {
  const at = vfs.normalizePath(root);
  const out = new Map<string, string>();
  for (const file of vfs.listFiles(at)) {
    const relative = file.slice(at.length + 1);
    if (!IGNORED.test(relative)) out.set(relative, file);
  }
  return out;
}

export function baseFiles(meta: GitHubProjectMeta): Map<string, string> {
  const base = baseDir(meta);
  const out = new Map<string, string>();
  for (const file of vfs.listFiles(base)) out.set(file.slice(base.length + 1), file);
  return out;
}

function freeFolder(projectsHome: string, name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60) || "project";
  vfs.mkdirSync(projectsHome, { recursive: true });
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = `${vfs.normalizePath(projectsHome)}/${attempt === 1 ? base : `${base}-${attempt}`}`;
    if (!vfs.existsSync(candidate)) {
      vfs.mkdirSync(candidate);
      return candidate;
    }
  }
  throw new Error("Too many projects with that name");
}

/** The branch to open when the address names none: the repository's default, else main or master. */
async function defaultBranch(api: GitHubApi, repo: string): Promise<string[]> {
  for (let page = 1; page <= 10; page += 1) {
    const { repos, nextPage } = await api.repos(page);
    const found = repos.find((one) => one.fullName.toLowerCase() === repo.toLowerCase());
    if (found !== undefined) return [found.defaultBranch];
    if (nextPage === null) break;
  }
  return ["main", "master"];
}

export interface ImportProgress { readonly done: number; readonly total: number }

/** Copy a repository into a new project folder. Resolves with the folder. */
export async function importRepository(api: GitHubApi, projectsHome: string, address: string, onProgress?: (progress: ImportProgress) => void): Promise<string> {
  const parsed = parseRepository(address);
  if (parsed === null) throw new Error("Paste a GitHub repository, like https://github.com/you/project or you/project.");
  let tree = null;
  let lastError: unknown = null;
  for (const branch of parsed.branch === null ? await defaultBranch(api, parsed.repo) : [parsed.branch]) {
    try {
      tree = await api.tree(parsed.repo, branch);
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof GitHubError && error.code === "not-found")) throw error;
    }
  }
  if (tree === null) throw lastError instanceof Error ? lastError : new Error("That repository or branch was not found.");

  const root = freeFolder(projectsHome, parsed.repo.split("/")[1]!);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const base = `${GITHUB_HOME}/${id}/base`;
  const skipped: string[] = [];
  let next = 0;
  let done = 0;
  const files = tree.files;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]!;
      try {
        const { content } = await api.file(tree.repo, tree.commit, file.path);
        for (const target of [`${root}/${file.path}`, `${base}/${file.path}`]) {
          vfs.mkdirSync(vfs.dirnameOf(target), { recursive: true });
          vfs.writeFileSync(target, content);
        }
      } catch (error) {
        // A GitHub-wide refusal (signed out, rate limit) stops the copy; one unreadable file does not.
        if (error instanceof GitHubError && ["unauthenticated", "github-not-connected", "rate-limit", "network"].includes(error.code)) throw error;
        skipped.push(file.path);
      }
      done += 1;
      onProgress?.({ done, total: files.length });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, Math.max(1, files.length)) }, worker));
  } catch (error) {
    vfs.rmSync(root, { recursive: true, force: true });
    vfs.rmSync(`${GITHUB_HOME}/${id}`, { recursive: true, force: true });
    throw error;
  }
  vfs.mkdirSync(base, { recursive: true });
  saveMeta({ id, root, repo: tree.repo, branch: tree.ref, commit: tree.commit, importedAt: Date.now(), skipped: skipped.sort(), truncated: tree.truncated, pullRequests: [] });
  return root;
}

export interface GitHubProjectOpsDeps {
  readonly projectsHome: string;
  readonly api: GitHubApi;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * The page's GitHub operations, by the names the page already uses for the cloud host
 * (web/githubConnect.ts, web/projectActions.ts), plus the repository list.
 */
export function createGitHubProjectOps(deps: GitHubProjectOpsDeps): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  return {
    /** Not connected, with the reason when it is not simply "GitHub was never connected" (signed out, offline). */
    async githubStatus() {
      try {
        return await deps.api.status();
      } catch (error) {
        const reason = error instanceof GitHubError && error.code !== "github-not-connected" ? error.message : null;
        return { connected: false, login: null, ...(reason === null ? {} : { error: reason }) };
      }
    },
    async githubStart() {
      const started = await deps.api.start();
      return { userCode: started.userCode, verificationUri: started.verificationUri };
    },
    /** Waits for the person to enter the code on GitHub, as the cloud host's op of the same name does. */
    async githubFinish() {
      const deadline = now() + 15 * 60_000;
      while (now() < deadline) {
        const result = await deps.api.poll();
        if (result.state === "connected") return { ok: true, login: result.login ?? null };
        if (result.state === "expired") return { ok: false, reason: "The code expired. Start again to get a new one." };
        if (result.state === "denied") return { ok: false, reason: "GitHub sign-in was cancelled." };
        await sleep(Math.max(1_000, result.retryAfterMs ?? 5_000));
      }
      return { ok: false, reason: "The code expired. Start again to get a new one." };
    },
    async githubDisconnect() {
      await deps.api.disconnect();
      return { ok: true };
    },
    async githubRepos(page: unknown) {
      return deps.api.repos(typeof page === "number" && Number.isInteger(page) && page > 0 ? page : 1);
    },
    /** "Import from GitHub": an address or `owner/name`, copied into a new project. */
    async cloneProject(address: unknown) {
      if (typeof address !== "string") throw new Error("Paste a GitHub repository address.");
      return importRepository(deps.api, deps.projectsHome, address);
    },
  };
}
