/**
 * An agent's look: a shape and a colour. Pure - no DOM - so profiles can validate and default it.
 *
 * The idea of a small blob that shows how an agent is doing follows bloub's shape × colour ×
 * expression model; the shapes and faces themselves are ADCode's own drawings.
 */

export const MASCOT_SHAPES = ["circle", "capsule", "pebble", "drop", "hexagon", "cloud", "squircle", "egg"] as const;
export type MascotShape = (typeof MASCOT_SHAPES)[number];

/** Names only; each maps to a `--mascot-<name>` token defined for light and dark themes. */
export const MASCOT_COLORS = ["blue", "teal", "green", "lime", "amber", "orange", "coral", "pink", "violet", "slate"] as const;
export type MascotColor = (typeof MASCOT_COLORS)[number];

export interface MascotLook {
  readonly shape: MascotShape;
  readonly color: MascotColor;
}

/** FNV-1a: tiny, stable across runs and platforms, and well spread for short ids. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The look an agent has until someone picks one: always the same for the same id. */
export function defaultMascotFor(id: string): MascotLook {
  const value = hash(id);
  return {
    shape: MASCOT_SHAPES[value % MASCOT_SHAPES.length]!,
    color: MASCOT_COLORS[Math.floor(value / MASCOT_SHAPES.length) % MASCOT_COLORS.length]!,
  };
}

/** A saved look, or null when it is not one this build can draw. */
export function parseMascot(value: unknown): MascotLook | null {
  if (typeof value !== "object" || value === null) return null;
  const { shape, color } = value as { shape?: unknown; color?: unknown };
  if (!MASCOT_SHAPES.includes(shape as MascotShape) || !MASCOT_COLORS.includes(color as MascotColor)) return null;
  return { shape: shape as MascotShape, color: color as MascotColor };
}
