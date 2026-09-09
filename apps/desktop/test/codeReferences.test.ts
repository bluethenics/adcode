import { describe, expect, it } from "vitest";
import { codeReferenceParts, markdownCodeReference, parseCodeReference } from "../src/renderer/editor/codeReferences.ts";

describe("Markdown code references", () => {
  it("accepts GitHub line anchors and VS Code line/column locations", () => {
    expect(parseCodeReference("src/app.ts#L42-L48")).toEqual({ path: "src/app.ts", line: 42, column: 1 });
    expect(parseCodeReference("C:\\project\\app.ts:42:5")).toEqual({ path: "C:/project/app.ts", line: 42, column: 5 });
  });
  it("round trips spaces, parentheses, brackets and Windows paths", () => {
    for (const path of ["src/my file (1).ts", "src/[id]/page.ts", "C:\\project\\app.ts", "src/a#b.ts"]) {
      const parts = codeReferenceParts(markdownCodeReference(path, 12, 18));
      expect(parts.find(part => part.reference)?.reference).toEqual({ path: path.replace(/\\/g, "/"), line: 12, column: 1 });
    }
  });
  it("leaves commands, remote links and invalid locations inert", () => {
    for (const target of ["command:delete#L1", "https://example.com/x#L2", "javascript:alert(1)#L2", "//host/file#L1", "src/a.ts:0", "src/a.ts:2:0", "%00file#L1", "%ZZ#L1"]) {
      expect(parseCodeReference(target)).toBeNull();
    }
  });
  it("preserves incomplete streamed links until their closing delimiter arrives", () => {
    const partial = "Open [app](src/app.ts#L4";
    expect(codeReferenceParts(partial)).toEqual([{ text: partial }]);
    expect(codeReferenceParts(partial + ")").find(part => part.reference)?.reference?.line).toBe(4);
  });
  it("does not activate references inside code examples", () => {
    const text = "`[inline](app.ts#L1)`\n```md\n[example](app.ts#L2)\n```\n[real](app.ts#L3)";
    expect(codeReferenceParts(text).filter(part => part.reference).map(part => part.reference?.line)).toEqual([3]);
  });
});
