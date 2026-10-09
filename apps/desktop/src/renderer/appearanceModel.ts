/**
 * Zoom, text size and motion, as numbers - no DOM, so the rules are testable.
 *
 * Zoom scales the whole window. Text size scales only what you read: the editor's code, the
 * terminal, and chat messages. Each setting is a value from a short list rather than a free
 * number, so the shortcuts step through the same sizes the Settings row offers and a row
 * always shows exactly where the shortcuts left it.
 */

export const ZOOM_SETTING = "adcode.appearance.zoom";
export const TEXT_SIZE_SETTING = "adcode.appearance.textSize";
export const MOTION_SETTING = "adcode.appearance.motion";

/** In the order the shortcuts step through; must match the setting's options. */
export const ZOOM_STEPS = ["80", "90", "100", "110", "125", "150", "175", "200"] as const;
export const TEXT_SIZES = ["small", "default", "large", "larger", "largest"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

const TEXT_SCALE: Readonly<Record<TextSize, number>> = {
  small: 0.9,
  default: 1,
  large: 1.12,
  larger: 1.25,
  largest: 1.4,
};

/** One step bigger (+1), smaller (-1), or back to the default (0). Stops at the ends. */
function step<T extends string>(steps: readonly T[], fallback: T, current: unknown, direction: number): T {
  if (direction === 0) return fallback;
  const at = steps.indexOf(current as T);
  const from = at === -1 ? steps.indexOf(fallback) : at;
  const next = Math.max(0, Math.min(steps.length - 1, from + Math.sign(direction)));
  return steps[next]!;
}

export function stepZoom(current: unknown, direction: number): string {
  return step(ZOOM_STEPS, "100", current, direction);
}

export function stepTextSize(current: unknown, direction: number): TextSize {
  return step(TEXT_SIZES, "default", current, direction);
}

/** The window's zoom factor for a setting value; 1 for anything unrecognised. */
export function zoomFactor(value: unknown): number {
  return (ZOOM_STEPS as readonly string[]).includes(value as string) ? Number(value) / 100 : 1;
}

export function textScale(value: unknown): number {
  return TEXT_SCALE[value as TextSize] ?? 1;
}

/** The editor's font size and line height. 13 / 20 at the default size, as before. */
export function editorFont(value: unknown): { readonly fontSize: number; readonly lineHeight: number } {
  const fontSize = Math.round(13 * textScale(value));
  return { fontSize, lineHeight: Math.round(fontSize * (20 / 13)) };
}

/** The terminal's font size: 12 at the default size, as before. */
export function terminalFontSize(value: unknown): number {
  return Math.round(12 * textScale(value));
}

/** Whether motion should be reduced, from the setting and the system's own preference. */
export function reduceMotion(value: unknown, systemPrefersReduced: boolean): boolean {
  if (value === "reduce") return true;
  if (value === "full") return false;
  return systemPrefersReduced;
}

/** Percent, for a status line: "125%". */
export function zoomLabel(value: unknown): string {
  return `${Math.round(zoomFactor(value) * 100)}%`;
}

const TEXT_LABEL: Readonly<Record<TextSize, string>> = {
  small: "Small",
  default: "Default",
  large: "Large",
  larger: "Larger",
  largest: "Largest",
};

export function textSizeLabel(value: unknown): string {
  return TEXT_LABEL[value as TextSize] ?? "Default";
}
