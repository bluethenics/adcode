import { describe, expect, it } from "vitest";
import {
  aiWorkspaceContext,
  editorContextLines,
  parseAiEditorContext,
} from "../src/main/aiWorkspaceContext.ts";
import { localPreviewUrl } from "../src/renderer/ai/chatPreview.ts";

describe("assistant workspace context", () => {
  it("supplies the selected root and relative file tool instructions", () => {
    const context = aiWorkspaceContext("C:\\Projects\\my app", null);
    expect(context).toContain(JSON.stringify("C:\\Projects\\my app"));
    expect(context).toContain("Do not ask the user for its path");
    expect(context).toContain("create new files with propose_edit");
    expect(context).toContain("edit_file");
    expect(context).toContain("open_preview");
  });
  it("reports missing folders and actual file-tool blockers distinctly", () => {
    expect(aiWorkspaceContext(null, null)).toContain("no folder is open");
    const blocked = aiWorkspaceContext("/project", "Save open file changes.");
    expect(blocked).toContain("Save open file changes.");
    expect(blocked).not.toContain("File tools are available");
  });

  it("carries the editor state into the prompt when provided", () => {
    const context = aiWorkspaceContext("/project", null, {
      mode: "code",
      activeFile: "src/app.ts",
      languageId: "typescript",
      cursorLine: 12,
      selection: { startLine: 10, endLine: 14, text: "foo();\n" },
      openFiles: ["src/app.ts", "src/other.ts"],
      problems: ["line 3: error something broke"],
    });
    expect(context).toContain("looking at src/app.ts");
    expect(context).toContain("<selection>");
    expect(context).toContain("Other open editor tabs: src/other.ts.");
    expect(context).toContain("line 3: error something broke");
  });
});

describe("editor context lines", () => {
  it("says nothing without an editor", () => {
    expect(editorContextLines(null)).toEqual([]);
  });

  it("orients by mode and quotes the selection as data", () => {
    const lines = editorContextLines({
      mode: "code",
      activeFile: "a.ts",
      languageId: null,
      cursorLine: null,
      selection: { startLine: 2, endLine: 2, text: "x();\n" },
      openFiles: [],
      problems: [],
    });
    expect(lines.join("\n")).toContain('"This file" means it');
    expect(lines).toContain("<selection>");
  });

  it("hides selections in Vibe mode, where the editor is not visible", () => {
    const lines = editorContextLines({
      mode: "vibe",
      activeFile: "a.ts",
      languageId: null,
      cursorLine: 5,
      selection: null,
      openFiles: [],
      problems: ["line 1: warning shaky"],
    });
    const text = lines.join("\n");
    expect(text).toContain("Vibe mode");
    expect(text).toContain("Most recently active file: a.ts.");
    expect(text).toContain("line 1: warning shaky");
  });
});

describe("parseAiEditorContext", () => {
  it("accepts a well-formed editor snapshot", () => {
    expect(
      parseAiEditorContext({
        mode: "code",
        activeFile: "src/a.ts",
        languageId: "typescript",
        cursorLine: 7,
        selection: { startLine: 7, endLine: 9, text: "code();\n" },
        openFiles: ["src/a.ts"],
        problems: ["line 1: error boom"],
      }),
    ).toEqual({
      mode: "code",
      activeFile: "src/a.ts",
      languageId: "typescript",
      cursorLine: 7,
      selection: { startLine: 7, endLine: 9, text: "code();\n" },
      openFiles: ["src/a.ts"],
      problems: ["line 1: error boom"],
    });
  });

  it("drops malformed fields instead of failing the message", () => {
    expect(parseAiEditorContext(null)).toBeNull();
    expect(parseAiEditorContext([])).toBeNull();
    expect(parseAiEditorContext("no")).toBeNull();
    const parsed = parseAiEditorContext({
      mode: "party",
      activeFile: "",
      cursorLine: -3,
      selection: { startLine: 9, endLine: 7, text: "backwards" },
      openFiles: ["ok.ts", "", 42, "x".repeat(2000)],
      problems: ["", 7, "  ok  "],
    });
    expect(parsed?.mode).toBe("code");
    expect(parsed?.activeFile).toBeNull();
    expect(parsed?.cursorLine).toBeNull();
    expect(parsed?.selection).toBeNull();
    expect(parsed?.openFiles).toEqual(["ok.ts"]);
    expect(parsed?.problems).toEqual(["  ok  "]);
  });

  it("truncates an overlong selection rather than dropping it", () => {
    const parsed = parseAiEditorContext({
      selection: { startLine: 1, endLine: 400, text: `x\n`.repeat(9000) },
    });
    expect(parsed?.selection?.text).toContain("[selection truncated]");
    expect(parsed?.selection?.text.length).toBeLessThan(13_000);
  });
});

describe("embedded preview URL boundary", () => {
  it.each(["http://localhost:3000/", "http://127.0.0.1:5173/app", "http://[::1]:8000/"])("accepts local server %s", url => {
    expect(localPreviewUrl(url)).toBe(url);
  });
  it.each([null, "javascript:alert(1)", "file:///etc/passwd", "https://example.com", "http://127.0.0.1:3000@evil.example", "http://user:pass@localhost:3000", "http://localhost.evil.example"])("rejects non-preview address %s", url => {
    expect(localPreviewUrl(url)).toBeNull();
  });
});
