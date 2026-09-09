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
  size.ariaLabel = "Width by height, for pasting a size";
  size.title = "Paste a size, e.g. 390 × 844. For typing, the W and H boxes beside it are easier.";
  size.placeholder = "W × H";
  size.spellcheck = false;
  size.autocomplete = "off";

  /*
   * One-click sizes, before the dropdown.
   *
   * The dropdown lists seven presets but reads as a setting; these three answer
   * the question people actually ask - "phone, tablet, or desktop?" - with one
   * click. They write the same viewport as picking the matching preset.
   */
  const QUICK_SIZES: ReadonlyArray<readonly [string, number, number]> = [
    ["Phone", 390, 844],
    ["Tablet", 768, 1024],
    ["Desktop", 1440, 900],
  ];
  const quickButtons: HTMLButtonElement[] = QUICK_SIZES.map(([label, width, height]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button device-quick";
    button.textContent = label;
    button.title = `Preview at ${width} × ${height} without reloading the page`;
    button.setAttribute("aria-label", `Preview at ${label} size, ${width} by ${height}`);
    button.addEventListener("click", () => set({ width, height }));
    return button;
  });

  /*
   * Labelled width and height steppers.
   *
   * The earlier bar had two bare number boxes and a combined text box with no
   * visible labels - three inputs for one size, none saying which was which.
   * Now each dimension is one labelled group: a − button, the number, a + button.
   * Typing, arrow keys, and the steppers all write the same three frame
   * properties (`width`, `height`, `transform`) and nothing else, so none of
   * them ever reloads the page. The combined box stays behind them for paste
   * and for the smoke check that types `360x640` into it.
   */
  const STEP = 20;

  function dimensionGroup(
    name: "Width" | "Height",
    applyStep: (viewport: Viewport, delta: number) => Viewport,
    commit: (input: HTMLInputElement) => void,
  ): { group: HTMLElement; input: HTMLInputElement } {
    const group = document.createElement("span");
    group.className = "device-dim";

    const label = document.createElement("span");
    label.className = "device-dim-label";
    label.textContent = name === "Width" ? "W" : "H";
    label.title = `Viewport ${name.toLowerCase()} in CSS pixels — the frame reshapes in place`;
    label.setAttribute("aria-hidden", "true");

    const input = document.createElement("input");
    input.type = "number";
    input.className = name === "Width" ? "device-width" : "device-height";
    input.ariaLabel = `Viewport ${name.toLowerCase()} in CSS pixels`;
    input.title = `Viewport ${name.toLowerCase()} in CSS pixels — the frame reshapes in place, never reloads`;
    input.min = "180";
    input.max = "4000";
    input.step = String(STEP);

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "ghost-button device-step";
    minus.textContent = "−";
    minus.title = `${name} minus ${STEP}px`;
    minus.setAttribute("aria-label", `Decrease ${name.toLowerCase()} by ${STEP} pixels`);
    minus.addEventListener("click", () => set(applyStep(viewport, -STEP)));

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "ghost-button device-step";
    plus.textContent = "+";
    plus.title = `${name} plus ${STEP}px`;
    plus.setAttribute("aria-label", `Increase ${name.toLowerCase()} by ${STEP} pixels`);
    plus.addEventListener("click", () => set(applyStep(viewport, STEP)));

    input.addEventListener("change", () => commit(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(input);
      }
    });

    group.append(label, minus, input, plus);
    return { group, input };
  }

  const widthGroup = dimensionGroup(
    "Width",
    (current, delta) => ({ width: current.width + delta, height: current.height }),
    (input) => {
      const width = Number(input.value);
      if (!Number.isFinite(width)) {
        input.value = String(viewport.width);
        return;
      }
      set({ width, height: viewport.height });
    },
  );
  const heightGroup = dimensionGroup(
    "Height",
    (current, delta) => ({ width: current.width, height: current.height + delta }),
    (input) => {
      const height = Number(input.value);
      if (!Number.isFinite(height)) {
        input.value = String(viewport.height);
        return;
      }
      set({ width: viewport.width, height });
    },
  );
  const widthInput = widthGroup.input;
  const heightInput = heightGroup.input;

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

  /*
   * The one-line hint that makes resizing discoverable. The bar used to be a row
   * of bare boxes nobody could explain; now it says what to do.
   */
  const hint = document.createElement("span");
  hint.className = "device-hint";
  hint.textContent = "Tip: drag the frame's edges, or use W / H.";

  element.append(
    ...quickButtons,
    presetPicker,
    widthGroup.group,
    heightGroup.group,
    size,
    rotateButton,
    zoomPicker,
    readout,
    hint,
  );

  /* ── The drag handles ───────────────────────────────────────────────── */

  const edges = ["right", "bottom", "corner"] as const;
  type Edge = (typeof edges)[number];

  const HANDLE_TITLES: Record<Edge, string> = {
    right: "Drag to resize the width — the page keeps running, it never reloads",
    bottom: "Drag to resize the height — the page keeps running, it never reloads",
    corner: "Drag to resize width and height — the page keeps running, it never reloads",
  };

  const handles = new Map<Edge, HTMLElement>();
  for (const edge of edges) {
    const handle = document.createElement("div");
    handle.className = `device-handle device-handle-${edge}`;
    handle.dataset["edge"] = edge;
    handle.hidden = true;
    handle.title = HANDLE_TITLES[edge];
    // Hidden from assistive tech: the size readout and the W / H inputs are the
    // screen-reader route, and a pointer-only drag handle has nothing to say there.
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
    widthInput.value = String(viewport.width);
    heightInput.value = String(viewport.height);

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
