import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() } }));

const workspace = await import("../src/main/workspace.ts");
const { assignWindowToGroup, currentGroup, currentWorkspace, groupShowing, MAIN_GROUP, noteFocusedGroup, onWorkspaceRootChanged, openWorkspaceRoots, releaseWindow, runInGroup, setWorkspaceRoot } = workspace;

describe("one project per window group", () => {
  it("answers currentWorkspace for the window that is asking, through awaits and timers", async () => {
    assignWindowToGroup(1, MAIN_GROUP);
    assignWindowToGroup(2, "w-second");
    runInGroup(MAIN_GROUP, () => setWorkspaceRoot("C:/work/shop"));
    runInGroup("w-second", () => setWorkspaceRoot("C:/work/blog"));

    const seen = await runInGroup("w-second", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return currentWorkspace()?.root;
    });
    expect(seen).toBe("C:/work/blog");
    expect(runInGroup(MAIN_GROUP, () => currentWorkspace()?.root)).toBe("C:/work/shop");
    expect(openWorkspaceRoots().sort()).toEqual(["C:/work/blog", "C:/work/shop"]);
  });

  it("gives code no window called the project of the window focused last", () => {
    noteFocusedGroup("w-second");
    expect(currentGroup()).toBe("w-second");
    expect(currentWorkspace()?.root).toBe("C:/work/blog");
    noteFocusedGroup(MAIN_GROUP);
    expect(currentWorkspace()?.root).toBe("C:/work/shop");
  });

  it("finds the window already showing a folder, whatever its slashes or case", () => {
    expect(groupShowing("c:/work/BLOG/")).toBe("w-second");
    expect(groupShowing("C:/work/other")).toBeNull();
  });

  it("tells listeners which group changed and what it had, and lets a closed group's project go", () => {
    const heard: Array<{ root: string | null; group: string; previous: string | null }> = [];
    onWorkspaceRootChanged((root, change) => heard.push({ root, ...change }));
    releaseWindow(2);
    expect(heard).toEqual([{ root: null, group: "w-second", previous: "C:/work/blog" }]);
    expect(openWorkspaceRoots()).toEqual(["C:/work/shop"]);
    expect(groupShowing("C:/work/blog")).toBeNull();
    // The first group keeps its folder even with no window: the next one opened there gets it back.
    releaseWindow(1);
    expect(runInGroup(MAIN_GROUP, () => currentWorkspace()?.root)).toBe("C:/work/shop");
  });
});
