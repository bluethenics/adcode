import type { PopupId } from "./popupLayer.ts";
import type { LayoutInput } from "./motion.ts";

export type PopupSize = "anchored" | "medium" | "large" | "workspace";

export interface PopupShellOptions {
  readonly id: PopupId;
  readonly title: string;
  readonly size: PopupSize;
  readonly modal: boolean;
  readonly host: HTMLElement;
  readonly content: HTMLElement;
  readonly initialFocus?: () => HTMLElement | null;
  readonly closeOnBackdrop?: boolean;
  readonly onRequestClose: () => void;
}

export interface PopupOpenOptions {
  readonly trigger?: HTMLElement;
  readonly anchor?: HTMLElement;
  readonly input?: LayoutInput;
  readonly initialFocus?: HTMLElement;
}

export interface PopupShell {
  readonly element: HTMLDialogElement;
  readonly surface: HTMLElement;
  open(options?: PopupOpenOptions): void;
  close(options?: { readonly restoreFocus?: boolean; readonly immediate?: boolean }): void;
  isOpen(): boolean;
  focus(): void;
}

/** A click's composed path survives synchronous replacement of its original target. */
export function isPopupShellBackdrop(event: Event, surface: HTMLElement): boolean {
  return !event.composedPath().includes(surface);
}

