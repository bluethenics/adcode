import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileChange, type ToolCallBlock } from "@adcode/ai";
import { createAiToolRunner, type ProposedEdit } from "../src/main/aiTools.ts";

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
});
