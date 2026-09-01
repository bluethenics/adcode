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
  close(options?: { readonly restoreFocus?: boolean }): void;
  isOpen(): boolean;
  focus(): void;
}

export function createPopupShell(options: PopupShellOptions): PopupShell {
  const dialog = document.createElement("dialog");
  dialog.className = "popup-shell";
  dialog.dataset["popupId"] = options.id;
  dialog.dataset["popupSize"] = options.size;
  dialog.setAttribute("aria-label", options.title);

  const surface = document.createElement("section");
  surface.className = "popup-shell-surface";
  surface.tabIndex = -1;
  surface.append(options.content);
  dialog.append(surface);
  options.host.append(dialog);

  let restoreTarget: HTMLElement | null = null;

  const announce = (open: boolean): void => {
    restoreTarget?.setAttribute("aria-expanded", String(open));
    restoreTarget?.setAttribute("aria-pressed", String(open));
  };

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    options.onRequestClose();
  });
  dialog.addEventListener("click", (event) => {
    if (options.closeOnBackdrop !== false && !surface.contains(event.target as Node)) {
      options.onRequestClose();
    }
  });

  return {
    element: dialog,
    surface,
    open(openOptions = {}) {
      restoreTarget = openOptions.trigger ?? null;
      if (openOptions.anchor !== undefined) positionAnchored(dialog, openOptions.anchor);
      if (options.modal) dialog.showModal();
      else dialog.show();
      dialog.dataset["input"] = openOptions.input ?? "keyboard";
      announce(true);
      (openOptions.initialFocus ?? surface).focus({ preventScroll: true });
    },
    close(closeOptions = {}) {
      if (!dialog.open) return;
      dialog.close();
      announce(false);
      if (closeOptions.restoreFocus !== false) restoreTarget?.focus();
    },
    isOpen: () => dialog.open,
    focus: () => surface.focus({ preventScroll: true }),
  };
}

function positionAnchored(dialog: HTMLDialogElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  dialog.style.setProperty("--popup-anchor-x", `${String(box.right + 10)}px`);
  dialog.style.setProperty("--popup-anchor-y", `${String(box.top)}px`);
}