export function createPopupShell(options: PopupShellOptions): PopupShell {
  const dialog = document.createElement("dialog");
  dialog.className = "popup-shell";
  dialog.dataset["popupId"] = options.id;
  dialog.dataset["popupSize"] = options.size;

  const surface = document.createElement("section");
  surface.className = "popup-shell-surface";
  surface.tabIndex = -1;
  surface.append(options.content);

  const visibleTitle = options.content.querySelector<HTMLElement>("h1, h2");
  const titleElement = visibleTitle ?? document.createElement("h2");
  titleElement.id = `popup-shell-title-${options.id}`;
  if (visibleTitle === null) {
    titleElement.className = "popup-shell-title";
    titleElement.textContent = options.title;
    surface.prepend(titleElement);
  }
  dialog.setAttribute("aria-labelledby", titleElement.id);
  dialog.append(surface);
  options.host.append(dialog);

  let restoreTarget: HTMLElement | null = null;
  let sourceOffset = { x: 0, y: 10 };
  let motionGeneration = 0;

  const reducedMotion = (): boolean =>
    document.documentElement.dataset["reducedMotion"] === "true" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const enterTiming = {
    duration: 220,
    easing: "cubic-bezier(.32,.72,0,1)",
  } satisfies KeyframeAnimationOptions;
  const reducedTiming = {
    duration: 100,
    easing: "linear",
  } satisfies KeyframeAnimationOptions;

  const cancelSurfaceMotion = (): void => {
    motionGeneration += 1;
    surface.getAnimations().forEach((animation) => animation.cancel());
  };

  // Computed styles are live. Copy the painted values before canceling their animation.
  const presentation = (): Keyframe => {
    const current = getComputedStyle(surface);
    return { opacity: current.opacity, scale: current.scale, translate: current.translate };
  };

  const offsetFrom = (trigger: HTMLElement | undefined): { x: number; y: number } => {
    if (trigger === undefined) return { x: 0, y: 10 };
    const origin = trigger.getBoundingClientRect();
    const destination = surface.getBoundingClientRect();
    return {
      x: Math.max(-28, Math.min(28, origin.left + origin.width / 2 - (destination.left + destination.width / 2))),
      y: Math.max(-28, Math.min(28, origin.top + origin.height / 2 - (destination.top + destination.height / 2))),
    };
  };

  const animateOpen = (input: LayoutInput, trigger: HTMLElement | undefined, current?: Keyframe): void => {
    cancelSurfaceMotion();
    delete dialog.dataset["closing"];
    if (input === "keyboard") return;

    if (current === undefined) {
      sourceOffset = offsetFrom(trigger);
      surface.style.transformOrigin = `${String(sourceOffset.x < 0 ? 0 : surface.clientWidth)}px ${String(sourceOffset.y < 0 ? 0 : surface.clientHeight)}px`;
    }
    const reduce = reducedMotion();
    const keyframes: Keyframe[] = reduce
      ? [{ opacity: current?.opacity ?? 0 }, { opacity: 1 }]
      : [
          current ?? { opacity: 0, scale: 0.97, translate: `${String(sourceOffset.x)}px ${String(sourceOffset.y)}px` },
          { opacity: 1, scale: 1, translate: "0 0" },
        ];
    surface.animate(keyframes, reduce ? reducedTiming : enterTiming);
  };

  const finishClose = (generation: number, restoreFocus: boolean): void => {
    if (generation !== motionGeneration || !dialog.open) return;
    dialog.close();
    delete dialog.dataset["closing"];
    if (restoreFocus) restoreTarget?.focus();
  };

  const announce = (open: boolean): void => {
    restoreTarget?.setAttribute("aria-expanded", String(open));
    restoreTarget?.setAttribute("aria-pressed", String(open));
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    options.onRequestClose();
  });
  dialog.addEventListener("keydown", (event) => {
    if (!options.modal && event.key === "Escape") {
      event.preventDefault();
      options.onRequestClose();
    }
  });
  dialog.addEventListener("click", (event) => {
    if (options.closeOnBackdrop !== false && isPopupShellBackdrop(event, surface)) {
      options.onRequestClose();
    }
  });

  return {
    element: dialog,
    surface,
    open(openOptions = {}) {
      const current = dialog.open ? presentation() : undefined;
      restoreTarget = openOptions.trigger ?? null;
      if (openOptions.anchor !== undefined) positionAnchored(dialog, openOptions.anchor);
      if (!dialog.open) {
        if (options.modal) dialog.showModal();
        else dialog.show();
      }
      const input = openOptions.input ?? "keyboard";
      dialog.dataset["input"] = input;
      animateOpen(input, openOptions.trigger, current);
      announce(true);
      (openOptions.initialFocus ?? options.initialFocus?.() ?? surface).focus({
        preventScroll: true,
      });
    },
    close(closeOptions = {}) {
      if (!dialog.open) return;
      if (
        dialog.dataset["closing"] === "true" &&
        closeOptions.immediate !== true
      )
        return;
      const current = presentation();
      cancelSurfaceMotion();
      announce(false);
      const restoreFocus = closeOptions.restoreFocus !== false;
      if (closeOptions.immediate === true) {
        finishClose(motionGeneration, restoreFocus);
        return;
      }

      dialog.dataset["closing"] = "true";
      const generation = motionGeneration;
      const duration = reducedMotion() ? 100 : 160;
      const keyframes: Keyframe[] = reducedMotion()
        ? [{ opacity: current.opacity }, { opacity: 0 }]
        : [
            { opacity: current.opacity, scale: current.scale, translate: current.translate },
            { opacity: 0, scale: 0.97, translate: `${String(sourceOffset.x)}px ${String(sourceOffset.y)}px` },
          ];
      const animation = surface.animate(keyframes, {
        duration,
        easing: "cubic-bezier(.4,0,1,1)",
        fill: "forwards",
      });
      void animation.finished
        .then(() => finishClose(generation, restoreFocus))
        .catch(() => undefined);
    },
    isOpen: () => dialog.open,
    focus: () => surface.focus({ preventScroll: true }),
  };
}

function positionAnchored(dialog: HTMLDialogElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const width = Math.min(420, window.innerWidth - 72);
  const x = Math.max(12, Math.min(box.right + 10, window.innerWidth - width - 12));
  dialog.style.setProperty("--popup-anchor-x", `${String(x)}px`);
  dialog.style.setProperty("--popup-anchor-y", `${String(box.top)}px`);
}
