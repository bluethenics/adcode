/**
 * The floating panel replaces every right-hand dock, so its accessibility contract is the
 * thing most likely to regress silently: a non-modal dialog that screen readers announce,
 * resize handles on every edge, and a narrow-window sheet mode. The geometry is tested in
 * `floatingLayout.test.ts`; this pins the DOM and CSS the geometry drives.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/renderer/workbench/floatingPanel.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/renderer/styles/floatingPanel.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/renderer/main.ts", import.meta.url), "utf8");

describe("floating panel", () => {
  it("is a labelled, non-modal dialog", () => {
    expect(source).toContain('setAttribute("role", "dialog")');
    expect(source).toContain('setAttribute("aria-modal", "false")');
    expect(source).toContain('setAttribute("aria-labelledby"');
  });

  it("resizes from all eight edges through the shared geometry", () => {
    expect(source).toContain('["n", "s", "e", "w", "ne", "nw", "se", "sw"]');
    expect(source).toContain("floating-panel-edge");
    expect(source).toContain("resizeGeometry(");
  });

  it("clamps remembered geometry and becomes a sheet on narrow windows", () => {
    expect(source).toContain("clampToViewport(");
    expect(source).toContain("FLOATING_SHEET_BREAKPOINT");
    expect(styles).toContain('.floating-panel[data-sheet="true"]');
  });

  it("closes on Escape and gives focus back", () => {
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain("returnFocus");
  });

  it("maximises on a header double-click", () => {
    expect(source).toContain('"dblclick"');
    expect(source).toContain("maximisedIn(");
  });

  it("is styled by the app", () => {
    expect(main).toContain('import "./styles/floatingPanel.css";');
  });
});
