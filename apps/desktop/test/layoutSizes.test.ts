import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_HEIGHT,
  DEFAULT_SIDEBAR_WIDTH,
  clampPanelHeight,
  clampSidebarWidth,
} from "../src/renderer/workbench/layoutSizes.ts";

/**
 * The rules that keep a resized layout usable.
 *
 * Pure, so the awkward cases are exercised in milliseconds rather than by dragging a real
 * window to the edge of the screen: a restored size from a much larger monitor, a window
 * shrunk below the sum of its own minimums, and the values a corrupted session file can
 * hold.
 */
describe("clampSidebarWidth", () => {
  const WIDE = 1600;

  it("leaves a reasonable width alone", () => {
    expect(clampSidebarWidth(320, WIDE)).toBe(320);
  });

  it("holds a floor, so the sidebar cannot be dragged to a sliver", () => {
    expect(clampSidebarWidth(10, WIDE)).toBe(150);
    expect(clampSidebarWidth(-500, WIDE)).toBe(150);
  });

  it("holds a ceiling, so it cannot eat the whole window", () => {
    expect(clampSidebarWidth(5000, WIDE)).toBe(600);
  });

  it("always leaves room for the editor on a narrow window", () => {
    // 800px window: the ceiling is what is left after the editor's minimum, not 600.
    const width = clampSidebarWidth(600, 800);
    expect(width).toBeLessThan(600);
    expect(800 - width).toBeGreaterThanOrEqual(320);
  });

  it("prefers the floor over the editor's minimum when the window is tiny", () => {
    // Both cannot be honoured at 300px wide. A sidebar at its floor is recoverable;
    // one clamped to near zero is a sidebar the user cannot grab to drag back.
    expect(clampSidebarWidth(240, 300)).toBe(150);
  });

  it("brings a width stored on a bigger monitor back into range", () => {
    expect(clampSidebarWidth(900, 1000)).toBe(600);
    expect(clampSidebarWidth(900, 700)).toBe(380);
  });

  it("falls back to the default for values a session file should not contain", () => {
    expect(clampSidebarWidth(Number.NaN, WIDE)).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY, WIDE)).toBe(DEFAULT_SIDEBAR_WIDTH);
  });

  it("returns whole pixels", () => {
    expect(clampSidebarWidth(240.6, WIDE)).toBe(241);
    expect(Number.isInteger(clampSidebarWidth(333.33, WIDE))).toBe(true);
  });
});

describe("clampPanelHeight", () => {
  const TALL = 1000;

  it("leaves a reasonable height alone", () => {
    expect(clampPanelHeight(300, TALL)).toBe(300);
  });

  it("holds a floor, so the terminal cannot be dragged shut by accident", () => {
    // Closing the panel is what the close button and Ctrl+J are for; a drag that leaves a
    // 2px strip is an accident with no obvious way back.
    expect(clampPanelHeight(4, TALL)).toBe(80);
  });

  it("never takes the whole window", () => {
    const height = clampPanelHeight(5000, TALL);
    expect(height).toBeLessThanOrEqual(TALL * 0.8);
    expect(TALL - height).toBeGreaterThanOrEqual(120);
  });

  it("brings a height stored on a taller window back into range", () => {
    expect(clampPanelHeight(900, 500)).toBe(380);
  });

  it("falls back to the default for values a session file should not contain", () => {
    expect(clampPanelHeight(Number.NaN, TALL)).toBe(DEFAULT_PANEL_HEIGHT);
    expect(clampPanelHeight(-1, TALL)).toBe(80);
  });
});
