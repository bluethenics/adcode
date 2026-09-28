/**
 * Things that move should be seen to move.
 *
 * When a run on the Agents board goes from Working to Ready, its box used to vanish from one
 * column and appear in another. FLIP - first, last, invert, play - makes it glide instead:
 * measure every box before the render, measure it after, and animate each moved box from
 * its old place back to its new one. The maths is pure and tested; the rest is a thin layer
 * over the Web Animations API, which needs no class to clean up and never holds the final
 * state - an animation that never runs (an occluded window) leaves the box where it belongs.
 */

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type MotionPersonality = "lively" | "crisp";

/** Vibe is where people watch agents work, so it moves with some bounce; Code stays brisk. */
export function motionPersonality(mode: "vibe" | "code"): MotionPersonality {
  return mode === "vibe" ? "lively" : "crisp";
}

/** How far a box must travel back to where it was, or null when it did not really move. */
export function flipDelta(before: Box, after: Box): { readonly dx: number; readonly dy: number } | null {
  if (before.width === 0 || before.height === 0 || after.width === 0 || after.height === 0) return null;
  const dx = Math.round(before.left - after.left);
  const dy = Math.round(before.top - after.top);
  return dx === 0 && dy === 0 ? null : { dx, dy };
}

/** A list item's place in a stagger: its index, capped so a long list does not crawl in. */
export function staggerIndex(index: number): number {
  return Math.min(12, Math.max(0, Math.floor(index)));
}

/** Whether anything should animate: neither the system nor ADCode's own switch asked for stillness. */
export function motionAllowed(): boolean {
  if (document.documentElement.dataset["reducedMotion"] === "true") return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function lively(): boolean {
  return document.documentElement.dataset["motion"] === "lively";
}

/** Where each element is now, for a later `playFlip`. */
export function measure(elements: Iterable<readonly [string, HTMLElement]>): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const [id, element] of elements) {
    if (!element.isConnected) continue;
    const rect = element.getBoundingClientRect();
    boxes.set(id, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return boxes;
}

/** Glide every element that moved since `before` from its old place to its new one. */
export function playFlip(elements: ReadonlyMap<string, HTMLElement>, before: ReadonlyMap<string, Box>): void {
  if (!motionAllowed()) return;
  const duration = lively() ? 320 : 180;
  const easing = lively() ? "cubic-bezier(.34, 1.4, .64, 1)" : "cubic-bezier(.2, .8, .2, 1)";
  for (const [id, element] of elements) {
    const was = before.get(id);
    if (was === undefined || !element.isConnected || typeof element.animate !== "function") continue;
    const rect = element.getBoundingClientRect();
    const delta = flipDelta(was, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    if (delta === null) continue;
    element.animate(
      [{ transform: `translate(${String(delta.dx)}px, ${String(delta.dy)}px)` }, { transform: "none" }],
      { duration, easing },
    );
  }
}

/**
 * Mark an element for a one-shot CSS entrance, then unmark it.
 *
 * The mark has to go: moving an element in the DOM restarts its CSS animations, and a box
 * that glides to another column must not also rise in again. A timer, never a frame or
 * `animationend` - both can simply not arrive in a window that is not being painted.
 */
export function markFor(element: HTMLElement, key: string, value: string, ms: number): void {
  element.dataset[key] = value;
  window.setTimeout(() => {
    if (element.dataset[key] === value) delete element.dataset[key];
  }, ms);
}

/** Number a list's items for a staggered entrance (`--i`, read by motion.css). */
export function indexForStagger(list: HTMLElement): void {
  [...list.children].forEach((child, index) => {
    if (child instanceof HTMLElement) child.style.setProperty("--i", String(staggerIndex(index)));
  });
}
