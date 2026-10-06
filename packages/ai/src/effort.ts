/**
 * ADCode's effort choice, in the words a particular model understands.
 *
 * Connect a model offers Low, Medium, High and Max. Models name their own levels, and no two
 * lists agree: GPT-5 Mini takes minimal to high, GPT-5.6 none to max, Gemini 3 Pro only low
 * and high, Claude Opus 4.5 low to high, Claude Haiku 4.5 nothing at all. Sending a level a
 * model does not have is a 400, so the choice is mapped onto the model's own list - the
 * nearest level, rounding toward what the person asked for - or sent not at all.
 */
import type { Effort } from "./types.ts";

/** Every level any provider uses, cheapest first. */
const SCALE = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const TARGET: Readonly<Record<Effort, number>> = { low: 2, medium: 3, high: 4, max: 6 };

/**
 * The level to send for `effort`, or undefined to send none.
 *
 * `none` is never chosen on the person's behalf: it turns reasoning off, which nothing in
 * ADCode's four levels asks for.
 */
export function effortFor(effort: Effort | undefined, levels: readonly string[] | null | undefined): string | undefined {
  if (effort === undefined || levels === null || levels === undefined) return undefined;

  const known = levels
    .map((level) => ({ level, rank: SCALE.indexOf(level as (typeof SCALE)[number]) }))
    .filter((entry) => entry.rank > 0);
  if (known.length === 0) return undefined;

  if (effort === "max") return known.reduce((best, entry) => (entry.rank > best.rank ? entry : best)).level;

  const target = TARGET[effort];
  // Ties round toward the person's intent: Low down, Medium and High up.
  const preferLower = effort === "low";
  let best = known[0]!;
  for (const entry of known.slice(1)) {
    const distance = Math.abs(entry.rank - target);
    const bestDistance = Math.abs(best.rank - target);
    if (distance < bestDistance || (distance === bestDistance && (preferLower ? entry.rank < best.rank : entry.rank > best.rank))) {
      best = entry;
    }
  }
  return best.level;
}
