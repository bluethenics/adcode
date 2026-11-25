import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCheckpointStore } from "../src/main/aiCheckpoints.ts";
import { outsideToolForChat, parsePorcelainZ, startCliTurnSnapshot, workspaceRelative, workspaceSnapshotDeps, writesUnnamed, type SnapshotRecorder } from "../src/main/cliTurnSnapshot.ts";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function repo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "adcode-cli-snapshot-"));
  folders.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  git("config", "core.autocrlf", "false");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return root;
}

function recorder(): SnapshotRecorder & { files: Map<string, { before: string | null; after: string | null; encoding?: string }> } {
  const files = new Map<string, { before: string | null; after: string | null; encoding?: string }>();
  return { files, record: (path, before, after, encoding) => { files.set(path, { before, after, ...(encoding === undefined ? {} : { encoding }) }); } };
}

describe("a coding CLI's turn, as a checkpoint", () => {
  it("names paths the way the checkpoint does, and refuses ones outside the workspace", () => {
    const root = process.platform === "win32" ? "E:\\proj" : "/proj";
    const inside = process.platform === "win32" ? "e:\\Proj\\src\\a.ts" : "/proj/src/a.ts";
    expect(workspaceRelative(root, inside)).toBe("src/a.ts");
    expect(workspaceRelative(root, "src\\b.ts")).toBe("src/b.ts");
    expect(workspaceRelative(root, "./c.ts")).toBe("c.ts");
    expect(workspaceRelative(root, "../outside.ts")).toBeNull();
    expect(workspaceRelative(root, process.platform === "win32" ? "C:\\Windows\\win.ini" : "/etc/hosts")).toBeNull();
  });

  it("shows a CLI's absolute paths the way ADCode's own rows read them", () => {
    const root = process.platform === "win32" ? "E:\\proj" : "/proj";
    const file = process.platform === "win32" ? "E:\\proj\\src\\a.ts" : "/proj/src/a.ts";
    const slashed = process.platform === "win32" ? "E:/proj/src/a.ts" : "/proj/src/a.ts";
    expect(outsideToolForChat({ id: "e1", detail: file, paths: [file] }, root)).toEqual({ id: "e1", detail: process.platform === "win32" ? "src\\a.ts" : "src/a.ts", paths: ["src/a.ts"] });
    expect(outsideToolForChat({ id: "e2", detail: `Edit ${slashed}` }, root)).toEqual({ id: "e2", detail: "Edit src/a.ts" });
    expect(writesUnnamed("execute")).toBe(true);
    expect(writesUnnamed("edit")).toBe(false);
  });

  it("reads git's porcelain list, renames both ways, within the workspace's folder", () => {
    expect(parsePorcelainZ(" M app/a.ts\u0000?? app/new.ts\u0000R  app/b.ts\u0000app/old.ts\u0000 M other/x.ts\u0000", "app/")).toEqual(["a.ts", "new.ts", "b.ts", "old.ts"]);
  });

  it("records the two files a CLI edited - one changed, one created - and Undo puts both back", async () => {
    const root = await repo({ "src/a.ts": "export const a = 1;\n", "README.md": "hi\n" });
    const snapshot = await startCliTurnSnapshot(root, workspaceSnapshotDeps(root));
    // Claude Code names its files absolute, before it writes them.
    snapshot.touch([join(root, "src", "a.ts"), join(root, "src", "b.ts")]);
    await writeFile(join(root, "src/a.ts"), "export const a = 2;\n");
    await writeFile(join(root, "src/b.ts"), "export const b = 1;\n");

    const store = createCheckpointStore({ directory: () => join(root, ".checkpoints"), resolve: async (folder, path) => join(folder, path) });
    const turn = store.open(root, "chat-1");
    expect(await snapshot.finish(turn)).toEqual(["src/a.ts", "src/b.ts"]);
    const saved = await turn.finish();
    expect(saved?.files).toEqual([
      { path: "src/a.ts", before: "export const a = 1;\n", after: "export const a = 2;\n" },
      { path: "src/b.ts", before: null, after: "export const b = 1;\n" },
    ]);

    const undone = await store.undo(saved!.id, root, false);
    expect(undone.ok).toBe(true);
    expect(await readFile(join(root, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
    await expect(readFile(join(root, "src/b.ts"), "utf8")).rejects.toThrow();
  });

  it("keeps a person's own uncommitted work as it was when the turn began, not as the commit has it", async () => {
    const root = await repo({ "notes.md": "committed\n" });
    await writeFile(join(root, "notes.md"), "my own edit\n");
    const snapshot = await startCliTurnSnapshot(root, workspaceSnapshotDeps(root));
    await writeFile(join(root, "notes.md"), "the CLI's edit\n");
    snapshot.touch(["notes.md"]);
    const out = recorder();
    await snapshot.finish(out);
    expect(out.files.get("notes.md")).toEqual({ before: "my own edit\n", after: "the CLI's edit\n", encoding: "utf8" });
  });

  it("asks git for files a command changed without naming them, only once the CLI ran one", async () => {
    const root = await repo({ "a.txt": "a\n", "b.txt": "b\n" });
    const quiet = await startCliTurnSnapshot(root, workspaceSnapshotDeps(root));
    await writeFile(join(root, "b.txt"), "changed by me in the editor\n");
    const none = recorder();
    // The CLI only named a.txt, with its own edit tool, and ran no command: b.txt is not its change.
    quiet.touch(["a.txt"]);
    expect(await quiet.finish(none)).toEqual([]);

    await writeFile(join(root, "b.txt"), "b\n");
    const ran = await startCliTurnSnapshot(root, workspaceSnapshotDeps(root));
    ran.noteUnnamedWrites();
    // `sed -i` and a code generator: neither names its files.
    await writeFile(join(root, "a.txt"), "rewritten by sed\n");
    await mkdir(join(root, "gen"));
    await writeFile(join(root, "gen/out.ts"), "generated\n");
    const all = recorder();
    expect(await ran.finish(all)).toEqual(["a.txt", "gen/out.ts"]);
    expect(all.files.get("gen/out.ts")).toMatchObject({ before: null, after: "generated\n" });
  });

  it("records a deleted file and keeps binary files byte for byte", async () => {
    const root = await repo({ "old.ts": "gone soon\n", "logo.bin": "\u0000\u0001\u0002" });
    const snapshot = await startCliTurnSnapshot(root, workspaceSnapshotDeps(root));
    snapshot.touch(["old.ts", "logo.bin"]);
    await rm(join(root, "old.ts"));
    await writeFile(join(root, "logo.bin"), Buffer.from([0, 9, 9]));
    const out = recorder();
    await snapshot.finish(out);
    expect(out.files.get("old.ts")).toEqual({ before: "gone soon\n", after: null, encoding: "utf8" });
    expect(out.files.get("logo.bin")).toEqual({ before: Buffer.from([0, 1, 2]).toString("base64"), after: Buffer.from([0, 9, 9]).toString("base64"), encoding: "base64" });
  });

  it("without git, keeps the files the CLI named as they were when it named them", async () => {
    const files = new Map<string, string | null>([["a.ts", "before\n"]]);
    const snapshot = await startCliTurnSnapshot("/proj", { git: async () => null, read: async (path) => (files.get(path) ?? null) === null ? null : Buffer.from(files.get(path)!) });
    snapshot.touch(["a.ts"]);
    await Promise.resolve();
    files.set("a.ts", "after\n");
    const out = recorder();
    expect(await snapshot.finish(out)).toEqual(["a.ts"]);
    expect(out.files.get("a.ts")).toMatchObject({ before: "before\n", after: "after\n" });
  });
});
