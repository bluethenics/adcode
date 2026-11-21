/**
 * `Git` for a project opened from GitHub in the browser host (2026-11-21).
 *
 * The desktop's source control (main/sourceControl.ts) asks `@adcode/git` for a Git and drives
 * the git program with it. The web has no git program, so in the browser host `createGit`
 * returns this instead (browserHost/git.ts). It compares the project with the copy of the
 * commit it was opened at (githubProjects.ts), so the Changes list, diffs, gutter marks and
 * discard behave as they do on a computer. Committing opens a pull request on a new branch
 * with every change; the branch that was opened is never written to.
 */
import { computeHunks, type Hunk } from "@adcode/ai";
import type { BlameLine, Git, GitBranch, GitCommit, GitCommitDetail, GitRemote, GitResult, GitStatus, GitStatusEntry, LineChange, RepoState } from "@adcode/git";
import * as vfs from "./shims/vfs.ts";
import { baseDir, baseFiles, projectMeta, saveMeta, workingFiles, type GitHubProjectMeta } from "./githubProjects.ts";
import type { GitHubApi } from "./githubApi.ts";

/** GitHub's limits for one pull request through the cloud Worker (apps/cloud githubWorkspace.ts). */
const MAX_PR_FILES = 50;
const MAX_FILE_BYTES = 256_000;
const MAX_CHANGED_BYTES = 1_000_000;

const NOT_GITHUB: GitResult = { ok: false, message: "This project wasn't opened from GitHub. On the web, open a repository from GitHub to save changes back as a pull request." };
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const read = (path: string): string => decoder.decode(vfs.readFileSync(path) as Uint8Array);

export type ChangeKind = "modified" | "added" | "deleted";
export interface Change { readonly path: string; readonly kind: ChangeKind; readonly before: string | null; readonly after: string | null }

