import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGit, type Git } from "../src/git.ts";
import { nodeGitExec } from "../src/nodeExec.ts";

/**
 * Run against real repositories on disk, driving the real `git` binary.
 *
 * Porcelain v2 is a machine-readable format, but "machine-readable" and "parsed
 * correctly" are different claims, and the gap between them is where a source-control UI
 * silently shows the wrong thing. A fake that returns the output I expect would only
 * test that I can parse my own assumptions.
 */
const run = promisify(execFile);

let dir: string;
let git: Git;

async function gitRaw(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir });
  return stdout;
}

/** Read a working-tree file with newlines normalised, so assertions are platform-neutral. */
async function readBack(path: string): Promise<string> {
  const text = await readFile(join(dir, path), "utf8");
  return text.replace(/\r\n/g, "\n");
}

async function write(path: string, contents: string): Promise<void> {
  const full = join(dir, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-git-"));
  git = createGit({ exec: nodeGitExec, root: dir });

  await git.init();
  await gitRaw("config", "user.email", "test@example.com");
  await gitRaw("config", "user.name", "Test");
  await gitRaw("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("init and repo detection", () => {
  it("reports a fresh repository", async () => {
    expect(await git.isRepo()).toBe(true);
  });

  it("reports a plain directory as not a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "adcode-plain-"));
    try {
      const notARepo = createGit({ exec: nodeGitExec, root: plain });
      expect(await notARepo.isRepo()).toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("status", () => {
  it("is clean on an empty repository", async () => {
    const status = await git.status();
    expect(status.isClean).toBe(true);
    expect(status.entries).toEqual([]);
  });

  it("sees an untracked file", async () => {
    await write("a.txt", "hello");
    const status = await git.status();

    expect(status.isClean).toBe(false);
    const entry = status.entries.find((e) => e.path === "a.txt");
    expect(entry?.worktree).toBe("untracked");
  });

  it("distinguishes staged from unstaged changes", async () => {
    await write("a.txt", "one");
    await git.stage(["a.txt"]);
    await git.commit("first");

    await write("a.txt", "two");
    await git.stage(["a.txt"]);
    await write("a.txt", "three");

    const entry = (await git.status()).entries.find((e) => e.path === "a.txt");
    expect(entry?.staged).toBe("modified");
    expect(entry?.worktree).toBe("modified");
  });

  it("sees a deletion", async () => {
    await write("a.txt", "one");
    await git.stage(["a.txt"]);
    await git.commit("first");
    await rm(join(dir, "a.txt"));

    const entry = (await git.status()).entries.find((e) => e.path === "a.txt");
    expect(entry?.worktree).toBe("deleted");
  });

  it("handles a path with a space in it", async () => {
    // Porcelain v2 with -z exists precisely so this does not break the parser.
    await write("a file.txt", "x");
    const status = await git.status();

    expect(status.entries.some((e) => e.path === "a file.txt")).toBe(true);
  });

  it("reports the current branch", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);
    await git.commit("first");

    const status = await git.status();
    expect(status.branch).not.toBeNull();
  });
});

describe("staging", () => {
  it("stages and unstages a file", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    expect((await git.status()).entries[0]?.staged).toBe("added");

    await git.unstage(["a.txt"]);
    expect((await git.status()).entries[0]?.worktree).toBe("untracked");
  });

  it("stages everything at once", async () => {
    await write("a.txt", "x");
    await write("b.txt", "y");
    await git.stageAll();

    const status = await git.status();
    expect(status.entries.every((e) => e.staged !== "none")).toBe(true);
  });

  it("refuses a path that looks like an option", async () => {
    const result = await git.stage(["--exec=touch pwned"]);
    expect(result.ok).toBe(false);
  });
});

describe("commit", () => {
  it("commits staged changes", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    const result = await git.commit("add a");
    expect(result.ok).toBe(true);
    expect((await git.status()).isClean).toBe(true);
  });

  it("refuses an empty message rather than producing a blank commit", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    expect((await git.commit("   ")).ok).toBe(false);
  });

  it("reports failure when there is nothing staged", async () => {
    expect((await git.commit("nothing")).ok).toBe(false);
  });

  /*
   * The message, not just the outcome.
   *
   * The test above passed while this was badly broken, which is the whole lesson: it asserted
   * that the commit failed and never looked at what the user was told. What they were told was
   * `Command failed: git commit -m ood` - Node's own string, because `git commit` writes its
   * explanation to **stdout** and leaves stderr empty, and `nodeExec` used to substitute
   * `error.message` whenever stderr was blank. Callers prefer stderr, so git's real words were
   * then discarded in favour of a sentence that says only that something went wrong.
   */
  it("says what to do about nothing being staged, in words a person can act on", async () => {
    await write("a.txt", "x");

    const result = await git.commit("ood");

    expect(result.ok).toBe(false);
    // Never Node's construction.
    expect(result.message).not.toMatch(/Command failed/i);
    // And never git's three paragraphs of branch, unstaged files and untracked files.
    expect(result.message).not.toMatch(/Untracked files/i);
    expect(result.message).toMatch(/staged/i);
  });

  it("says the same thing before the first commit exists", async () => {
    // A repository with no HEAD is exactly where a beginner making their first commit is, and
    // it is the case a `--quiet` check against HEAD would fail outright on.
    await write("a.txt", "x");

    const result = await git.commit("first");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/staged/i);
    expect(result.message).not.toMatch(/Command failed/i);
  });

  it("still commits normally once something is staged", async () => {
    // The guard must not have made committing harder, only its failure legible.
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    expect((await git.commit("real commit")).ok).toBe(true);
  });

  it("explains a missing git identity without telling a GUI user to read the manual", async () => {
    /*
     * The first-commit wall. A machine that has never run git has no `user.name` or
     * `user.email`, and git's own refusal is four paragraphs ending in two `git config`
     * commands - sound advice at a prompt, close to useless in a window.
     *
     * `user.useConfigOnly` reproduces the state without depending on what the machine running
     * this suite happens to have configured globally, which is the only way this test means the
     * same thing on a developer's laptop and in CI.
     */
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    /*
     * The identity is emptied in this repository's own config, and nowhere else.
     *
     * An empty `user.email` is not the same as an unset one: git treats it as an identity it
     * cannot use and refuses exactly as it does on a machine that has never been configured,
     * which is the state being reproduced. Unsetting instead would fall through to whoever runs
     * this suite having a global identity, and the commit would succeed.
     *
     * An earlier version pointed `GIT_CONFIG_GLOBAL` at a nonexistent file by mutating
     * `process.env`. That worked and was a bad idea: Vitest reuses a worker across test files,
     * so a global mutation is visible to whatever else is running in that process, and the
     * suite failed once, intermittently, in a way that had nothing to do with the code under
     * test. Local config touches nothing outside this temporary repository.
     */
    await gitRaw("config", "--local", "user.email", "");
    await gitRaw("config", "--local", "user.name", "");

    const result = await git.commit("first");

    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/Command failed/i);
    expect(result.message).toMatch(/name and email/i);
    // Names the terminal, because this application ships one - the advice has to be followable
    // from inside the app that gives it.
    expect(result.message).toMatch(/terminal/i);
  });
});

