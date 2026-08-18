/**
 * The right-click menu.
 *
 * Deliberately built on the menu bar's `.menu-panel` / `.menu-item` classes rather than a
 * second set of its own: two menus styled separately drift apart, and the drift shows up
 * as one of them looking subtly wrong in a theme nobody tested. The only additions are a
 * `data-context` flag that switches the panel to fixed positioning and a `data-danger`
 * flag for entries that destroy something.
 *
 * Positioning flips rather than clamps. A menu opened near the bottom edge that merely
 * slid up would sit under the pointer with a different entry beneath it than the one the
 * user was aiming at, which is how people delete the wrong file.
 */

export interface ContextMenuItem {
  readonly kind?: "item";
  readonly label: string;
  readonly run: () => void | Promise<void>;
  readonly accelerator?: string;
  readonly disabled?: boolean;
  /** Renders in the danger colour. For entries that destroy work. */
  readonly danger?: boolean;
}

export interface ContextMenuSeparator {
  readonly kind: "separator";
}

export interface ContextMenuHeading {
  readonly kind: "heading";
  readonly label: string;
}

export type ContextMenuNode = ContextMenuItem | ContextMenuSeparator | ContextMenuHeading;

export interface ContextMenu {
  /**
   * `onClose` fires however the menu goes away - a choice, a click elsewhere, Escape, a
   * scroll. A button that opens this menu needs that to put `aria-expanded` back, and
   * there is no other moment it can learn the menu is gone.
   */
  open(x: number, y: number, nodes: readonly ContextMenuNode[], onClose?: () => void): void;
  close(): void;
  isOpen(): boolean;
  /** Move focus by `step` entries, wrapping. Skips disabled ones. */
  focusStep(step: number): void;
}

/** Keeps the panel off the window edge when it has to flip back the other way. */
const MARGIN = 6;

export function createContextMenu(host: HTMLElement): ContextMenu {
  let panel: HTMLElement | null = null;
  let notifyClosed: (() => void) | null = null;

  function close(): void {
    // Cleared before it runs, so a handler that opens another menu cannot be re-entered
    // by the `close()` that opening does first.
    const notify = notifyClosed;
    notifyClosed = null;

    panel?.remove();
    panel = null;

    notify?.();
  }

  function items(): HTMLElement[] {
    return panel === null ? [] : [...panel.querySelectorAll<HTMLElement>(".menu-item:not([disabled])")];
  }

  function focusStep(step: number): void {
    const all = items();
    if (all.length === 0) return;

    const at = all.indexOf(document.activeElement as HTMLElement);
    // -1 + 1 lands on 0, so an unfocused menu opens onto its first entry either way.
    all[(at + step + all.length) % all.length]?.focus();
  }

  function build(nodes: readonly ContextMenuNode[]): HTMLElement {
    const built = document.createElement("div");
    built.className = "menu-panel";
    built.dataset["context"] = "true";
    built.setAttribute("role", "menu");

    for (const node of nodes) {
      if ("kind" in node && node.kind === "separator") {
        const rule = document.createElement("div");
        rule.className = "menu-separator";
        rule.setAttribute("role", "separator");
        built.append(rule);
        continue;
      }

      if ("kind" in node && node.kind === "heading") {
        const heading = document.createElement("div");
        heading.className = "menu-heading";
        heading.textContent = node.label;
        built.append(heading);
        continue;
      }

      const item = document.createElement("button");
      item.className = "menu-item";
      item.type = "button";
      item.setAttribute("role", "menuitem");
      if (node.disabled === true) item.disabled = true;
      if (node.danger === true) item.dataset["danger"] = "true";

      const label = document.createElement("span");
      label.className = "menu-item-label";
      label.textContent = node.label;
      item.append(label);

      if (node.accelerator !== undefined) {
        const hint = document.createElement("span");
        hint.className = "menu-item-accelerator";
        hint.textContent = node.accelerator;
        item.append(hint);
      }

      item.addEventListener("click", () => {
        // Closed before running, so an action that opens its own surface - an inline
        // editor, a confirmation - is not immediately covered by the menu it came from.
        close();
        void Promise.resolve(node.run()).catch(() => {
          /* the action reports its own failures; nothing useful to add here */
        });
      });

      built.append(item);
    }

    return built;
  }

  return {
    open(x, y, nodes, onClose) {
      close();
      if (nodes.length === 0) {
        onClose?.();
        return;
      }

      notifyClosed = onClose ?? null;
      const built = build(nodes);
      // Measured off-screen first: the flip decision needs a real height, and a panel
      // whose contents vary cannot be measured before it is in the document.
      built.style.visibility = "hidden";
      built.style.left = "0px";
      built.style.top = "0px";
      host.append(built);
      panel = built;

      const { width, height } = built.getBoundingClientRect();
      const flipX = x + width > window.innerWidth - MARGIN;
      const flipY = y + height > window.innerHeight - MARGIN;

      const left = flipX ? Math.max(MARGIN, x - width) : x;
      const top = flipY ? Math.max(MARGIN, y - height) : y;

      built.style.left = `${left}px`;
      built.style.top = `${top}px`;
      built.style.visibility = "visible";

      items()[0]?.focus();
    },

    close,
    isOpen: () => panel !== null,
    focusStep,
  };
}

/**
 * Wire a menu's global dismissals once.
 *
 * Kept separate from `createContextMenu` so the listeners are registered a single time for
 * the application rather than per menu, and so a test can drive the menu without them.
 */
export function attachContextMenuDismissal(menu: ContextMenu, restoreFocus: () => void): void {
  document.addEventListener("pointerdown", (event) => {
    if (!menu.isOpen()) return;

    // Not every target is an element - an event dispatched at `document` has no `closest`,
    // and the exception left the menu open with no way to dismiss it.
    const target = event.target;
    const inside = target instanceof Element && target.closest(".menu-panel[data-context]") !== null;
    if (!inside) menu.close();
  });

  // A menu anchored to a row that has scrolled away is pointing at the wrong thing.
  window.addEventListener("scroll", () => menu.close(), true);
  window.addEventListener("blur", () => menu.close());
  window.addEventListener("resize", () => menu.close());

  document.addEventListener("keydown", (event) => {
    if (!menu.isOpen()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      menu.close();
      restoreFocus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      menu.focusStep(event.key === "ArrowDown" ? 1 : -1);
    }
  });
}
