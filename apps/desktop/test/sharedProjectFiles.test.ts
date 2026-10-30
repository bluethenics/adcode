import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scan, applyFiles, mergeFiles } from "../src/main/sharedProjectFiles.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "adcode-shared-project-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("online project files", () => {
  it("merges independent edits, pauses conflicting edits and backs up both versions on explicit resolution", () => {
    const base = { "a.ts": "old-a", "b.ts": "old-b", "deleted.ts": "old" };
    expect(mergeFiles(base, { ...base, "a.ts": "my-a" }, { "a.ts": "old-a", "b.ts": "their-b" })).toMatchObject({ files: { "a.ts": "my-a", "b.ts": "their-b" }, conflicts: [] });
    const mine = { "a.ts": "mine", "deleted.ts": "edited" }, theirs = { "a.ts": "theirs" };
    expect(mergeFiles(base, mine, theirs).conflicts).toEqual(["a.ts", "deleted.ts"]);
    expect(mergeFiles(base, mine, theirs, "online")).toMatchObject({ files: { "a.ts": "theirs" }, backups: [{ path: "a.ts", local: "mine", online: "theirs" }, { path: "deleted.ts", local: "edited" }] });
    expect(mergeFiles({}, { constructor: "file content" }, {}).files).toEqual({ constructor: "file content" });
  });
  it("shares source and binary assets while excluding private files, generated directories and gitignored files", async () => {
    await writeFile(join(root, "app.ts"), "source"); await writeFile(join(root, ".env"), "secret"); await writeFile(join(root, "private.pem"), "key");
    await writeFile(join(root, ".gitignore"), "local.txt\nignored/\n"); await writeFile(join(root, "local.txt"), "private note");
    await mkdir(join(root, "ignored")); await writeFile(join(root, "ignored", "copy.ts"), "ignored");
    await mkdir(join(root, "node_modules")); await writeFile(join(root, "node_modules", "module.js"), "generated");
    await mkdir(join(root, "src")); await writeFile(join(root, "src", ".gitignore"), "private.json\n"); await writeFile(join(root, "src", "private.json"), "private");
    await writeFile(join(root, "logo.png"), Buffer.from([0, 1, 255]));
    const files = await scan(root);
    expect(Object.keys(files).sort()).toEqual([".gitignore", "app.ts", "logo.png", "src/.gitignore"]);
    expect(files["logo.png"]).toBe(Buffer.from([0, 1, 255]).toString("base64"));
  });

  it("pulls online changes and deletions without overwriting a file modified after scanning", async () => {
    await writeFile(join(root, "app.ts"), "old"); await writeFile(join(root, "delete.ts"), "old");
    await applyFiles(root, { "app.ts": b64("old"), "delete.ts": b64("old") }, { "app.ts": b64("online"), "src/new.ts": b64("new") });
    expect(await readFile(join(root, "app.ts"), "utf8")).toBe("online");
    expect(await readFile(join(root, "src", "new.ts"), "utf8")).toBe("new");
    await expect(readFile(join(root, "delete.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(root, "app.ts"), "just edited");
    await expect(applyFiles(root, { "app.ts": b64("online") }, { "app.ts": b64("stale") })).rejects.toThrow("changed while syncing");
    expect(await readFile(join(root, "app.ts"), "utf8")).toBe("just edited");
  });

  it("refuses traversal, Windows device names, private paths and symbolic-link parents", async () => {
    for (const name of ["../outside", "C:/outside", "a\\b", "nul.txt", ".env", ".git/config"]) {
      await expect(applyFiles(root, {}, { [name]: b64("unsafe") })).rejects.toThrow();
    }
    const outside = await mkdtemp(join(tmpdir(), "adcode-shared-outside-"));
    try {
      await symlink(outside, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
      await expect(applyFiles(root, {}, { "linked/file.ts": b64("escape") })).rejects.toThrow("link blocks");
      expect(await scan(root)).toEqual({});
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});
