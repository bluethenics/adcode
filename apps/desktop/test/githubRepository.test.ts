import { describe, expect, it } from "vitest";
import { githubRepositoryUrl } from "../src/shared/githubRepository.ts";

describe("GitHub repository destinations", () => {
  it("normalizes HTTPS and SSH remotes without carrying credentials", () => {
    for (const remote of ["https://github.com/owner/repo.git", "git@github.com:owner/repo.git", "ssh://git@github.com/owner/repo.git", "https://token@github.com/owner/repo.git"]) {
      expect(githubRepositoryUrl(remote, "pulls")).toBe("https://github.com/owner/repo/pulls");
    }
  });
  it("rejects other hosts, unsafe paths and unknown destinations", () => {
    for (const remote of ["https://github.com.evil.test/a/b", "file:///a/b", "https://github.com/a/../b", "https://github.com/a/b/extra", "https://github.com/a/%2e%2e", "https://gitlab.com/a/b"]) {
      expect(githubRepositoryUrl(remote, "code")).toBeNull();
    }
    expect(githubRepositoryUrl("https://github.com/a/b", "../../settings")).toBeNull();
    expect(githubRepositoryUrl("https://github.com/a/b", "toString")).toBeNull();
  });
  it("opens new pull requests and issues on their repository", () => {
    expect(githubRepositoryUrl("git@github.com:a/b.git", "new-pull-request")).toBe("https://github.com/a/b/compare?expand=1");
    expect(githubRepositoryUrl("git@github.com:a/b.git", "new-issue")).toBe("https://github.com/a/b/issues/new/choose");
  });
});
