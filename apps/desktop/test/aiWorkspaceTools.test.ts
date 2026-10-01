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
  it.each([{}, { path: null }, { path: "" }])("reports missing edit arguments without blaming workspace confinement", async (input) => {
    const workspace = vi.fn(async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }));
    const writeSandboxFile = vi.fn();
    const runner = createAiToolRunner({ workspace, memory: () => null, writeSandboxFile, onProposedEdit: vi.fn() });
    const result = await runner.run(call("propose_edit", input), new AbortController().signal);
    expect(result).toMatchObject({ isError: true, content: expect.stringContaining('requires a non-empty "path"') });
    expect(result.content).not.toContain("outside");
    expect(workspace).not.toHaveBeenCalled();
    expect(writeSandboxFile).not.toHaveBeenCalled();
  });

  it("reports a missing workspace as a filesystem failure, not a rejected file path", async () => {
    const writeSandboxFile = vi.fn();
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "", sandboxRoot: join(human, "missing-project"), humanRoot: human }),
      memory: () => null, writeSandboxFile, onProposedEdit: vi.fn(),
    });
    const result = await runner.run(call("propose_edit", { path: "index.html", contents: "hello" }), new AbortController().signal);
    expect(result).toMatchObject({ isError: true, content: expect.stringContaining("ENOENT") });
    expect(result.content).not.toContain(human);
    expect(writeSandboxFile).not.toHaveBeenCalled();
  });

  it("opens the saved project preview without allocating an edit sandbox", async () => {
    const workspace = vi.fn(async () => null);
    const status = { running: true, starting: false, root: human, url: "http://127.0.0.1:4000/", mode: "static" as const, label: null, error: null };
    const openPreview = vi.fn(async (path: string | null) => ({ status, page: `http://127.0.0.1:4000/${path ?? ""}` }));
    const runner = createAiToolRunner({
      workspace, memory: () => null, writeSandboxFile: vi.fn(), onProposedEdit: vi.fn(),
      openPreview,
    });
    const result = await runner.run(call("open_preview", {}), new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toMatchObject({ type: "live-preview", status, page: "http://127.0.0.1:4000/" });
    expect(openPreview).toHaveBeenCalledWith(null);
    expect(workspace).not.toHaveBeenCalled();
  });

  it("opens the page the model names, not always the home page", async () => {
    const status = { running: true, starting: false, root: human, url: "http://127.0.0.1:4000/", mode: "static" as const, label: null, error: null };
    const openPreview = vi.fn(async (path: string | null) => ({ status, page: `http://127.0.0.1:4000/${path ?? ""}` }));
    const runner = createAiToolRunner({ workspace: async () => null, memory: () => null, writeSandboxFile: vi.fn(), onProposedEdit: vi.fn(), openPreview });
    const result = await runner.run(call("open_preview", { path: "  about.html " }), new AbortController().signal);
    expect(openPreview).toHaveBeenCalledWith("about.html");
    expect(JSON.parse(result.content)).toMatchObject({ page: "http://127.0.0.1:4000/about.html" });
  });

  it("reports a preview with no address as a failure the model can act on", async () => {
    const status = { running: true, starting: true, root: human, url: null, mode: "project" as const, label: "Vite", error: null };
    const runner = createAiToolRunner({ workspace: async () => null, memory: () => null, writeSandboxFile: vi.fn(), onProposedEdit: vi.fn(), openPreview: async () => ({ status, page: null }) });
    const result = await runner.run(call("open_preview", {}), new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).note).toContain("no address yet");
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

  it("reads the live project without a task while edits go through the write workspace", async () => {
    const workspace = vi.fn(async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }));
    const writeWorkspace = vi.fn(async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }));
    const runner = createAiToolRunner({
      workspace,
      writeWorkspace,
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, "sandbox version\n", contents),
      onProposedEdit: () => undefined,
    });

    const read = await runner.run(call("read_file", { path: "src/file.ts" }), new AbortController().signal);
    expect(read.isError).toBe(false);
    expect(read.content).toContain("human version");
    expect(writeWorkspace).not.toHaveBeenCalled();

    const edit = await runner.run(
      call("propose_edit", { path: "src/file.ts", contents: "agent version\n" }),
      new AbortController().signal,
    );
    expect(edit.isError).toBe(false);
    expect(writeWorkspace).toHaveBeenCalled();
  });

  it("fails an edit cleanly when the write workspace is unavailable", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }),
      writeWorkspace: async () => null,
      workspaceUnavailableMessage: () => "Save a.ts before starting AI file tools.",
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, "", contents),
      onProposedEdit: () => undefined,
    });

    const result = await runner.run(
      call("propose_edit", { path: "src/file.ts", contents: "agent version\n" }),
      new AbortController().signal,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Save a.ts");
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
    expect(result.content).toContain("staged in an isolated copy of the project");
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

  it.each(["./src/file.ts", ".\\src\\file.ts", "src//./file.ts", "absolute"])(
    "maps %s into the active sandbox for reads and writes",
    async (spelling) => {
      const path = spelling === "absolute" ? join(human, "src", "file.ts") : spelling;
      const writeSandboxFile = vi.fn(async (relativePath: string, contents: string) => {
        await writeFile(join(sandbox, relativePath), contents, "utf8");
        return createFileChange(relativePath, "sandbox version\n", contents);
      });
      const runner = createAiToolRunner({
        workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
        memory: () => null, writeSandboxFile, onProposedEdit: vi.fn(),
      });
      const signal = new AbortController().signal;
      const read = await runner.run(call("read_file", { path }), signal);
      expect(read.isError).toBe(false);
      expect(read.content).toContain("sandbox version");
      const edit = await runner.run(call("propose_edit", { path, contents: "updated\n" }), signal);
      expect(edit.isError).toBe(false);
      expect(writeSandboxFile).toHaveBeenCalledWith("src/file.ts", "updated\n");
      expect(await readFile(join(human, "src", "file.ts"), "utf8")).toBe("human version\n");
      expect(await readFile(join(sandbox, "src", "file.ts"), "utf8")).toBe("updated\n");
    },
  );

  it("accepts the live project's absolute path when edits apply directly", async () => {
    const writeSandboxFile = vi.fn(async (path: string, contents: string) => {
      await writeFile(join(human, path), contents, "utf8");
      return createFileChange(path, "human version\n", contents);
    });
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }),
      directWrites: true, memory: () => null, writeSandboxFile, onProposedEdit: vi.fn(),
    });
    const result = await runner.run(call("edit_file", {
      path: join(human, "src", "file.ts"), old_string: "human version", new_string: "updated",
    }), new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(await readFile(join(human, "src", "file.ts"), "utf8")).toBe("updated\n");
  });

  it("refuses traversal and absolute outside paths before calling the write authority", async () => {
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
      call("propose_edit", { path: join(`${human}-other`, "src", "file.ts"), contents: "x" }),
      new AbortController().signal,
    );

    expect(traversal.isError).toBe(true);
    expect(absolute.isError).toBe(true);
    expect(traversal.content).toContain("workspace-relative path");
    expect(absolute.content).toContain("list_files");
    expect(writeSandboxFile).not.toHaveBeenCalled();
  });

  it.each(["./src/../secret.txt", "C:secret.txt", "", null, "src/file.ts\u0000.txt"])(
    "rejects malformed or traversing edit path %s",
    async (path) => {
      const writeSandboxFile = vi.fn();
      const runner = createAiToolRunner({
        workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
        memory: () => null, writeSandboxFile, onProposedEdit: vi.fn(),
      });
      expect(await runner.run(call("propose_edit", { path, contents: "x" }), new AbortController().signal))
        .toMatchObject({ isError: true });
      expect(writeSandboxFile).not.toHaveBeenCalled();
    },
  );

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

  it("does not let normalized or absolute paths write through an outside junction", async () => {
    await symlink(join(human, "src"), join(sandbox, "escape"), process.platform === "win32" ? "junction" : "dir");
    const writeSandboxFile = vi.fn();
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null, writeSandboxFile, onProposedEdit: vi.fn(),
    });
    for (const path of ["./escape/new.txt", join(human, "escape", "new.txt")]) {
      expect(await runner.run(call("propose_edit", { path, contents: "x" }), new AbortController().signal))
        .toMatchObject({ isError: true });
    }
    expect(writeSandboxFile).not.toHaveBeenCalled();
  });

  /*
   * The same directory rule as the editor's own search. A shadow-copy sandbox of a dirty
   * repository carries `.claude/worktrees` - whole second checkouts - along with it, and an
   * assistant that searched them would answer from a copy of the code nobody is editing.
   */
  it("skips agent worktrees and gitignored folders when listing and searching", async () => {
    await mkdir(join(sandbox, ".claude", "worktrees", "x", "src"), { recursive: true });
    await writeFile(join(sandbox, ".claude", "worktrees", "x", "src", "file.ts"), "sandbox version\n", "utf8");
    await writeFile(join(sandbox, ".claude", "settings.json"), "{}\n", "utf8");
    await mkdir(join(sandbox, "src", "generated"), { recursive: true });
    await writeFile(join(sandbox, "src", "generated", "types.ts"), "sandbox version\n", "utf8");
    await writeFile(join(sandbox, ".gitignore"), "generated/\n", "utf8");
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "task-tools", sandboxRoot: sandbox, humanRoot: human }),
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });
    const signal = new AbortController().signal;

    const searched = await runner.run(call("search", { pattern: "sandbox" }), signal);
    const recursive = await runner.run(call("list_files", { recursive: true }), signal);
    const claude = await runner.run(call("list_files", { path: ".claude" }), signal);

    expect(searched.content).toBe("src/file.ts:1: sandbox version");
    expect(recursive.content.split("\n")).toEqual([".claude/settings.json", ".gitignore", "src/file.ts"]);
    expect(claude.content).toBe("settings.json");
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

  it("says plainly when an edit lands straight in the project", async () => {
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }),
      directWrites: true,
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, "human version\n", contents),
      onProposedEdit: () => undefined,
    });

    const result = await runner.run(
      call("propose_edit", { path: "src/file.ts", contents: "agent version\n" }),
      new AbortController().signal,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("in your project");
    expect(result.content).not.toContain("isolated");
  });

  it("notifies when a command finishes so the Explorer can refresh", async () => {
    const onCommandFinished = vi.fn();
    const runner = createAiToolRunner({
      workspace: async () => ({ taskId: "", sandboxRoot: human, humanRoot: human }),
      onCommandFinished,
      memory: () => null,
      writeSandboxFile: async (path, contents) => createFileChange(path, null, contents),
      onProposedEdit: () => undefined,
    });

    const result = await runner.run(call("run_command", { command: "echo tool-ok" }), new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(onCommandFinished).toHaveBeenCalledTimes(1);
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
    ).toEqual({ ok: true, text: "const x = 1;\r\nbar();\r\n", notes: [] });
  });

  it("creates a missing file from an empty old_string", () => {
    expect(
      applyReplacements("", [{ oldString: "", newString: "new();\n", replaceAll: false }], "new.ts"),
    ).toEqual({ ok: true, text: "new();\n", notes: [] });
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
    ).toEqual({ ok: true, text: "y\ny\n", notes: [] });
  });

  it("applies several edits in order, all or nothing", () => {
    const result = applyReplacements("a1\nb1\n", [
      { oldString: "a1", newString: "a2", replaceAll: false },
      { oldString: "zzz", newString: "nope", replaceAll: false },
    ], "a.ts");
    expect(result.ok).toBe(false);
  });
});
