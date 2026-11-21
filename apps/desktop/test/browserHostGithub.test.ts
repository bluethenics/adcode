import { describe, expect, it } from "vitest";
import * as vfs from "../src/browserHost/shims/vfs.ts";
import { GitHubError, parseRepository, type GitHubApi, type PullRequestInput } from "../src/browserHost/githubApi.ts";
import { createGitHubProjectOps, importRepository, projectMeta } from "../src/browserHost/githubProjects.ts";
import { createGitHubGit, unifiedDiff } from "../src/browserHost/githubGit.ts";

/*
 * The web version opens GitHub repositories into the tab's own file system and sends changes
 * back as pull requests (src/browserHost). These run against the real in-memory file system
 * and a fake of the cloud Worker's GitHub routes.
 */

const REPO_FILES: Record<string, string> = {
  "README.md": "# Bakery\n\nFresh bread.\n",
  "src/app.ts": "export const greeting = \"hello\";\nexport const count = 1;\n",
  "src/old.ts": "export {};\n",
  "logo.png": "binary",
};

function fakeApi(overrides: Partial<GitHubApi> = {}): GitHubApi & { pulls: PullRequestInput[] } {
  const pulls: PullRequestInput[] = [];
  return {
    pulls,
    status: async () => ({ connected: true, login: "baker" }),
    start: async () => ({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: 0, intervalMs: 5000 }),
    poll: async () => ({ state: "connected", login: "baker" }),
    disconnect: async () => undefined,
    repos: async () => ({ repos: [{ fullName: "baker/bakery", defaultBranch: "trunk", private: false, canPush: true, htmlUrl: "https://github.com/baker/bakery" }], nextPage: null }),
    tree: async (repo, ref) => {
      if (ref !== "trunk") throw new GitHubError("That repository, branch or file was not found.", "not-found", 404);
      return { repo, ref, commit: "a".repeat(40), files: Object.keys(REPO_FILES).map((path) => ({ path, sha: "b".repeat(40), size: 10 })), truncated: false };
    },
    file: async (_repo, _commit, path) => {
      if (path === "logo.png") throw new GitHubError("This file is not UTF-8 text.", "binary-file", 400);
      return { path, sha: "c".repeat(40), content: REPO_FILES[path]!, bytes: REPO_FILES[path]!.length };
    },
    pullRequest: async (input) => {
      pulls.push(input);
      return { url: "https://github.com/baker/bakery/pull/7", branch: "adcode/x", number: 7 };
    },
    ...overrides,
  };
}

let home = 0;
const projectsHome = (): string => `/home/adcode/test-projects-${++home}`;

