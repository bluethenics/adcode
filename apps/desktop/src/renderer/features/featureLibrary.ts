import {
  featureRecords,
  type FeatureAction,
  type FeatureRecord,
  type HelpGroupId,
} from "@adcode/help";
import { createHelpButton, createHelpPopover } from "../help/helpPopover.ts";
import {
  featureActionPresentation,
  featureLibraryCategories,
  filterFeatureLibrary,
  moveFeatureSelection,
  type FeatureLibraryCategory,
} from "./featureLibraryModel.ts";

export interface FeatureLibrary {
  open(): void;
  close(restoreFocus?: boolean): void;
  toggle(): void;
  isOpen(): boolean;
}

export interface FeatureLibraryDeps {
  readonly host: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly hasCommand: (command: string) => boolean;
  readonly runAction: (action: FeatureAction) => void;
}

const GROUP_TITLES: Readonly<Record<string, string>> = {
  all: "All",
  ads: "Ads",
  appearance: "Appearance",
  editing: "Edit",
  formatting: "Format",
  git: "Git",
  navigation: "Navigate",
  structure: "Structure",
  language: "Run",
  session: "Session",
  updates: "Updates",
  ai: "AI",
  workbench: "Workbench",
  account: "Account",
  gestures: "Files",
};

const titleFor = (group: FeatureLibraryCategory): string => GROUP_TITLES[group] ?? group;

