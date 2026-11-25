import { describe, expect, it } from "vitest";
import {
  MAX_VIEW_LINES,
  ancestorsOf,
  filterTree,
  isHeavyFolder,
  isImageFile,
  relativeTo,
  sortTree,
  viewPlan,
  type TreeEntry,
} from "../src/renderer/workbench/codeBrowserModel.ts";

const file = (path: string): TreeEntry => ({ name: path.split("/").pop()!, path, isDirectory: false });
const folder = (path: string): TreeEntry => ({ name: path.split("/").pop()!, path, isDirectory: true });

describe("the Code view's tree", () => {
  it("lists folders first, then files, in the order a person reads names", () => {
    const sorted = sortTree([file("/p/b.ts"), folder("/p/src"), file("/p/A.md"), file("/p/item10.ts"), file("/p/item2.ts"), folder("/p/Assets")]);
    expect(sorted.map((entry) => entry.name)).toEqual(["Assets", "src", "A.md", "b.ts", "item2.ts", "item10.ts"]);
  });

  it("dims generated and private folders", () => {
    expect(isHeavyFolder("node_modules")).toBe(true);
    expect(isHeavyFolder(".git")).toBe(true);
    expect(isHeavyFolder("src")).toBe(false);
  });

  it("shows paths relative to the project, on either slash", () => {
    expect(relativeTo("/p", "/p/src/app.ts")).toBe("src/app.ts");
    expect(relativeTo("C:\\Work\\app", "c:\\work\\app\\src\\a.ts")).toBe("src/a.ts");
    expect(relativeTo("/p", "/other/x.ts")).toBe("/other/x.ts");
    expect(relativeTo("/p", "/project/x.ts")).toBe("/project/x.ts");
    expect(relativeTo(null, "/p/x.ts")).toBe("/p/x.ts");
  });

  it("finds the folders to open to reveal a file", () => {
    expect(ancestorsOf("/p", "/p/src/ui/button.tsx")).toEqual(["/p/src", "/p/src/ui"]);
    expect(ancestorsOf("C:\\app", "C:\\app\\src\\a.ts")).toEqual(["C:\\app\\src"]);
    expect(ancestorsOf("/p", "/p/readme.md")).toEqual([]);
    expect(ancestorsOf("/p", "/elsewhere/a.ts")).toEqual([]);
  });

  it("filters to matching names and the folders that lead to them", () => {
    const loaded = new Map<string, TreeEntry[]>([
      ["/p", [folder("/p/src"), file("/p/readme.md")]],
      ["/p/src", [folder("/p/src/ui"), file("/p/src/main.ts")]],
      ["/p/src/ui", [file("/p/src/ui/Button.tsx")]],
    ]);
    expect([...filterTree(loaded, "/p", "button")].sort()).toEqual(["/p/src", "/p/src/ui", "/p/src/ui/Button.tsx"]);
    expect(filterTree(loaded, "/p", "  ").size).toBe(0);
  });
});

describe("what the reader shows", () => {
  it("shows text with its line count", () => {
    expect(viewPlan("a\nb\nc")).toEqual({ kind: "text", lines: 3 });
    expect(viewPlan("")).toEqual({ kind: "text", lines: 1 });
  });

  it("refuses bytes and files too big to draw, rather than freezing the panel", () => {
    expect(viewPlan("PNG\u0000\u0001")).toEqual({ kind: "binary" });
    expect(viewPlan("x\n".repeat(MAX_VIEW_LINES + 1)).kind).toBe("too-large");
    expect(viewPlan("x".repeat(700_000)).kind).toBe("too-large");
  });

  it("knows an image by its name", () => {
    expect(isImageFile("logo.PNG")).toBe(true);
    expect(isImageFile("icon.svg")).toBe(true);
    expect(isImageFile("app.ts")).toBe(false);
  });
});
