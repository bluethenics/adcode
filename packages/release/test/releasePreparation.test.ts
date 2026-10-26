import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { changelogSection, latestPublishedStableRelease, nextReleaseVersion, releaseChanges } from "../src/releasePreparation.ts";

const script = resolve(import.meta.dirname, "../../../scripts/prepare-release.mjs");
const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function checkout(version = "1.2.3") {
  const base = await mkdtemp(join(tmpdir(), "adcode-release-prepare-")); temporary.push(base);
  const root = join(base, "source"), origin = join(base, "origin.git");
  await mkdir(join(root, "apps/desktop"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "adcode", version }, null, 2) + "\n");
  await writeFile(join(root, "apps/desktop/package.json"), JSON.stringify({ name: "@adcode/desktop", version }, null, 2) + "\n");
  await writeFile(join(root, "package-lock.json"), JSON.stringify({ version, packages: { "": { version }, "node_modules/example": { version } } }, null, 2) + "\n");
  await writeFile(join(root, "CHANGELOG.md"), `# Changelog\n\n## ${version} — 2026-10-25\n\n- Previous improvement.\n`);
  git("init"); git("config", "user.name", "Release Test"); git("config", "user.email", "release@example.test");
  git("add", "."); git("commit", "-m", "chore: initial fixture"); git("tag", `v${version}`);
  await writeFile(join(root, "improvement.txt"), "fixed\n"); git("add", "."); git("commit", "-m", "fix: protect unsaved work");
  git("init", "--bare", origin); git("remote", "add", "origin", origin); git("push", "origin", "HEAD", "--tags");
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 30_000 });
  return { root, git, run };
}

