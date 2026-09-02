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
  type PresentedFeatureAction,
} from "./featureLibraryModel.ts";

export interface FeatureLibrary {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  isOpen(): boolean;
}

export interface FeatureLibraryDeps {
  readonly overlayHost?: HTMLElement;
  readonly onRequestClose: () => void;
  readonly hasCommand: (command: string) => boolean;
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

const titleFor = (group: FeatureLibraryCategory): string =>
  GROUP_TITLES[group] ?? group;

export function createFeatureLibrary(deps: FeatureLibraryDeps): FeatureLibrary {
  const records = featureRecords();
  const categories = featureLibraryCategories(records);
  const helpPopover = createHelpPopover(deps.overlayHost ?? document.body);
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
  const close = document.createElement("button");
  close.type = "button";
  close.className = "feature-library-close";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close All Features");
  close.title = "Close All Features";
  close.addEventListener("click", () => deps.onRequestClose());
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "feature-library-body";
  const categoryRail = document.createElement("nav");
  categoryRail.className = "feature-library-categories";
  categoryRail.setAttribute("aria-label", "Feature categories");
  const workspace = document.createElement("div");
  workspace.className = "feature-library-workspace";
  const workspaceHeader = document.createElement("div");
  workspaceHeader.className = "feature-library-workspace-header";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "feature-library-search";
  search.placeholder = "Search what ADCode can do…";
  search.setAttribute("aria-label", "Search all features");
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-controls", "feature-library-results");
  search.setAttribute("aria-autocomplete", "list");
  search.setAttribute("aria-expanded", "true");
  const notice = document.createElement("p");
  notice.className = "feature-library-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const results = document.createElement("div");
  results.id = "feature-library-results";
  results.className = "feature-library-results";
  results.setAttribute("role", "listbox");
  results.setAttribute("aria-label", "ADCode features");

  workspaceHeader.append(search, notice);
  workspace.append(workspaceHeader, results);
  body.append(categoryRail, workspace);
  sheet.append(header, body);

  function available(action: FeatureAction): boolean {
    return action.kind !== "command" || deps.hasCommand(action.command);
  }

  function run(action: FeatureAction): void {
    if (!available(action)) {
      notice.textContent = "This feature is not available in this window.";
      return;
    }
    // Routing can open another primary surface, so the coordinator dismisses this one first.
    deps.onRequestClose();
    deps.runAction(action);
  }

  function actionButton(
    presented: PresentedFeatureAction,
    primary: boolean,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary
      ? "feature-library-open"
      : "feature-library-secondary";
    button.textContent = presented.label;
    button.disabled = !presented.enabled;
    if (button.disabled)
      button.title = "This feature is not available in this window.";
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
    if (presentation.primary !== null)
      actions.append(actionButton(presentation.primary, true));
    for (const secondary of presentation.secondary.slice(0, 2))
      actions.append(actionButton(secondary, false));
    actions.append(createHelpButton(feature.entry, helpPopover));
    row.append(copy, actions);
    return row;
  }

  function chooseCategory(value: FeatureLibraryCategory): void {
    category = value;
    query = "";
    search.value = "";
    selected = -1;
    render();
  }

  function renderCategories(): void {
    categoryRail.replaceChildren();
    for (const value of categories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feature-library-category";
      button.dataset["category"] = value;
      button.setAttribute("aria-pressed", String(value === category));
      const label = document.createElement("span");
      label.textContent = titleFor(value);
      const count = document.createElement("span");
      count.className = "feature-library-category-count";
      count.textContent = String(
        filterFeatureLibrary(records, { category: value, query: "" }).length,
      );
      button.append(label, count);
      button.addEventListener("click", () => chooseCategory(value));
      categoryRail.append(button);
    }
  }

  function renderResults(): void {
    visible = filterFeatureLibrary(records, { category, query });
    if (selected >= visible.length) selected = visible.length - 1;
    results.replaceChildren();
    notice.textContent =
      visible.length === 0 ? `No features match “${query}”.` : "";
    let lastGroup: HelpGroupId | null = null;
    visible.forEach((feature, index) => {
      if (
        query.length === 0 &&
        category === "all" &&
        lastGroup !== feature.entry.group
      ) {
        lastGroup = feature.entry.group;
        const group = document.createElement("h3");
        group.className = "feature-library-group";
        group.textContent = titleFor(feature.entry.group);
        results.append(group);
      }
      results.append(rowFor(feature, index));
    });
    const selectedRow = results.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (selectedRow === null) search.removeAttribute("aria-activedescendant");
    else {
      selectedRow.scrollIntoView({ block: "nearest" });
      const activeId = selectedRow.dataset["featureId"];
      if (activeId === undefined)
        search.removeAttribute("aria-activedescendant");
      else {
        selectedRow.id = `feature-result-${activeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        search.setAttribute("aria-activedescendant", selectedRow.id);
      }
    }
  }

  function render(): void {
    renderCategories();
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
      selected = moveFeatureSelection(
        selected,
        event.key === "ArrowDown" ? 1 : -1,
        visible.length,
      );
      renderResults();
      return;
    }
    if (event.key === "Enter" && selected >= 0) {
      const feature = visible[selected];
      const primary =
        feature === undefined
          ? null
          : featureActionPresentation(
              feature,
              deps.hasCommand,
              deps.settingValue,
            ).primary;
      if (primary?.enabled === true) {
        event.preventDefault();
        run(primary.action);
      }
    }
  });

  return {
    element: sheet,
    shown(): void {
      open = true;
      category = "all";
      query = "";
      selected = -1;
      search.value = "";
      render();
      sheet.dataset["state"] = "open";
      search.focus({ preventScroll: true });
    },
    hidden(): void {
      open = false;
      helpPopover.close();
      delete sheet.dataset["state"];
    },
    isOpen: () => open,
  };
}