export function createFeatureLibrary(deps: FeatureLibraryDeps): FeatureLibrary {
  const records = featureRecords();
  const categories = featureLibraryCategories(records);
  const helpPopover = createHelpPopover(deps.host);
  let open = false;
  let category: FeatureLibraryCategory = "all";
  let query = "";
  let selected = -1;
  let visible: readonly FeatureRecord[] = records;

  const sheet = document.createElement("section");
  sheet.className = "feature-library";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "All Features");

  const header = document.createElement("header");
  header.className = "feature-library-header";

  const title = document.createElement("h2");
  title.className = "feature-library-title";
  title.textContent = "All Features";

  const done = document.createElement("button");
  done.type = "button";
  done.className = "ghost-button";
  done.textContent = "Done";
  done.addEventListener("click", () => api.close());
  header.append(title, done);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "feature-library-search";
  search.placeholder = "Search what ADCode can do…";
  search.setAttribute("aria-label", "Search all features");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-controls", "feature-library-results");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-expanded", "true");

  const chips = document.createElement("div");
  chips.className = "feature-library-categories";
  chips.setAttribute("role", "tablist");
  chips.setAttribute("aria-label", "Feature categories");

  const notice = document.createElement("p");
  notice.className = "feature-library-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  const results = document.createElement("div");
  results.id = "feature-library-results";
  results.className = "feature-library-results";
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "ADCode features");

  sheet.append(header, search, chips, notice, results);
  deps.host.append(sheet);

  function available(action: FeatureAction): boolean {
    return action.kind === "setting" || deps.hasCommand(action.command);
  }

  function run(action: FeatureAction): void {
    if (!available(action)) {
      notice.textContent = "This feature is not available in this window.";
      return;
    }
    api.close(false);
    deps.runAction(action);
  }

  function actionButton(
    action: FeatureAction,
    primary: boolean,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "feature-library-open" : "feature-library-secondary";
    button.textContent = primary ? "Open" : action.label;
    button.disabled = !available(action);
    if (button.disabled) button.title = "This feature is not available in this window.";
    button.addEventListener("click", () => run(action));
    return button;
  }

  function rowFor(feature: FeatureRecord, index: number): HTMLElement {
    const row = document.createElement("article");
    row.className = "feature-library-row";
    row.dataset["featureId"] = feature.entry.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(index === selected));

    const copy = document.createElement("div");
    copy.className = "feature-library-copy";
    const heading = document.createElement("h3");
    heading.className = "feature-library-row-title";
    heading.textContent = feature.entry.title;
    const plain = document.createElement("p");
    plain.className = "feature-library-row-plain";
    plain.textContent = feature.entry.plain;
    copy.append(heading, plain);

    const actions = document.createElement("div");
    actions.className = "feature-library-actions";
    const presentation = featureActionPresentation(feature, deps.hasCommand);
    if (presentation.primary !== null) {
      actions.append(actionButton(presentation.primary.action, true));
    }
    for (const secondary of presentation.secondary.slice(0, 2)) {
      actions.append(actionButton(secondary.action, false));
    }
    actions.append(createHelpButton(feature.entry, helpPopover));
    row.append(copy, actions);
    return row;
  }

  function renderChips(): void {
    chips.replaceChildren();
    for (const value of categories) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "feature-library-category";
      chip.textContent = titleFor(value);
      chip.dataset["category"] = value;
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", String(value === category));
      chip.tabIndex = value === category ? 0 : -1;
      chip.addEventListener("click", () => {
        category = value;
        query = "";
        search.value = "";
        selected = -1;
        render();
      });
      chip.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const at = categories.indexOf(value);
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const nextAt = Math.max(0, Math.min(at + direction, categories.length - 1));
        const next = chips.querySelectorAll<HTMLButtonElement>(".feature-library-category")[nextAt];
        next?.focus();
        next?.click();
      });
      chips.append(chip);
    }
  }

  function renderResults(): void {
    visible = filterFeatureLibrary(records, { category, query });
    if (selected >= visible.length) selected = visible.length - 1;
    results.replaceChildren();
    notice.textContent = visible.length === 0 ? `No features match “${query}”.` : "";

    let lastGroup: HelpGroupId | null = null;
    visible.forEach((feature, index) => {
      if (query.length === 0 && category === "all" && lastGroup !== feature.entry.group) {
        lastGroup = feature.entry.group;
        const group = document.createElement("h3");
        group.className = "feature-library-group";
        group.textContent = titleFor(feature.entry.group);
        results.append(group);
      }
      results.append(rowFor(feature, index));
    });

    const selectedRow = results.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selectedRow === null) {
      search.removeAttribute("aria-activedescendant");
    } else {
      selectedRow.scrollIntoView({ block: "nearest" });
      const activeId = selectedRow.dataset["featureId"];
      if (activeId === undefined) search.removeAttribute("aria-activedescendant");
      else {
        selectedRow.id = `feature-result-${activeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        search.setAttribute("aria-activedescendant", selectedRow.id);
      }
    }
  }

  function render(): void {
    renderChips();
    renderResults();
  }

  search.addEventListener("input", () => {
    query = search.value;
    if (query.trim().length > 0) category = "all";
    selected = -1;
    render();
  });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      selected = moveFeatureSelection(selected, event.key === "ArrowDown" ? 1 : -1, visible.length);
      renderResults();
      return;
    }
    if (event.key === "Enter" && selected >= 0) {
      const feature = visible[selected];
      const primary = feature === undefined
        ? null
        : featureActionPresentation(feature, deps.hasCommand).primary;
      if (primary?.enabled === true) {
        event.preventDefault();
        run(primary.action);
      }
    }
  });

  function place(): void {
    const anchor = deps.button.getBoundingClientRect();
    // Placement must use the final layout size, not the opening transform's scaled visual
    // box. Measuring `getBoundingClientRect()` here underestimates both dimensions by 1.5%.
    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    // Keep two physical pixels of rounding headroom beyond the promised 8px gutter.
    // Chromium can report a nominal 8px edge as 7.998px at non-integer page zooms.
    const margin = 10;
    const gap = 8;
    const right = anchor.right + gap;
    const left = right + width <= window.innerWidth - margin
      ? right
      : Math.max(margin, anchor.left - gap - width);
    const top = Math.max(margin, Math.min(anchor.top, window.innerHeight - height - margin));
    sheet.style.left = `${String(Math.round(left))}px`;
    sheet.style.top = `${String(Math.round(top))}px`;
  }

  // The first measurement can precede the UI font settling. Re-clamp when the sheet's
  // real content size changes so a late three-pixel growth cannot escape the 8px margin.
  const sizeObserver = new ResizeObserver(() => {
    if (open) place();
  });

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (sheet.contains(target) || deps.button.contains(target)) return;
    api.close();
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !open || helpPopover.isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    api.close();
  };

  const api: FeatureLibrary = {
    open(): void {
      if (open) return;
      open = true;
      category = "all";
      query = "";
      selected = -1;
      search.value = "";
      render();
      sheet.hidden = false;
      sizeObserver.observe(sheet);
      place();
      void sheet.offsetHeight;
      sheet.dataset["state"] = "open";
      deps.button.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeydown, true);
      window.addEventListener("resize", place);
      search.focus();
    },

    close(restoreFocus = true): void {
      if (!open) return;
      open = false;
      helpPopover.close();
      delete sheet.dataset["state"];
      sheet.hidden = true;
      sizeObserver.unobserve(sheet);
      deps.button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("resize", place);
      if (restoreFocus) deps.button.focus();
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open,
  };

  deps.button.addEventListener("click", () => api.toggle());
  return api;
}
