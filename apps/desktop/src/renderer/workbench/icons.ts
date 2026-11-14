import { createElement as createLucideElement, type IconNode } from "lucide";

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

/** Legacy workbench paths use 16×16; Lucide nodes retain their native 24×24 grid. */
const VIEW_BOX = "0 0 16 16";

/**
 * Every icon path in the workbench.
 *
 * Grouped by what they are for rather than alphabetically, because the reason two icons
 * should look related is that they do related things.
 */
export const ICON = {
  projects: "M2 5h4l1.5 2H14v7H2zM3.5 5V2h4l1.5 2h3.5v3",
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
  /* A tablet beside a phone: "the same page at another size". */
  device: "M2 3.5h7.5v9H2zM11 6.5h3v6h-3z",
  /** Crosshair: "tell me about the element under the pointer". Symmetric about (8, 8). */
  inspect: "M8 2v3M8 11v3M2 8h3M11 8h3M8 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
  /**
   * Annotate: a pointer arrow with a small sparkle above its shoulder - "point at it, and the
   * assistant does the rest". Arrow and sparkle together span (3, 1.5)-(14.5, 13.7), so the
   * ink centres within a pixel of (8, 8).
   */
  annotate: "M3 3v9.5l2.6-2.4 1.7 3.6 1.6-.8-1.7-3.5h3.6zM12.5 1.5c.15 1 .95 1.85 2 2c-1.05.15-1.85 1-2 2c-.15-1-.95-1.85-2-2c1.05-.15 1.85-1 2-2z",
  /** The same two marks as separate paths, so the button can nudge the arrow and twinkle the sparkle. */
  annotateArrow: "M3 3v9.5l2.6-2.4 1.7 3.6 1.6-.8-1.7-3.5h3.6z",
  annotateSparkle: "M12.5 1.5c.15 1 .95 1.85 2 2c-1.05.15-1.85 1-2 2c-.15-1-.95-1.85-2-2c1.05-.15 1.85-1 2-2z",

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

  /* ── Chat composer and message actions ──────────────────────────────────── */

  /**
   * Dictation mic: capsule centred on x = 8, cradle arc and stem hanging below.
   * Stroked like everything else here; the caller sets the stroke width.
   */
  mic: "M8 2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-4 0v-3a2 2 0 0 1 2-2zM5.5 8a2.5 2.5 0 0 0 5 0M8 10.5V14M6.5 14h3",

  /**
   * Overflow: three micro-segments that read as dots under a round line cap.
   * Paths only (no `<circle>` helper exists), symmetric about (8, 8) by
   * construction — 4, 8, 12 on the horizontal centre line.
   */
  more: "M4 8h.01M8 8h.01M12 8h.01",

  /* ── Chat message actions (Claude-style footer) ─────────────────────── */

  /**
   * Copy: two overlapping squares. Back square (3,3)-(11,11) centres at
   * (7,7), front square (5,5)-(13,13) centres at (9,9) — the pair centres
   * at (8, 8) by construction.
   */
  copy: "M3 3h8v8H3z M5 5h8v8H5z",

  /**
   * Speaker: box centred on x = 8, waves to the right. Vertical centre 8.
   */
  speaker: "M3 6.5v3h2.2L8 12.5v-9L5.2 6.5z M10 6a3.2 3.2 0 0 1 0 4 M11.8 4.2a5.6 5.6 0 0 1 0 7.6",

  /** Thumbs up: fist with thumb rising. Ink centres near (8, 8). */
  thumbUp: "M3.5 8.5v4H6v-4z M6 12.5V7l2.3-3.4c.8 0 1.2.7 1 1.5L8.8 7.2H13l-1 5.3z",

  /** Thumbs down: vertical mirror of the up vote. */
  thumbDown: "M3.5 3.5v4H6v-4z M6 3.5V9l2.3 3.4c.8 0 1.2-.7 1-1.5l-.5-1.9H13l-1-5.5z",

  /** Pencil for Edit prompt. Diagonal, crossing near (8, 8). */
  edit: "M4 12l1-4L11.5 2.5a1.4 1.4 0 0 1 2 2L7 11z M10.8 3.2l2 2",

  /* ── Chat timeline: what each step of the assistant's work was ──────────── */

  /** Thinking: a four-point star, symmetric about (8, 8) on both axes. */
  sparkle: "M8 2.5c.4 2.6 2.9 5.1 5.5 5.5c-2.6.4-5.1 2.9-5.5 5.5c-.4-2.6-2.9-5.1-5.5-5.5c2.6-.4 5.1-2.9 5.5-5.5z",
  /** A lens and its handle; the ink spans (3, 3)-(13, 13), so it centres on (8, 8). */
  search: "M7 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM10 10l3 3",
  globe: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11zM2.5 8h11M8 2.5c-1.6 1.6-2.3 3.5-2.3 5.5s.7 3.9 2.3 5.5M8 2.5c1.6 1.6 2.3 3.5 2.3 5.5s-.7 3.9-2.3 5.5",
  /** A page with its corner folded; (4.5, 2.5)-(11.5, 13.5). */
  file: "M4.5 2.5h4.5l2.5 2.5v8.5h-7zM9 2.5V5h2.5",
  terminal: "M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10H11",
  eye: "M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6z",
  checklist: "M7 4.5h6.5M7 8h6.5M7 11.5h6.5M2.5 4.5l1 1 1.5-2M2.5 8l1 1 1.5-2M2.5 11.5l1 1 1.5-2",
  /** A plug: two prongs, the body, the lead. (4.5, 2.5)-(11.5, 13.5). */
  plug: "M6 2.5v3M10 2.5v3M4.5 5.5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11.5v2",
  /** A padlock: body, shackle and keyhole, centred on (8, 8). For "kept encrypted". */
  lock: "M4.5 7h7v6h-7zM5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7M8 9.25v1.5",
  /** A shield, outline only, symmetric about (8, 8). For permission state. */
  shield: "M8 2l5 2v4c0 3-2.1 5.3-5 6-2.9-.7-5-3-5-6V4z",
  tool: "M10.5 2.5a3 3 0 0 0-2.8 4.1L2.8 11.5a1.2 1.2 0 0 0 1.7 1.7l4.9-4.9a3 3 0 0 0 4.1-2.8l-1.8 1.8-1.7-.3-.3-1.7z",
  /** A finished step. The tick's ink spans (3.5, 4.5)-(12.5, 11.5). */
  check: "M3.5 8.5l3 3 6-7",
  /** Disclosure chevrons, each centred on (8, 8). */
  chevronRight: "M6.25 4.5L9.75 8l-3.5 3.5",
  chevronDown: "M4.5 6.25L8 9.75l3.5-3.5",

  /* ── Filtering ──────────────────────────────────────────────────────────── */

  /**
   * A funnel: wide mouth, narrow stem, closed so the stroke reads as one outline.
   *
   * Symmetric about x = 8, and the stem is drawn as a tapered spout rather than a line so
   * it still reads as a funnel at 14px, where a 1.5px stem and a 1.5px stroke are the same
   * width and the shape collapses into an arrow.
   */
  filter: "M3 4h10l-4 4.5V13l-2-1.5V8.5z",
} as const;

export type IconName = keyof typeof ICON;
export type IconSource = string | readonly string[] | IconNode;

/**
 * Build an icon element from legacy paths or an official Lucide icon node.
 *
 * `aria-hidden` throughout: every caller labels the *control* instead, so a screen reader
 * announces "Close tab" rather than the decoration inside the button.
 */
export function createIcon(paths: IconSource): SVGSVGElement {
  if (typeof paths !== "string" && paths.length > 0 && Array.isArray(paths[0])) {
    return createLucideElement(paths as IconNode, {
      class: "lucide", "aria-hidden": "true", focusable: "false", "stroke-width": 2,
    }) as SVGSVGElement;
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", VIEW_BOX);
  svg.setAttribute("aria-hidden", "true");

  for (const data of typeof paths === "string" ? [paths] : paths) {
    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute("d", data as string);
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
  paths: IconSource,
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
