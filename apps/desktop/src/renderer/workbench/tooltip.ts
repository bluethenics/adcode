/**
 * One tooltip for the whole app, in the design system's own box.
 *
 * Nearly three hundred controls explain themselves with a `title`, and the operating system
 * draws those: a yellow-grey rectangle in the wrong font, a second late, that ignores the
 * theme. This shows the same words in `.ad-tooltip` instead - the app's surface, type and
 * shadow - placed beside the control and never off the window.
 *
 * It works from what is already there. While the pointer or the keyboard is on an element
 * with a `title`, the title is lent to `data-ad-tip` so the system tooltip stays away, with the
 * words kept available to assistive technology (`aria-description`, unless the element's
 * accessible name already says the same). When the pointer leaves, the `title` is put back
 * exactly as it was - so nothing that reads or sets a title has to know this exists.
 *
 * Shown after a short pause, at once when moving between neighbours, and gone on leave,
 * blur, a press, a key, a scroll or Escape. A touch never shows one.
 */
const SHOW_AFTER_MS = 420;
/** Moving from one control to its neighbour inside this window skips the pause. */
const WARM_MS = 600;
const GAP = 8;

export interface TipPlacement { readonly left: number; readonly top: number; readonly side: "above" | "below" }

/**
 * Where the box goes: centred under the control, above it when there is no room below, and
 * always wholly inside the viewport. Pure, so the edge cases are tested rather than eyeballed.
 */
export function placeTip(anchor: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }, tip: { readonly width: number; readonly height: number }, viewport: { readonly width: number; readonly height: number }, gap = GAP): TipPlacement {
  const below = anchor.top + anchor.height + gap;
  const fitsBelow = below + tip.height <= viewport.height - 4;
  const fitsAbove = anchor.top - gap - tip.height >= 4;
  const side = fitsBelow || !fitsAbove ? "below" : "above";
  const top = side === "below" ? Math.min(below, Math.max(4, viewport.height - tip.height - 4)) : anchor.top - gap - tip.height;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(6, Math.min(centred, viewport.width - tip.width - 6));
  return { left: Math.round(left), top: Math.round(top), side };
}

/** Whether the app already shows this control's name in a tooltip of its own. */
export function hasOwnTooltip(element: Element): boolean {
  return element.matches(".web-rail [data-tip], .web-rail [data-tip] *");
}

/** The element whose words should show for an event target: the nearest one carrying a tip. */
function tipTarget(target: EventTarget | null): HTMLElement | null {
  const found = target instanceof Element ? target.closest<HTMLElement>("[title], [data-ad-tip]") : null;
  // The icon rail draws its own label beside each button (`data-tip`, webFrame.css). Reported:
  // hovering Automations showed that label and this box together. One name, one box: the rail's.
  return found !== null && hasOwnTooltip(found) ? null : found;
}

/** Move a `title` out of the system's reach, keeping its words where a screen reader finds them. */
export function adoptTitle(element: HTMLElement): string {
  const title = element.getAttribute("title");
  if (title !== null && title.trim() !== "") {
    element.dataset["adTip"] = title;
    element.removeAttribute("title");
    element.dataset["tipLent"] = "true";
    const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim();
    if (name !== title.trim() && !element.hasAttribute("aria-description")) {
      element.setAttribute("aria-description", title);
      element.dataset["tipDescribed"] = "true";
    }
  }
  return element.dataset["adTip"] ?? "";
}

/** Give a lent title back. A title the page set meanwhile wins; a `data-ad-tip` written by hand is left alone. */
export function returnTitle(element: HTMLElement): void {
  if (element.dataset["tipLent"] !== "true") return;
  if (!element.hasAttribute("title") && element.dataset["adTip"] !== undefined) element.setAttribute("title", element.dataset["adTip"]);
  delete element.dataset["adTip"];
  delete element.dataset["tipLent"];
  if (element.dataset["tipDescribed"] === "true") {
    element.removeAttribute("aria-description");
    delete element.dataset["tipDescribed"];
  }
}

export function installTooltips(root: Document = document): void {
  const box = root.createElement("div");
  box.className = "ad-tooltip ad-tooltip-layer";
  box.setAttribute("role", "tooltip");
  box.hidden = true;
  root.body.append(box);

  let current: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastHidden = 0;

  function hide(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!box.hidden) lastHidden = Date.now();
    box.hidden = true;
    delete box.dataset["shown"];
    if (current !== null) returnTitle(current);
    current = null;
  }

  function show(element: HTMLElement): void {
    const text = adoptTitle(element);
    if (text === "" || !element.isConnected) { hide(); return; }
    box.textContent = text;
    box.hidden = false;
    // A dialog opened with showModal is in the top layer; the tooltip has to be inside it to be seen.
    const host = element.closest("dialog[open]") ?? root.body;
    if (box.parentElement !== host) host.append(box);
    const anchor = element.getBoundingClientRect();
    const size = box.getBoundingClientRect();
    const place = placeTip(anchor, size, { width: window.innerWidth, height: window.innerHeight });
    box.style.left = `${place.left.toString()}px`;
    box.style.top = `${place.top.toString()}px`;
    box.dataset["side"] = place.side;
    // Next frame, so the entrance has a start to move from.
    requestAnimationFrame(() => { if (!box.hidden) box.dataset["shown"] = "true"; });
  }

  function arm(element: HTMLElement, immediate: boolean): void {
    if (element === current) return;
    hide();
    // For the pointer, borrow the title now, before the system's own timer can show the native
    // tooltip. Keyboard focus never shows a system tooltip, so then it is borrowed only when ours
    // shows - which leaves a control's title where anything looking for it expects it to be.
    const text = immediate ? element.getAttribute("title") ?? element.dataset["adTip"] ?? "" : adoptTitle(element);
    if (text.trim() === "") return;
    current = element;
    const wait = immediate || Date.now() - lastHidden < WARM_MS ? 0 : SHOW_AFTER_MS;
    timer = setTimeout(() => { timer = null; if (current === element) show(element); }, wait);
  }

  root.addEventListener("pointerover", (event) => {
    if ((event as PointerEvent).pointerType === "touch") return;
    const element = tipTarget(event.target);
    if (element === null) { if (current !== null) hide(); return; }
    arm(element, false);
  }, true);
  root.addEventListener("pointerout", (event) => {
    if (current === null) return;
    const to = (event as PointerEvent).relatedTarget;
    if (!(to instanceof Node) || !current.contains(to)) hide();
  }, true);
  /** When a key was last pressed: focus that follows one is the keyboard moving, not the app. */
  let lastKeyAt = 0;
  root.addEventListener("focusin", (event) => {
    const element = tipTarget(event.target);
    // Only for the keyboard moving focus. A click focuses too, and so does a popup handing focus
    // back to the button that opened it - a tooltip springing up on either is in the way.
    if (element !== null && element.matches(":focus-visible") && Date.now() - lastKeyAt < 500) arm(element, true);
  }, true);
  root.addEventListener("focusout", hide, true);
  root.addEventListener("pointerdown", hide, true);
  root.addEventListener("keydown", (event) => {
    lastKeyAt = Date.now();
    if ((event as KeyboardEvent).key === "Escape" || current !== null) hide();
  }, true);
  root.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}