describe("GitHub repositories as web projects", () => {
  it("reads a repository from an address, an owner/name, or a branch link", () => {
    expect(parseRepository("baker/bakery")).toEqual({ repo: "baker/bakery", branch: null });
    expect(parseRepository("https://github.com/baker/bakery.git")).toEqual({ repo: "baker/bakery", branch: null });
    expect(parseRepository("https://github.com/baker/bakery/tree/feature/new-menu")).toEqual({ repo: "baker/bakery", branch: "feature/new-menu" });
    for (const bad of ["https://gitlab.com/baker/bakery", "http://github.com/baker/bakery", "bakery", "https://github.com/baker"]) expect(parseRepository(bad)).toBeNull();
  });

  it("opens the default branch's text files and lists what it left out", async () => {
    const api = fakeApi();
    const root = await importRepository(api, projectsHome(), "https://github.com/baker/bakery");
    expect(vfs.readFileSync(`${root}/src/app.ts`, "utf8")).toBe(REPO_FILES["src/app.ts"]);
    const meta = projectMeta(root)!;
    expect(meta).toMatchObject({ repo: "baker/bakery", branch: "trunk", commit: "a".repeat(40), skipped: ["logo.png"] });
    const git = createGitHubGit({ root, api: () => api });
    expect(await git.repoState()).toBe("repo");
    expect(await git.status()).toMatchObject({ branch: "trunk", isClean: true, entries: [] });
    expect(await git.remotes()).toEqual([{ name: "origin", url: "https://github.com/baker/bakery.git" }]);
  });

  it("shows changes, diffs and discards them like git does", async () => {
    const api = fakeApi();
    const root = await importRepository(api, projectsHome(), "baker/bakery");
    const git = createGitHubGit({ root, api: () => api });
    vfs.writeFileSync(`${root}/src/app.ts`, "export const greeting = \"hi\";\nexport const count = 1;\nexport const more = 2;\n");
    vfs.writeFileSync(`${root}/src/new.ts`, "export const fresh = true;\n");
    vfs.rmSync(`${root}/src/old.ts`);
    vfs.mkdirSync(`${root}/node_modules/x`, { recursive: true });
    vfs.writeFileSync(`${root}/node_modules/x/index.js`, "ignored");
    const status = await git.status();
    expect(status.isClean).toBe(false);
    expect(status.entries).toEqual([
      { path: "src/app.ts", staged: "none", worktree: "modified", isConflicted: false, added: 2, removed: 1 },
      { path: "src/new.ts", staged: "none", worktree: "untracked", isConflicted: false, added: null, removed: null },
      { path: "src/old.ts", staged: "none", worktree: "deleted", isConflicted: false, added: 0, removed: 1 },
    ]);
    expect(await git.diff("src/app.ts")).toBe([
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,1 @@",
      "-export const greeting = \"hello\";",
      "+export const greeting = \"hi\";",
      "@@ -2,0 +3,1 @@",
      "+export const more = 2;",
      "",
    ].join("\n"));
    expect(await git.lineChanges("src/app.ts")).toEqual([
      { kind: "modified", startLine: 1, lineCount: 1 },
      { kind: "added", startLine: 3, lineCount: 1 },
    ]);
    expect(await git.showFile("HEAD", "src/app.ts")).toBe(REPO_FILES["src/app.ts"]);
    expect((await git.discard(["src/app.ts", "src/new.ts", "src/old.ts"])).ok).toBe(true);
    expect((await git.status()).isClean).toBe(true);
    expect(vfs.existsSync(`${root}/src/new.ts`)).toBe(false);
    expect(vfs.readFileSync(`${root}/src/old.ts`, "utf8")).toBe("export {};\n");
  });

  it("sends every change as one pull request from the commit it was opened at", async () => {
    const api = fakeApi();
    const root = await importRepository(api, projectsHome(), "baker/bakery");
    const git = createGitHubGit({ root, api: () => api, now: () => 1 });
    expect((await git.commit("Nothing yet")).message).toContain("no changes");
    vfs.writeFileSync(`${root}/README.md`, "# Bakery\n\nFresh bread daily.\n");
    vfs.rmSync(`${root}/src/old.ts`);
    const result = await git.commit("Say daily\n\nThe shop opens every day now.");
    expect(result).toEqual({ ok: true, message: "Opened pull request #7 on baker/bakery: https://github.com/baker/bakery/pull/7" });
    expect(api.pulls[0]).toMatchObject({
      repo: "baker/bakery", baseBranch: "trunk", baseCommit: "a".repeat(40), title: "Say daily",
      files: [{ path: "README.md", content: "# Bakery\n\nFresh bread daily.\n" }, { path: "src/old.ts", content: null }],
    });
    expect(api.pulls[0]!.body).toContain("The shop opens every day now.");
    expect(projectMeta(root)!.pullRequests).toEqual([{ url: "https://github.com/baker/bakery/pull/7", number: 7, branch: "adcode/x", title: "Say daily", at: 1 }]);
  });

  it("refuses a pull request past GitHub's limits with a reason, before calling GitHub", async () => {
    const api = fakeApi();
    const root = await importRepository(api, projectsHome(), "baker/bakery");
    const git = createGitHubGit({ root, api: () => api });
    for (let i = 0; i < 51; i += 1) vfs.writeFileSync(`${root}/file-${i}.txt`, "x");
    expect((await git.commit("Too many")).message).toContain("50 files");
    expect(api.pulls).toEqual([]);
  });

  it("says a folder not opened from GitHub has nowhere to send changes", async () => {
    vfs.mkdirSync("/home/adcode/projects/local-only", { recursive: true });
    const git = createGitHubGit({ root: "/home/adcode/projects/local-only", api: () => fakeApi() });
    expect(await git.repoState()).toBe("none");
    expect((await git.commit("x")).ok).toBe(false);
  });

  it("removes a half-made copy when GitHub stops answering, and keeps going past one unreadable file", async () => {
    const home = projectsHome();
    const api = fakeApi({ file: async () => { throw new GitHubError("GitHub's request limit was reached.", "rate-limit", 429); } });
    await expect(importRepository(api, home, "baker/bakery")).rejects.toThrow("request limit");
    expect(vfs.readdirSync(home)).toEqual([]);
  });

  it("connects GitHub with the code flow the page already shows", async () => {
    let polls = 0;
    const ops = createGitHubProjectOps({ projectsHome: projectsHome(), api: fakeApi({ poll: async () => (++polls < 3 ? { state: "pending", retryAfterMs: 5 } : { state: "connected", login: "baker" }) }), sleep: async () => undefined });
    expect(await ops["githubStart"]!()).toEqual({ userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" });
    expect(await ops["githubFinish"]!()).toEqual({ ok: true, login: "baker" });
    expect(polls).toBe(3);
  });

  it("writes a new file's diff whole", () => {
    expect(unifiedDiff({ path: "a.txt", kind: "added", before: null, after: "one\ntwo\n" })).toBe("diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n");
  });
});