/** Every file that differs from the commit the project was opened at, sorted by path. */
export function projectChanges(meta: GitHubProjectMeta): Change[] {
  const working = workingFiles(meta.root);
  const base = baseFiles(meta);
  const changes: Change[] = [];
  for (const [path, file] of working) {
    const after = read(file);
    const original = base.get(path);
    if (original === undefined) {
      // A file GitHub's copy left out (binary, too large) is not a new file.
      if (!meta.skipped.includes(path)) changes.push({ path, kind: "added", before: null, after });
      continue;
    }
    const before = read(original);
    if (before !== after) changes.push({ path, kind: "modified", before, after });
  }
  for (const [path, file] of base) if (!working.has(path)) changes.push({ path, kind: "deleted", before: read(file), after: null });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

const lines = (text: string | null): number => (text === null || text === "" ? 0 : text.replace(/\n$/, "").split("\n").length);

function counts(change: Change): { added: number; removed: number } {
  if (change.before === null) return { added: lines(change.after), removed: 0 };
  if (change.after === null) return { added: 0, removed: lines(change.before) };
  const hunks = computeHunks(change.before, change.after);
  return { added: hunks.reduce((sum, hunk) => sum + hunk.replacement.length, 0), removed: hunks.reduce((sum, hunk) => sum + hunk.original.length, 0) };
}

/** Hunks with where each lands in the new file, which `computeHunks` leaves to the caller. */
function placed(before: string, after: string): { hunk: Hunk; newStart: number }[] {
  let shift = 0;
  return computeHunks(before, after).map((hunk) => {
    const newStart = hunk.startLine + shift;
    shift += hunk.replacement.length - hunk.original.length;
    return { hunk, newStart };
  });
}

/** One change as a unified diff with no context lines, which every diff reader accepts. */
export function unifiedDiff(change: Change): string {
  const header = [
    `diff --git a/${change.path} b/${change.path}`,
    ...(change.kind === "added" ? ["new file mode 100644"] : change.kind === "deleted" ? ["deleted file mode 100644"] : []),
    `--- ${change.before === null ? "/dev/null" : `a/${change.path}`}`,
    `+++ ${change.after === null ? "/dev/null" : `b/${change.path}`}`,
  ];
  const split = (text: string): string[] => (text === "" ? [] : text.replace(/\n$/, "").split("\n"));
  if (change.before === null || change.after === null) {
    const body = split(change.before ?? change.after ?? "");
    const sign = change.before === null ? "+" : "-";
    const range = change.before === null ? `@@ -0,0 +1,${body.length} @@` : `@@ -1,${body.length} +0,0 @@`;
    return [...header, range, ...body.map((line) => sign + line)].join("\n") + "\n";
  }
  const out = [...header];
  for (const { hunk, newStart } of placed(change.before, change.after)) {
    const oldStart = hunk.original.length === 0 ? hunk.startLine : hunk.startLine + 1;
    const start = hunk.replacement.length === 0 ? newStart : newStart + 1;
    out.push(`@@ -${oldStart},${hunk.original.length} +${start},${hunk.replacement.length} @@`);
    for (const line of hunk.original) out.push(`-${line}`);
    for (const line of hunk.replacement) out.push(`+${line}`);
  }
  return out.join("\n") + "\n";
}

export interface GitHubGitDeps {
  readonly root: string;
  readonly api: () => GitHubApi;
  /** The signed-in GitHub login, for the identity a "commit" is recorded as. */
  readonly now?: () => number;
}

export function createGitHubGit(deps: GitHubGitDeps): Git {
  const root = vfs.normalizePath(deps.root);
  const now = deps.now ?? Date.now;
  const meta = (): GitHubProjectMeta | null => projectMeta(root);
  const withMeta = async (run: (project: GitHubProjectMeta) => Promise<GitResult> | GitResult): Promise<GitResult> => {
    const project = meta();
    return project === null ? NOT_GITHUB : run(project);
  };
  const changeFor = (project: GitHubProjectMeta, path: string): Change | undefined => projectChanges(project).find((change) => change.path === path);

  /** Put files back as they were at the commit the project was opened at. */
  function restore(project: GitHubProjectMeta, paths: readonly string[]): GitResult {
    const base = baseDir(project);
    for (const path of paths) {
      const safe = vfs.normalizePath(`${root}/${path}`);
      if (!safe.startsWith(`${root}/`)) return { ok: false, message: `${path} is outside this project.` };
      const original = `${base}/${safe.slice(root.length + 1)}`;
      if (vfs.existsSync(original)) {
        vfs.mkdirSync(vfs.dirnameOf(safe), { recursive: true });
        vfs.writeFileSync(safe, vfs.readFileSync(original) as Uint8Array);
      } else {
        vfs.rmSync(safe, { force: true });
      }
    }
    return { ok: true, message: paths.length === 1 ? "Change discarded." : `${paths.length} changes discarded.` };
  }

  /** Every change as one pull request on a new branch. */
  async function pullRequest(project: GitHubProjectMeta, message: string): Promise<GitResult> {
    const changes = projectChanges(project);
    if (changes.length === 0) return { ok: false, message: "There are no changes to send to GitHub." };
    if (changes.length > MAX_PR_FILES) return { ok: false, message: `A pull request from the web can carry ${MAX_PR_FILES} files; this has ${changes.length}. Discard some changes, or send them in parts.` };
    let total = 0;
    for (const change of changes) {
      const bytes = change.after === null ? 0 : encoder.encode(change.after).length;
      total += bytes;
      if (bytes > MAX_FILE_BYTES) return { ok: false, message: `${change.path} is larger than 256 KB, more than GitHub takes from the web in one file.` };
      if (change.after?.includes("\0") === true) return { ok: false, message: `${change.path} isn't text, so it can't go into a pull request from the web.` };
    }
    if (total > MAX_CHANGED_BYTES) return { ok: false, message: "These changes add up to more than 1 MB. Send them as two smaller pull requests." };
    const [title, ...rest] = message.trim().split("\n");
    if (title === undefined || title.trim() === "") return { ok: false, message: "A pull request needs a title: write one in the message box." };
    try {
      const created = await deps.api().pullRequest({
        repo: project.repo,
        baseBranch: project.branch,
        baseCommit: project.commit,
        title: title.trim().slice(0, 200),
        body: [rest.join("\n").trim(), "Made with [ADCode](https://adcode.bluethenics.com) on the web."].filter(Boolean).join("\n\n"),
        files: changes.map((change) => ({ path: change.path, content: change.after })),
      });
      saveMeta({ ...project, pullRequests: [...project.pullRequests, { url: created.url, number: created.number, branch: created.branch, title: title.trim(), at: now() }] });
      return { ok: true, message: `Opened pull request #${created.number} on ${project.repo}: ${created.url}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "GitHub couldn't open the pull request. Try again." };
    }
  }

  const unsupported = (what: string): GitResult => ({ ok: false, message: `${what} isn't available on the web. Your changes go to GitHub as a pull request: write a message and commit.` });

  return {
    async isRepo() { return meta() !== null; },
    async repoState(): Promise<RepoState> { return meta() === null ? "none" : "repo"; },
    async trust() { return { ok: true, message: "" }; },
    async init() { return NOT_GITHUB; },
    async clone() { return unsupported("Cloning"); },
    async cloneLocalPath() { return unsupported("Cloning"); },

    async status(): Promise<GitStatus> {
      const project = meta();
      if (project === null) return { branch: null, upstream: null, ahead: 0, behind: 0, entries: [], isClean: true, hasConflicts: false };
      const entries: GitStatusEntry[] = projectChanges(project).map((change) => {
        const { added, removed } = counts(change);
        return change.kind === "added"
          ? { path: change.path, staged: "none", worktree: "untracked", isConflicted: false, added: null, removed: null }
          : { path: change.path, staged: "none", worktree: change.kind === "deleted" ? "deleted" : "modified", isConflicted: false, added, removed };
      });
      return { branch: project.branch, upstream: `origin/${project.branch}`, ahead: 0, behind: 0, entries, isClean: entries.length === 0, hasConflicts: false };
    },
    // Nothing is staged on the web: a pull request takes every change.
    async stage() { return { ok: true, message: "" }; },
    async stageAll() { return { ok: true, message: "" }; },
    async unstage() { return { ok: true, message: "" }; },
    async discard(paths) { return withMeta((project) => restore(project, paths)); },
    async commit(message) { return withMeta((project) => pullRequest(project, message)); },
    async identity() {
      return { name: "ADCode", email: null, complete: true, suggestedName: null, suggestedEmails: [], typo: null };
    },
    async setIdentity() { return { ok: true, message: "On the web, pull requests are opened as your GitHub account." }; },

    async push() { return withMeta((project) => pullRequest(project, "Changes from ADCode")); },
    async pull() { return unsupported("Pulling"); },
    async fetch() { return { ok: true, message: "" }; },
    async addRemote() { return unsupported("Adding a remote"); },
    async remotes(): Promise<GitRemote[]> {
      const project = meta();
      return project === null ? [] : [{ name: "origin", url: `https://github.com/${project.repo}.git` }];
    },

    async branches(): Promise<GitBranch[]> {
      const project = meta();
      return project === null ? [] : [{ name: project.branch, current: true, upstream: `origin/${project.branch}` }];
    },
    async checkout() { return unsupported("Switching branches"); },
    async createBranch() { return unsupported("Making a branch"); },

    async diff(path) {
      const project = meta();
      if (project === null) return "";
      const changes = projectChanges(project).filter((change) => path === undefined || change.path === path);
      return changes.map(unifiedDiff).join("");
    },
    async lineChanges(path): Promise<LineChange[]> {
      const project = meta();
      const change = project === null ? undefined : changeFor(project, path);
      if (change === undefined || change.before === null || change.after === null) return [];
      return placed(change.before, change.after).map(({ hunk, newStart }): LineChange => (
        hunk.original.length === 0 ? { kind: "added", startLine: newStart + 1, lineCount: hunk.replacement.length }
          : hunk.replacement.length === 0 ? { kind: "deleted", startLine: Math.max(1, newStart), lineCount: 1 }
            : { kind: "modified", startLine: newStart + 1, lineCount: hunk.replacement.length }
      ));
    },
    async log(): Promise<GitCommit[]> {
      const project = meta();
      if (project === null) return [];
      return [{ hash: project.commit, shortHash: project.commit.slice(0, 7), subject: `Opened ${project.repo} at ${project.branch}`, author: "GitHub", date: new Date(project.importedAt).toISOString() }];
    },
    async fileHistory() { return []; },
    async blame(): Promise<BlameLine[]> { return []; },
    async showFile(_ref, path) {
      const project = meta();
      if (project === null) return null;
      const original = `${baseDir(project)}/${path.replace(/^\/+/, "")}`;
      return vfs.existsSync(original) ? read(original) : null;
    },
    async commitDetail(): Promise<GitCommitDetail | null> { return null; },
    async commitFileDiff() { return ""; },
    async restoreFile(_ref, path) { return withMeta((project) => restore(project, [path])); },
  };
}
