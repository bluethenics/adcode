import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createProjectsStore, readProjectDetails } from "../src/main/projects.ts";

const directories: string[] = [];
async function temporary() { const dir = await mkdtemp(join(tmpdir(), "adcode-projects-")); directories.push(dir); return dir; }
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

it("keeps every known project across restarts and concurrent updates beyond the recent-menu limit", async () => {
  const dir = await temporary(), store = createProjectsStore(dir);
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.remember([{ path: `C:/projects/${i}`, name: `Project ${i}`, openedAt: i }])));
  await store.remember([{ path: "C:/projects/1", name: "Updated", openedAt: 30 }]);
  const restored = await createProjectsStore(dir).list();
  expect(restored).toHaveLength(20);
  expect(restored[0]?.name).toBe("Updated");
});

it("reads real multi-author contributions, branch history and changed files without exposing remote credentials", async () => {
  const dir = await temporary();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, windowsHide: true, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
  git("init", "-b", "main");
  git("config", "user.name", "Alex"); git("config", "user.email", "alex@example.test");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(dir, "notes.txt"), "first\n");
  git("add", "."); git("commit", "-m", "Initial contribution");
  git("checkout", "-b", "feature");
  await writeFile(join(dir, "notes.txt"), "second\n");
  git("add", "."); git("commit", "--author=Sam <sam@example.test>", "-m", "Feature contribution");
  git("checkout", "main");
  await writeFile(join(dir, "untracked.txt"), "pending");
  git("remote", "add", "origin", "https://user:secret@github.com/team/project.git?token=hidden");
  const details = await readProjectDetails(dir);
  expect(details.branch).toBe("main");
  expect(details.changedFiles).toBe(1);
  expect(details.repository).toBe("https://github.com/team/project.git");
  expect(details.contributors.map(c => c.name).sort()).toEqual(["Alex", "Sam"]);
  expect(details.contributors.reduce((n, c) => n + c.commits, 0)).toBe(2);
  expect(details.commitCount).toBe(2);
  expect(details.commits.map(c => c.subject)).toContain("Feature contribution");
  git("commit", "--allow-empty", "-m", "Shared contribution\n\nCo-authored-by: Sam <sam@example.test>");
  const shared = await readProjectDetails(dir);
  expect(shared.commitCount).toBe(3);
  expect(shared.contributors.find(c => c.name === "Sam")?.commits).toBe(2);
});

it("supports a repository before its first commit and explains missing history", async () => {
  const dir = await temporary();
  await expect(readProjectDetails(dir)).rejects.toThrow("Git repository");
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, windowsHide: true });
  const details = await readProjectDetails(dir);
  expect(details.branch).toBe("main");
  expect(details.contributors).toEqual([]);
  expect(details.commits).toEqual([]);
});
