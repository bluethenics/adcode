/**
 * Distinct category colors remain legible on both appearance modes.
 *
 * Labels and legends remain present, so color is not the only
 * carrier of meaning. Slot assignment is stable: an entity keeps its shade when its
 * value or rank changes.
 */

/** Slot order. Assigned by index and never cycled. */
export const SERIES = ["#3976f6", "#26a881", "#9971e8", "#d89028", "#dd6b8c", "#36a5bc", "#8391a8"] as const;

/** Reserve a separate green for spend, earnings, and balance. */
export const MONEY = "#218563";

/** Everything folded into "Other", and the de-emphasised half of a sparkline. */
export const NEUTRAL = "#6b7577";

/** How many slices a donut may show before the rest becomes "Other". */
export const DONUT_CAP = 3;

/** Past the seventh series, use neutral instead of repeating a shade. */
export function seriesColor(index: number): string {
  return SERIES[index] ?? NEUTRAL;
}
