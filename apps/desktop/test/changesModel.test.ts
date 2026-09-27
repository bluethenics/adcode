import { describe, expect, it } from "vitest";
import {
  changeTotals,
  commitScope,
  defaultCommitMessage,
  diffLines,
  includeState,
  revertPlan,
  type ChangeEntry,
} from "../src/renderer/workbench/changesModel.ts";

const entry = (path: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({
  path,
  staged: "none",
  worktree: "modified",
  isConflicted: false,
  added: 1,
  removed: 0,
  ...over,
});
const untracked = (path: string): ChangeEntry => entry(path, { worktree: "untracked", added: null, removed: null });

describe("what a commit includes", () => {
  it("includes every file while nothing is staged - the vibecoder's case", () => {
    const entries = [entry("a.ts"), untracked("b.ts")];
    expect(commitScope(entries)).toEqual({ mode: "all", count: 2, blocked: false });
    expect(entries.map((item) => includeState(item, entries))).toEqual(["checked", "checked"]);
  });

  it("includes only the checked files once something is staged", () => {
    const entries = [entry("a.ts", { staged: "modified", worktree: "none" }), entry("b.ts"), untracked("c.ts")];
    expect(commitScope(entries)).toEqual({ mode: "staged", count: 1, blocked: false });
    expect(entries.map((item) => includeState(item, entries))).toEqual(["checked", "unchecked", "unchecked"]);
  });

  it("shows a file staged with later edits as partly included", () => {
    const entries = [entry("a.ts", { staged: "modified", worktree: "modified" })];
    expect(includeState(entries[0]!, entries)).toBe("partial");
  });

  it("refuses to commit while a conflict is unresolved", () => {
    const entries = [entry("a.ts"), entry("b.ts", { isConflicted: true })];
    expect(commitScope(entries).blocked).toBe(true);
  });
});

describe("the commit message nobody had to write", () => {
  it("names one file with a verb that fits", () => {
    expect(defaultCommitMessage([entry("css/app.css")])).toBe("Update css/app.css");
    expect(defaultCommitMessage([untracked("js/names.js")])).toBe("Add js/names.js");
    expect(defaultCommitMessage([entry("old.js", { worktree: "deleted" })])).toBe("Remove old.js");
  });

  it("names two, then summarises the rest", () => {
    expect(defaultCommitMessage([entry("a.ts"), entry("b.ts")])).toBe("Update a.ts and b.ts");
    expect(defaultCommitMessage([entry("a.ts"), untracked("b.ts"), entry("c.ts"), entry("d.ts")]))
      .toBe("Update a.ts, b.ts and 2 more files");
    expect(defaultCommitMessage([untracked("a.ts"), untracked("b.ts"), untracked("c.ts")]))
      .toBe("Add a.ts, b.ts and 1 more file");
  });
});

describe("revert", () => {
  it("unstages, then restores a tracked file to its last commit", () => {
    expect(revertPlan(entry("a.ts"))).toEqual({ unstage: false, restore: true, trash: false });
    expect(revertPlan(entry("a.ts", { staged: "modified", worktree: "modified" }))).toEqual({ unstage: true, restore: true, trash: false });
    expect(revertPlan(entry("a.ts", { staged: "deleted", worktree: "none" }))).toEqual({ unstage: true, restore: true, trash: false });
  });

  it("moves a new file to the bin rather than deleting it", () => {
    expect(revertPlan(untracked("b.ts"))).toEqual({ unstage: false, restore: false, trash: true });
    expect(revertPlan(entry("b.ts", { staged: "added", worktree: "none" }))).toEqual({ unstage: true, restore: false, trash: true });
  });
});

describe("totals and diffs", () => {
  it("adds up what git counted and skips what it could not", () => {
    expect(changeTotals([entry("a", { added: 3, removed: 1 }), untracked("b"), entry("c", { added: 2, removed: 5 })])).toEqual({ added: 5, removed: 6 });
  });

  it("keeps the hunks of a diff, coloured by kind, without git's headers", () => {
    const text = [
      "diff --git a/a.ts b/a.ts",
      "index 1..2 100644",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
      "\\ No newline at end of file",
    ].join("\n");
    expect(diffLines(text)).toEqual({
      lines: [
        { kind: "hunk", text: "@@ -1,2 +1,2 @@" },
        { kind: "context", text: " keep" },
        { kind: "del", text: "-old" },
        { kind: "add", text: "+new" },
      ],
      truncated: false,
    });
  });

  it("caps a long diff and says so", () => {
    const text = ["@@ -1 +1,500 @@", ...Array.from({ length: 500 }, (_, index) => `+line ${index}`)].join("\n");
    const result = diffLines(text, 100);
    expect(result.lines).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
});
