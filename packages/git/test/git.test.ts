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
