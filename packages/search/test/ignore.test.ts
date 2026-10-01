import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDirectoryFilter } from "../src/ignore.ts";

/**
 * Real files on disk, as in `textSearch.test.ts`: what is under test is how a `.gitignore`
 * and a `.git` directory are found and read, and a fake filesystem would only repeat my
 * assumptions about that back to me.
 */
let dir: string;

async function write(path: string, contents: string): Promise<void> {
  const full = join(dir, path);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, contents, "utf8");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-ignore-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the fixed floor", () => {
  it("skips the usual build and dependency folders with no ignore file at all", async () => {
    const skip = await loadDirectoryFilter(dir);

    expect(skip("node_modules")).toBe(true);
    expect(skip("apps/web/.next")).toBe(true);
    expect(skip(".claude/worktrees")).toBe(true);
    expect(skip("src")).toBe(false);
    expect(skip(".claude")).toBe(false);
  });

  it("cannot be switched back on by a negation", async () => {
    await write(".gitignore", "!node_modules/\n!.claude/worktrees/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("node_modules")).toBe(true);
    expect(skip(".claude/worktrees")).toBe(true);
  });
});

describe("the root .gitignore", () => {
  it("skips a named directory at any depth", async () => {
    await write(".gitignore", "generated/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("generated")).toBe(true);
    expect(skip("packages/a/generated")).toBe(true);
    expect(skip("generated-not")).toBe(false);
  });

  it("anchors a pattern that contains a slash to the root", async () => {
    await write(".gitignore", "/docs/plans/\nmock-server/.data/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("docs/plans")).toBe(true);
    expect(skip("packages/a/docs/plans")).toBe(false);
    expect(skip("mock-server/.data")).toBe(true);
    expect(skip("x/mock-server/.data")).toBe(false);
  });

  it("understands *, ? and **", async () => {
    await write(".gitignore", "tmp-*\nlog?\n**/fixtures/out\ncache/**\na/**/z\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("tmp-2026")).toBe(true);
    expect(skip("src/tmp-x")).toBe(true);
    expect(skip("log1")).toBe(true);
    expect(skip("log12")).toBe(false);
    expect(skip("fixtures/out")).toBe(true);
    expect(skip("deep/er/fixtures/out")).toBe(true);
    expect(skip("cache")).toBe(false);
    expect(skip("cache/inner")).toBe(true);
    expect(skip("a/z")).toBe(true);
    expect(skip("a/b/c/z")).toBe(true);
  });

  it("understands a character class", async () => {
    await write(".gitignore", "build-[0-9]\nkeep-[!a]\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("build-7")).toBe(true);
    expect(skip("build-x")).toBe(false);
    expect(skip("keep-b")).toBe(true);
    expect(skip("keep-a")).toBe(false);
  });

  it("lets a later negation take a directory back", async () => {
    await write(".gitignore", "gen*/\n!generated-keep/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("generated")).toBe(true);
    expect(skip("generated-keep")).toBe(false);
  });

  // A line git would shrug at must not take every search in the editor down with it.
  it("drops a pattern it cannot read and keeps the rest", async () => {
    await write(".gitignore", "bad-[z-a]/\nscratch/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("scratch")).toBe(true);
    expect(skip("src")).toBe(false);
  });

  it("ignores comments, blank lines and Windows line endings", async () => {
    await write(".gitignore", "# a comment\r\n\r\nscratch/\r\n\\#literal\r\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("scratch")).toBe(true);
    expect(skip("#literal")).toBe(true);
    expect(skip("# a comment")).toBe(false);
  });
});

describe(".git/info/exclude", () => {
  it("skips what the repository's local exclude file lists", async () => {
    await write(".git/info/exclude", "local-scratch/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("local-scratch")).toBe(true);
  });

  it("is overridden by the .gitignore, as git does", async () => {
    await write(".git/info/exclude", "vendor/\nother/\n");
    await write(".gitignore", "!vendor/\n");
    const skip = await loadDirectoryFilter(dir);

    expect(skip("other")).toBe(true);
    expect(skip("vendor")).toBe(false);
  });

  /*
   * In a linked worktree `.git` is a file pointing at `<repo>/.git/worktrees/<name>`, and
   * the exclude file git reads lives in the main repository's `.git`, found through that
   * directory's `commondir`. A worktree opened as a workspace should skip what its parent
   * repository skips.
   */
  it("is found through a linked worktree's .git file", async () => {
    const main = join(dir, "main");
    const worktree = join(dir, "wt");
    await write("main/.git/info/exclude", "agent-notes/\n");
    await write("main/.git/worktrees/wt/commondir", "../..\n");
    await write("wt/.git", `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);

    const skip = await loadDirectoryFilter(worktree);

    expect(skip("agent-notes")).toBe(true);
  });
});
