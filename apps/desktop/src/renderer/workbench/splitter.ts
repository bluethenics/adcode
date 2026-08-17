/**
 * A draggable divider between two regions of the workbench.
 *
 * One component for both axes, because the only real difference is which coordinate is
 * read and which direction counts as "bigger" - the sidebar grows as the pointer moves
 * right, the panel grows as it moves *up*.
 *
 * Three things this does that a `mousemove` listener would not:
 *
 *   - **Pointer capture.** Dragging quickly takes the pointer over Monaco, which is its
 *     own event-hungry surface; without capture the moves stop arriving and the divider
 *     sticks to the last place it heard about while the button is still held.
 *   - **`user-select: none` on the body for the duration.** Otherwise a drag across the
 *     editor selects text the whole way, and the user lets go holding a selection they
 *     never asked for.
 *   - **Keyboard.** A control that can only be operated by dragging is a control some
 *     people cannot operate. Arrows nudge, Home resets, and the handle is focusable.
 */

export interface SplitterDeps {
  /** The element the user grabs. */
  readonly element: HTMLElement;
  readonly axis: "x" | "y";
  /** The size right now, in pixels - read at the start of every drag. */
  readonly current: () => number;
  /** Apply a new size. Clamping belongs to the caller, which knows the limits. */
  readonly apply: (size: number) => void;
  /** Called when a drag or a key press finishes, so the result can be persisted. */
  readonly commit: () => void;
  /** What double-click restores. */
  readonly reset: number;
  /**
   * Which pointer direction makes the region larger.
   *
   * The sidebar grows rightwards (+1); the panel is below the editor, so it grows as the
   * pointer moves up, which is a decreasing Y (-1).
   */
  readonly sign: 1 | -1;
  readonly label: string;
}

const KEY_STEP = 16;

export function createSplitter(deps: SplitterDeps): void {
  const { element, axis } = deps;

  element.classList.add("splitter");
  element.dataset["axis"] = axis;
  element.tabIndex = 0;
  element.setAttribute("role", "separator");
  element.setAttribute("aria-orientation", axis === "x" ? "vertical" : "horizontal");
  element.setAttribute("aria-label", deps.label);

  let startPointer = 0;
  let startSize = 0;
  let dragging = false;

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;

    const position = axis === "x" ? event.clientX : event.clientY;
    deps.apply(startSize + (position - startPointer) * deps.sign);
  }

  function stop(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;

    element.releasePointerCapture(event.pointerId);
    delete element.dataset["dragging"];
    delete document.body.dataset["resizing"];
    deps.commit();
  }

  element.addEventListener("pointerdown", (event) => {
    // Left button only: a right-click here should not start a drag that can only be
    // ended by pressing and releasing the left one.
    if (event.button !== 0) return;

    event.preventDefault();
    dragging = true;
    startPointer = axis === "x" ? event.clientX : event.clientY;
    startSize = deps.current();

    element.setPointerCapture(event.pointerId);
    element.dataset["dragging"] = "true";
    // Suppresses selection everywhere at once; the drag crosses several surfaces.
    document.body.dataset["resizing"] = axis;
  });

  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);

  element.addEventListener("dblclick", () => {
    deps.apply(deps.reset);
    deps.commit();
  });

  element.addEventListener("keydown", (event) => {
    const bigger = axis === "x" ? "ArrowRight" : "ArrowUp";
    const smaller = axis === "x" ? "ArrowLeft" : "ArrowDown";

    if (event.key === bigger || event.key === smaller) {
      event.preventDefault();
      const step = event.key === bigger ? KEY_STEP : -KEY_STEP;
      // `sign` is already baked into which arrow means bigger, so it is not applied twice.
      deps.apply(deps.current() + step);
      deps.commit();
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      deps.apply(deps.reset);
      deps.commit();
    }
  });
}
