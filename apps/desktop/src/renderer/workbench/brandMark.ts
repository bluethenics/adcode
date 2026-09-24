/**
 * The ADCode mark, `<$>`, as an inline SVG - one folded ribbon.
 *
 * The same geometry as `build/icon.svg` and the site's `Mark.tsx`, path for path,
 * fold for fold - a logo that differs between the app and the site is two logos.
 * Kept here rather than fetched so the mark is in the first paint with no request
 * and no flash of nothing. Drawn rather than set as text for the same reason the
 * icon is: a font that is missing turns a logo into a fallback.
 *
 * `currentColor` on the ribbon is deliberate - on the empty-editor screen the mark sits
 * in the placeholder's own muted colour rather than shouting the accent at someone who
 * has not opened anything yet. The folds are plain black at low opacity over it, so the
 * mark stays one colour that inverts with the theme.
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

function path(d: string, stroke: string, width: number, extra?: Record<string, string>): SVGPathElement {
  const element = document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", d);
  element.setAttribute("stroke", stroke);
  element.setAttribute("stroke-width", String(width));
  element.setAttribute("fill", "none");
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  for (const [key, value] of Object.entries(extra ?? {})) element.setAttribute(key, value);
  return element;
}

function fold(points: string, fill: string, opacity: string): SVGPathElement {
  const element = document.createElementNS(SVG_NS, "path");
  element.setAttribute("d", points);
  element.setAttribute("fill", fill);
  element.setAttribute("stroke", "none");
  element.setAttribute("opacity", opacity);
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
    // The ribbon body. Same centre-lines as ever, cut thicker.
    path("M320 348L140 512L320 676", bracket, 96),
    path("M704 348L884 512L704 676", bracket, 96),
    // The dollar's stem, drawn as two strokes so the S is not crossed through the middle.
    path("M512 296V388", "currentColor", 64),
    path("M512 636V728", "currentColor", 64),
    path("M584 405C563 374 531 356 494 356C446 356 413 383 413 423C413 463 444 484 505 500C569 517 606 541 606 590C606 641 565 671 511 671C466 671 429 651 405 619", "currentColor", 92),
    // Folds: the side face at each bracket tip, the twists where the stems dive
    // behind the S, and the shadow where the S crosses over itself.
    fold("M128 478L128 546L198 512Z", "#000", ".32"),
    fold("M896 478L896 546L826 512Z", "#000", ".32"),
    path("M292 358L164 474", "#fff", 20, { opacity: ".26" }),
    path("M732 358L860 474", "#fff", 20, { opacity: ".26" }),
    path("M164 550L292 666", "#000", 20, { opacity: ".2" }),
    path("M860 550L732 666", "#000", 20, { opacity: ".2" }),
    fold("M480 340L544 340L522 394L498 394Z", "#000", ".3"),
    fold("M480 630L544 630L522 684L498 684Z", "#000", ".3"),
    path("M492 512Q560 536 512 576", "#000", 32, { opacity: ".22" }),
    path("M440 400Q450 375 490 368", "#fff", 15, { opacity: ".24" }),
  );

  return svg;
}
