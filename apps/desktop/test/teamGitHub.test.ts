import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { teamGitHubReadiness, teamGitHubRemotePlan, type TeamGitHubDeps } from "../src/main/teamGitHub.ts";
import { githubRemoteFromInput, githubRepositoryName } from "../src/shared/githubRepository.ts";

const deps = (over: Partial<TeamGitHubDeps>): TeamGitHubDeps => ({
  root: "E:\\site-demo",
  repoState: async () => "repo",
  remotes: async () => [],
  gitInstalled: async () => true,
  ...over,
});

describe("Team: is the open project ready to share", () => {
  it("names the missing step instead of one sentence for every reason", async () => {
    expect((await teamGitHubReadiness(deps({ root: null }))).state).toBe("no-folder");
    const notRepo = await teamGitHubReadiness(deps({ repoState: async () => "none" }));
    expect(notRepo).toMatchObject({ state: "not-repo", folder: "site-demo" });
    expect(notRepo.message).toContain("Start tracking");
    expect((await teamGitHubReadiness(deps({ repoState: async () => "none", gitInstalled: async () => false }))).message).toContain("git-scm.com");
    expect((await teamGitHubReadiness(deps({ repoState: async () => "untrusted" }))).message).toContain("Trust this folder");
    expect((await teamGitHubReadiness(deps({}))).state).toBe("no-remote");
    const other = await teamGitHubReadiness(deps({ remotes: async () => [{ name: "origin", url: "https://token@gitlab.com/me/site.git" }] }));
    expect(other).toMatchObject({ state: "other-remote", remotes: ["origin"] });
    expect(other.message).toContain("gitlab.com");
    expect(other.message).not.toContain("token");
  });

  it("reads every github.com remote Source Control reads", async () => {
    for (const url of ["https://github.com/Owner/Repo.git", "git@github.com:owner/repo.git", "ssh://git@github.com/owner/repo.git", "https://owner@github.com/owner/repo", "https://GitHub.com/owner/repo/"]) {
      expect(githubRepositoryName(url), url).toBe("owner/repo");
      const ready = await teamGitHubReadiness(deps({ remotes: async () => [{ name: "upstream", url }] }));
      expect(ready).toMatchObject({ state: "ready", repository: "owner/repo", remote: "upstream" });
    }
  });
});

describe("Team: connecting a pasted GitHub address", () => {
  it("accepts what people copy from GitHub and the address bar", () => {
    expect(githubRemoteFromInput("https://github.com/me/site.git")).toBe("https://github.com/me/site.git");
    expect(githubRemoteFromInput("github.com/me/site")).toBe("https://github.com/me/site.git");
    expect(githubRemoteFromInput("https://www.github.com/me/site/tree/main/src")).toBe("https://github.com/me/site.git");
    expect(githubRemoteFromInput("git@github.com:me/site.git")).toBe("git@github.com:me/site.git");
    for (const bad of ["https://gitlab.com/me/site", "https://github.com/me", "https://github.com.evil.test/me/site", "me/site", ""]) expect(githubRemoteFromInput(bad), bad).toBeNull();
  });

  it("never replaces an existing remote", () => {
    expect(teamGitHubRemotePlan("github.com/me/site", [])).toEqual({ ok: true, name: "origin", url: "https://github.com/me/site.git" });
    expect(teamGitHubRemotePlan("github.com/me/site", [{ name: "origin", url: "https://gitlab.com/me/site" }])).toMatchObject({ ok: true, name: "github" });
    const refused = teamGitHubRemotePlan("https://gitlab.com/me/site", []);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("green Code button");
  });
});

it("walks the Team card from a plain folder to a shared project, with errors on screen", () => {
  const env = { ...process.env }; delete env["ELECTRON_RUN_AS_NODE"];
  const run = spawnSync(createRequire(import.meta.url)("electron") as string, [fileURLToPath(new URL("./fixtures/teamConnectGitHub.cjs", import.meta.url))], { env, encoding: "utf8", timeout: 110_000, windowsHide: true });
  expect(run.status, run.stdout + run.stderr || String(run.error)).toBe(0);
}, 120_000);
