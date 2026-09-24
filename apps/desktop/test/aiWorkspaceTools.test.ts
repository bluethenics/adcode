import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileChange, type ToolCallBlock } from "@adcode/ai";
import { applyReplacements, createAiToolRunner, type ProposedEdit } from "../src/main/aiTools.ts";

let human: string;
let sandbox: string;

beforeEach(async () => {
  human = await mkdtemp(join(tmpdir(), "adcode-tools-human-"));
  sandbox = await mkdtemp(join(tmpdir(), "adcode-tools-sandbox-"));
  await mkdir(join(human, "src"));
  await mkdir(join(sandbox, "src"));
  await writeFile(join(human, "src", "file.ts"), "human version\n", "utf8");
  await writeFile(join(sandbox, "src", "file.ts"), "sandbox version\n", "utf8");
});

afterEach(async () => {
  await rm(human, { recursive: true, force: true });
  await rm(sandbox, { recursive: true, force: true });
});

const call = (name: string, input: Record<string, unknown>): ToolCallBlock => ({
  type: "tool-call",
  id: `call-${name}`,
  name,
  input,
});

describe("sandboxed built-in AI tools", () => {
  it("opens the saved project preview without allocating an edit sandbox", async () => {
    const workspace = vi.fn(async () => null);
    const status = { running: true, starting: false, root: human, url: "http://127.0.0.1:4000/", mode: "static" as const, label: null, error: null };
    const runner = createAiToolRunner({
      workspace, memory: () => null, writeSandboxFile: vi.fn(), onProposedEdit: vi.fn(),
      openPreview: async () => status,
    });
    const result = await runner.run(call("open_preview", {}), new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({ type: "live-preview", status });
    expect(workspace).not.toHaveBeenCalled();
  });
  it("reads, lists, and searches the task sandbox instead of the human project", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, "sandbox version\n", contents),
      onProposedEdit: () => undefined,
    });

    const read = await runner.run(call("read_file", { path: "src/file.ts" }), new AbortController().signal);
    const list = await runner.run(call("list_files", { path: "src" }), new AbortController().signal);
    const search = await runner.run(call("search", { pattern: "sandbox" }), new AbortController().signal);

    expect(read.content).toContain("sandbox version");
    expect(read.content).not.toContain("human version");
    expect(list.content).toContain("file.ts");
    expect(search.content).toContain("src/file.ts:1: sandbox version");
  });

  it("writes a proposal into the sandbox and emits a diff addressed to the human file", async () => {
    let proposed: ProposedEdit | null = null;
    const writeSandboxFile = vi.fn(async (path: string, contents: string) => {
      await writeFile(join(sandbox, ...path.split("/")), contents, "utf8");
      return createFileChange(path, "sandbox version\n", contents);
    });
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile,
      onProposedEdit: (edit) => {
        proposed = edit;
      },
    });

    const result = await runner.run(
      call("propose_edit", {
        path: "src/file.ts",
        contents: "agent version\n",
        summary: "Update the file",
      }),
      new AbortController().signal,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("isolated task workspace");
    expect(writeSandboxFile).toHaveBeenCalledWith("src/file.ts", "agent version\n");
    expect(proposed).toMatchObject({
      taskId: "task-tools",
      relativePath: "src/file.ts",
      path: join(human, "src", "file.ts"),
      original: "sandbox version\n",
      proposed: "agent version\n",
    });
    expect(await readFile(join(sandbox, "src", "file.ts"), "utf8")).toBe("agent version\n");
    expect(await readFile(join(human, "src", "file.ts"), "utf8")).toBe("human version\n");
  });

  it("tells a trusted agent that apply waits for a successful turn and keeps a checkpoint", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      reviewPolicy: () => "trusted",
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, "sandbox version\n", contents),
      onProposedEdit: () => undefined,
    });

    const result = await runner.run(
      call("propose_edit", { path: "src/file.ts", contents: "agent version\n" }),
      new AbortController().signal,
    );

    expect(result.content).toContain("after this turn succeeds");
    expect(result.content).toContain("rollback checkpoint");
  });

  it("refuses traversal and absolute human paths before calling the write authority", async () => {
    const writeSandboxFile = vi.fn(async (path: string, contents: string) =>
      createFileChange(path, null, contents),
    );
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile,
      onProposedEdit: () => undefined,
    });

    const traversal = await runner.run(
      call("propose_edit", { path: "../secret.txt", contents: "x" }),
      new AbortController().signal,
    );
    const absolute = await runner.run(
      call("propose_edit", { path: join(human, "src", "file.ts"), contents: "x" }),
      new AbortController().signal,
    );

    expect(traversal.isError).toBe(true);
    expect(absolute.isError).toBe(true);
    expect(writeSandboxFile).not.toHaveBeenCalled();
  });

  it("refuses read, list, and search paths redirected outside the sandbox", async () => {    await symlink(
      join(human, "src"),
      join(sandbox, "src", "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });

    const read = await runner.run(
      call("read_file", { path: "src/escape/file.ts" }),
      new AbortController().signal,
    );
    const list = await runner.run(
      call("list_files", { path: "src/escape" }),
      new AbortController().signal,
    );
    const search = await runner.run(
      call("search", { path: "src/escape", pattern: "human" }),
      new AbortController().signal,
    );

    expect(read).toMatchObject({ isError: true });
    expect(list).toMatchObject({ isError: true });
    expect(search).toMatchObject({ isError: true });
    expect(read.content).not.toContain("human version");
    expect(list.content).not.toContain("file.ts");
    expect(search.content).not.toContain("human version");
  });

  it("treats empty, dot, and slash list/search paths as the workspace root", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    for (const path of ["", ".", "./", "/"]) {
      const listed = await runner.run(call("list_files", { path }), signal);
      expect(listed.isError).toBe(false);
      expect(listed.content).toContain("src/");
    }
    const searched = await runner.run(call("search", { pattern: "sandbox", path: "" }), signal);
    expect(searched.isError).toBe(false);
    expect(searched.content).toContain("src/file.ts");
  });

  it("pages large reads with offset and limit", async () => {
    await writeFile(join(sandbox, "long.txt"), "one\ntwo\nthree\nfour", "utf8");
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    const page = await runner.run(call("read_file", { path: "long.txt", offset: 2, limit: 2 }), signal);
    expect(page.isError).toBe(false);
    expect(page.content).toContain("   2 two");
    expect(page.content).toContain("   3 three");
    expect(page.content).not.toContain("one");
    expect(page.content).not.toContain("four");
    expect(page.content).toContain("Showing lines 2-3 of 4");

    const bad = await runner.run(call("read_file", { path: "long.txt", offset: 0 }), signal);
    expect(bad.isError).toBe(true);
  });

  it("finds files by glob, including images in a folder", async () => {
    await mkdir(join(sandbox, "assets"), { recursive: true });
    await writeFile(join(sandbox, "assets", "logo.png"), "png", "utf8");
    await writeFile(join(sandbox, "assets", "photo.jpg"), "jpg", "utf8");
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    const images = await runner.run(call("glob_files", { pattern: "assets/*.{png,jpg}" }), signal);
    expect(images.isError).toBe(false);
    expect(images.content).toContain("assets/logo.png");
    expect(images.content).toContain("assets/photo.jpg");

    const everyPng = await runner.run(call("glob_files", { pattern: "**/*.png", path: "" }), signal);
    expect(everyPng.content).toContain("assets/logo.png");
    expect(everyPng.content).not.toContain("src/file.ts");

    const filtered = await runner.run(
      call("search", { pattern: "sandbox", include: "**/*.md" }),
      signal,
    );
    expect(filtered.content).toBe("No matches.");
  });

  it("outlines symbols so long files can be skimmed first", async () => {
    await writeFile(
      join(sandbox, "src", "shapes.ts"),
      "export function makeShape() {}\nexport class Circle {}\nconst x = 1;\n",
      "utf8",
    );
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });

    const outline = await runner.run(
      call("get_outline", { path: "src/shapes.ts" }),
      new AbortController().signal,
    );
    expect(outline.isError).toBe(false);
    expect(outline.content).toContain("function makeShape");
    expect(outline.content).toContain("class Circle");
  });

  it("runs sandboxed commands and blocks destructive ones", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    const ok = await runner.run(call("run_command", { command: "echo tool-ok" }), signal);
    expect(ok.isError).toBe(false);
    expect(ok.content).toContain("tool-ok");

    const blocked = await runner.run(call("run_command", { command: "rm -rf /" }), signal);
    expect(blocked.isError).toBe(true);
    expect(blocked.content).toMatch(/blocked/i);
  });

  it("refuses unsafe fetch URLs before touching the network", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    const plain = await runner.run(call("fetch_url", { url: "http://example.com/docs" }), signal);
    expect(plain.isError).toBe(true);

    const nonsense = await runner.run(call("fetch_url", { url: "not a url" }), signal);
    expect(nonsense.isError).toBe(true);
  });
});

