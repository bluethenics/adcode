import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGit, type Git } from "../src/git.ts";
import { nodeGitExec } from "../src/nodeExec.ts";
import type { GitExec } from "../src/types.ts";

/**
 * Who a commit is recorded as - found, explained and fixed without a terminal.
 *
 * Reported by the user: Commit & Push answered "Git needs a name and email" on a machine
 * whose git was "all set up", and VS Code committed fine. His global config said
 * `user.mail` - a typo git ignores - so git had a name and no email, and the advice to run
 * `git config --global user.email` read as an accusation rather than a fix. These tests
 * drive the real git binary; every identity is set in the temporary repository's own config,
 * never the machine's (see git.test.ts for why mutating the environment is not safe here).
 */
const run = promisify(execFile);

let dir: string;
let git: Git;

async function gitRaw(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir });
  return stdout;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-identity-"));
  git = createGit({ exec: nodeGitExec, root: dir });
  await git.init();
  await gitRaw("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Emptied locally, which git treats as unusable whatever the machine's global config says. */
async function withoutEmail(): Promise<void> {
  await gitRaw("config", "--local", "user.email", "");
}

describe("a commit refused for want of an identity", () => {
  it("says so in a way the window can act on", async () => {
    // Both emptied: git accepts an empty email on its own (it commits as "Test <>"), but an
    // empty name is refused on every machine whatever its global config holds.
    await gitRaw("config", "--local", "user.name", "");
    await withoutEmail();
    await writeFile(join(dir, "a.txt"), "x");
    await git.stage(["a.txt"]);

    const result = await git.commit("first");

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("identity");
  });

  it("passes any other failure of the identity check through in git's own words", async () => {
    // The check used to turn every non-zero `git var` into "needs a name and email" - so a
    // broken config file or a git that could not start looked like a missing identity.
    const failingVar: GitExec = {
      run: (args, options) =>
        args[0] === "var"
          ? Promise.resolve({ stdout: "", stderr: "fatal: bad config line 3 in file .git/config", code: 128 })
          : nodeGitExec.run(args, options),
    };
    const broken = createGit({ exec: failingVar, root: dir });
    await gitRaw("config", "--local", "user.name", "Test");
    await gitRaw("config", "--local", "user.email", "test@example.com");
    await writeFile(join(dir, "a.txt"), "x");
    await broken.stage(["a.txt"]);

    const result = await broken.commit("first");

    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.message).toMatch(/bad config line 3/);
  });
});

describe("what git knows about who is committing", () => {
  it("reports a complete identity", async () => {
    await gitRaw("config", "--local", "user.name", "Ann");
    await gitRaw("config", "--local", "user.email", "ann@example.com");

    const identity = await git.identity();

    expect(identity.name).toBe("Ann");
    expect(identity.email).toBe("ann@example.com");
    expect(identity.complete).toBe(true);
  });

  it("finds the email written under user.mail and offers it", async () => {
    await gitRaw("config", "--local", "user.name", "sinan faizal");
    await withoutEmail();
    await gitRaw("config", "--local", "user.mail", "sinan@example.com");

    const identity = await git.identity();

    expect(identity.email).toBeNull();
    expect(identity.complete).toBe(false);
    expect(identity.typo).toEqual({ key: "user.mail", value: "sinan@example.com" });
    expect(identity.suggestedEmails[0]).toBe("sinan@example.com");
  });

  it("offers the email this person's earlier commits here were made with", async () => {
    await gitRaw("config", "--local", "user.name", "Ann");
    await gitRaw("config", "--local", "user.email", "ann@old.example.com");
    await writeFile(join(dir, "a.txt"), "x");
    await gitRaw("add", "a.txt");
    await gitRaw("commit", "-m", "earlier");
    await withoutEmail();

    const identity = await git.identity();

    expect(identity.suggestedEmails).toContain("ann@old.example.com");
    expect(identity.suggestedName).toBe("Ann");
  });
});

describe("setting the identity", () => {
  it("saves it for this project, after which the commit goes through", async () => {
    await withoutEmail();
    await writeFile(join(dir, "a.txt"), "x");
    await git.stage(["a.txt"]);

    const saved = await git.setIdentity("Ann Lee", "ann@example.com", "local");
    expect(saved.ok).toBe(true);
    expect((await gitRaw("config", "--local", "--get", "user.email")).trim()).toBe("ann@example.com");

    const committed = await git.commit("first");
    expect(committed.ok).toBe(true);
    expect((await gitRaw("log", "-1", "--format=%an <%ae>")).trim()).toBe("Ann Lee <ann@example.com>");
  });

  it("saves it for every project with --global", async () => {
    const calls: string[][] = [];
    const recording: GitExec = {
      run: (args) => {
        calls.push([...args]);
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    const saved = await createGit({ exec: recording, root: dir }).setIdentity("Ann", "ann@example.com", "global");

    expect(saved.ok).toBe(true);
    expect(calls).toContainEqual(["config", "--global", "user.name", "Ann"]);
    expect(calls).toContainEqual(["config", "--global", "user.email", "ann@example.com"]);
  });

  it.each([
    ["", "ann@example.com"],
    ["Ann", ""],
    ["Ann", "not-an-email"],
    ["-c core.pager=evil", "ann@example.com"],
    ["Ann", "-ann@example.com"],
    ["Ann\nEvil", "ann@example.com"],
  ])("refuses %j <%j> and writes nothing", async (name, email) => {
    const calls: string[][] = [];
    const recording: GitExec = {
      run: (args) => {
        calls.push([...args]);
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      },
    };

    const saved = await createGit({ exec: recording, root: dir }).setIdentity(name, email, "local");

    expect(saved.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
