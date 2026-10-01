/**
 * The assistant's tools after the better-tools pass: what a model can now do that it could
 * not before - delete and move with Undo, run long commands and servers, search like grep,
 * survive whitespace in its edits, look at images and big files, and keep a plan.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileChange, type ToolCallBlock } from "@adcode/ai";
import { applyReplacements, createAiToolRunner, looseReplace, parsePlan, type AiToolDeps } from "../src/main/aiTools.ts";
import { createCommandRunner, looksLikeServer } from "../src/main/aiCommands.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "adcode-better-tools-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "app.ts"), "export function greet() {\n    return \"hi\";\n}\n", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const call = (name: string, input: Record<string, unknown>): ToolCallBlock => ({ type: "tool-call", id: `call-${name}`, name, input });
const signal = (): AbortSignal => new AbortController().signal;

function direct(extra: Partial<AiToolDeps> = {}) {
  const undo: [string, string | null, string | null, string][] = [];
  const changed: string[][] = [];
  const runner = createAiToolRunner({
    workspace: async () => ({ taskId: "", sandboxRoot: root, humanRoot: root }),
    directWrites: true,
    memory: () => null,
    writeSandboxFile: async (path, contents) => {
      const target = join(root, ...path.split("/"));
      let before: string | null = null;
      try { before = await readFile(target, "utf8"); } catch { /* new file */ }
      await writeFile(target, contents, "utf8");
      return createFileChange(path, before, contents);
    },
    onProposedEdit: () => undefined,
    recordUndo: (path, before, after, encoding) => undo.push([path, before, after, encoding]),
    onFilesChanged: (paths) => changed.push([...paths]),
    ...extra,
  });
  return { runner, undo, changed };
}

const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

describe("delete_file and move_file", () => {
  it("deletes a file and keeps its contents for Undo", async () => {
    const { runner, undo, changed } = direct();
    const result = await runner.run(call("delete_file", { path: "src/app.ts" }), signal());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Undo brings it back");
    expect(await exists(join(root, "src", "app.ts"))).toBe(false);
    expect(undo).toEqual([["src/app.ts", expect.stringContaining("greet"), null, "utf8"]]);
    expect(changed).toEqual([["src/app.ts"]]);
  });

  it("keeps a binary file as base64, byte for byte", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
    await writeFile(join(root, "logo.png"), bytes);
    const { runner, undo } = direct();
    await runner.run(call("delete_file", { path: "logo.png" }), signal());
    expect(undo[0]?.[3]).toBe("base64");
    expect(Buffer.from(undo[0]?.[1] ?? "", "base64")).toEqual(bytes);
  });

  it("refuses a folder with things in it, and the workspace itself", async () => {
    const { runner } = direct();
    expect((await runner.run(call("delete_file", { path: "src" }), signal())).content).toContain("folder with 1 item");
    expect(await exists(join(root, "src", "app.ts"))).toBe(true);
    expect((await runner.run(call("delete_file", { path: "." }), signal())).isError).toBe(true);
  });

  it("refuses outside the workspace", async () => {
    const { runner } = direct();
    const result = await runner.run(call("delete_file", { path: "../escape.txt" }), signal());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("workspace-relative");
  });

  it("does not delete or move in review mode, where the change could not reach the merge", async () => {
    const { runner } = direct({ directWrites: false });
    expect((await runner.run(call("delete_file", { path: "src/app.ts" }), signal())).content).toContain("apply automatically");
    expect((await runner.run(call("move_file", { from: "src/app.ts", to: "app.ts" }), signal())).isError).toBe(true);
    expect(await exists(join(root, "src", "app.ts"))).toBe(true);
  });

  it("moves a file into a new folder and records both ends for Undo", async () => {
    const { runner, undo } = direct();
    const result = await runner.run(call("move_file", { from: "src/app.ts", to: "lib/core/app.ts" }), signal());
    expect(result.isError).toBe(false);
    expect(await readFile(join(root, "lib", "core", "app.ts"), "utf8")).toContain("greet");
    expect(await exists(join(root, "src", "app.ts"))).toBe(false);
    expect(undo.map(([path, before, after]) => [path, before === null, after === null])).toEqual([
      ["src/app.ts", false, true],
      ["lib/core/app.ts", true, false],
    ]);
  });

  it("moves a whole folder, file by file in the Undo record", async () => {
    await writeFile(join(root, "src", "util.ts"), "export const x = 1;\n", "utf8");
    const { runner, undo } = direct();
    const result = await runner.run(call("move_file", { from: "src", to: "source" }), signal());
    expect(result.content).toContain("2 files");
    expect(await exists(join(root, "source", "util.ts"))).toBe(true);
    expect(undo.map(([path]) => path).sort()).toEqual(["source/app.ts", "source/util.ts", "src/app.ts", "src/util.ts"]);
  });

  it("will not overwrite unless asked, and keeps what it replaced", async () => {
    await writeFile(join(root, "target.ts"), "old target\n", "utf8");
    const { runner, undo } = direct();
    const refused = await runner.run(call("move_file", { from: "src/app.ts", to: "target.ts" }), signal());
    expect(refused.content).toContain("overwrite: true");
    const moved = await runner.run(call("move_file", { from: "src/app.ts", to: "target.ts", overwrite: true }), signal());
    expect(moved.isError).toBe(false);
    expect(await readFile(join(root, "target.ts"), "utf8")).toContain("greet");
    expect(undo.find(([path]) => path === "target.ts")?.[1]).toBe("old target\n");
  });

  it("refuses to move a folder into itself", async () => {
    const { runner } = direct();
    expect((await runner.run(call("move_file", { from: "src", to: "src/inner" }), signal())).content).toContain("cannot move into itself");
  });
});

