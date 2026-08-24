/**
 * The arithmetic behind device-size preview.
 *
 * Pure, and separate from the toolbar, because every one of these is a small calculation
 * with an off-by-one that would show up as a preview that is subtly the wrong width - which
 * is the one bug a responsive-testing tool cannot afford, since the whole point is trusting
 * the number in the box.
 */

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface DevicePreset extends Viewport {
  readonly id: string;
  readonly label: string;
}

/**
 * The presets.
 *
 * CSS pixels, not physical ones: a phone with a 3x display still lays out at 393 wide, and
 * a preview 1179 pixels across would be testing a breakpoint nobody has. Chosen to sit
 * either side of the breakpoints people actually write - 360, 390, 768, 1024, 1280 - rather
 * than to enumerate current handsets, which would need updating every autumn.
 */
export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: "phone-small", label: "Phone (small) — 360 × 640", width: 360, height: 640 },
  { id: "phone", label: "Phone — 390 × 844", width: 390, height: 844 },
  { id: "phone-large", label: "Phone (large) — 430 × 932", width: 430, height: 932 },
  { id: "tablet", label: "Tablet — 768 × 1024", width: 768, height: 1024 },
  { id: "tablet-large", label: "Tablet (large) — 1024 × 1366", width: 1024, height: 1366 },
  { id: "laptop", label: "Laptop — 1280 × 800", width: 1280, height: 800 },
  { id: "desktop", label: "Desktop — 1440 × 900", width: 1440, height: 900 },
];

/**
 * The narrowest and widest a viewport may be set to.
 *
 * The floor is below every real device on purpose: 320 is the usual "smallest supported"
 * width and being able to go under it is how you find out what happens at 280. The ceiling
 * only exists so a typo in the size box cannot produce a frame so large the pane stops
 * responding.
 */
export const MIN_DIMENSION = 180;
export const MAX_DIMENSION = 4000;

export function clampViewport(viewport: Viewport): Viewport {
  return {
    width: clamp(viewport.width, MIN_DIMENSION, MAX_DIMENSION),
    height: clamp(viewport.height, MIN_DIMENSION, MAX_DIMENSION),
  };
}

function clamp(value: number, low: number, high: number): number {
  // A non-finite value comes from a half-typed box; the floor is a better guess than NaN.
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, Math.round(value)));
}

/** Swap the axes. Portrait becomes landscape and back. */
export function rotate(viewport: Viewport): Viewport {
  return { width: viewport.height, height: viewport.width };
}

/**
 * The scale that makes a viewport fit the space available.
 *
 * Never above 1: scaling a 360-wide phone frame up to fill a wide pane would show the user
 * a page at a size no device renders it, which is worse than empty space beside it. Below 1
 * it shrinks, which is a lie about size but an honest one about layout - the page still
 * *lays out* at its true width, because scaling is a transform and transforms do not change
 * the viewport a page sees.
 */
export function fitScale(viewport: Viewport, available: Viewport): number {
  if (viewport.width <= 0 || viewport.height <= 0) return 1;
  if (available.width <= 0 || available.height <= 0) return 1;

  return Math.min(1, available.width / viewport.width, available.height / viewport.height);
}

/**
 * Read a size the user typed.
 *
 * Tolerant of what people actually type: `390x844`, `390 × 844`, `390*844`, and a bare
 * `390` meaning "this wide, leave the height". Returns null rather than guessing when there
 * is no number in it at all.
 */
export function parseSize(text: string, fallbackHeight: number): Viewport | null {
  const cleaned = text.trim().toLowerCase();
  if (cleaned === "") return null;

  const parts = cleaned.split(/\s*[x×*,]\s*/);
  const width = Number(parts[0]);
  if (!Number.isFinite(width)) return null;

  if (parts.length === 1) return clampViewport({ width, height: fallbackHeight });

  const height = Number(parts[1]);
  if (!Number.isFinite(height)) return clampViewport({ width, height: fallbackHeight });

  return clampViewport({ width, height });
}

export function formatSize(viewport: Viewport): string {
  return `${viewport.width} × ${viewport.height}`;
}

/** The preset matching a viewport exactly, either way up, or null for a custom size. */
export function presetFor(viewport: Viewport): DevicePreset | null {
  for (const preset of DEVICE_PRESETS) {
    if (preset.width === viewport.width && preset.height === viewport.height) return preset;
    if (preset.height === viewport.width && preset.width === viewport.height) return preset;
  }
  return null;
}

/**
 * Read a stored `WIDTHxHEIGHT`, or null.
 *
 * Separate from `parseSize` because stored text is not user input: there is no fallback
 * height to fall back to, and anything unreadable means "no remembered size" rather than
 * "keep what you had".
 */
export function parseViewport(text: string | null): Viewport | null {
  if (text === null || text.trim() === "") return null;

  const match = /^(\d+)x(\d+)$/.exec(text.trim());
  if (match?.[1] === undefined || match[2] === undefined) return null;

  return clampViewport({ width: Number(match[1]), height: Number(match[2]) });
}

/** How a viewport is stored. Parsed back by `parseViewport`. */
export function formatViewport(viewport: Viewport): string {
  return `${viewport.width}x${viewport.height}`;
}
