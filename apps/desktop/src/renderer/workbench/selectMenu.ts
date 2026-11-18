/**
 * A searchable dropdown that stands in for a native `<select>`.
 *
 * The native select stays in the page, hidden, as the source of truth: code that reads
 * `select.value`, sets it, fills its options or listens for "change" keeps working unchanged.
 * What the person sees is a button in ADCode's own control style and, when it opens, a menu in
 * the top layer (so it sits above dialogs too) with a search box, group headings, a tick on the
 * current choice, and a quiet tag for anything after " · " in an option's text ("Paid credits").
 *
 * Keyboard: Enter, Space or the arrows open it; typing filters; arrows, Home and End move;
 * Enter picks; Escape or Tab closes and gives focus back.
 */
import { Check, ChevronDown, Search } from "lucide";
import { createIcon } from "./icons.ts";

export interface SelectMenuOptions {
  /** Show the search box: always, never, or ("auto") once there are more than seven choices. */
  readonly search?: boolean | "auto";
  /** Shown in the search box. */
  readonly searchPlaceholder?: string;
  /** Minimum menu width, in pixels; the menu is never narrower than its button. */
  readonly minWidth?: number;
}

export interface SelectMenu {
  /** Put this in the page where the select would go (it holds the select). */
  readonly element: HTMLElement;
  readonly trigger: HTMLButtonElement;
  /** Draw the button again from the select (after changing it without events). */
  refresh(): void;
  open(): void;
  close(returnFocus?: boolean): void;
  destroy(): void;
}

interface Row {
  readonly option: HTMLOptionElement;
  readonly label: string;
  readonly tag: string;
  readonly group: string;
}

const ENHANCED = new WeakMap<HTMLSelectElement, SelectMenu>();
let openMenu: SelectMenu | null = null;
let menuCount = 0;

function split(text: string): { label: string; tag: string } {
  const at = text.indexOf(" · ");
  return at < 0 ? { label: text.trim(), tag: "" } : { label: text.slice(0, at).trim(), tag: text.slice(at + 3).trim() };
}