describe("edit_file forgives whitespace", () => {
  it("matches a block whose indentation the model got wrong, and re-indents the replacement", () => {
    const result = looseReplace("function a() {\n    return 1;\n}\n", "  return 1;", "  return 2;\n  // two");
    expect(result).toEqual({ text: "function a() {\n    return 2;\n    // two\n}\n", line: 2 });
  });

  it("refuses when the loose match is not unique", () => {
    expect(looseReplace("  x();\n  x();\n", "x();", "y();")).toBeNull();
  });

  it("says so in the result, so the model knows to check", async () => {
    const { runner } = direct();
    const result = await runner.run(call("edit_file", { path: "src/app.ts", old_string: "  return \"hi\";  ", new_string: "  return \"hello\";" }), signal());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("indentation and trailing spaces were ignored");
    expect(await readFile(join(root, "src", "app.ts"), "utf8")).toBe("export function greet() {\n    return \"hello\";\n}\n");
  });

  it("still prefers an exact match and reports no note for it", () => {
    const applied = applyReplacements("a\nb\n", [{ oldString: "b", newString: "c", replaceAll: false }], "x.ts");
    expect(applied).toEqual({ ok: true, text: "a\nc\n", notes: [] });
  });
});

describe("read_file", () => {
  it("hands an image back as a picture", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await writeFile(join(root, "mock.png"), png);
    const { runner } = direct();
    const result = await runner.run(call("read_file", { path: "mock.png" }), signal());
    expect(result.isError).toBe(false);
    expect(result.images).toEqual([{ type: "image", mediaType: "image/png", data: png.toString("base64") }]);
  });

  it("pages a large file instead of refusing it", async () => {
    const lines = Array.from({ length: 30_000 }, (_, index) => `line ${index + 1} ${"x".repeat(20)}`);
    await writeFile(join(root, "big.log"), lines.join("\n"), "utf8");
    const { runner } = direct();
    const result = await runner.run(call("read_file", { path: "big.log" }), signal());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Showing lines 1-2000 of 30000");
    const later = await runner.run(call("read_file", { path: "big.log", offset: 29_999 }), signal());
    expect(later.content).toContain("30000 line 30000");
  });

  it("names a binary file instead of printing it", async () => {
    await writeFile(join(root, "data.bin"), Buffer.from([1, 0, 2, 0, 3]));
    const { runner } = direct();
    expect((await runner.run(call("read_file", { path: "data.bin" }), signal())).content).toContain("binary file");
  });

  it("shortens a minified line", async () => {
    await writeFile(join(root, "bundle.min.js"), "x".repeat(10_000), "utf8");
    const { runner } = direct();
    const result = await runner.run(call("read_file", { path: "bundle.min.js" }), signal());
    expect(result.content).toContain("more characters on this line");
    expect(result.content.length).toBeLessThan(3_000);
  });
});

