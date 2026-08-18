/**
 * One definition of what an icon is.
 *
 * This file exists because there were five. `previewPane.ts` had a local `iconButton`,
 * `main.ts` built its own SVG for tree rows, `runButton.ts` built another, `fileIcons.ts` a
 * fourth - and four surfaces drew their close button as the text character `×` instead of
 * drawing anything at all. "Check all the buttons" is not a task you can finish while the
 * answer to "what is a button's icon" lives in five places, so now it lives here.
 *
 * **Why the text glyph was wrong, and not merely inconsistent.** `×` is U+00D7 MULTIPLICATION
 * SIGN - a mathematical operator. A font positions it on the maths axis, around the height of
 * a minus sign and centred on the x-height rather than on the em box, so it renders visibly
 * high in a square button even when the box centres it perfectly. The four buttons using it
 * also had no centring mechanism at all: `line-height: 1` and the default `text-align: center`
 * centre horizontally and then leave the vertical position to the baseline, which sits low.
 * The two errors point in opposite directions, so they do not cancel - which is exactly why
 * the icons looked off rather than uniformly shifted.
 *
 * A stroked path in a `viewBox` has no baseline, no x-height and no font metrics. Drawn
 * symmetric about (8, 8) it is centred by construction, on every platform and at every font
 * size. That is the whole reason to prefer it over a character that happens to look close.
 *
 * **The one rule for adding an icon here:** draw it symmetric about (8, 8) in the 16×16
 * viewBox. Geometry is what centres these, so an icon whose ink sits off-centre in its own
 * box cannot be rescued by CSS downstream.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The 16×16 grid every icon is drawn on. Sizing is CSS's job, never the path's. */
const VIEW_BOX = "0 0 16 16";

/**
 * Every icon path in the workbench.
 *
 * Grouped by what they are for rather than alphabetically, because the reason two icons
 * should look related is that they do related things.
 */
export const ICON = {
  /* ── Dismissal ──────────────────────────────────────────────────────────── */

  /** Symmetric about (8, 8): the diagonals cross exactly at the centre. */
  close: "M4 4l8 8M12 4l-8 8",

  /* ── Staging, in the source-control panel ───────────────────────────────── */

  /**
   * Stage and unstage.
   *
   * These replaced the characters "+" and "−" (U+2212 MINUS SIGN). Both are maths operators
   * and carry the same defect as "×": the glyph sits on the font's maths axis, so it draws
   * high in a square button, and the two have different widths so the control's contents
   * shifted as a file moved between staged and unstaged.
   */
  plus: "M8 4.5v7M4.5 8h7",
  minus: "M4.5 8h7",

  /* ── Preview ────────────────────────────────────────────────────────────── */

  reload: "M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3",
  external: "M6.5 3H3v10h10V9.5M9.5 2.5H13.5V6.5M13.5 2.5L7 9",
  /** Arrows pushing apart - the pane leaving its slot to float free. */
  undock: "M9.5 6.5l4-4M10.5 2.5h3v3M6.5 9.5l-4 4M5.5 13.5h-3v-3",
  /** Arrows pulling together - the card returning to its slot. */
  dock: "M2.5 2.5l4 4M6.5 3.5v3h-3M13.5 13.5l-4-4M9.5 12.5v-3h3",
  output: "M2.5 3.5h11M2.5 8h11M2.5 12.5h7",

  /* ── Severity, for the Problems panel's badges ──────────────────────────── */

  /** Drawn smaller than `close` because it sits inside a 16px circle, not beside one. */
  severityError: "M5.25 5.25l5.5 5.5M10.75 5.25l-5.5 5.5",
  /** Stem and dot, both centred on x = 8. */
  severityWarning: "M8 4.25v4.25M8 11.25v.5",
  /** The same two marks inverted, which is what makes an `i` an `i` and not a `!`. */
  severityInfo: "M8 11.75V7.5M8 4.75v.5",

  /* ── Earnings ───────────────────────────────────────────────────────────── */

  /**
   * A dollar sign, drawn rather than typed.
   *
   * 180° rotationally symmetric about (8, 8), so the S and the bar are both centred by
   * construction. The character `$` would not be: like `×`, it is positioned by font metrics
   * and sits on a baseline.
   *
   * The activity bar carries its own 24×24 copy of this inline in `index.html`, because every
   * icon in that bar is drawn on a 24 grid rather than this file's 16.
   */
  earnings: "M10.5 6.1C10.5 5.1 9.4 4.5 8 4.5S5.5 5.1 5.5 6.1c0 1.2 1.2 1.6 2.5 1.9s2.5.7 2.5 1.9c0 1-1.1 1.6-2.5 1.6s-2.5-.6-2.5-1.6M8 3v10",
} as const;

export type IconName = keyof typeof ICON;

/**
 * Build an icon element.
 *
 * `aria-hidden` throughout: every caller labels the *control* instead, so a screen reader
 * announces "Close tab" rather than the decoration inside the button.
 */
export function createIcon(paths: string | readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");

  for (const data of typeof paths === "string" ? [paths] : paths) {
    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute("d", data);
    svg.append(shape);
  }

  return svg;
}

/**
 * An icon button, labelled for both the pointer and the screen reader.
 *
 * `title` and `aria-label` carry the same string on purpose. They serve different readers
 * and letting them drift is how a tooltip ends up describing a button that used to do
 * something else.
 */
export function iconButton(
  label: string,
  paths: string | readonly string[],
  className = "icon-button",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(paths));

  return button;
}