/** Turn a native select into a searchable menu. Calling it twice returns the same menu. */
export function enhanceSelect(select: HTMLSelectElement, options: SelectMenuOptions = {}): SelectMenu {
  const existing = ENHANCED.get(select);
  if (existing !== undefined) return existing;
  const id = `select-menu-${++menuCount}`;

  const element = document.createElement("span");
  element.className = "select-menu";
  if (select.parentNode !== null) select.replaceWith(element);
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = `${select.className} select-menu-trigger`.trim();
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-list`);
  const label = select.getAttribute("aria-label");
  if (label !== null) trigger.setAttribute("aria-label", label);
  if (select.title) trigger.title = select.title;
  const value = document.createElement("span");
  value.className = "select-menu-value";
  const chevron = createIcon(ChevronDown);
  chevron.classList.add("select-menu-chevron");
  trigger.append(value, chevron);
  element.append(select, trigger);

  const popover = document.createElement("div");
  popover.className = "select-menu-popover";
  popover.id = id;
  popover.setAttribute("popover", "manual");
  const searchBox = document.createElement("label");
  searchBox.className = "select-menu-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = options.searchPlaceholder ?? "Search";
  searchInput.setAttribute("aria-label", options.searchPlaceholder ?? "Search");
  searchInput.setAttribute("aria-controls", `${id}-list`);
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchBox.append(createIcon(Search), searchInput);
  const list = document.createElement("div");
  list.className = "select-menu-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  if (label !== null) list.setAttribute("aria-label", label);
  const empty = document.createElement("p");
  empty.className = "select-menu-empty";
  empty.textContent = "Nothing matches.";
  popover.append(searchBox, list, empty);

  let rows: Row[] = [];
  let shown: Row[] = [];
  let active = -1;

  function readRows(): Row[] {
    return [...select.options].filter((option) => !option.hidden).map((option) => {
      const parts = split(option.textContent ?? option.label);
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "";
      return { option, label: parts.label, tag: parts.tag, group };
    });
  }

  function refresh(): void {
    const current = select.selectedOptions[0];
    const parts = split(current?.textContent ?? "");
    value.textContent = parts.label || (current === undefined ? "Choose…" : "");
    trigger.disabled = select.disabled;
    trigger.dataset["empty"] = current === undefined ? "true" : "false";
    if (isOpen()) paint();
  }

  function isOpen(): boolean {
    return popover.matches(":popover-open");
  }

  function wantsSearch(): boolean {
    const mode = options.search ?? "auto";
    return mode === "auto" ? rows.length > 7 : mode;
  }

  function paint(): void {
    rows = readRows();
    const query = searchInput.value.trim().toLowerCase();
    shown = query === "" ? rows : rows.filter((row) => `${row.label} ${row.tag} ${row.group}`.toLowerCase().includes(query));
    list.replaceChildren();
    let group: string | null = null;
    shown.forEach((row, index) => {
      if (row.group !== group) {
        group = row.group;
        if (group !== "") {
          const heading = document.createElement("div");
          heading.className = "select-menu-group";
          heading.setAttribute("role", "presentation");
          heading.textContent = group;
          list.append(heading);
        }
      }
      const item = document.createElement("div");
      item.className = "select-menu-option";
      item.id = `${id}-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(row.option.selected));
      if (row.option.disabled) item.setAttribute("aria-disabled", "true");
      const tick = createIcon(Check);
      tick.classList.add("select-menu-tick");
      const text = document.createElement("span");
      text.className = "select-menu-label";
      text.textContent = row.label;
      item.append(tick, text);
      if (row.tag !== "") {
        const tag = document.createElement("span");
        tag.className = "select-menu-tag";
        tag.textContent = row.tag;
        item.append(tag);
      }
      item.addEventListener("pointermove", () => { if (active !== index) setActive(index, false); });
      item.addEventListener("click", () => choose(index));
      list.append(item);
    });
    empty.hidden = shown.length > 0;
    if (active >= shown.length || active < 0) active = Math.max(0, shown.findIndex((row) => row.option.selected));
    setActive(shown.length === 0 ? -1 : active, true);
  }

  function setActive(index: number, scroll: boolean): void {
    active = index;
    for (const item of list.querySelectorAll<HTMLElement>(".select-menu-option")) item.classList.toggle("is-active", item.id === `${id}-option-${index}`);
    const target = index < 0 ? null : list.querySelector<HTMLElement>(`#${id}-option-${index}`);
    const descendant = target?.id ?? "";
    trigger.setAttribute("aria-activedescendant", descendant);
    searchInput.setAttribute("aria-activedescendant", descendant);
    if (scroll) target?.scrollIntoView({ block: "nearest" });
  }

  function move(step: number): void {
    if (shown.length === 0) return;
    let next = active;
    for (let tries = 0; tries < shown.length; tries += 1) {
      next = (next + step + shown.length) % shown.length;
      if (!shown[next]!.option.disabled) break;
    }
    setActive(next, true);
  }

  function choose(index: number): void {
    const row = shown[index];
    if (row === undefined || row.option.disabled) return;
    const changed = select.value !== row.option.value || !row.option.selected;
    row.option.selected = true;
    refresh();
    close(true);
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function place(): void {
    const box = trigger.getBoundingClientRect();
    const width = Math.max(box.width, options.minWidth ?? 200);
    popover.style.minWidth = `${Math.round(width)}px`;
    popover.style.maxWidth = `${Math.max(width, Math.min(420, window.innerWidth - 16))}px`;
    const below = window.innerHeight - box.bottom - 12;
    const above = box.top - 12;
    const height = Math.min(popover.scrollHeight, 360);
    const up = below < Math.min(height, 240) && above > below;
    popover.dataset["side"] = up ? "top" : "bottom";
    popover.style.maxHeight = `${Math.max(160, Math.min(360, up ? above : below))}px`;
    const left = Math.min(Math.max(8, box.left), window.innerWidth - popover.offsetWidth - 8);
    popover.style.left = `${Math.round(left)}px`;
    if (up) { popover.style.top = ""; popover.style.bottom = `${Math.round(window.innerHeight - box.top + 4)}px`; }
    else { popover.style.bottom = ""; popover.style.top = `${Math.round(box.bottom + 4)}px`; }
  }

  function open(initial = ""): void {
    if (select.disabled || isOpen()) return;
    if (openMenu !== null && openMenu !== api) openMenu.close(false);
    openMenu = api;
    rows = readRows();
    searchBox.hidden = !wantsSearch();
    searchInput.value = searchBox.hidden ? "" : initial;
    active = -1;
    // Inside a modal dialog the menu belongs to the dialog's top layer stack.
    (trigger.closest("dialog[open]") ?? document.body).append(popover);
    popover.showPopover();
    paint();
    place();
    trigger.setAttribute("aria-expanded", "true");
    element.classList.add("is-open");
    if (!searchBox.hidden) searchInput.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onViewport);
    document.addEventListener("scroll", onScroll, true);
  }

  function close(returnFocus = false): void {
    if (!isOpen()) return;
    popover.hidePopover();
    popover.remove();
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
    element.classList.remove("is-open");
    if (openMenu === api) openMenu = null;
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("resize", onViewport);
    document.removeEventListener("scroll", onScroll, true);
    if (returnFocus) trigger.focus({ preventScroll: true });
  }

  function outside(event: Event): void {
    const target = event.target as Node | null;
    if (target !== null && (popover.contains(target) || trigger.contains(target))) return;
    close(false);
  }
  function onViewport(): void { close(false); }
  function onScroll(event: Event): void {
    if (event.target instanceof Node && popover.contains(event.target)) return;
    place();
  }

  function keys(event: KeyboardEvent): void {
    if (!isOpen()) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); open(); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { open(event.key); if (searchBox.hidden) jump(event.key); event.preventDefault(); }
      return;
    }
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); move(1); break;
      case "ArrowUp": event.preventDefault(); move(-1); break;
      case "Home": if (event.target === trigger || searchInput.value === "") { event.preventDefault(); setActive(0, true); } break;
      case "End": if (event.target === trigger || searchInput.value === "") { event.preventDefault(); setActive(shown.length - 1, true); } break;
      case "Enter": event.preventDefault(); choose(active); break;
      case " ": if (event.target === trigger) { event.preventDefault(); choose(active); } break;
      case "Escape": event.preventDefault(); event.stopPropagation(); close(true); break;
      case "Tab": close(false); break;
      default:
        if (event.target === trigger && event.key.length === 1) jump(event.key);
    }
  }

  /** With no search box, a letter jumps to the next choice starting with it. */
  function jump(letter: string): void {
    const lower = letter.toLowerCase();
    for (let step = 1; step <= shown.length; step += 1) {
      const index = (Math.max(active, 0) + step) % shown.length;
      if (shown[index]!.label.toLowerCase().startsWith(lower)) { setActive(index, true); return; }
    }
  }

  trigger.addEventListener("click", () => { if (isOpen()) close(true); else open(); });
  trigger.addEventListener("keydown", keys);
  searchInput.addEventListener("keydown", keys);
  searchInput.addEventListener("input", () => { active = 0; paint(); place(); });

  // Keep the button true to the select, however the select changes.
  const observer = new MutationObserver(() => refresh());
  observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "selected", "label"] });
  select.addEventListener("change", refresh);
  const proto = HTMLSelectElement.prototype;
  for (const key of ["value", "selectedIndex", "disabled"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key)!;
    Object.defineProperty(select, key, {
      configurable: true,
      get() { return descriptor.get!.call(select); },
      set(next: unknown) { descriptor.set!.call(select, next); refresh(); },
    });
  }

  const api: SelectMenu = {
    element,
    trigger,
    refresh,
    open: () => open(),
    close,
    destroy() {
      close(false);
      observer.disconnect();
      for (const key of ["value", "selectedIndex", "disabled"]) delete (select as unknown as Record<string, unknown>)[key];
      select.hidden = false;
      select.removeAttribute("aria-hidden");
      select.tabIndex = 0;
      element.replaceWith(select);
      ENHANCED.delete(select);
    },
  };
  ENHANCED.set(select, api);
  refresh();
  return api;
}

/** Make a select element that is already a searchable menu; append `.element`, use `.select`. */
export function selectMenu(className: string, ariaLabel: string, options: SelectMenuOptions = {}): { readonly select: HTMLSelectElement; readonly menu: SelectMenu; readonly element: HTMLElement } {
  const select = document.createElement("select");
  select.className = className;
  select.setAttribute("aria-label", ariaLabel);
  const menu = enhanceSelect(select, options);
  return { select, menu, element: menu.element };
}
