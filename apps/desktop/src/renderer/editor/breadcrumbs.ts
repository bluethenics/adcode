/** Interactive, searchable file-location trail above the editor. */
import { nodeAtLine, outlineOf, outlineSupported, type OutlineNode } from "@adcode/structure";
import {
  buildFileChoices,
  buildLocationCrumbs,
  buildSymbolChoices,
  directoryChoices,
  filterBreadcrumbChoices,
  parentPath,
  type BreadcrumbChoice,
  type LocationCrumb,
} from "./breadcrumbModel.ts";
import { fileIcon } from "../workbench/fileIcons.ts";

export interface Breadcrumbs {
  readonly element: HTMLElement;
  setEnabled(enabled: boolean): void;
  update(path: string | null, languageId: string, text: string, line: number): void;
  dispose(): void;
}

interface DirectoryEntry {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

export interface BreadcrumbsDeps {
  readonly workspaceRoot: () => string | null;
  readonly list: (directory: string) => Promise<readonly DirectoryEntry[]>;
  readonly recentFiles: () => readonly string[];
  readonly openFile: (path: string) => void;
  readonly openQuick: (seed?: string) => void;
  readonly showStructure: () => void;
  readonly goToLine: (line: number) => void;
  readonly copyPath: (path: string) => void;
  readonly revealPath: (path: string) => void;
  readonly renamePath: (path: string) => void;
  readonly comparePath: (path: string) => void;
}

const RECOMPUTE_DELAY_MS = 250;
const MENU_MARGIN = 8;

function trailTo(nodes: readonly OutlineNode[], line: number): OutlineNode[] {
  if (nodeAtLine(nodes, line) === null) return [];
  const trail: OutlineNode[] = [];
  let level: readonly OutlineNode[] = nodes;
  for (;;) {
    const next = level.find((node) => line >= node.line && line <= node.endLine);
    if (next === undefined) break;
    trail.push(next);
    level = next.children;
  }
  return trail;
}

export function createBreadcrumbs(deps: BreadcrumbsDeps): Breadcrumbs {
  const element = document.createElement("nav");
  element.className = "breadcrumbs";
  element.setAttribute("aria-label", "File location");
  element.dataset["empty"] = "true";

  const menu = document.createElement("div");
  menu.className = "breadcrumb-popover";
  menu.id = `breadcrumb-menu-${Math.random().toString(36).slice(2)}`;
  menu.hidden = true;
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-label", "Choose a location");

  const search = document.createElement("input");
  search.className = "breadcrumb-search";
  search.type = "search";
  search.autocomplete = "off";
  search.spellcheck = false;
  search.placeholder = "Filter this level";
  search.setAttribute("aria-label", "Filter breadcrumb choices");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-expanded", "true");

  const list = document.createElement("div");
  list.className = "breadcrumb-menu-list";
  list.id = `breadcrumb-list-${Math.random().toString(36).slice(2)}`;
  list.setAttribute("role", "listbox");
  search.setAttribute("aria-controls", list.id);

  const empty = document.createElement("p");
  empty.className = "breadcrumb-menu-empty";
  empty.textContent = "Nothing at this level.";
  menu.append(search, list, empty);
  document.body.append(menu);

  let enabled = true;
  let timer: number | null = null;
  let signature = "";
  let currentOutline: readonly OutlineNode[] = [];
  let currentCrumbs: LocationCrumb[] = [];
  let menuChoices: BreadcrumbChoice[] = [];
  let visibleChoices: BreadcrumbChoice[] = [];
  let selected = 0;
  let anchorIndex = -1;
  let menuGeneration = 0;

  const crumbButtons = (): HTMLButtonElement[] => [
    ...element.querySelectorAll<HTMLButtonElement>(".breadcrumb"),
  ];

  function closeMenu(restore = false): void {
    menuGeneration += 1;
    menu.hidden = true;
    const previous = anchorIndex;
    for (const button of crumbButtons()) button.setAttribute("aria-expanded", "false");
    anchorIndex = -1;
    if (restore) crumbButtons()[previous]?.focus();
  }

  function positionMenu(anchor: HTMLElement): void {
    const box = anchor.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - MENU_MARGIN * 2);
    menu.style.width = `${String(width)}px`;
    menu.style.left = `${String(Math.max(MENU_MARGIN, Math.min(box.left, window.innerWidth - width - MENU_MARGIN)))}px`;
    const height = menu.getBoundingClientRect().height;
    const below = box.bottom + 6;
    const fitsBelow = below + height <= window.innerHeight - MENU_MARGIN;
    menu.style.top = `${String(fitsBelow ? below : Math.max(MENU_MARGIN, box.top - height - 6))}px`;

    /*
     * Which way it opened is also which corner it should grow from, and only this function
     * knows. The stylesheet flips `transform-origin` and the travel direction off this.
     *
     * Written only when it actually changes. This runs again every time the menu is
     * repositioned - after the directory listing lands, after navigating a level - and
     * `data-side` selects a different `animation-name`, so an unconditional write would
     * restart the 160ms entrance on each of those, mid-flight, for no reason.
     */
    const side = fitsBelow ? "below" : "above";
    if (menu.dataset["side"] !== side) menu.dataset["side"] = side;
  }

