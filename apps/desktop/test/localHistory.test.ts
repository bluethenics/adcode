/**
 * Local file history and crash recovery - brief §4's Session group.
 *
 * Both are the same shape underneath: a copy of a file's text, kept somewhere the editor
 * can find it again. History keeps copies of what was saved; recovery keeps copies of
 * what was not.
 *
 * Run against a real directory. Everything worth testing here - what gets pruned, what
 * happens to a path with a colon in it, what a corrupt entry does - is filesystem
 * behaviour, and a fake would only confirm my own assumptions about it.
 */
import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalHistory, type LocalHistory } from "../src/main/localHistory.ts";

let dir: string;
let history: LocalHistory;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "adcode-history-"));
  history = createLocalHistory(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("recording saves", () => {
  it("keeps what was saved and hands it back", async () => {
    await history.record("E:/work/a.ts", "version one");

    const versions = await history.versions("E:/work/a.ts");
    expect(versions).toHaveLength(1);
    expect(await history.read("E:/work/a.ts", versions[0]!.id)).toBe("version one");
  });

  it("keeps versions newest first", async () => {
    await history.record("E:/work/a.ts", "one");
    await history.record("E:/work/a.ts", "two");
    await history.record("E:/work/a.ts", "three");

    const versions = await history.versions("E:/work/a.ts");
    expect(versions).toHaveLength(3);
    expect(await history.read("E:/work/a.ts", versions[0]!.id)).toBe("three");
  });

  it("ignores a save that changed nothing", async () => {
    await history.record("E:/work/a.ts", "same");
    await history.record("E:/work/a.ts", "same");

    expect(await history.versions("E:/work/a.ts")).toHaveLength(1);
  });

  it("keeps different files apart", async () => {
    await history.record("E:/work/a.ts", "a");
    await history.record("E:/work/b.ts", "b");

    expect(await history.versions("E:/work/a.ts")).toHaveLength(1);
    expect(await history.read("E:/work/b.ts", (await history.versions("E:/work/b.ts"))[0]!.id)).toBe("b");
  });

  it("survives a path a filesystem would reject as a directory name", async () => {
    const nasty = "E:/work/../weird name: with * chars?.ts";

    await history.record(nasty, "kept");
    const versions = await history.versions(nasty);

    expect(await history.read(nasty, versions[0]!.id)).toBe("kept");
  });

  it("records the size, so the UI can show it without reading the file", async () => {
    await history.record("E:/work/a.ts", "12345");
    expect((await history.versions("E:/work/a.ts"))[0]?.bytes).toBe(5);
  });

  it("has nothing for a file it has never seen", async () => {
    expect(await history.versions("E:/never.ts")).toEqual([]);
  });

  it("returns null for a version id that does not exist", async () => {
    await history.record("E:/work/a.ts", "one");
    expect(await history.read("E:/work/a.ts", "nope")).toBeNull();
  });

  it("refuses a version id that tries to climb out of its directory", async () => {
    await history.record("E:/work/a.ts", "one");
    expect(await history.read("E:/work/a.ts", "../../../etc/passwd")).toBeNull();
  });
});

describe("pruning", () => {
  it("keeps only the most recent versions", async () => {
    for (let i = 0; i < 60; i++) await history.record("E:/work/a.ts", `version ${i}`);

    const versions = await history.versions("E:/work/a.ts");
    expect(versions.length).toBeLessThanOrEqual(50);
    expect(await history.read("E:/work/a.ts", versions[0]!.id)).toBe("version 59");
  });

  it("does not keep a copy of something too large to be source", async () => {
    await history.record("E:/work/big.ts", "x".repeat(3_000_000));
    expect(await history.versions("E:/work/big.ts")).toEqual([]);
  });
});

describe("crash recovery", () => {
  it("keeps an unsaved buffer and returns it", async () => {
    await history.draft("E:/work/a.ts", "typed but not saved");

    const drafts = await history.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ path: "E:/work/a.ts", text: "typed but not saved" });
  });

  it("replaces the previous draft rather than piling them up", async () => {
    await history.draft("E:/work/a.ts", "first");
    await history.draft("E:/work/a.ts", "second");

    const drafts = await history.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe("second");
  });

  it("forgets a draft once the file is saved", async () => {
    await history.draft("E:/work/a.ts", "unsaved");
    await history.clearDraft("E:/work/a.ts");

    expect(await history.drafts()).toEqual([]);
  });

  it("keeps drafts for several files", async () => {
    await history.draft("E:/work/a.ts", "a");
    await history.draft("E:/work/b.ts", "b");

    expect((await history.drafts()).map((d) => d.path).sort()).toEqual(["E:/work/a.ts", "E:/work/b.ts"]);
  });

  it("skips a corrupt draft rather than failing the whole recovery", async () => {
    await history.draft("E:/work/a.ts", "good");
    await mkdir(join(dir, "drafts"), { recursive: true });
    await writeFile(join(dir, "drafts", "broken.json"), "{not json", "utf8");

    const drafts = await history.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.text).toBe("good");
  });

  it("has nothing to recover on a clean start", async () => {
    expect(await history.drafts()).toEqual([]);
  });

  it("leaves no temporary files behind", async () => {
    await history.draft("E:/work/a.ts", "x");

    const files = await readdir(join(dir, "drafts"));
    expect(files.every((name) => name.endsWith(".json"))).toBe(true);
  });
});

describe("failing soft", () => {
  it("does not throw when the directory cannot be created", async () => {
    // A NUL byte cannot appear in a path on any platform, which is the portable way to
    // make the write fail without depending on file permissions.
    const broken = createLocalHistory(join(dir, "no\u0000pe"));

    await expect(broken.record("E:/a.ts", "x")).resolves.toBeUndefined();
    await expect(broken.draft("E:/a.ts", "x")).resolves.toBeUndefined();
    await expect(broken.drafts()).resolves.toEqual([]);
    await expect(broken.versions("E:/a.ts")).resolves.toEqual([]);
  });

  it("does not throw when clearing a draft that was never written", async () => {
    await expect(history.clearDraft("E:/never.ts")).resolves.toBeUndefined();
  });
});
