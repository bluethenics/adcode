/**
 * What a resized sidebar and panel are allowed to be.
 *
 * Pure and DOM-free, so every awkward case is testable in milliseconds instead of by
 * dragging a real window about: a size restored from a larger monitor, a window shrunk
 * below the sum of its own minimums, and whatever a hand-edited session file contains.
 *
 * The main process validates these too, but it cannot do this job: it does not know how
 * big the window is. It checks that a stored number is a number; this decides whether the
 * number still makes sense on the screen in front of the user.
 */

export const DEFAULT_SIDEBAR_WIDTH = 240;
export const DEFAULT_PANEL_HEIGHT = 260;

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 600;

const PANEL_MIN = 80;
/** No more than this share of the window, however hard the divider is dragged. */
const PANEL_MAX_SHARE = 0.8;

/** What the editor keeps for itself before anything else gets to grow. */
const EDITOR_MIN_WIDTH = 320;
const EDITOR_MIN_HEIGHT = 120;

export function clampSidebarWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;

  /*
   * `Math.max(SIDEBAR_MIN, …)` on the ceiling, not just the floor.
   *
   * On a window too narrow to satisfy both minimums the two rules disagree, and the
   * sidebar's floor is the one to keep: a sidebar squeezed to twenty pixels has no edge
   * left to grab, so the layout cannot be dragged back. Overflowing a very narrow window
   * is recoverable; a control that cannot be reached is not.
   */
  const ceiling = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, windowWidth - EDITOR_MIN_WIDTH));
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(width, ceiling)));
}

export function clampPanelHeight(height: number, windowHeight: number): number {
  if (!Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;

  const ceiling = Math.max(
    PANEL_MIN,
    Math.min(windowHeight * PANEL_MAX_SHARE, windowHeight - EDITOR_MIN_HEIGHT),
  );
  return Math.round(Math.max(PANEL_MIN, Math.min(height, ceiling)));
}
