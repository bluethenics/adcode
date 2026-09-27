import { describe, expect, it } from "vitest";
import { createGit } from "../src/git.ts";
import type { GitExec, GitExecResult } from "../src/types.ts";

/**
 * A repository on a drive that records no owner (FAT32, exFAT) is refused by git as
 * "dubious ownership" until it is listed in `safe.directory`. Real git cannot be made to
 * refuse on this test machine's own disk, so a scripted runner plays git's exact answers.
 */
const DUBIOUS: GitExecResult = {
  code: 128,
  stdout: "",
  stderr: "fatal: detected dubious ownership in repository at 'E:/sc'\n'E:/sc' is on a file system that does not record ownership\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory E:/sc\n",
};
const NOT_A_REPO: GitExecResult = { code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" };
const INSIDE: GitExecResult = { code: 0, stdout: "true\n", stderr: "" };
const OK: GitExecResult = { code: 0, stdout: "", stderr: "" };

function scripted(state: { repo: "none" | "untrusted" | "repo"; trusted: string[]; initialised: boolean }) {
  const calls: string[] = [];
  const exec: GitExec = {
    async run(args) {
      calls.push(args.join(" "));
      if (args[0] === "rev-parse") {
        if (state.repo === "none") return NOT_A_REPO;
        return state.repo === "untrusted" && !state.trusted.includes("E:/sc") ? DUBIOUS : INSIDE;
      }
      if (args[0] === "init") {
        state.initialised = true;
        // What happens on FAT32: the new repository is refused straight away.
        state.repo = "untrusted";
        return { code: 0, stdout: "Initialized empty Git repository in E:/sc/.git/\n", stderr: "" };
      }
      if (args.join(" ") === "config --global --get-all safe.directory") return { code: 0, stdout: state.trusted.join("\n"), stderr: "" };
      if (args.slice(0, 4).join(" ") === "config --global --add safe.directory") {
        state.trusted.push(args[4]!);
        return OK;
      }
      return OK;
    },
  };
  return { git: createGit({ exec, root: "E:\\sc" }), calls, state };
}

describe("repositories git will not trust", () => {
  it("tells a refused repository apart from no repository", async () => {
    expect(await scripted({ repo: "untrusted", trusted: [], initialised: false }).git.repoState()).toBe("untrusted");
    expect(await scripted({ repo: "none", trusted: [], initialised: false }).git.repoState()).toBe("none");
    expect(await scripted({ repo: "repo", trusted: [], initialised: false }).git.repoState()).toBe("repo");
  });

  it("trusts the folder on request, once, with forward slashes as git writes it", async () => {
    const { git, state } = scripted({ repo: "untrusted", trusted: [], initialised: false });
    expect((await git.trust()).ok).toBe(true);
    expect(state.trusted).toEqual(["E:/sc"]);
    expect(await git.repoState()).toBe("repo");
    await git.trust();
    expect(state.trusted).toEqual(["E:/sc"]);
  });

  it("vouches for a repository it has just created on a drive that records no owner", async () => {
    const { git, state } = scripted({ repo: "none", trusted: [], initialised: false });
    expect((await git.init()).ok).toBe(true);
    expect(state.trusted).toEqual(["E:/sc"]);
    expect(await git.repoState()).toBe("repo");
  });

  it("never vouches for a repository that was already there", async () => {
    const { git, state } = scripted({ repo: "untrusted", trusted: [], initialised: false });
    const result = await git.init();
    expect(result.ok).toBe(false);
    expect(state.initialised).toBe(false);
    expect(state.trusted).toEqual([]);
  });
});
