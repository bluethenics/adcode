/**
 * The `?` popover.
 *
 * One of these exists for the whole window rather than one per row. Fifty-five settings
 * rows each holding a hidden popover is fifty-five subtrees the browser lays out and keeps
 * in memory to show at most one of, and it makes "close the one that is open" a search
 * instead of a fact.
 *
 * Placement is measured, not guessed: the popover is rendered, then read, then moved. A
 * popover positioned from assumptions about its own height is the one that ends up half
 * off the bottom of the screen for the last row in a group, which is exactly the row a
 * new user is most likely to be reading.
 *
 * It closes on Escape and on a click anywhere else. Scrolling does *not* close it: it
 * follows its anchor instead, and closes only once the anchor has actually left the
 * screen. Dismissing on any scroll at all was the first implementation and it was wrong
 * twice over - it threw the explanation away when the list moved by three pixels, and it
 * fired for scrolls of elements the anchor is not even inside, including a smooth
 * scroll still settling from an unrelated jump a second earlier.
 */
import type { HelpEntry } from "@adcode/help";

export interface HelpPopover {
  /** Show `entry` beside `anchor`. Showing the same anchor twice closes it, as a toggle. */
  show(anchor: HTMLElement, entry: HelpEntry): void;
  close(): void;
  isOpen(): boolean;
}

/** Kept clear of the window edges so the popover never touches them. */
const MARGIN = 12;
/** Between the anchor and the popover. */
const GAP = 8;

export function createHelpPopover(host: HTMLElement): HelpPopover {
  let anchored: HTMLElement | null = null;

  const card = document.createElement("div");
  card.className = "help-popover";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "What this does");

  const title = document.createElement("h3");
  title.className = "help-popover-title";

  const plain = document.createElement("p");
  plain.className = "help-popover-plain";

  const why = document.createElement("p");
  why.className = "help-popover-detail";

  const how = document.createElement("p");
  how.className = "help-popover-detail";

  card.append(title, plain, why, how);
  host.append(card);

  function place(anchor: HTMLElement): void {
    const target = anchor.getBoundingClientRect();
    const self = card.getBoundingClientRect();

    // Below the anchor by default; above it when there is not room below. Compared against
    // the space actually available rather than a fixed threshold, so a short popover near
    // the bottom still opens downwards instead of jumping for no reason.
    const below = window.innerHeight - target.bottom - GAP - MARGIN;
    const above = target.top - GAP - MARGIN;
    const goAbove = self.height > below && above > below;

    const top = goAbove ? target.top - self.height - GAP : target.bottom + GAP;

    // Centred on the anchor, then pulled back inside the window. Clamping after centring
    // rather than choosing a side keeps the popover pointing at its button in the common
    // case and merely near it in the awkward one.
    const centred = target.left + target.width / 2 - self.width / 2;
    const left = Math.max(MARGIN, Math.min(centred, window.innerWidth - self.width - MARGIN));

    card.style.top = `${String(Math.round(top))}px`;
    card.style.left = `${String(Math.round(left))}px`;
    card.dataset["side"] = goAbove ? "above" : "below";
  }

  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (anchored === null) return;

    const target = event.target;
    if (!(target instanceof Node)) return;
    // A click on the anchor is the anchor's own toggle; letting it also count as "outside"
    // would close and reopen in the same gesture, which reads as nothing happening.
    if (card.contains(target) || anchored.contains(target)) return;

    api.close();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || anchored === null) return;
    // Stopped so the settings sheet behind does not also take the Escape and close itself.
    // Escape means "close the innermost thing", and the popover is it.
    event.preventDefault();
    event.stopPropagation();

    const returnTo = anchored;
    api.close();
    returnTo.focus();
  };

  /**
   * Follow the anchor, or give up on it.
   *
   * Coalesced into a frame because scroll fires far faster than anything needs to be
   * repositioned, and two `getBoundingClientRect` calls per event during a smooth scroll
   * is work for nothing.
   */
  let following = false;
  const onViewportChange = (): void => {
    if (anchored === null || following) return;
    following = true;

    requestAnimationFrame(() => {
      following = false;
      const anchor = anchored;
      if (anchor === null) return;

      const box = anchor.getBoundingClientRect();
      // Fully off the top or bottom of the window - the row has been scrolled away, and a
      // popover pointing at nothing is the case where closing is the right answer.
      const gone = box.bottom < 0 || box.top > window.innerHeight;
      if (gone) api.close();
      else place(anchor);
    });
  };

  const api: HelpPopover = {
    show(anchor: HTMLElement, entry: HelpEntry): void {
      if (anchored === anchor) {
        api.close();
        return;
      }

      anchored = anchor;

      title.textContent = entry.title;
      plain.textContent = `What it does: ${entry.plain}`;
      why.textContent = `Why use it: ${entry.why}`;
      how.textContent = `How to use it: ${entry.how}`;

      card.hidden = false;
      anchor.setAttribute("aria-expanded", "true");

      // Measured after being made visible, before being revealed - the element has a size
      // only once it is in the layout.
      place(anchor);

      /*
       * A forced reflow rather than `requestAnimationFrame`.
       *
       * rAF is throttled to nothing while a window is unfocused or occluded, so the frame
       * that reveals the popover may simply never arrive - the card sits in the DOM,
       * correctly placed, permanently at `opacity: 0`. Reading `offsetHeight` flushes the
       * starting style synchronously, which is all the transition needed the frame for.
       */
      void card.offsetHeight;
      card.dataset["state"] = "open";

      document.addEventListener("pointerdown", onDocumentPointerDown, true);
      document.addEventListener("keydown", onKeydown, true);
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("scroll", onViewportChange, true);
    },

    close(): void {
      if (anchored === null) return;

      anchored.setAttribute("aria-expanded", "false");
      anchored = null;

      delete card.dataset["state"];
      card.hidden = true;

      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    },

    isOpen: () => anchored !== null,
  };

  return api;
}

/**
 * The button itself.
 *
 * A `button` rather than an icon with a click handler, because it has to be reachable by
 * keyboard and announce itself to a screen reader - and because a settings screen whose
 * explanations only open for mouse users explains nothing to the people most likely to
 * need them read aloud.
 */
export function createHelpButton(
  entry: HelpEntry,
  popover: HelpPopover,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "help-button";
  button.textContent = "?";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-label", `What does ${entry.title} do?`);
  button.title = entry.plain;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    popover.show(button, entry);
  });

  return button;
}