describe("how git's failures are reported", () => {
  it("passes git's own words through when git writes to stderr", async () => {
    // The other half of the `nodeExec` change: suppressing Node's message must not suppress
    // git's. A bad ref is refused by git on stderr, and that sentence is the useful one.
    const result = await git.checkout("no-such-branch-anywhere");

    expect(result.ok).toBe(false);
    expect(result.message).not.toMatch(/Command failed/i);
    expect(result.message).toMatch(/no-such-branch-anywhere|did not match|invalid reference/i);
  });

  it("still explains itself when git cannot be run at all", async () => {
    /*
     * The case `error.message` genuinely is the only information.
     *
     * When the binary is missing there is no stdout and no stderr to prefer, so the fallback
     * has to survive - suppressing it unconditionally would turn "git is not installed" into
     * an empty error message, which is worse than the bug being fixed.
     */
    const missing = createGit({ exec: nodeGitExec, root: dir });
    const originalPath = process.env["PATH"];

    try {
      process.env["PATH"] = join(dir, "definitely-not-a-real-directory");
      const result = await missing.commit("anything");

      expect(result.ok).toBe(false);
      expect(result.message.trim().length).toBeGreaterThan(0);
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("keeps a multi-line message intact", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);
    await git.commit("subject line\n\nbody paragraph explaining why");

    const log = await git.log(1);
    expect(log[0]?.subject).toBe("subject line");
  });

  it("does not interpret a message beginning with a dash as an option", async () => {
    // `-m` takes the message as a separate argument, so this is safe - but only if the
    // message is passed as its own array element, which is the thing being checked.
    await write("a.txt", "x");
    await git.stage(["a.txt"]);

    const result = await git.commit("--amend is not what I meant");
    expect(result.ok).toBe(true);
    expect((await git.log(1))[0]?.subject).toBe("--amend is not what I meant");
  });
});

describe("branches", () => {
  beforeEach(async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);
    await git.commit("first");
  });

  it("lists the current branch and marks it", async () => {
    const branches = await git.branches();
    expect(branches.some((b) => b.current)).toBe(true);
  });

  it("creates and switches to a branch", async () => {
    expect((await git.createBranch("feature/x")).ok).toBe(true);

    const branches = await git.branches();
    expect(branches.find((b) => b.name === "feature/x")?.current).toBe(true);
  });

  it("switches back to an existing branch", async () => {
    const original = (await git.status()).branch;
    await git.createBranch("other");

    expect((await git.checkout(original ?? "main")).ok).toBe(true);
    expect((await git.status()).branch).toBe(original);
  });

  it("refuses a branch name that would be read as an option", async () => {
    const result = await git.createBranch("--exec=touch pwned");
    expect(result.ok).toBe(false);

    // And nothing was created.
    expect((await git.branches()).some((b) => b.name.includes("exec"))).toBe(false);
  });

  it("refuses a branch name containing a shell metacharacter", async () => {
    expect((await git.createBranch("a;rm -rf /")).ok).toBe(false);
  });
});

