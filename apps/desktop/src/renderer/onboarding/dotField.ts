/**
 * The dot field: a slow, living halftone, used behind the welcome tour.
 *
 * A grid of round dots whose brightness follows a few drifting soft shapes - the look of a
 * picture seen through a screen, moving like clouds. It is ADCode's own drawing: no image, no
 * video, nothing downloaded; a few lines of arithmetic per dot on a canvas.
 *
 * Built to cost nothing when it is not wanted:
 *  - it draws about 24 times a second, not 60, and only while it is on screen and the
 *    window is visible;
 *  - the canvas is sized to the element at the device's pixel ratio, capped at 2;
 *  - with reduced motion it draws one still frame and stops;
 *  - `mood` changes how lively it is, so a step that is working can look like it.
 *
 * `fieldValue` is the whole picture as a function, and is pure, so the look is testable
 * without a canvas.
 */
export type DotMood = "calm" | "working" | "done";

export interface DotField {
  readonly element: HTMLCanvasElement;
  setMood(mood: DotMood): void;
  /** Stop drawing and listening. Safe to call more than once. */
  destroy(): void;
}

/**
 * Brightness, 0-1, of the field at a point and a time. `x` and `y` are in grid cells, `t` in
 * seconds. Three soft blobs wander on their own slow orbits and add up; a faint ripple keeps
 * the gaps between them from going flat. `energy` (0-1) speeds and sharpens it.
 */
export function fieldValue(x: number, y: number, t: number, columns: number, rows: number, energy = 0): number {
  const speed = 0.16 + energy * 0.34;
  let sum = 0;
  for (let index = 0; index < 3; index += 1) {
    const phase = index * 2.094;
    const cx = columns * (0.5 + 0.36 * Math.sin(t * speed * (0.9 + index * 0.23) + phase));
    const cy = rows * (0.5 + 0.34 * Math.cos(t * speed * (0.7 + index * 0.31) + phase * 1.7));
    const radius = Math.min(columns, rows) * (0.34 + 0.08 * Math.sin(t * speed * 1.3 + phase));
    const dx = x - cx;
    const dy = (y - cy) * 1.15;
    sum += Math.exp(-(dx * dx + dy * dy) / (radius * radius));
  }
  const ripple = 0.5 + 0.5 * Math.sin(x * 0.42 + t * speed * 2.1) * Math.cos(y * 0.37 - t * speed * 1.6);
  const value = sum * 0.62 + ripple * 0.16;
  // A soft threshold: the shapes get edges, the way a halftone has, without hard steps.
  const edge = 0.34 - energy * 0.06;
  return Math.max(0, Math.min(1, (value - edge) / (0.62 - edge)));
}

const ENERGY: Readonly<Record<DotMood, number>> = { calm: 0, working: 1, done: 0.35 };
const FRAME_MS = 1000 / 24;

export function createDotField(options: { readonly pitch?: number; readonly mood?: DotMood } = {}): DotField {
  const element = document.createElement("canvas");
  element.className = "dot-field";
  element.setAttribute("aria-hidden", "true");
  const pitch = options.pitch ?? 7;
  const context = element.getContext("2d");
  let energy = ENERGY[options.mood ?? "calm"];
  let target = energy;
  let frame = 0;
  let last = 0;
  let onScreen = false;
  let destroyed = false;
  const started = performance.now();
  const still = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset["reducedMotion"] === "true";

  function draw(now: number): void {
    if (context === null) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(element.clientWidth * ratio);
    const height = Math.round(element.clientHeight * ratio);
    if (width === 0 || height === 0) return;
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    const cell = pitch * ratio;
    const columns = Math.ceil(width / cell);
    const rows = Math.ceil(height / cell);
    const t = (now - started) / 1000;
    energy += (target - energy) * 0.06;
    context.clearRect(0, 0, width, height);
    // The dots take the text colour, so the field belongs to whichever theme is on.
    context.fillStyle = getComputedStyle(element).color || "#fff";
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const value = fieldValue(column, row, t, columns, rows, energy);
        if (value < 0.04) continue;
        context.globalAlpha = 0.12 + value * 0.88;
        context.beginPath();
        context.arc((column + 0.5) * cell, (row + 0.5) * cell, cell * (0.12 + value * 0.3), 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }

  function tick(now: number): void {
    frame = 0;
    if (destroyed || !onScreen || document.hidden) return;
    if (now - last >= FRAME_MS) {
      last = now;
      draw(now);
    }
    if (!still()) frame = requestAnimationFrame(tick);
  }
  const wake = (): void => {
    if (destroyed || frame !== 0 || !onScreen || document.hidden) return;
    if (still()) { draw(performance.now()); return; }
    frame = requestAnimationFrame(tick);
  };

  const seen = typeof IntersectionObserver === "function"
    ? new IntersectionObserver((entries) => { onScreen = entries.some((entry) => entry.isIntersecting); wake(); })
    : null;
  if (seen === null) onScreen = true; else seen.observe(element);
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(() => { if (still()) draw(performance.now()); }) : null;
  resized?.observe(element);
  document.addEventListener("visibilitychange", wake);

  return {
    element,
    setMood(mood) {
      target = ENERGY[mood];
      wake();
    },
    destroy() {
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      seen?.disconnect();
      resized?.disconnect();
      document.removeEventListener("visibilitychange", wake);
    },
  };
}
