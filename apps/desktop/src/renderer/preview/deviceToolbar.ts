/**
 * Device-size preview: check a layout at a width without leaving the editor.
 *
 * **The iframe is never touched structurally.** `previewPane.ts` explains at length why
 * reparenting it destroys the document and reloads the page; the same trap applies to
 * resizing, and it is worse here because resizing is something the user does continuously.
 * A responsive check that reloaded the page on every pixel of a drag would throw away
 * scroll position, form state and whatever the page's own JavaScript was holding - roughly
 * once per frame.
 *
 * So this only ever sets three things on the frame that already exists: `width`, `height`
 * and `transform`. All three are pure layout; none of them reload anything. You can drag
 * from 1440 down to 280 and the page keeps running.
 *
 * **Scale is a lie about size and the truth about layout.** When a 1440-wide viewport will
 * not fit the pane, the frame is scaled down with a transform. A transform does not change
 * the viewport the page sees, so `@media (min-width: 1200px)` still matches - the page lays
 * out as a desktop and is merely drawn smaller. Setting the frame's CSS width to what fits
 * instead would silently test the wrong breakpoint, which is the failure this design exists
 * to avoid.
 */
import {
  DEVICE_PRESETS,
  clampViewport,
  fitScale,
  formatSize,
  parseSize,
  presetFor,
  rotate,
  type Viewport,
} from "./deviceSizes.ts";

export interface DeviceToolbarDeps {
  /** The preview iframe. Only its `style` is ever written. */
  readonly frame: HTMLIFrameElement;
  /** The scrollable area the frame sits in. Drag handles are mounted here. */
  readonly stage: HTMLElement;
  /** Remember the last viewport for this workspace. */
  readonly persist: (viewport: Viewport | null) => void;
}

export interface DeviceToolbar {
  readonly element: HTMLElement;
  /** Turn device sizing on or off. Off restores a frame that fills the pane. */
  setActive(active: boolean): void;
  isActive(): boolean;
  toggle(): void;
  /** Re-fit after the pane itself changed size. */
  refit(): void;
  /** Restore a remembered viewport without announcing it as a change. */
  restore(viewport: Viewport | null): void;
}

/** How wide the invisible grab strip along each draggable edge is. */
const HANDLE = 10;