describe("applyReplacements", () => {
  it("replaces exact text and preserves CRLF files", () => {
    expect(
      applyReplacements("const x = 1;\r\nfoo();\r\n", [{ oldString: "foo();", newString: "bar();", replaceAll: false }], "a.ts"),
    ).toEqual({ ok: true, text: "const x = 1;\r\nbar();\r\n" });
  });

  it("creates a missing file from an empty old_string", () => {
    expect(
      applyReplacements("", [{ oldString: "", newString: "new();\n", replaceAll: false }], "new.ts"),
    ).toEqual({ ok: true, text: "new();\n" });
    const refused = applyReplacements("full();\n", [{ oldString: "", newString: "x", replaceAll: false }], "a.ts");
    expect(refused.ok).toBe(false);
  });

  it("refuses misses and ambiguity with somewhere to look", () => {
    const miss = applyReplacements("aaa\n", [{ oldString: "zzz", newString: "y", replaceAll: false }], "a.ts");
    expect(miss).toMatchObject({ ok: false });
    const twice = applyReplacements("x\nx\n", [{ oldString: "x", newString: "y", replaceAll: false }], "a.ts");
    expect(twice).toMatchObject({ ok: false });
    expect(
      applyReplacements("x\nx\n", [{ oldString: "x", newString: "y", replaceAll: true }], "a.ts"),
    ).toEqual({ ok: true, text: "y\ny\n" });
  });

  it("applies several edits in order, all or nothing", () => {
    const result = applyReplacements("a1\nb1\n", [
      { oldString: "a1", newString: "a2", replaceAll: false },
      { oldString: "zzz", newString: "nope", replaceAll: false },
    ], "a.ts");
    expect(result.ok).toBe(false);
  });
});