describe("daily desktop release preparation", () => {
  it("uses a fresh patch for each release, even when several are prepared on the same day", () => {
    expect(nextReleaseVersion("2.4.0", ["v2.4.0"])).toBe("2.4.1");
    expect(nextReleaseVersion("2.4.1", ["v2.4.0", "v2.4.1"])).toBe("2.4.2");
    expect(nextReleaseVersion("2.4.1", [], "2.5.0")).toBe("2.5.0");
    expect(() => nextReleaseVersion("2.4.0", ["v2.4.1"], "2.4.1")).toThrow();
    expect(() => nextReleaseVersion("2.4.0", [], "2.4.0")).toThrow();
    expect(() => nextReleaseVersion("2.4.0", [], "02.4.1")).toThrow();
    expect(() => nextReleaseVersion("2.4.0", [], "2.4.1-beta")).toThrow();
  });

  it("extracts only the selected changelog version and meaningful deduplicated changes", () => {
    expect(releaseChanges(["fix: save drafts", "fix: save drafts", "chore: prepare release", "feat(ui): show updates"])).toEqual(["- Save drafts.", "- Show updates."]);
    expect(changelogSection("# Changes\n\n## 2.4.1 — today\n\n- New.\n\n## 2.4.0 — before\n\n- Old.", "2.4.1")).toBe("## 2.4.1 — today\n\n- New.");
    expect(() => changelogSection("## 2.4.10\n- Different.", "2.4.1")).toThrow();
  });

  it("uses only published stable releases as the shipped change boundary", () => {
    const published = { tagName: "v2.4.0", isDraft: false, isPrerelease: false, publishedAt: "2026-10-21T06:10:22Z" };
    expect(latestPublishedStableRelease([
      published,
      { ...published, tagName: "v2.4.1", isDraft: true },
      { ...published, tagName: "v2.5.0", isPrerelease: true },
      { ...published, tagName: "v2.6.0", publishedAt: null },
      { ...published, tagName: "v2.7.0", publishedAt: "invalid" },
      { ...published, tagName: "ci-adcode-2.8.0-123" },
    ])).toBe("v2.4.0");
    expect(latestPublishedStableRelease([])).toBeNull();
    expect(latestPublishedStableRelease([published, { ...published, tagName: "2.4.2" }])).toBe("2.4.2");
  });

  it("keeps unpublished improvements after a failed tagged build when preparing the next version", async () => {
    const { root, git } = await checkout("2.4.0");
    for (const path of ["package.json", "apps/desktop/package.json"]) {
      const pkg = JSON.parse(await readFile(join(root, path), "utf8"));
      pkg.version = "2.4.1";
      await writeFile(join(root, path), JSON.stringify(pkg, null, 2) + "\n");
    }
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    lock.version = lock.packages[""].version = "2.4.1";
    await writeFile(join(root, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    git("add", "."); git("commit", "-m", "chore: prepare failed candidate"); git("tag", "v2.4.1");
    await writeFile(join(root, "installer.txt"), "fixed\n");
    git("add", "."); git("commit", "-m", "fix: correct Windows updater launch"); git("push", "origin", "HEAD", "--tags");
    // Only external GitHub metadata is replaced. Tag/ancestry checks and the
    // generated changelog run against an actual local repository and remote.
    const preload = join(root, "..", "github-release-metadata.mjs");
    await writeFile(preload, `import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const execute = child.execFileSync;
child.execFileSync = (command, args, options) => {
  if (command === 'gh') return JSON.stringify([{tagName:'v2.4.0',isDraft:false,isPrerelease:false,publishedAt:'2026-10-21T06:10:22Z'}]);
  if (command === 'git' && args.join(' ') === 'remote get-url origin') return 'https://github.com/example/adcode.git';
  return execute(command, args, options);
};
syncBuiltinESMExports();
`);
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(preload).href, script, "--dry-run"], { cwd: root, encoding: "utf8", timeout: 30_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("2.4.1 → 2.4.2");
    expect(result.stdout).toContain("Base: v2.4.0 (published stable release)");
    expect(result.stdout).toContain("- Protect unsaved work.");
    expect(result.stdout).toContain("- Correct Windows updater launch.");
    expect(git("status", "--porcelain")).toBe("");
    expect(git("tag", "--list")).toBe("v2.4.0\nv2.4.1");
  });

  it("previews without changing files, tags, or working state", async () => {
    const { root, git, run } = await checkout();
    const before = await readFile(join(root, "package.json"), "utf8");
    const result = run("--dry-run", "--offline");
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain("1.2.3 → 1.2.4");
    expect(result.stdout).toContain("tag-based preview; published release status unverified");
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before);
    expect(git("status", "--porcelain")).toBe(""); expect(git("tag", "--list")).toBe("v1.2.3");
  });

  it("writes consistent package and lock metadata without changing dependency versions or publishing", async () => {
    const { root, git, run } = await checkout(); const head = git("rev-parse", "HEAD");
    const result = run("--write"); expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8")).version).toBe("1.2.4");
    expect(JSON.parse(await readFile(join(root, "apps/desktop/package.json"), "utf8")).version).toBe("1.2.4");
    const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
    expect(lock.version).toBe("1.2.4"); expect(lock.packages[""].version).toBe("1.2.4"); expect(lock.packages["node_modules/example"].version).toBe("1.2.3");
    expect(await readFile(join(root, "CHANGELOG.md"), "utf8")).toMatch(/## 1\.2\.4 — \d{4}-\d{2}-\d{2}\n\n- Protect unsaved work\./);
    expect(git("rev-parse", "HEAD")).toBe(head); expect(git("tag", "--list")).toBe("v1.2.3");
    expect(git("ls-remote", "--tags", "origin")).not.toContain("v1.2.4");
  });

  it("refuses dirty, stale and mismatched checkouts before changing any release file", async () => {
    const { root, git, run } = await checkout(); const before = await readFile(join(root, "package.json"), "utf8");
    await writeFile(join(root, "uncommitted.txt"), "keep this\n");
    expect(run("--write").stderr).toContain("uncommitted changes");
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before);
    git("add", "."); git("commit", "-m", "fix: another change");
    git("tag", "v1.2.4");
    expect(run("--write").stderr).toContain("Update your checkout");
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before);
  });

  it("refuses a release branch missing the latest tagged source and conflicting action flags", async () => {
    const { git, run } = await checkout();
    git("tag", "-f", "v1.2.3", "HEAD"); git("push", "--force", "origin", "v1.2.3"); git("checkout", "--detach", "HEAD~1");
    expect(run("--write").stderr).toContain("does not contain v1.2.3");
    expect(run("--dry-run", "--write").status).toBe(1);
    expect(run("--write", "--offline").status).toBe(1);
  });

  it("refuses a locally moved release tag even when its name matches origin", async () => {
    const { git, run } = await checkout();
    git("tag", "-f", "v1.2.3", "HEAD");
    expect(run("--write").stderr).toContain("Local tag v1.2.3 disagrees with origin");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("checks annotated release tags against their peeled source commit", async () => {
    const { git, run } = await checkout();
    git("tag", "-f", "-a", "v1.2.3", "HEAD~1", "-m", "Fixture release");
    git("push", "--force", "origin", "v1.2.3");
    const result = run("--dry-run");
    expect(result.status, result.stderr).toBe(0);
  });
});
