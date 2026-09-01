import {
  featureRecords,
  type FeatureAction,
  type FeatureRecord,
  type HelpGroupId,
} from "@adcode/help";
import { createHelpButton, createHelpPopover } from "../help/helpPopover.ts";
import { ICON, createIcon } from "../workbench/icons.ts";
import {
  featureActionPresentation,
  featureLibraryCategories,
  filterFeatureLibrary,
  moveFeatureSelection,
  type FeatureLibraryCategory,
  type PresentedFeatureAction,
} from "./featureLibraryModel.ts";

export interface FeatureLibrary {
  open(): void;
  close(restoreFocus?: boolean): void;
  toggle(): void;
  isOpen(): boolean;
}

export interface FeatureLibraryDeps {
  readonly host: HTMLElement;
  readonly overlayHost?: HTMLElement;
  readonly requestClose: () => void;
  readonly hasCommand: (command: string) => boolean;
  /** The live value of a boolean setting, so a toggle can say which way it will go. */
  readonly settingValue: (settingId: string) => boolean | undefined;
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
  const helpPopover = createHelpPopover(deps.overlayHost ?? deps.host);
  let open = false;
  let category: FeatureLibraryCategory = "all";
  let query = "";
  let selected = -1;
  let visible: readonly FeatureRecord[] = records;

  const sheet = document.createElement("section");
  sheet.className = "feature-library";
  sheet.setAttribute("role", "region");
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

  /*
   * Categories are chosen from a menu, not a row of chips.
   *
   * The chips were a horizontal strip with `overflow-x: auto` and no scrollbar, so once the
   * catalogue grew past the sheet's width the categories past the edge could be reached by
   * keyboard and by nothing else. A pointer had no affordance to scroll and no gesture that
   * worked. A menu has no edge to fall off, and it states the current filter in words
   * instead of asking the reader to spot which pill is tinted.
   */
  const filterRow = document.createElement("div");
  filterRow.className = "feature-library-filter";

  const filterButton = document.createElement("button");
  filterButton.type = "button";
  filterButton.className = "feature-library-filter-button";
  filterButton.setAttribute("aria-haspopup", "listbox");
  filterButton.setAttribute("aria-expanded", "false");
  filterButton.append(createIcon(ICON.filter));

  const filterLabel = document.createElement("span");
  filterLabel.className = "feature-library-filter-label";
  filterButton.append(filterLabel);

  const menu = document.createElement("div");
  menu.className = "feature-library-filter-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", "Feature categories");
  menu.hidden = true;

  filterRow.append(filterButton, menu);

  const notice = document.createElement("p");
  notice.className = "feature-library-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  const results = document.createElement("div");
  results.id = "feature-library-results";
  results.className = "feature-library-results";
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "ADCode features");

  sheet.append(header, search, filterRow, notice, results);
  deps.host.append(sheet);

  function available(action: FeatureAction): boolean {
    return action.kind !== "command" || deps.hasCommand(action.command);
  }

  function run(action: FeatureAction): void {
    if (!available(action)) {
      notice.textContent = "This feature is not available in this window.";
      return;
    }
    api.close();
    deps.runAction(action);
  }

  /*
   * The button says what pressing it does.
   *
   * The primary button used to say "Open" for every feature in the catalogue, which was
   * accurate for the eighteen that opened something and misleading for the rest: "Open"
   * on Merge conflict resolution opened the Settings row. Now it carries the action's own
   * words - "Check for conflicts", "Turn off", "Open Minimap setting" - so the row states
   * its offer before you press it.
   */
  function actionButton(
    presented: PresentedFeatureAction,
    primary: boolean,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "feature-library-open" : "feature-library-secondary";
    button.textContent = presented.label;
    button.disabled = !presented.enabled;
    if (button.disabled) button.title = "This feature is not available in this window.";
    button.addEventListener("click", () => run(presented.action));
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
    const presentation = featureActionPresentation(
      feature,
      deps.hasCommand,
      deps.settingValue,
    );
    if (presentation.primary !== null) {
      actions.append(actionButton(presentation.primary, true));
    }
    for (const secondary of presentation.secondary.slice(0, 2)) {
      actions.append(actionButton(secondary, false));
    }
    actions.append(createHelpButton(feature.entry, helpPopover));
    row.append(copy, actions);
    return row;
  }

  function menuIsOpen(): boolean {
    return !menu.hidden;
  }

  function closeMenu(restoreFocus = true): void {
    if (menu.hidden) return;
    menu.hidden = true;
    filterButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) filterButton.focus();
  }

  function openMenu(): void {
    if (!menu.hidden) return;
    menu.hidden = false;
    filterButton.setAttribute("aria-expanded", "true");
    // Focus lands on the current category rather than the top of the list, so the menu
    // opens where the reader already is.
    const current = menu.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    (current ?? menu.querySelector<HTMLButtonElement>(".feature-library-filter-option"))?.focus();
  }

  function chooseCategory(value: FeatureLibraryCategory): void {
    category = value;
    query = "";
    search.value = "";
    selected = -1;
    closeMenu();
    render();
  }

  function renderFilter(): void {
    const name = titleFor(category);
    filterLabel.textContent = name;
    // Title and aria-label carry the same sentence, for the same reason `iconButton` does:
    // a tooltip that describes a different state than the screen reader announces is a bug
    // nobody sees until it matters.
    filterButton.title = `Filter by category — showing ${name}`;
    filterButton.setAttribute("aria-label", filterButton.title);

    menu.replaceChildren();
    for (const value of categories) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "feature-library-filter-option";
      option.textContent = titleFor(value);
      option.dataset["category"] = value;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(value === category));
      option.addEventListener("click", () => chooseCategory(value));
      option.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeMenu();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const options = [...menu.querySelectorAll<HTMLButtonElement>(".feature-library-filter-option")];
        const at = options.indexOf(option);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        // Clamped rather than wrapped: the ends of a short list are a useful place to stop.
        options[Math.max(0, Math.min(at + direction, options.length - 1))]?.focus();
      });
      menu.append(option);
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
    renderFilter();
    renderResults();
  }

  filterButton.addEventListener("click", () => {
    if (menuIsOpen()) closeMenu();
    else openMenu();
  });

  filterButton.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openMenu();
  });

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
        : featureActionPresentation(feature, deps.hasCommand, deps.settingValue).primary;
      if (primary?.enabled === true) {
        event.preventDefault();
        run(primary.action);
      }
    }
  });

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !open || deps.host.hidden || helpPopover.isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    // Escape closes one layer at a time: the menu first, the sheet only once it is shut.
    if (menuIsOpen()) closeMenu();
    else api.close();
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
      sheet.dataset["state"] = "open";
      document.addEventListener("keydown", onKeydown, true);
      search.focus({ preventScroll: true });
    },

    close(restoreFocus = true): void {
      if (!open) return;
      open = false;
      helpPopover.close();
      // Without restoring focus: the sheet is going away, and the button it would return
      // focus to is going with it.
      closeMenu(false);
      delete sheet.dataset["state"];
      document.removeEventListener("keydown", onKeydown, true);
      if (restoreFocus) deps.requestClose();
    },

    toggle(): void {
      if (open) api.close();
      else api.open();
    },

    isOpen: () => open && !deps.host.hidden,
  };

  return api;
}