export function createDeviceToolbar(deps: DeviceToolbarDeps): DeviceToolbar {
  const element = document.createElement("div");
  element.className = "device-bar";
  element.hidden = true;

  const presetPicker = document.createElement("select");
  presetPicker.className = "device-preset";
  presetPicker.ariaLabel = "Device size";

  const custom = document.createElement("option");
  custom.value = "custom";
  custom.textContent = "Custom";
  presetPicker.append(custom);

  for (const preset of DEVICE_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    presetPicker.append(option);
  }

  const size = document.createElement("input");
  size.type = "text";
  size.className = "device-size";
  size.ariaLabel = "Width by height";
  size.spellcheck = false;
  size.autocomplete = "off";

  const rotateButton = document.createElement("button");
  rotateButton.type = "button";
  rotateButton.className = "ghost-button device-action";
  rotateButton.textContent = "Rotate";
  rotateButton.title = "Swap width and height";

  const zoomPicker = document.createElement("select");
  zoomPicker.className = "device-zoom";
  zoomPicker.ariaLabel = "Zoom";
  for (const [value, label] of [
    ["fit", "Fit"],
    ["1", "100%"],
    ["0.75", "75%"],
    ["0.5", "50%"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    zoomPicker.append(option);
  }

  const readout = document.createElement("span");
  readout.className = "device-readout";
  // `aria-live` because during a drag this is the only thing that says what is happening,
  // and a pointer drag gives a screen reader nothing else to go on.
  readout.ariaLive = "polite";

  element.append(presetPicker, size, rotateButton, zoomPicker, readout);

  /* ── The drag handles ───────────────────────────────────────────────── */

  const edges = ["right", "bottom", "corner"] as const;
  type Edge = (typeof edges)[number];

  const handles = new Map<Edge, HTMLElement>();
  for (const edge of edges) {
    const handle = document.createElement("div");
    handle.className = `device-handle device-handle-${edge}`;
    handle.dataset["edge"] = edge;
    handle.hidden = true;
    handle.setAttribute("aria-hidden", "true");
    handles.set(edge, handle);
    deps.stage.append(handle);
  }

  let active = false;
  let viewport: Viewport = { width: 390, height: 844 };
  let zoom: "fit" | number = "fit";

  function available(): Viewport {
    // The stage's own box, less a margin so the handles are reachable rather than flush
    // against the pane edge.
    return {
      width: Math.max(0, deps.stage.clientWidth - 2 * HANDLE),
      height: Math.max(0, deps.stage.clientHeight - 2 * HANDLE),
    };
  }

  function scale(): number {
    return zoom === "fit" ? fitScale(viewport, available()) : zoom;
  }

  /** Write the three properties, and nothing else, onto the frame. */
  function apply(): void {
    if (!active) {
      deps.frame.style.removeProperty("width");
      deps.frame.style.removeProperty("height");
      deps.frame.style.removeProperty("transform");
      deps.stage.dataset["device"] = "off";
      for (const handle of handles.values()) handle.hidden = true;
      return;
    }

    const factor = scale();
    deps.frame.style.width = `${viewport.width}px`;
    deps.frame.style.height = `${viewport.height}px`;
    deps.frame.style.transform = factor === 1 ? "none" : `scale(${factor})`;
    deps.stage.dataset["device"] = "on";

    // The handles sit on the frame's *drawn* edges, which scaling moves.
    const drawn = { width: viewport.width * factor, height: viewport.height * factor };
    deps.stage.style.setProperty("--device-drawn-width", `${drawn.width}px`);
    deps.stage.style.setProperty("--device-drawn-height", `${drawn.height}px`);
    for (const handle of handles.values()) handle.hidden = false;

    const percent = Math.round(factor * 100);
    readout.textContent = factor === 1 ? formatSize(viewport) : `${formatSize(viewport)} · ${percent}%`;
    size.value = formatSize(viewport);

    const preset = presetFor(viewport);
    presetPicker.value = preset?.id ?? "custom";
  }

  function set(next: Viewport, remember = true): void {
    viewport = clampViewport(next);
    apply();
    if (remember) deps.persist(active ? viewport : null);
  }

  presetPicker.addEventListener("change", () => {
    const preset = DEVICE_PRESETS.find((candidate) => candidate.id === presetPicker.value);
    // "Custom" is a label for a state, not a size to switch to - selecting it changes
    // nothing and leaves the current numbers alone to be edited.
    if (preset !== undefined) set({ width: preset.width, height: preset.height });
  });

  const commitSize = (): void => {
    const parsed = parseSize(size.value, viewport.height);
    if (parsed === null) {
      // Unreadable input snaps back rather than clearing: the user's next move is almost
      // always to correct one digit.
      size.value = formatSize(viewport);
      return;
    }
    set(parsed);
  };

  size.addEventListener("change", commitSize);
  size.addEventListener("blur", commitSize);
  size.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSize();
    }
  });

  rotateButton.addEventListener("click", () => set(rotate(viewport)));

  zoomPicker.addEventListener("change", () => {
    zoom = zoomPicker.value === "fit" ? "fit" : Number(zoomPicker.value);
    apply();
  });

  /* ── Dragging an edge ───────────────────────────────────────────────── */

  for (const [edge, handle] of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (!active) return;

      event.preventDefault();
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      const startY = event.clientY;
      const start = viewport;
      // The pointer moves in drawn pixels; the viewport is in CSS pixels. Without dividing
      // by the scale, a frame shown at 50% would resize twice as fast as the pointer.
      const factor = scale();

      const onMove = (move: PointerEvent): void => {
        const dx = (move.clientX - startX) / factor;
        const dy = (move.clientY - startY) / factor;

        set(
          {
            width: edge === "bottom" ? start.width : start.width + dx,
            height: edge === "right" ? start.height : start.height + dy,
          },
          // Not persisted per pointer move - only when the drag ends.
          false,
        );
      };

      /*
       * The grab bar is drawn on `:hover`, and a resize leaves the handle almost at once -
       * the pointer is captured, so the drag keeps working, but the hover does not survive
       * it. The bar therefore vanished on the first pixel of every resize, which is the one
       * moment it is meant to be visible: the feedback disappeared exactly while the user
       * was doing the thing it was feedback for.
       *
       * The attribute holds it lit for the whole gesture, and it is cleared on cancel as
       * well as on release, or a drag interrupted by the window losing focus leaves a
       * handle glowing at nothing.
       */
      handle.dataset["dragging"] = "true";

      const onUp = (): void => {
        delete handle.dataset["dragging"];
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        deps.persist(viewport);
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  return {
    element,

    setActive(next) {
      active = next;
      element.hidden = !next;
      apply();
      deps.persist(next ? viewport : null);
    },

    isActive: () => active,

    toggle() {
      this.setActive(!active);
    },

    refit() {
      // Only matters in Fit, where the scale is a function of the pane's size.
      if (active) apply();
    },

    restore(remembered) {
      if (remembered === null) {
        active = false;
        element.hidden = true;
        apply();
        return;
      }

      viewport = clampViewport(remembered);
      active = true;
      element.hidden = false;
      apply();
    },
  };
}
