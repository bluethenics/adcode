/**
 * The colours charts are allowed to use.
 *
 * Not hand-picked. Every hue below is an iOS system colour stepped into the lightness
 * band a dark surface needs, and the *order* was chosen by enumeration rather than taste:
 * it is the ordering that maximises the worst adjacent colour-blind separation. Against
 * the `--card` surface it measures
 *
 *   worst adjacent pair    ΔE 18.7 (protanopia)   target is 8
 *   worst normal-vision    ΔE 25.5                floor is 15
 *   first three, all pairs ΔE 17.2 (deuteranopia) - which is what makes the donut legal
 *
 * The first three matter separately because in a pie or donut any two slices can end up
 * side by side, and a palette that is only safe between neighbours hides a collapse
 * there. Three is the cap that clears it: a donut folds everything past the third into
 * "Other", which wears the neutral and is not a hue at all.
 *
 * Green is deliberately absent from the categorical order. `--money` is the one colour
 * this site spends on nothing but real currency figures, and a green that meant
 * "campaign 4" on Tuesday would spend it. `MONEY` below is the same hue stepped for a
 * chart mark, and it is used only where the series *is* money.
 */

/** Slot order. Assigned by index and never cycled - colour follows the entity, not its rank. */
export const SERIES = [
  "#2aa0b5",
  "#d97706",
  "#5e5ce6",
  "#ff375f",
  "#0a84ff",
  "#b88a00",
  "#bf5af2",
] as const;

/** Spend, earnings, balance. Never anything that is not currency. */
export const MONEY = "#21a84a";

/** Everything folded into "Other", and the de-emphasised half of a sparkline. */
export const NEUTRAL = "#6b7577";

/** How many slices a donut may show before the rest becomes "Other". */
export const DONUT_CAP = 3;

/**
 * The colour for the nth entity.
 *
 * Past the seventh this returns the neutral rather than starting the order again: two
 * series in one chart wearing the same hue is worse than one of them being grey, and a
 * chart that needs an eighth colour needs to fold instead.
 */
export function seriesColor(index: number): string {
  return SERIES[index] ?? NEUTRAL;
}
