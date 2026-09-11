import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorHost = readFileSync(
  new URL("../src/renderer/editor/editorHost.ts", import.meta.url),
  "utf8",
);
const editorCss = readFileSync(
  new URL("../src/renderer/styles/editor.css", import.meta.url),
  "utf8",
);

describe("breakpoint gutter", () => {
  it("previews a breakpoint target beside a hovered line number", () => {
    expect(editorCss).toMatch(/\.margin-view-overlays\s*>\s*div:hover[^{]*::before/);
    expect(editorCss).toContain("var(--danger)");
    expect(editorCss).toContain("opacity:");
  });

  it("labels the hovered target and moves the cursor to a toggled breakpoint", () => {
    expect(editorHost).toContain("Add breakpoint at line");
    expect(editorHost).toContain("Remove breakpoint at line");
    expect(editorHost).toContain("editor.setPosition({ lineNumber: line, column: 1 })");
  });
});