describe("diff", () => {
  it("returns a unified diff for a changed file", async () => {
    await write("a.txt", "one\n");
    await git.stage(["a.txt"]);
    await git.commit("first");
    await write("a.txt", "two\n");

    const diff = await git.diff("a.txt");
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });

  it("returns per-line change ranges for gutter decorations", async () => {
    // §4: gutter diff decorations. The UI needs line ranges, not a text diff.
    await write("a.txt", "one\ntwo\nthree\n");
    await git.stage(["a.txt"]);
    await git.commit("first");
    await write("a.txt", "one\nCHANGED\nthree\nfour\n");

    const changes = await git.lineChanges("a.txt");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.kind === "modified" || c.kind === "added")).toBe(true);
  });

  it("returns nothing for an unchanged file", async () => {
    await write("a.txt", "one\n");
    await git.stage(["a.txt"]);
    await git.commit("first");

    expect(await git.lineChanges("a.txt")).toEqual([]);
  });
});

describe("log and file timeline", () => {
  beforeEach(async () => {
    await write("a.txt", "one");
    await git.stage(["a.txt"]);
    await git.commit("first commit");

    await write("a.txt", "two");
    await write("b.txt", "other");
    await git.stageAll();
    await git.commit("second commit");
  });

  it("lists commits newest first", async () => {
    const log = await git.log(10);
    expect(log).toHaveLength(2);
    expect(log[0]?.subject).toBe("second commit");
  });

  it("gives each commit an author and a date", async () => {
    const log = await git.log(1);
    expect(log[0]?.author).toBe("Test");
    expect(log[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("returns the history of one file", async () => {
    // §4's file timeline.
    const history = await git.fileHistory("b.txt");
    expect(history).toHaveLength(1);
    expect(history[0]?.subject).toBe("second commit");
  });

  it("refuses a path that looks like an option", async () => {
    expect(await git.fileHistory("--all")).toEqual([]);
  });
});

describe("blame", () => {
  it("attributes each line to a commit and author", async () => {
    await write("a.txt", "one\ntwo\n");
    await git.stage(["a.txt"]);
    await git.commit("first");

    const blame = await git.blame("a.txt");
    expect(blame).toHaveLength(2);
    expect(blame[0]?.author).toBe("Test");
    expect(blame[0]?.summary).toBe("first");
  });

  it("returns nothing for a path outside the repository", async () => {
    expect(await git.blame("../escape.txt")).toEqual([]);
  });
});

describe("showFile", () => {
  it("returns the file as it was at a commit", async () => {
    await write("a.txt", "first version\n");
    await git.stage(["a.txt"]);
    await git.commit("first");

    const [commit] = await git.log(1);
    await write("a.txt", "second version\n");

    expect(await git.showFile(commit!.hash, "a.txt")).toBe("first version\n");
  });

  it("returns null when the file did not exist at that commit", async () => {
    await write("a.txt", "one\n");
    await git.stage(["a.txt"]);
    await git.commit("first");

    const [commit] = await git.log(1);
    expect(await git.showFile(commit!.hash, "never-existed.txt")).toBeNull();
  });

  it("refuses a ref that would be read as an option", async () => {
    expect(await git.showFile("--output=/tmp/x", "a.txt")).toBeNull();
  });

  it("refuses a path outside the repository", async () => {
    expect(await git.showFile("HEAD", "../escape.txt")).toBeNull();
  });
});

describe("remotes", () => {
  it("reports no remote on a fresh repository", async () => {
    expect(await git.remotes()).toEqual([]);
  });

  it("lists a configured remote", async () => {
    await gitRaw("remote", "add", "origin", "https://example.test/repo.git");
    const remotes = await git.remotes();

    expect(remotes[0]?.name).toBe("origin");
    expect(remotes[0]?.url).toContain("example.test");
  });

  it("reports a push with no remote as a failure rather than throwing", async () => {
    const result = await git.push();
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("reports a pull with no remote as a failure rather than throwing", async () => {
    expect((await git.pull()).ok).toBe(false);
  });

  it("sets the upstream on the first push to a single remote", async () => {
    /*
     * The Push button doing what it says on a branch that has never been pushed.
     *
     * Plain `git push` refuses this with advice to run `git push --set-upstream origin main` -
     * correct at a prompt, unusable in a window that has a Push button and no command line.
     * A bare repository stands in for the server so this stays offline.
     */
    const server = await mkdtemp(join(tmpdir(), "adcode-remote-"));
    try {
      await run("git", ["init", "--bare", "-q", server]);

      await write("a.txt", "x");
      await git.stage(["a.txt"]);
      await git.commit("first");
      await gitRaw("remote", "add", "origin", server);

      expect((await git.status()).upstream).toBeNull();

      const result = await git.push();

      expect(result.ok).toBe(true);
      expect(result.message).toMatch(/upstream/i);
      // The branch now tracks, so every later push is an ordinary one.
      expect((await git.status()).upstream).not.toBeNull();
      expect((await git.push()).ok).toBe(true);
    } finally {
      await rm(server, { recursive: true, force: true });
    }
  });

  it("leaves the choice to git when two remotes make it ambiguous", async () => {
    /*
     * Two remotes and no upstream is a real decision, and guessing would push someone's work
     * somewhere they did not choose. Note there is no `origin` here - with one present it is the
     * unambiguous answer whatever else exists alongside it.
     */
    const first = await mkdtemp(join(tmpdir(), "adcode-remote-a-"));
    const second = await mkdtemp(join(tmpdir(), "adcode-remote-b-"));

    try {
      await run("git", ["init", "--bare", "-q", first]);
      await run("git", ["init", "--bare", "-q", second]);

      await write("a.txt", "x");
      await git.stage(["a.txt"]);
      await git.commit("first");
      await gitRaw("remote", "add", "alpha", first);
      await gitRaw("remote", "add", "beta", second);

      const result = await git.push();

      // Refused, and nothing was pushed to either.
      expect(result.ok).toBe(false);
      expect((await git.status()).upstream).toBeNull();
    } finally {
      await rm(first, { recursive: true, force: true });
      await rm(second, { recursive: true, force: true });
    }
  });
});

describe("clone", () => {
  it("clones a local repository", async () => {
    await write("a.txt", "x");
    await git.stage(["a.txt"]);
    await git.commit("first");

    const target = await mkdtemp(join(tmpdir(), "adcode-clone-"));
    try {
      // `cloneLocalPath` is a separate entry point on purpose: `file://` URLs are
      // refused by the URL validator, and "open a repo from disk" is a different
      // operation from "clone this URL someone pasted".
      const result = await git.cloneLocalPath(dir, join(target, "copy"));
      expect(result.ok).toBe(true);

      expect(await readFile(join(target, "copy", "a.txt"), "utf8")).toBe("x");
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it("refuses an ext:: URL", async () => {
    const target = await mkdtemp(join(tmpdir(), "adcode-clone-"));
    try {
      const result = await git.clone("ext::sh -c 'touch pwned'", join(target, "x"));
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not a supported/i);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });

  it("refuses a URL that would be parsed as an option", async () => {
    const target = await mkdtemp(join(tmpdir(), "adcode-clone-"));
    try {
      expect((await git.clone("--upload-pack=touch pwned", join(target, "x"))).ok).toBe(false);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe("failure handling", () => {
  it("returns a result rather than throwing when git fails", async () => {
    // §9's shape applied to source control: a failed git command is information the UI
    // shows, not an exception that takes the window down.
    const result = await git.checkout("no-such-branch");
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("survives being pointed at a directory that does not exist", async () => {
    const missing = createGit({ exec: nodeGitExec, root: join(dir, "nope") });
    await expect(missing.isRepo()).resolves.toBe(false);
  });
});

/**
 * The commit browser (§4's Git group, GitHub-shaped).
 *
 * These are the operations behind "click a past commit, see what it touched, put one of
 * those files back". Restoring is deliberately the *safe* half of that idea: the file
 * lands in the working tree as an uncommitted edit, and nothing already committed is
 * rewritten - so a mistaken restore is undone by discarding it, not by a reflog rescue.
 */
describe("commit detail and restore", () => {
  beforeEach(async () => {
    await write("keep.txt", "original\n");
    await write("gone.txt", "doomed\n");
    await git.stageAll();
    await git.commit("first commit");

    await write("keep.txt", "changed\n");
    await write("added.txt", "new file\n");
    await rm(join(dir, "gone.txt"));
    await git.stageAll();
    await git.commit("second commit\n\nA body that explains the change.\n");
  });

  it("returns the full message, not just the subject", async () => {
    const [head] = await git.log(1);
    const detail = await git.commitDetail(head!.hash);

    expect(detail?.subject).toBe("second commit");
    expect(detail?.body).toContain("A body that explains the change.");
  });

  it("lists the files a commit touched, with how each changed", async () => {
    const [head] = await git.log(1);
    const detail = await git.commitDetail(head!.hash);

    const byPath = Object.fromEntries((detail?.files ?? []).map((f) => [f.path, f.kind]));
    expect(byPath).toEqual({
      "keep.txt": "modified",
      "added.txt": "added",
      "gone.txt": "deleted",
    });
  });

  it("counts the lines added and removed per file", async () => {
    const [head] = await git.log(1);
    const detail = await git.commitDetail(head!.hash);

    const keep = detail?.files.find((f) => f.path === "keep.txt");
    expect(keep?.added).toBe(1);
    expect(keep?.removed).toBe(1);
  });

  it("describes the very first commit, which has no parent", async () => {
    // `git show` against a root commit has nothing to diff against; a browser that
    // cannot open the first commit in a repository is broken for every new project.
    const log = await git.log(10);
    const first = log.at(-1);
    const detail = await git.commitDetail(first!.hash);

    expect(detail?.subject).toBe("first commit");
    expect(detail?.files.map((f) => f.path).sort()).toEqual(["gone.txt", "keep.txt"]);
  });

  it("returns null for a hash that is not a commit", async () => {
    expect(await git.commitDetail("0000000000000000000000000000000000000000")).toBeNull();
  });

  it("refuses a ref that would be read as an option", async () => {
    expect(await git.commitDetail("--all")).toBeNull();
  });

  it("restores a file to how it was at a commit", async () => {
    const log = await git.log(10);
    const first = log.at(-1);

    const result = await git.restoreFile(first!.hash, "keep.txt");
    expect(result.ok).toBe(true);
    // Normalised because git's `core.autocrlf` rewrites newlines on checkout under
    // Windows. What is being asserted is that the old contents came back, not which
    // newline the platform prefers.
    expect(await readBack("keep.txt")).toBe("original\n");
  });

  it("brings back a file the commit had deleted", async () => {
    const log = await git.log(10);
    const first = log.at(-1);

    const result = await git.restoreFile(first!.hash, "gone.txt");
    expect(result.ok).toBe(true);
    expect(await readBack("gone.txt")).toBe("doomed\n");
  });

  it("leaves the restored file as an uncommitted change rather than rewriting history", async () => {
    const log = await git.log(10);
    const before = log.length;
    await git.restoreFile(log.at(-1)!.hash, "keep.txt");

    const status = await git.status();
    expect(status.isClean).toBe(false);
    // History is untouched: the restore is a working-tree edit awaiting review.
    expect((await git.log(10)).length).toBe(before);
  });

  it("refuses a path that would be read as an option", async () => {
    const [head] = await git.log(1);
    expect((await git.restoreFile(head!.hash, "--force")).ok).toBe(false);
  });

  it("refuses a ref that would be read as an option", async () => {
    expect((await git.restoreFile("--exec=evil", "keep.txt")).ok).toBe(false);
  });

  it("reports a failure rather than throwing when the file is not in that commit", async () => {
    const [head] = await git.log(1);
    const result = await git.restoreFile(head!.hash, "never-existed.txt");
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("returns the diff of one file within one commit", async () => {
    const [head] = await git.log(1);
    const diff = await git.commitFileDiff(head!.hash, "keep.txt");

    expect(diff).toContain("-original");
    expect(diff).toContain("+changed");
  });

  it("returns the diff of a file added by the first commit", async () => {
    const log = await git.log(10);
    const diff = await git.commitFileDiff(log.at(-1)!.hash, "keep.txt");
    expect(diff).toContain("+original");
  });

  it("refuses unsafe arguments to the diff", async () => {
    const [head] = await git.log(1);
    expect(await git.commitFileDiff(head!.hash, "--output=/tmp/x")).toBe("");
    expect(await git.commitFileDiff("--all", "keep.txt")).toBe("");
  });
});
