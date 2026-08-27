/**
 * The neutral shades charts are allowed to use.
 *
 * A descending lightness scale keeps every visual inside the product's strict
 * black-and-white system. Labels and legends remain present, so shade is not the only
 * carrier of meaning. Slot assignment is stable: an entity keeps its shade when its
 * value or rank changes.
 */

/** Slot order. Assigned by index and never cycled. */
export const SERIES = ["#f5f5f5", "#d4d4d4", "#b3b3b3", "#929292", "#737373", "#555555", "#404040"] as const;

/** Spend, earnings, and balance use the brightest neutral. */
export const MONEY = "#ffffff";

/** Everything folded into "Other", and the de-emphasised half of a sparkline. */
export const NEUTRAL = "#6b7577";

/** How many slices a donut may show before the rest becomes "Other". */
export const DONUT_CAP = 3;

/** Past the seventh series, use neutral instead of repeating a shade. */
export function seriesColor(index: number): string {
  return SERIES[index] ?? NEUTRAL;
}