describe("search", () => {
  beforeEach(async () => {
    await writeFile(join(root, "src", "math.ts"), "const a = add(1, 2);\nconst b = Add(3);\n// add(\nexport {};\n", "utf8");
  });

  it("searches for code as plain text with literal", async () => {
    const { runner } = direct();
    const regex = await runner.run(call("search", { pattern: "add(" }), signal());
    expect(regex.isError).toBe(true);
    expect(regex.content).toContain("literal: true");
    const literal = await runner.run(call("search", { pattern: "add(", literal: true, case_sensitive: true }), signal());
    expect(literal.content.split("\n")).toEqual(["src/math.ts:1: const a = add(1, 2);", "src/math.ts:3: // add("]);
  });

  it("shows context lines grep-style", async () => {
    const { runner } = direct();
    const result = await runner.run(call("search", { pattern: "Add\\(3", context: 1 }), signal());
    expect(result.content.split("\n")).toEqual([
      "src/math.ts-1- const a = add(1, 2);",
      "src/math.ts:2: const b = Add(3);",
      "src/math.ts-3- // add(",
    ]);
  });

  it("lists matching files only, and says when it stopped early", async () => {
    const { runner } = direct();
    const files = await runner.run(call("search", { pattern: "e", files_only: true }), signal());
    expect(files.content.split("\n").sort()).toEqual(["src/app.ts (2 matches)", "src/math.ts (1 match)"]);
    const capped = await runner.run(call("search", { pattern: "const", max_results: 1 }), signal());
    expect(capped.content).toContain("Stopped at 1 matches");
  });

  it("does not read binary files as text", async () => {
    await writeFile(join(root, "src", "blob.bin"), Buffer.concat([Buffer.from("add("), Buffer.from([0, 0, 0])]));
    const { runner } = direct();
    const result = await runner.run(call("search", { pattern: "add(", literal: true }), signal());
    expect(result.content).not.toContain("blob.bin");
  });
});

describe("update_plan", () => {
  it("accepts a plan and reads back the step under way", async () => {
    const { runner } = direct();
    const result = await runner.run(call("update_plan", {
      steps: [{ step: "Add header", status: "done" }, { step: "Add footer", status: "in_progress" }, { step: "Check phone", status: "pending" }],
    }), signal());
    expect(result).toEqual({ content: "Plan shown to the user: 1 of 3 done, now: Add footer.", isError: false });
  });

  it("explains a malformed plan", () => {
    expect(parsePlan({})).toContain("needs steps");
    expect(parsePlan({ steps: [{ step: "a", status: "doing" }] })).toContain("pending, in_progress or done");
    expect(parsePlan({ steps: [{ step: "a", status: "in_progress" }, { step: "b", status: "in_progress" }] })).toContain("Only one");
  });
});

