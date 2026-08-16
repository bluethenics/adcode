/**
 * The in-window menu bar.
 *
 * The shell uses a hidden title bar (§3), and a native menu has nowhere to live under
 * one - so the bar is drawn here, the same choice VS Code makes on Windows and Linux.
 * macOS keeps the system menu instead; there this renders nothing.
 *
 * Behaves like a real menu bar rather than a row of dropdowns: Alt focuses it, one open
 * menu means hovering a sibling switches to it, arrows walk both axes, Escape closes and
 * returns focus to the editor.
 */
import { MENU_BAR, formatAccelerator, type MenuEntry, type MenuTop } from "../../shared/menuModel.ts";

export interface MenuBar {
  readonly element: HTMLElement;
  close(): void;
  /** True while a menu is open, so the shell can leave its own shortcuts alone. */
  isOpen(): boolean;
  focusFirst(): void;
}

export interface MenuBarDeps {
  readonly run: (command: string) => void;
  readonly platform: string;
  /** Where focus goes when the menu closes without choosing anything. */
  readonly restoreFocus: () => void;
}

export function createMenuBar(deps: MenuBarDeps): MenuBar {
  const element = document.createElement("nav");
  element.className = "menubar";
  element.setAttribute("role", "menubar");
  element.ariaLabel = "Main menu";

  let openIndex: number | null = null;
  let openPanel: HTMLElement | null = null;

  const buttons: HTMLButtonElement[] = [];

  function closeMenu(restore = false): void {
    openPanel?.remove();
    openPanel = null;

    if (openIndex !== null) buttons[openIndex]?.setAttribute("aria-expanded", "false");
    openIndex = null;

    if (restore) deps.restoreFocus();
  }

  /** Build one dropdown's contents. Submenus are inlined with a heading. */
  function buildPanel(top: MenuTop): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "menu-panel";
    panel.setAttribute("role", "menu");

    const addEntries = (entries: readonly MenuEntry[], nested: boolean): void => {
      for (const entry of entries) {
        if ("kind" in entry && entry.kind === "separator") {
          const rule = document.createElement("div");
          rule.className = "menu-separator";
          rule.setAttribute("role", "separator");
          panel.append(rule);
          continue;
        }

        if ("kind" in entry && entry.kind === "submenu") {
          const heading = document.createElement("div");
          heading.className = "menu-heading";
          heading.textContent = entry.label;
          panel.append(heading);
          addEntries(entry.items, true);
          continue;
        }

        const item = document.createElement("button");
        item.className = "menu-item";
        item.type = "button";
        item.setAttribute("role", "menuitem");
        if (nested) item.dataset["nested"] = "true";

        const label = document.createElement("span");
        label.className = "menu-item-label";
        label.textContent = entry.label;
        item.append(label);

        if (entry.accelerator !== undefined) {
          const hint = document.createElement("span");
          hint.className = "menu-item-accelerator";
          hint.textContent = formatAccelerator(entry.accelerator, deps.platform);
          item.append(hint);
        }

        item.addEventListener("click", () => {
          closeMenu();
          deps.run(entry.command);
        });

        panel.append(item);
      }
    };

    addEntries(top.items, false);
    return panel;
  }

  function openAt(index: number): void {
    const top = MENU_BAR[index];
    const button = buttons[index];
    if (top === undefined || button === undefined) return;

    closeMenu();

    const panel = buildPanel(top);
    // Positioned against the bar rather than inside the button, so a long menu is not
    // clipped by the title bar's own overflow.
    panel.style.left = `${button.offsetLeft}px`;
    element.append(panel);

    openPanel = panel;
    openIndex = index;
    button.setAttribute("aria-expanded", "true");

    panel.querySelector<HTMLElement>(".menu-item")?.focus();
  }

  MENU_BAR.forEach((top, index) => {
    const button = document.createElement("button");
    button.className = "menubar-item";
    button.type = "button";
    button.textContent = top.label;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");

    button.addEventListener("click", () => {
      if (openIndex === index) closeMenu(true);
      else openAt(index);
    });

    // Once one menu is open, sliding along the bar switches between them - which is what
    // makes a menu bar feel like a menu bar rather than seven separate buttons.
    button.addEventListener("mouseenter", () => {
      if (openIndex !== null && openIndex !== index) openAt(index);
    });

    buttons.push(button);
    element.append(button);
  });

  /** Arrow-key navigation within the open panel and across the bar. */
  element.addEventListener("keydown", (event) => {
    if (openIndex === null) return;

    const items = openPanel === null ? [] : [...openPanel.querySelectorAll<HTMLElement>(".menu-item")];
    const at = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = items[(at + step + items.length) % items.length];
      next?.focus();
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      openAt((openIndex + step + MENU_BAR.length) % MENU_BAR.length);
    }
  });

  // A click anywhere else closes the menu, as it does everywhere.
  document.addEventListener("pointerdown", (event) => {
    if (openIndex !== null && !element.contains(event.target as Node)) closeMenu();
  });

  return {
    element,
    close: () => closeMenu(),
    isOpen: () => openIndex !== null,
    focusFirst() {
      if (openIndex === null) openAt(0);
      else closeMenu(true);
    },
  };
}
