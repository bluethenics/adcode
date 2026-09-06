import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initialWorkbenchLayout,
  reduceWorkbenchLayout,
} from "../src/renderer/workbench/workbenchLayout.ts";

const WORKBENCH_CSS = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/renderer/styles/workbench.css"),
  "utf8",
);

describe("workbench layout", () => {
  it("collapses an already-selected docked sidebar view", () => {
    const state = initialWorkbenchLayout(1200, "explorer");

    expect(reduceWorkbenchLayout(state, { type: "toggle-sidebar", view: "explorer" }))
      .toMatchObject({ sidebarOpen: false, dockedSidebarOpen: false });
  });

  it("keeps only Explorer and Search in structural sidebar state", () => {
    const explorer = initialWorkbenchLayout(1200, "explorer");
    const search = reduceWorkbenchLayout(explorer, { type: "show-sidebar", view: "search" });

    expect(search.activeSidebarView).toBe("search");
    expect(search.sidebarOpen).toBe(true);
  });

  it("excludes popup tools from the structural sidebar type", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/desktop/src/renderer/workbench/workbenchLayout.ts"),
      "utf8",
    );
    expect(source).toContain('export type SidebarViewId = "explorer" | "search";');
    expect(source).not.toContain('| "structure"');
    expect(source).not.toContain('| "source-control"');
  });

  it("enters a narrow window with the overlay closed and restores the docked state", () => {
    const overlay = reduceWorkbenchLayout(initialWorkbenchLayout(1200, "search"), {
      type: "viewport",
      width: 760,
    });

    expect(overlay).toMatchObject({
      sidebarMode: "overlay",
      sidebarOpen: false,
      dockedSidebarOpen: true,
      activeSidebarView: "search",
    });
    expect(reduceWorkbenchLayout(overlay, { type: "viewport", width: 1200 }))
      .toMatchObject({ sidebarMode: "docked", sidebarOpen: true });
  });

  it("does not let closing an overlay erase the saved docked preference", () => {
    const overlay = reduceWorkbenchLayout(initialWorkbenchLayout(1200), {
      type: "viewport",
      width: 760,
    });
    const opened = reduceWorkbenchLayout(overlay, { type: "show-sidebar", view: "search" });
    const closed = reduceWorkbenchLayout(opened, { type: "close-sidebar" });

    expect(closed).toMatchObject({ sidebarOpen: false, dockedSidebarOpen: true });
    expect(reduceWorkbenchLayout(closed, { type: "viewport", width: 1200 }).sidebarOpen)
      .toBe(true);
  });

  it("restores the selected view without opening a narrow drawer", () => {
    const overlay = initialWorkbenchLayout(760, "explorer");
    const restored = reduceWorkbenchLayout(overlay, {
      type: "restore-sidebar-view",
      view: "search",
    });

    expect(restored).toMatchObject({
      sidebarMode: "overlay",
      sidebarOpen: false,
      activeSidebarView: "search",
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

  it("keeps the maximized panel margin box inside the workbench", () => {
    const rule = WORKBENCH_CSS.match(
      /\.main\[data-panel-maximized="true"\] > \.panel\s*\{(?<body>[^}]*)\}/,
    )?.groups?.["body"];

    expect(rule).toBeDefined();
    expect(rule).toContain("margin: 8px;");
    expect(rule).toContain("height: auto;");
    expect(rule).not.toContain("height: 100%;");
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
