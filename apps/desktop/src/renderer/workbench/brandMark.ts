/**
 * The ADCode mark, `<$>`, as an inline SVG.
 *
 * The same geometry as `build/icon.svg`, kept here rather than fetched so the mark is in
 * the first paint with no request and no flash of nothing. Drawn rather than set as text
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
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("width", String(options.size));
  svg.setAttribute("height", String(options.size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "ADCode");
  svg.classList.add("brand-mark");

  if (options.plate === true) {
    const plate = document.createElementNS(SVG_NS, "rect");
    plate.setAttribute("x", "8");
    plate.setAttribute("y", "8");
    plate.setAttribute("width", "240");
    plate.setAttribute("height", "240");
    plate.setAttribute("rx", "56");
    plate.setAttribute("fill", "var(--bg-elevated)");
    plate.setAttribute("stroke", "var(--border-hairline)");
    svg.append(plate);
  }

  const bracket = options.accent === true ? "var(--accent)" : "currentColor";

  svg.append(
    path("M92 76 L52 128 L92 180", bracket, 19),
    path("M164 76 L204 128 L164 180", bracket, 19),
    path("M128 62 L128 194", "currentColor", 13),
    path(
      "M148 98 C148 85 139 79 128 79 C117 79 108 86 108 97 " +
        "C108 108 118 113 128 117 C138 121 148 127 148 138 " +
        "C148 150 138 157 128 157 C117 157 108 151 108 138",
      "currentColor",
      15,
    ),
  );

  return svg;
}
