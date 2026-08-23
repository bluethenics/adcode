/**
 * The ADCode mark, `<$>`, as an inline SVG.
 *
 * The same geometry as `build/icon.svg` and the site's `Mark.tsx`, path for path - a logo
 * that differs between the app and the site is two logos. Kept here rather than fetched so
 * the mark is in the first paint with no request and no flash of nothing. Drawn rather than set as text
 * for the same reason the icon is: a font that is missing turns a logo into a fallback.
 *
 * `currentColor` on the brackets is deliberate - on the empty-editor screen the mark sits
 * in the placeholder's own muted colour rather than shouting the accent at someone who
 * has not opened anything yet.
 */

export interface BrandMarkOptions {
  /** Pixel size of the square. */
  readonly size: number;
  /** Draw the plate behind it, as the app icon has. Off for inline use. */
  readonly plate?: boolean;
  /** Use the accent for the brackets instead of the inherited colour. */
  readonly accent?: boolean;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function path(d: string, stroke: string, width: number): SVGPathElement {
  const element = document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", d);
  element.setAttribute("stroke", stroke);
  element.setAttribute("stroke-width", String(width));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  return element;
}

export function brandMark(options: BrandMarkOptions): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1024 1024");
  svg.setAttribute("width", String(options.size));
  svg.setAttribute("height", String(options.size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "ADCode");
  svg.classList.add("brand-mark");

  if (options.plate === true) {
    const plate = document.createElementNS(SVG_NS, "rect");
    plate.setAttribute("x", "32");
    plate.setAttribute("y", "32");
    plate.setAttribute("width", "960");
    plate.setAttribute("height", "960");
    plate.setAttribute("rx", "224");
    plate.setAttribute("fill", "var(--bg-elevated)");
    plate.setAttribute("stroke", "var(--border-hairline)");
    svg.append(plate);
  }

  const bracket = options.accent === true ? "var(--accent)" : "currentColor";

  svg.append(
    path("M320 348L140 512L320 676", bracket, 56),
    path("M704 348L884 512L704 676", bracket, 56),
    // The dollar's stem, drawn as two strokes so the S is not crossed through the middle.
    path("M512 322V365", "currentColor", 42),
    path("M512 662V702", "currentColor", 42),
    path("M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", "currentColor", 56),
  );

  return svg;
}
