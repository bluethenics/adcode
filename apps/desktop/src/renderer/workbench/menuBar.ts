/**
 * The in-window menu bar.
 *
 * The shell uses a hidden title bar (§3), and a native menu has nowhere to live under
 * one - so the bar is drawn here, the same choice VS Code makes on Windows and Linux.
 * macOS keeps the system menu instead; there this renders nothing.
 *
 * Behaves like a real menu bar rather than a row of dropdowns. Alt focuses it without
 * opening anything, Alt+F opens File from wherever you were, one open menu means hovering
 * a sibling switches to it, submenus fly out to the side, arrows walk both axes, Home and
 * End go to the ends, a letter jumps to the row that claims it, and Escape unwinds one
 * level at a time until focus is back in the editor.
 *
 * Where the keystroke lands is decided by `menuKeyboard.ts`, which is pure and tested. This
 * file owns the DOM: what is built, where it is put, and what has focus.
 */
import {
  buildMenuBar,
  formatAccelerator,
  splitMnemonic,
  type MenuContext,
  type MenuEntry,
  type MenuItem,
  type MenuSubmenu,
  type MenuTop,
} from "../../shared/menuModel.ts";
import { edgeIndex, matchLetter, stepIndex, type MenuRow } from "./menuKeyboard.ts";
import { shortenPath } from "./pathLabel.ts";

export interface MenuBar {
  readonly element: HTMLElement;
  close(): void;
  /** True while a menu is open, so the shell can leave its own shortcuts alone. */
  isOpen(): boolean;
  /** True while the bar holds focus, open or not - Escape has to know. */
  isFocused(): boolean;
  /** Alt: focus the bar, underline the mnemonics, open nothing yet. */
  focusBar(): void;
  /** Alt+F and friends. True when a menu claimed the letter. */
  openByMnemonic(char: string): boolean;
  /** Rebuild from new runtime state - the recent folders, so far. */
  setContext(context: MenuContext): void;
}

export interface MenuBarDeps {
  readonly run: (command: string, arg?: string) => void;
  readonly platform: string;
  /** Where focus goes when the menu closes without choosing anything. */
  readonly restoreFocus: () => void;
}

/** One open dropdown: the root panel, or a submenu flying out of one. */
interface OpenPanel {
  readonly element: HTMLElement;
  /** Aligned with `rows` and `entries`; separators produce no entry in any of the three. */
  readonly buttons: HTMLButtonElement[];
  readonly rows: MenuRow[];
  /** Separators are drawn and then forgotten, so what is kept is only what can be chosen. */
  readonly entries: (MenuItem | MenuSubmenu)[];
}

/** Where a submenu sits relative to its parent row, so the two line up. */
const PANEL_PADDING = 5;

/** Characters of parent path a recent folder's row shows beside its name. */
const DETAIL_WIDTH = 30;

