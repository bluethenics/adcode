import { describe, expect, it } from "vitest";
import {
  describeVibeProject,
  projectName,
  recentProjectsFor,
  summarizeVibeChanges,
} from "../src/renderer/workbench/vibeSidebarModel.ts";
import type { AiWorkspaceTaskStateView } from "../src/shared/api.ts";

const task = (state: AiWorkspaceTaskStateView, files = 0) => ({ state, changedPaths: Array.from({ length: files }, (_, i) => `f${i}.ts`) });
const git = (entries: number, extra: Partial<{ isRepo: boolean; branch: string | null; hasConflicts: boolean }> = {}) => ({
  isRepo: true,
  branch: "main",
  hasConflicts: false,
  entries: Array.from({ length: entries }, (_, i) => ({ path: `f${i}`, staged: " ", worktree: "M", isConflicted: false })),
  ...extra,
});

describe("Vibe sidebar changes badge", () => {
  it("puts changes waiting to apply ahead of the uncommitted count", () => {
    const summary = summarizeVibeChanges(git(12), [task("review", 2), task("conflict", 1), task("applied", 4)]);
    expect(summary).toMatchObject({ proposals: 2, uncommitted: 12, badge: "2", attention: true });
    expect(summary.description).toBe("2 AI tasks waiting to apply, 12 uncommitted files");
  });

  it("shows the uncommitted count without alarm when nothing is proposed", () => {
    expect(summarizeVibeChanges(git(1), [])).toMatchObject({ badge: "1", attention: false, description: "1 uncommitted file" });
    expect(summarizeVibeChanges(git(250), []).badge).toBe("99+");
  });

  it("flags conflicts and handles folders without Git", () => {
    expect(summarizeVibeChanges(git(1, { hasConflicts: true }), []).attention).toBe(true);
    expect(summarizeVibeChanges(git(0), [])).toMatchObject({ badge: "", description: "Working tree clean" });
    expect(summarizeVibeChanges(git(3, { isRepo: false }), [])).toMatchObject({ uncommitted: 0, badge: "", description: "No changes" });
    expect(summarizeVibeChanges(null, [])).toMatchObject({ badge: "" });
  });
});

describe("Vibe project card", () => {
  it("names the folder on either platform", () => {
    expect(projectName("E:\\work\\shop\\")).toBe("shop");
    expect(projectName("/home/me/site")).toBe("site");
    expect(projectName(null)).toBe("No project open");
  });

  it("describes branch and change state", () => {
    expect(describeVibeProject(null, null)).toBe("Choose a folder to start");
    expect(describeVibeProject("/p", null)).toBe("Loading…");
    expect(describeVibeProject("/p", git(0))).toBe("main · clean");
    expect(describeVibeProject("/p", git(4))).toBe("main · 4 changed");
    expect(describeVibeProject("/p", git(1, { branch: null }))).toBe("Detached HEAD · 1 changed");
    expect(describeVibeProject("/p", git(1, { hasConflicts: true }))).toBe("main · conflicts");
    expect(describeVibeProject("/p", git(0, { isRepo: false }))).toBe("Not a Git repository");
  });

  it("offers recent projects other than the open one", () => {
    const recents = ["E:\\a", "E:\\b", "E:/c", "E:\\d"].map((path, i) => ({ path, name: path.slice(-1), openedAt: 10 - i }));
    expect(recentProjectsFor(recents, "e:/b/").map((folder) => folder.path)).toEqual(["E:\\a", "E:/c", "E:\\d"]);
    expect(recentProjectsFor(recents, null, 2).map((folder) => folder.path)).toEqual(["E:\\a", "E:\\b"]);
  });
});
