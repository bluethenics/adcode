import { describe, expect, it } from "vitest";
import {
  initialWorkbenchLayout,
  reduceWorkbenchLayout,
} from "../src/renderer/workbench/workbenchLayout.ts";

describe("workbench layout", () => {
  it("collapses an already-selected docked sidebar view", () => {
    const state = initialWorkbenchLayout(1200, "explorer");

    expect(reduceWorkbenchLayout(state, { type: "toggle-sidebar", view: "explorer" }))
      .toMatchObject({ sidebarOpen: false, dockedSidebarOpen: false });
  });

  it("switches views and opens the sidebar", () => {
    const closed = {
      ...initialWorkbenchLayout(1200, "explorer"),
      sidebarOpen: false,
      dockedSidebarOpen: false,
    };

    expect(reduceWorkbenchLayout(closed, { type: "show-sidebar", view: "structure" }))
      .toMatchObject({
        sidebarOpen: true,
        dockedSidebarOpen: true,
        activeSidebarView: "structure",
      });
  });

  it("enters a narrow window with the overlay closed and restores the docked state", () => {
    const overlay = reduceWorkbenchLayout(initialWorkbenchLayout(1200, "earnings"), {
      type: "viewport",
      width: 760,
    });

    expect(overlay).toMatchObject({
      sidebarMode: "overlay",
      sidebarOpen: false,
      dockedSidebarOpen: true,
      activeSidebarView: "earnings",
    });
    expect(reduceWorkbenchLayout(overlay, { type: "viewport", width: 1200 }))
      .toMatchObject({ sidebarMode: "docked", sidebarOpen: true });
  });

  it("does not let closing an overlay erase the saved docked preference", () => {
    const overlay = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
      type: "viewport",
      width: 760,
    });
    const opened = reduceWorkbenchLayout(overlay, { type: "show-sidebar", view: "features" });
    const closed = reduceWorkbenchLayout(opened, { type: "close-sidebar" });

    expect(closed).toMatchObject({ sidebarOpen: false, dockedSidebarOpen: true });
    expect(reduceWorkbenchLayout(closed, { type: "viewport", width: 1200 }).sidebarOpen)
      .toBe(true);
  });

  it("restores the selected view without opening a narrow drawer", () => {
    const overlay = initialWorkbenchLayout(760, "explorer");
    const restored = reduceWorkbenchLayout(overlay, {
      type: "restore-sidebar-view",
      view: "settings",
    });

    expect(restored).toMatchObject({
      sidebarMode: "overlay",
      sidebarOpen: false,
      activeSidebarView: "settings",
    });
  });

  it("keeps panel maximization through unrelated layout changes", () => {
    const maximized = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
      type: "toggle-panel-maximized",
    });

    expect(maximized.panelMaximized).toBe(true);
    expect(reduceWorkbenchLayout(maximized, { type: "viewport", width: 800 }).panelMaximized)
      .toBe(true);
  });

  it("restores a maximized panel idempotently", () => {
    const maximized = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
      type: "toggle-panel-maximized",
    });
    const restored = reduceWorkbenchLayout(maximized, { type: "restore-panel" });

    expect(restored.panelMaximized).toBe(false);
    expect(reduceWorkbenchLayout(restored, { type: "restore-panel" })).toEqual(restored);
  });
});
