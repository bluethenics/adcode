import { describe, expect, it } from "vitest";
import { EditorGroups } from "../src/renderer/editor/editorGroups.ts";

describe("editor groups", () => {
  it("opens files in the focused group without replacing its neighbour", () => {
    const groups = new EditorGroups();
    groups.open("one.ts");
    groups.split("two.ts");
    groups.open("three.ts");
    expect(groups.paths).toEqual(["one.ts", "three.ts"]);
    groups.focus(0);
    groups.open("four.ts");
    expect(groups.paths).toEqual(["four.ts", "three.ts"]);
  });

  it("keeps the focused file when returning to one panel", () => {
    const groups = new EditorGroups();
    groups.open("one.ts");
    groups.split("two.ts");
    groups.collapse();
    expect(groups.paths).toEqual(["two.ts", null]);
    expect(groups.active).toBe(0);
    expect(groups.isSplit).toBe(false);
  });

  it("collapses around a surviving file when either visible file closes", () => {
    for (const path of ["one.ts", "two.ts"]) {
      const groups = new EditorGroups();
      groups.open("one.ts");
      groups.split("two.ts");
      groups.close(path);
      expect(groups.paths).toEqual([path === "one.ts" ? "two.ts" : "one.ts", null]);
      expect(groups.isSplit).toBe(false);
    }
  });

  it("follows renames in both views and closes a shared file in both", () => {
    const groups = new EditorGroups();
    groups.open("one.ts");
    groups.split("one.ts");
    groups.rename("one.ts", "renamed.ts");
    expect(groups.paths).toEqual(["renamed.ts", "renamed.ts"]);
    groups.close("renamed.ts");
    expect(groups.paths).toEqual([null, null]);
  });

  it("leaves visible files alone when a background tab closes", () => {
    const groups = new EditorGroups();
    groups.open("one.ts");
    groups.split("two.ts");
    groups.close("background.ts");
    expect(groups.paths).toEqual(["one.ts", "two.ts"]);
    expect(groups.active).toBe(1);
  });
});