describe("run_command", () => {
  const node = (script: string): string => `"${process.execPath}" -e "${script}"`;

  it("reports the real exit code and output", async () => {
    const { runner } = direct();
    const passed = await runner.run(call("run_command", { command: node("console.log('fine')") }), signal());
    expect(passed).toEqual({ content: "exit 0\nfine", isError: false });
    const failed = await runner.run(call("run_command", { command: node("console.error('broke'); process.exit(3)") }), signal());
    expect(failed).toEqual({ content: "exit 3\nbroke", isError: true });
  });

  it("stops a command at the timeout the model chose and says what to do instead", async () => {
    const { runner } = direct();
    const started = Date.now();
    const result = await runner.run(call("run_command", { command: node("setInterval(() => {}, 1000)"), timeout_seconds: 1 }), signal());
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Timed out after 1s");
    expect(result.content).toContain("background: true");
    expect((await runner.run(call("run_command", { command: "echo x", timeout_seconds: 9999 }), signal())).content).toContain("timeout_seconds is 1 to 600");
  });

  it("stops when the user presses Stop", async () => {
    const { runner } = direct();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const result = await runner.run(call("run_command", { command: node("setInterval(() => {}, 1000)") }), controller.signal);
    expect(result.content).toContain("Stopped before it finished");
  });

  it("runs a server in the background, reads it, and stops it", async () => {
    const commands = createCommandRunner();
    const { runner } = direct({ backgroundCommands: commands });
    try {
      const started = await runner.run(call("run_command", {
        command: node("console.log('Local: http://localhost:5173/'); setInterval(() => console.log('tick'), 200)"),
        background: true,
      }), signal());
      expect(started.isError).toBe(false);
      expect(started.content).toContain("Started cmd-1 in the background");
      expect(started.content).toContain("http://localhost:5173/");
      expect(started.content).toContain("view_page");

      const more = await runner.run(call("command_output", { id: "cmd-1", wait_seconds: 2 }), signal());
      expect(more.content).toContain("still running");
      expect(more.content).toContain("tick");

      const listed = await runner.run(call("command_output", {}), signal());
      expect(listed.content).toContain("cmd-1");

      const stopped = await runner.run(call("stop_command", { id: "cmd-1" }), signal());
      expect(stopped.content).toContain("exited");
      expect((await runner.run(call("stop_command", { id: "cmd-9" }), signal())).isError).toBe(true);
    } finally {
      commands.stopAll();
    }
  }, 20_000);

  it("recognises servers and watchers, and not builds or tests", () => {
    for (const line of ["npm run dev", "pnpm dev", "yarn start", "npx vite", "vite --port 3000", "next dev", "python -m http.server 8000", "php -S localhost:8000", "npx serve .", "npm run build -- --watch", "nodemon app.js"]) {
      expect(looksLikeServer(line), line).toBe(true);
    }
    for (const line of ["npm run build", "npx vite build", "npm test", "next build", "tsc --noEmit", "npm install", "echo serve", "node script.js"]) {
      expect(looksLikeServer(line), line).toBe(false);
    }
  });

  it("starts a server asked for in the foreground in the background instead", async () => {
    const commands = createCommandRunner();
    const { runner } = direct({ backgroundCommands: commands });
    try {
      // Mentioning a server is not starting one.
      const result = await runner.run(call("run_command", { command: "echo npm run dev" }), signal());
      expect(result).toEqual({ content: "exit 0\nnpm run dev", isError: false });
      // A line that names a dev server, kept running without a timeout:
      const started = await runner.run(call("run_command", { command: "npm run dev --if-present", timeout_seconds: 1 }), signal());
      expect(started.content).toContain("looks like a server");
      expect(started.content).toContain("Started cmd-");
    } finally {
      commands.stopAll();
    }
  }, 20_000);

  it("offers no background commands to an agent without a registry", async () => {
    const { runner } = direct();
    const result = await runner.run(call("run_command", { command: "echo x", background: true }), signal());
    expect(result.content).toContain("cannot leave commands running");
  });
});

describe("view_page", () => {
  it("hands a parsed request to the browser", async () => {
    const viewPage = vi.fn(async () => ({ content: "report", isError: false }));
    const { runner } = direct({ viewPage });
    await runner.run(call("view_page", { path: "about.html", width: 390, height: 844, actions: [{ type: "click", text: "Menu" }] }), signal());
    expect(viewPage).toHaveBeenCalledWith(
      { target: { kind: "preview", path: "about.html" }, width: 390, height: 844, actions: [{ type: "click", text: "Menu" }], screenshot: true, fullPage: false },
      expect.anything(),
    );
  });

  it("explains bad input without opening anything", async () => {
    const viewPage = vi.fn();
    const { runner } = direct({ viewPage });
    expect((await runner.run(call("view_page", { url: "https://example.com" }), signal())).content).toContain("local addresses only");
    expect((await runner.run(call("view_page", { actions: [{ type: "click" }] }), signal())).content).toContain("needs a selector");
    expect(viewPage).not.toHaveBeenCalled();
  });

  it("says plainly when an agent has no browser", async () => {
    const { runner } = direct();
    expect((await runner.run(call("view_page", {}), signal())).content).toContain("no browser");
  });
});
