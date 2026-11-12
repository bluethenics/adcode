/**
 * The Usage page's small motions, kept calm: a segmented control's one indicator that
 * slides between options, and totals that count up once when the page arrives.
 *
 * CSS does the moving (transform and opacity only, behind both reduce-motion switches);
 * this file only measures and sets numbers. Anyone who asked for less motion gets the end
 * state at once: the count-up is skipped and the indicator still lands, without sliding.
 */

/** True when the operating system or ADCode's own switch asked for less motion. */
export function reducedMotion(): boolean {
  if (document.documentElement.dataset["reducedMotion"] === "true") return true;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Give a row of options one sliding indicator. The indicator is 100px wide and placed with
 * translateX and scaleX, so its move and its change of width are both transforms. Returns
 * `update`, to call whenever the selection or the layout changes.
 */
export function segmentIndicator(container: HTMLElement, selected: string): () => void {
  container.classList.add("usage-seg");
  const indicator = document.createElement("span");
  indicator.className = "usage-seg-indicator";
  indicator.setAttribute("aria-hidden", "true");
  container.prepend(indicator);
  const update = (): void => {
    const on = container.querySelector<HTMLElement>(selected);
    if (on === null || on.offsetWidth === 0) { indicator.style.opacity = "0"; return; }
    indicator.style.opacity = "";
    indicator.style.transform = `translateX(${on.offsetLeft.toString()}px) scaleX(${(on.offsetWidth / 100).toFixed(4)})`;
    // The first placement lands without sliding in from the left edge.
    if (container.dataset["segReady"] !== "true") requestAnimationFrame(() => { container.dataset["segReady"] = "true"; });
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(container);
  return update;
}

/** "$12.34" -> { prefix "$", value 12.34, decimals 2, suffix "" }; null for text with no number. */
export function splitFigure(text: string): { readonly prefix: string; readonly value: number; readonly decimals: number; readonly suffix: string } | null {
  const match = /^([^\d]*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(text);
  if (match === null) return null;
  const digits = match[2]!.replace(/,/g, "");
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { prefix: match[1]!, value, decimals: digits.includes(".") ? digits.split(".")[1]!.length : 0, suffix: match[3]! };
}

/** Count a figure up from zero to its text, once. The final text is set at the end, exactly. */
export function countUp(node: HTMLElement, durationMs = 560): void {
  const finalText = node.textContent ?? "";
  const figure = splitFigure(finalText);
  if (figure === null || figure.value === 0 || reducedMotion()) return;
  const grouped = /\d,\d/.test(finalText);
  const started = performance.now();
  const frame = (now: number): void => {
    if (!node.isConnected) return;
    const progress = Math.min(1, (now - started) / durationMs);
    // Ease out: quick at first, settling gently on the real number.
    const eased = 1 - Math.pow(1 - progress, 3);
    if (progress >= 1) { node.textContent = finalText; return; }
    const value = figure.value * eased;
    const shown = grouped ? value.toLocaleString("en-US", { minimumFractionDigits: figure.decimals, maximumFractionDigits: figure.decimals }) : value.toFixed(figure.decimals);
    node.textContent = `${figure.prefix}${shown}${figure.suffix}`;
    requestAnimationFrame(frame);
  };
  node.textContent = `${figure.prefix}${(0).toFixed(figure.decimals)}${figure.suffix}`;
  requestAnimationFrame(frame);
}
