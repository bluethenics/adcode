const LAYOUT_DURATION_MS = 220;
const REDUCED_MOTION_DURATION_MS = 100;
const LAYOUT_EASING = "cubic-bezier(.32,.72,0,1)";

export type LayoutInput = "pointer" | "keyboard";

function reducedMotion(): boolean {
  return (
    document.documentElement.dataset["reducedMotion"] === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Animate a panel from its previous rectangle after the grid has changed.
 *
 * The grid owns final geometry; the animation only carries the surface between those two
 * states. This keeps resize logic deterministic and confines motion to compositor-friendly
 * transform and opacity properties.
 */
export function animateLayoutFlip(
  element: HTMLElement,
  previous: DOMRectReadOnly,
  input: LayoutInput = "pointer",
): void {
  if (input === "keyboard" || typeof element.animate !== "function") return;

  const next = element.getBoundingClientRect();
  if (reducedMotion()) {
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate([{ opacity: 0.88 }, { opacity: 1 }], {
      duration: REDUCED_MOTION_DURATION_MS,
      easing: "linear",
    });
    return;
  }

  const deltaX = previous.left - next.left;
  const deltaY = previous.top - next.top;
  const scaleX = next.width > 0 ? previous.width / next.width : 1;
  const scaleY = next.height > 0 ? previous.height / next.height : 1;
  if (
    Math.abs(deltaX) < 1 &&
    Math.abs(deltaY) < 1 &&
    Math.abs(scaleX - 1) < 0.01 &&
    Math.abs(scaleY - 1) < 0.01
  ) return;

  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate(
    [
      {
        transform: `translate(${String(deltaX)}px, ${String(deltaY)}px) scale(${String(scaleX)}, ${String(scaleY)})`,
        transformOrigin: "top left",
        opacity: 0.88,
      },
      { transform: "translate(0, 0) scale(1, 1)", transformOrigin: "top left", opacity: 1 },
    ],
    { duration: LAYOUT_DURATION_MS, easing: LAYOUT_EASING, fill: "both" },
  );
}