  function renderMenu(): void {
    visibleChoices = filterBreadcrumbChoices(menuChoices, search.value);
    selected = Math.max(0, Math.min(selected, visibleChoices.length - 1));
    list.replaceChildren();
    empty.hidden = visibleChoices.length > 0;

    let group = "";
    visibleChoices.forEach((choice, index) => {
      const nextGroup = "group" in choice ? choice.group : "Symbols";
      if (nextGroup !== group) {
        group = nextGroup;
        const heading = document.createElement("div");
        heading.className = "breadcrumb-menu-heading";
        heading.textContent = group;
        list.append(heading);
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = "breadcrumb-menu-row";
      row.id = `breadcrumb-choice-${String(index)}`;
      row.setAttribute("role", "option");
      row.ariaSelected = String(index === selected);
      if (choice.kind === "symbol") {
        row.style.setProperty("--breadcrumb-indent", `${String(choice.depth * 12)}px`);
      }

      if (choice.kind === "file") row.append(fileIcon(choice.label));
      else {
        const mark = document.createElement("span");
        mark.className = `breadcrumb-choice-mark breadcrumb-choice-${choice.kind}`;
        mark.textContent = choice.kind === "directory" ? "›" : choice.kind === "symbol" ? "#" : "·";
        mark.setAttribute("aria-hidden", "true");
        row.append(mark);
      }

      const words = document.createElement("span");
      words.className = "breadcrumb-choice-words";
      const label = document.createElement("span");
      label.className = "breadcrumb-choice-label";
      label.textContent = choice.label;
      words.append(label);
      if (choice.detail !== undefined) {
        const detail = document.createElement("span");
        detail.className = "breadcrumb-choice-detail";
        detail.textContent = choice.detail;
        words.append(detail);
      }
      row.append(words);
      row.addEventListener("pointermove", () => {
        if (selected !== index) {
          selected = index;
          renderMenu();
        }
      });
      row.addEventListener("click", () => void runChoice(choice));
      list.append(row);
    });

    const active = list.querySelector<HTMLElement>('[aria-selected="true"]');
    search.setAttribute("aria-activedescendant", active?.id ?? "");
    active?.scrollIntoView({ block: "nearest" });
  }

  function actionsFor(crumb: LocationCrumb): BreadcrumbChoice[] {
    if (crumb.kind === "symbol") {
      return [{ kind: "action", group: "Actions", label: "Show full structure", action: "structure" }];
    }
    const actions: BreadcrumbChoice[] = [
      { kind: "action", group: "Actions", label: "Copy full path", action: "copy" },
      { kind: "action", group: "Actions", label: "Reveal in File Explorer", action: "reveal" },
    ];
    if (crumb.kind === "file") {
      actions.unshift(
        { kind: "action", group: "Actions", label: "Quick open any file…", action: "quick" },
        { kind: "action", group: "Actions", label: "Show file structure", action: "structure" },
      );
      actions.push(
        { kind: "action", group: "Actions", label: "Rename file…", action: "rename" },
        { kind: "action", group: "Actions", label: "Compare and history", action: "compare" },
      );
    }
    return actions;
  }

  async function choicesFor(crumb: LocationCrumb): Promise<BreadcrumbChoice[]> {
    if (crumb.kind === "symbol") return [...buildSymbolChoices(currentOutline), ...actionsFor(crumb)];
    if (crumb.kind === "file") {
      return [
        ...buildFileChoices(
          crumb.path,
          await deps.list(parentPath(crumb.path)).catch(() => []),
          deps.recentFiles(),
        ),
        ...actionsFor(crumb),
      ];
    }
    const [children, siblings] = await Promise.all([
      deps.list(crumb.path),
      deps.list(parentPath(crumb.path)).catch(() => []),
    ]);
    return [...directoryChoices(crumb.path, children, siblings), ...actionsFor(crumb)];
  }

  async function openDirectory(path: string): Promise<void> {
    const mine = ++menuGeneration;
    empty.hidden = false;
    empty.textContent = "Reading folder…";
    list.replaceChildren();
    const [children, siblings] = await Promise.all([
      deps.list(path),
      deps.list(parentPath(path)).catch(() => []),
    ]);
    if (mine !== menuGeneration || menu.hidden) return;
    menuChoices = directoryChoices(path, children, siblings);
    search.value = "";
    search.placeholder = `Filter ${path.split(/[\\/]/).at(-1) ?? "folder"}`;
    selected = 0;
    empty.textContent = "Nothing at this level.";
    renderMenu();
    const anchor = crumbButtons()[anchorIndex];
    if (anchor !== undefined) positionMenu(anchor);
  }

  async function runChoice(choice: BreadcrumbChoice): Promise<void> {
    if (choice.kind === "directory") return openDirectory(choice.path);
    if (choice.kind === "file") {
      closeMenu();
      deps.openFile(choice.path);
      return;
    }
    if (choice.kind === "symbol") {
      closeMenu();
      deps.goToLine(choice.line);
      return;
    }

    const crumb = currentCrumbs[anchorIndex];
    const query = search.value;
    closeMenu();
    if (choice.action === "quick") deps.openQuick(query);
    else if (choice.action === "structure") deps.showStructure();
    else if (crumb !== undefined && crumb.kind !== "symbol") {
      if (choice.action === "copy") deps.copyPath(crumb.path);
      else if (choice.action === "reveal") deps.revealPath(crumb.path);
      else if (choice.action === "rename") deps.renamePath(crumb.path);
      else if (choice.action === "compare") deps.comparePath(crumb.path);
    }
  }

  function openMenu(index: number, seed = ""): void {
    const crumb = currentCrumbs[index];
    const anchor = crumbButtons()[index];
    if (crumb === undefined || anchor === undefined) return;
    closeMenu();
    anchorIndex = index;
    anchor.setAttribute("aria-expanded", "true");
    menu.hidden = false;
    search.value = seed;
    search.placeholder = crumb.kind === "symbol" ? "Filter symbols" : `Filter ${crumb.label}`;
    menuChoices = [];
    selected = 0;
    list.replaceChildren();
    empty.hidden = false;
    empty.textContent = "Loading…";
    positionMenu(anchor);
    search.focus();
    search.setSelectionRange(seed.length, seed.length);

    const mine = ++menuGeneration;
    void choicesFor(crumb).then(
      (choices) => {
        if (mine !== menuGeneration || menu.hidden) return;
        menuChoices = choices;
        empty.textContent = "No matching files or symbols.";
        renderMenu();
        positionMenu(anchor);
      },
      () => {
        if (mine === menuGeneration && !menu.hidden) empty.textContent = "This location could not be read.";
      },
    );
  }

  function separator(): HTMLElement {
    const span = document.createElement("span");
    span.className = "breadcrumb-separator";
    span.setAttribute("aria-hidden", "true");
    span.textContent = "›";
    return span;
  }

  function crumbButton(crumb: LocationCrumb, index: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumb";
    button.textContent = crumb.label;
    button.title = crumb.kind === "symbol" ? `Go to line ${String(crumb.line)}` : crumb.path;
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", menu.id);
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => openMenu(index));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openMenu(index);
    });
    button.addEventListener("keydown", (event) => {
      const buttons = crumbButtons();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? -1 : 1;
        buttons[Math.max(0, Math.min(index + step, buttons.length - 1))]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
      } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu(index);
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        openMenu(index, event.key);
      }
    });
    return button;
  }

  function render(path: string | null, languageId: string, text: string, line: number): void {
    if (!enabled || path === null) {
      closeMenu();
      element.replaceChildren();
      element.dataset["empty"] = "true";
      signature = "";
      currentCrumbs = [];
      currentOutline = [];
      return;
    }
    const outline = outlineSupported(languageId) ? outlineOf(languageId, text) : [];
    const trail = trailTo(outline, line);
    const next = `${path}|${trail.map((node) => `${node.name}@${String(node.line)}`).join(">")}`;
    if (next === signature) return;
    signature = next;
    closeMenu();
    currentOutline = outline;
    currentCrumbs = [
      ...buildLocationCrumbs(deps.workspaceRoot(), path),
      ...trail.map((node): LocationCrumb => ({ kind: "symbol", label: node.name, line: node.line })),
    ];
    element.replaceChildren();
    delete element.dataset["empty"];
    currentCrumbs.forEach((crumb, index) => {
      if (index > 0) element.append(separator());
      element.append(crumbButton(crumb, index));
    });
  }

  search.addEventListener("input", () => {
    selected = 0;
    renderMenu();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleChoices.length === 0) return;
      selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + visibleChoices.length) % visibleChoices.length;
      renderMenu();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = visibleChoices[selected];
      if (choice !== undefined) void runChoice(choice);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && search.value.length === 0) {
      event.preventDefault();
      const next = anchorIndex + (event.key === "ArrowLeft" ? -1 : 1);
      if (next >= 0 && next < currentCrumbs.length) openMenu(next);
    }
  });

  const dismiss = (event: PointerEvent): void => {
    const target = event.target;
    if (menu.hidden || !(target instanceof Node)) return;
    if (!menu.contains(target) && !element.contains(target)) closeMenu();
  };
  const closeOnWindowChange = (): void => closeMenu();
  document.addEventListener("pointerdown", dismiss);
  window.addEventListener("resize", closeOnWindowChange);
  window.addEventListener("blur", closeOnWindowChange);
  window.addEventListener("scroll", closeOnWindowChange, true);

  return {
    element,
    setEnabled(next) {
      enabled = next;
      if (!next) render(null, "", "", 1);
    },
    update(path, languageId, text, line) {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        render(path, languageId, text, line);
      }, RECOMPUTE_DELAY_MS);
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", closeOnWindowChange);
      window.removeEventListener("blur", closeOnWindowChange);
      window.removeEventListener("scroll", closeOnWindowChange, true);
      menu.remove();
    },
  };
}