export function createMenuBar(deps: MenuBarDeps): MenuBar {
  const element = document.createElement("nav");
  element.className = "menubar";
  element.setAttribute("role", "menubar");
  element.ariaLabel = "Main menu";
  // Underlines appear once the bar has been reached from the keyboard, which is the only
  // time they mean anything. Windows has drawn them this way for thirty years.
  element.dataset["mnemonics"] = "false";

  let bar: readonly MenuTop[] = buildMenuBar();
  let buttons: HTMLButtonElement[] = [];
  let openIndex: number | null = null;
  /** Root panel first, then one entry per level of submenu currently flown out. */
  let stack: OpenPanel[] = [];
  /** Which row of each depth flew the next panel out, so Escape returns to it. */
  const lastOpenedRow: Record<number, number> = {};

  const deepest = (): OpenPanel | undefined => stack.at(-1);

  // A predicate rather than a boolean, so the row-building code below narrows to the one
  // shape that has accelerators and the one that has children.
  const isSubmenu = (entry: MenuItem | MenuSubmenu): entry is MenuSubmenu => entry.kind === "submenu";

  /* ── Building ────────────────────────────────────────────────────────── */

  /** The label, with its mnemonic letter underlined rather than spelled with an `&`. */
  function labelInto(host: HTMLElement, label: string): void {
    const split = splitMnemonic(label);

    if (split.key === null) {
      host.textContent = split.before;
      return;
    }

    const mark = document.createElement("u");
    mark.textContent = split.key;
    host.append(split.before, mark, split.after);
  }

  function buildPanel(entries: readonly MenuEntry[], depth: number): OpenPanel {
    const panel = document.createElement("div");
    panel.className = "menu-panel";
    panel.setAttribute("role", "menu");
    panel.dataset["depth"] = String(depth);

    const built: OpenPanel = { element: panel, buttons: [], rows: [], entries: [] };

    for (const entry of entries) {
      if ("kind" in entry && entry.kind === "separator") {
        const rule = document.createElement("div");
        rule.className = "menu-separator";
        rule.setAttribute("role", "separator");
        panel.append(rule);
        continue;
      }

      const item = document.createElement("button");
      item.className = "menu-item";
      item.type = "button";
      item.tabIndex = -1;
      item.setAttribute("role", "menuitem");

      const label = document.createElement("span");
      label.className = "menu-item-label";
      labelInto(label, entry.label);
      item.append(label);

      if (isSubmenu(entry)) {
        item.setAttribute("aria-haspopup", "true");
        item.setAttribute("aria-expanded", "false");

        const chevron = document.createElement("span");
        chevron.className = "menu-item-chevron";
        chevron.textContent = "›";
        chevron.setAttribute("aria-hidden", "true");
        item.append(chevron);
      } else {
        if (entry.enabled === false) item.disabled = true;

        if (entry.accelerator !== undefined) {
          const hint = document.createElement("span");
          hint.className = "menu-item-accelerator";
          hint.textContent = formatAccelerator(entry.accelerator, deps.platform);
          item.append(hint);
        } else if (entry.detail !== undefined) {
          // Where a recent folder lives, in the same slot an accelerator would use: a
          // dimmed second string on the right is exactly what it is.
          //
          // Trimmed from the front, not by CSS. Two projects both called `src` are told
          // apart by the end of their parent path, and ellipsising the end - which is all
          // `text-overflow` can do - renders both of them as `E:dcode-sourcecode\p…`.
          const detail = document.createElement("span");
          detail.className = "menu-item-detail";
          detail.textContent = shortenPath(entry.detail, DETAIL_WIDTH);
          detail.title = entry.detail;
          item.append(detail);
        }
      }

      const at = built.buttons.length;
      item.addEventListener("click", () => choose(depth, at));
      // Moving the pointer over a row is a selection, and it also has to put away any
      // submenu that a *different* row on this panel had opened.
      item.addEventListener("mouseenter", () => {
        if (item.disabled) return;
        truncateTo(depth);
        item.focus();
        if (isSubmenu(entry)) openSubmenu(depth, at);
      });

      built.buttons.push(item);
      // A submenu row is always choosable: what it opens may be empty, but the row is not.
      built.rows.push({ label: entry.label, enabled: isSubmenu(entry) || entry.enabled !== false });
      built.entries.push(entry);
      panel.append(item);
    }

    return built;
  }

  function buildTopButtons(): void {
    for (const button of buttons) button.remove();
    buttons = [];

    bar.forEach((top, index) => {
      const button = document.createElement("button");
      button.className = "menubar-item";
      button.type = "button";
      // Roving: one stop for the whole bar, so Tab does not walk eight menus.
      button.tabIndex = index === 0 ? 0 : -1;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-haspopup", "true");
      button.setAttribute("aria-expanded", "false");
      labelInto(button, top.label);

      button.addEventListener("click", () => {
        if (openIndex === index) closeMenu(true);
        else openAt(index);
      });

      // Once one menu is open, sliding along the bar switches between them - which is what
      // makes a menu bar feel like a menu bar rather than eight separate buttons.
      button.addEventListener("mouseenter", () => {
        if (openIndex !== null && openIndex !== index) openAt(index);
      });

      buttons.push(button);
      element.append(button);
    });
  }

  /* ── Opening and closing ─────────────────────────────────────────────── */

  /** Drop every panel deeper than `depth`, so only one branch is ever flown out. */
  function truncateTo(depth: number): void {
    while (stack.length > depth + 1) {
      const gone = stack.pop();
      gone?.element.remove();
    }

    const parent = stack[depth];
    if (parent === undefined) return;
    for (const button of parent.buttons) button.setAttribute("aria-expanded", "false");
  }

  function closeMenu(restore = false): void {
    for (const panel of stack) panel.element.remove();
    stack = [];

    if (openIndex !== null) buttons[openIndex]?.setAttribute("aria-expanded", "false");
    openIndex = null;

    if (restore) deps.restoreFocus();
  }

  function openAt(index: number): void {
    const top = bar[index];
    const button = buttons[index];
    if (top === undefined || button === undefined) return;

    closeMenu();

    const panel = buildPanel(top.items, 0);
    // Positioned against the bar rather than inside the button, so a long menu is not
    // clipped by the title bar's own overflow.
    panel.element.style.left = `${button.offsetLeft}px`;
    element.append(panel.element);
    keepOnScreen(panel.element);

    stack = [panel];
    openIndex = index;
    focusTop(index);
    button.setAttribute("aria-expanded", "true");

    focusRow(0, edgeIndex(panel.rows, "first"));
  }

  /** Fly a submenu out beside the row that owns it. */
  function openSubmenu(depth: number, at: number): void {
    const parent = stack[depth];
    const entry = parent?.entries[at];
    const button = parent?.buttons[at];
    if (parent === undefined || entry === undefined || button === undefined) return;
    if (!("kind" in entry) || entry.kind !== "submenu") return;

    truncateTo(depth);
    lastOpenedRow[depth] = at;

    const panel = buildPanel(entry.items, depth + 1);
    panel.element.style.left = `${parent.element.offsetLeft + parent.element.offsetWidth - 4}px`;
    // The parent panel is the button's offset parent, so its own offset has to be added
    // back to land the submenu beside the row rather than beside the bar.
    panel.element.style.top = `${parent.element.offsetTop + button.offsetTop - PANEL_PADDING}px`;

    element.append(panel.element);
    keepOnScreen(panel.element);

    stack.push(panel);
    button.setAttribute("aria-expanded", "true");
  }

  /**
   * Pull a panel back inside the window.
   *
   * A submenu near the right edge, or a long menu opened near the bottom, would otherwise
   * hang off the screen - and unlike an overflowing page there is nothing to scroll.
   */
  function keepOnScreen(panel: HTMLElement): void {
    const box = panel.getBoundingClientRect();
    const margin = 8;

    const overflowX = box.right - (window.innerWidth - margin);
    if (overflowX > 0) panel.style.left = `${panel.offsetLeft - overflowX}px`;

    const overflowY = box.bottom - (window.innerHeight - margin);
    if (overflowY > 0) panel.style.top = `${panel.offsetTop - overflowY}px`;
  }

  /** Run a row, or open it if it is a submenu. */
  function choose(depth: number, at: number): void {
    const panel = stack[depth];
    const entry = panel?.entries[at];
    if (panel === undefined || entry === undefined) return;

    if (isSubmenu(entry)) {
      openSubmenu(depth, at);
      focusRow(depth + 1, edgeIndex(stack[depth + 1]?.rows ?? [], "first"));
      return;
    }

    if (entry.enabled === false) return;

    closeMenu();
    deps.run(entry.command, entry.arg);
  }

  /* ── Focus ───────────────────────────────────────────────────────────── */

  function focusTop(index: number): void {
    for (const [at, button] of buttons.entries()) button.tabIndex = at === index ? 0 : -1;
    buttons[index]?.focus();
  }

  function focusRow(depth: number, at: number): void {
    if (at < 0) return;
    stack[depth]?.buttons[at]?.focus();
  }

  /** Which row of the deepest open panel has focus, or -1 for none. */
  function focusedRow(): number {
    const panel = deepest();
    if (panel === undefined) return -1;
    return panel.buttons.indexOf(document.activeElement as HTMLButtonElement);
  }

  const focusedTop = (): number => buttons.indexOf(document.activeElement as HTMLButtonElement);

  /* ── Keyboard ────────────────────────────────────────────────────────── */

  /**
   * Walking the bar with no menu open.
   *
   * This is the state Alt puts you in, and it is the one the old bar skipped entirely by
   * opening File immediately - which meant Alt on its own always cost you a dropdown you
   * had not asked for.
   */
  function onBarKey(event: KeyboardEvent): void {
    const at = focusedTop();
    if (at < 0) return;

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      focusTop((at + step + buttons.length) % buttons.length);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(at);
      if (event.key === "ArrowUp") focusRow(0, edgeIndex(stack[0]?.rows ?? [], "last"));
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusTop(event.key === "Home" ? 0 : buttons.length - 1);
      return;
    }

    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      deps.restoreFocus();
      return;
    }

    if (isLetter(event)) {
      event.preventDefault();
      openByMnemonic(event.key);
    }
  }

  function onPanelKey(event: KeyboardEvent): void {
    const depth = stack.length - 1;
    const panel = deepest();
    if (panel === undefined) return;

    const at = focusedRow();

    if (event.key === "Escape") {
      event.preventDefault();
      // One level at a time: a submenu closes back onto the row that opened it, and only
      // the root panel hands focus back to the editor.
      if (depth > 0) {
        truncateTo(depth - 1);
        focusRow(depth - 1, lastOpenedRow[depth - 1] ?? 0);
      } else {
        const was = openIndex ?? 0;
        closeMenu();
        focusTop(was);
      }
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(depth, stepIndex(panel.rows, at, event.key === "ArrowDown" ? 1 : -1));
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusRow(depth, edgeIndex(panel.rows, event.key === "Home" ? "first" : "last"));
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = panel.entries[at];
      // Right opens a submenu when there is one, and otherwise means the next menu along -
      // exactly as it does in every native menu.
      if (entry !== undefined && isSubmenu(entry)) {
        openSubmenu(depth, at);
        focusRow(depth + 1, edgeIndex(stack[depth + 1]?.rows ?? [], "first"));
        return;
      }

      if (openIndex !== null) openAt((openIndex + 1) % bar.length);
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (depth > 0) {
        truncateTo(depth - 1);
        focusRow(depth - 1, lastOpenedRow[depth - 1] ?? 0);
        return;
      }

      if (openIndex !== null) openAt((openIndex - 1 + bar.length) % bar.length);
      return;
    }

    if (isLetter(event)) {
      event.preventDefault();
      const match = matchLetter(panel.rows, event.key, at);
      if (match === null) return;

      focusRow(depth, match.index);
      // One claimant runs on the letter; several only move between them.
      if (match.unique) choose(depth, match.index);
    }
  }

  const isLetter = (event: KeyboardEvent): boolean =>
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey;

  element.addEventListener("keydown", (event) => {
    if (stack.length === 0) onBarKey(event);
    else onPanelKey(event);

    /*
     * The bar owns the keyboard while it has focus.
     *
     * Every branch above that answers a key also prevents its default, so that flag is
     * the signal. Without stopping the event here, the shell's own Escape handling runs
     * too - and Escape inside a submenu would close the whole bar instead of the one
     * level the submenu is.
     */
    if (event.defaultPrevented) event.stopPropagation();
  });

  function openByMnemonic(char: string): boolean {
    const wanted = char.toLowerCase();
    const index = bar.findIndex((top) => {
      const split = splitMnemonic(top.label);
      return split.key?.toLowerCase() === wanted;
    });
    if (index < 0) return false;

    element.dataset["mnemonics"] = "true";
    openAt(index);
    return true;
  }

  // A click anywhere else closes the menu, as it does everywhere. Pointer use also puts
  // the underlines away: they are a keyboard affordance and nothing else.
  document.addEventListener("pointerdown", (event) => {
    element.dataset["mnemonics"] = "false";
    if (element.contains(event.target as Node)) return;
    if (stack.length > 0) closeMenu();
  });

  buildTopButtons();

  return {
    element,
    close: () => closeMenu(),
    isOpen: () => stack.length > 0,
    isFocused: () => element.contains(document.activeElement),
    openByMnemonic,

    focusBar() {
      // Alt is a toggle: pressed again with the bar already focused, it gives the editor
      // back rather than sitting there waiting for a letter.
      if (element.contains(document.activeElement)) {
        element.dataset["mnemonics"] = "false";
        closeMenu(true);
        return;
      }

      element.dataset["mnemonics"] = "true";
      focusTop(0);
    },

    setContext(context) {
      bar = buildMenuBar(context);

      // Rebuilding under an open menu would leave a panel belonging to a bar that no
      // longer exists; the list this rebuild is for is the one being read.
      const reopen = openIndex;
      closeMenu();
      buildTopButtons();
      if (reopen !== null && reopen < bar.length) openAt(reopen);
    },
  };
}
