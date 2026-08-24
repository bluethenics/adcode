/**
 * The lines that make a tree readable.
 *
 * Indentation alone leaves the reader counting pixels to work out whether two rows are
 * siblings or whether one is inside the other. Rails answer it directly: a vertical line
 * for every ancestor that still has children below, and an elbow into the row itself.
 *
 * **They are spans, not a CSS `::before`.** Which ancestors still have siblings below is
 * per-row data - it depends on the shape of the tree above this row - and a stylesheet
 * cannot know it. One cell per ancestor level is the only honest way to draw it.
 *
 * Extracted from the Structure popup, which drew its outline this way first. Three trees
 * now use it - the outline, the project map, and the file explorer - and a tree that drew
 * its lines slightly differently would read as a different control.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Glyphs on a 14×22 grid, which is one rail cell. */
const RAIL = {
  /** An ancestor with more children below: a line straight through. */
  through: "M7 0v22",
  /** This row, with siblings after it. */
  branch: "M7 0v22M7 11h6",
  /** The last child: the line stops at the elbow rather than carrying on. */
  last: "M7 0v11h6",
} as const;

function cell(path: string | null, name: string, last = false): HTMLElement {
  const element = document.createElement("span");
  element.className = "tree-rail";
  element.dataset["rail"] = name;
  if (last) element.dataset["last"] = "true";

  if (path !== null) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 14 22");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("preserveAspectRatio", "none");

    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    element.append(svg);
  }

  return element;
}

export interface RailOptions {
  /**
   * For each ancestor level, whether that ancestor has more siblings below it.
   *
   * Outermost first. This is the part a stylesheet cannot derive, and the part that makes
   * the lines correct rather than decorative.
   */
  readonly ancestorsContinue: readonly boolean[];
  /** Whether this row is the last of its parent's children. */
  readonly isLast: boolean;
  /** Depth 0 draws nothing: a root has no ancestor to connect to. */
  readonly depth: number;
}

/**
 * The rail cells for one row, in order.
 *
 * Returns an empty array at depth 0 rather than a blank cell, so a flat list costs nothing
 * and looks like a list rather than a tree with the lines switched off.
 */
export function railsFor(options: RailOptions): HTMLElement[] {
  if (options.depth === 0) return [];

  const cells: HTMLElement[] = [];

  for (let level = 0; level < options.depth - 1; level += 1) {
    const continues = options.ancestorsContinue[level] === true;
    cells.push(cell(continues ? RAIL.through : null, `rail-${String(level)}`));
  }

  cells.push(cell(options.isLast ? RAIL.last : RAIL.branch, "elbow", options.isLast));
  return cells;
}

/**
 * Track which ancestors still have siblings, while walking a tree.
 *
 * A tiny stack rather than something the caller keeps by hand, because getting it wrong
 * draws a line down the side of the last item in a folder - the one visual mistake that
 * makes rails look broken rather than merely wrong.
 */
export function createRailStack() {
  const stack: boolean[] = [];

  return {
    /** The flags for a row at `depth`. */
    ancestors(depth: number): boolean[] {
      return stack.slice(0, Math.max(0, depth));
    },
    /** Entering a child level, recording whether the parent has more siblings after it. */
    push(parentContinues: boolean): void {
      stack.push(parentContinues);
    },
    pop(): void {
      stack.pop();
    },
    reset(): void {
      stack.length = 0;
    },
  };
}
