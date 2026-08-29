import { featureFor } from "@adcode/help";
import {
  createUniversalSearchCoordinator,
  rankUniversalItems,
  type UniversalSearchKind,
  type UniversalSearchSnapshot,
} from "@adcode/search/universal";
import { createHelpButton, createHelpPopover } from "../help/helpPopover.ts";
import type {
  UniversalDesktopAction,
  UniversalDesktopItem,
} from "./universalSearchModel.ts";

export interface UniversalSearch {
  open(seed?: string): void;
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
}

export interface UniversalSearchDeps {
  readonly host: HTMLElement;
  readonly localItems: () => readonly UniversalDesktopItem[];
  readonly files: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly UniversalDesktopItem[]>;
  readonly recents: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly UniversalDesktopItem[]>;
  readonly symbols: (
    query: string,
    signal: AbortSignal,
  ) => Promise<readonly UniversalDesktopItem[]>;
  readonly run: (action: UniversalDesktopAction) => void;
  readonly restoreFocus: () => void;
}

const GROUPS: readonly { readonly kind: UniversalSearchKind; readonly title: string }[] = [
  { kind: "feature", title: "Features" },
  { kind: "command", title: "Commands" },
  { kind: "file", title: "Files" },
  { kind: "symbol", title: "Symbols" },
  { kind: "recent", title: "Recent folders" },
];

const ASYNC_DELAY_MS = 70;

export function createUniversalSearch(deps: UniversalSearchDeps): UniversalSearch {
  let open = false;
  let timer: number | null = null;
  let selected = 0;
  let displayItems: readonly UniversalDesktopItem[] = [];
  const entries = new Map<string, UniversalDesktopItem>();
  const helpPopover = createHelpPopover(deps.host);

  const overlay = document.createElement("div");
  overlay.className = "universal-search-overlay";
  overlay.hidden = true;

  const box = document.createElement("section");
  box.className = "universal-search";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Search all of ADCode");

  const input = document.createElement("input");
  input.type = "search";
  input.className = "universal-search-input";
  input.placeholder = "Search features, commands, files, folders, and symbols";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", "Search all of ADCode");
  input.setAttribute("aria-controls", "universal-search-results");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");

  const list = document.createElement("div");
  list.id = "universal-search-results";
  list.className = "universal-search-results";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Search results");

  const status = document.createElement("div");
  status.className = "universal-search-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  box.append(input, list, status);
  overlay.append(box);
  deps.host.append(overlay);

  function remember(items: readonly UniversalDesktopItem[]): readonly UniversalDesktopItem[] {
    for (const item of items) entries.set(item.id, item);
    return items;
  }

  const coordinator = createUniversalSearchCoordinator({
    local: () => remember(deps.localItems()),
    providers: [
      { source: "file", search: (query, signal) => deps.files(query, signal).then(remember) },
      { source: "recent", search: (query, signal) => deps.recents(query, signal).then(remember) },
      {
        source: "symbol",
        minimumQueryLength: 2,
        search: (query, signal) => deps.symbols(query, signal).then(remember),
      },
    ],
    publish: (snapshot) => paint(snapshot),
    limits: { perKind: 8, total: 30 },
  });

  function grouped(items: readonly UniversalDesktopItem[]): readonly UniversalDesktopItem[] {
    return GROUPS.flatMap(({ kind }) => items.filter((item) => item.kind === kind));
  }

  function execute(item: UniversalDesktopItem): void {
    api.close(false);
    deps.run(item.action);
  }

  function resultRow(item: UniversalDesktopItem, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "universal-search-row-wrap";

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "universal-search-row";
    choose.id = `universal-result-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    choose.setAttribute("role", "option");
    choose.setAttribute("aria-selected", String(index === selected));
    choose.addEventListener("click", () => execute(item));

    const badge = document.createElement("span");
    badge.className = "universal-search-kind";
    badge.textContent = item.kind;

    const copy = document.createElement("span");
    copy.className = "universal-search-copy";
    const title = document.createElement("span");
    title.className = "universal-search-title";
    title.textContent = item.title;
    copy.append(title);
    if (item.detail !== undefined && item.detail !== item.title) {
      const detail = document.createElement("span");
      detail.className = "universal-search-detail";
      detail.textContent = item.detail;
      copy.append(detail);
    }
    choose.append(badge, copy);
    row.append(choose);

    if (item.helpId !== undefined) {
      const entry = featureFor(item.helpId);
      if (entry !== undefined) row.append(createHelpButton(entry.entry, helpPopover));
    }
    return row;
  }

  function renderRows(): void {
    list.replaceChildren();
    let at = 0;
    for (const group of GROUPS) {
      const items = displayItems.filter((item) => item.kind === group.kind);
      if (items.length === 0) continue;
      const section = document.createElement("section");
      section.className = "universal-search-group";
      section.setAttribute("role", "presentation");
      const heading = document.createElement("h2");
      heading.className = "universal-search-group-title";
      heading.textContent = group.title;
      section.append(heading);
      for (const item of items) section.append(resultRow(item, at++));
      list.append(section);
    }

    const current = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (current === null) input.removeAttribute("aria-activedescendant");
    else {
      input.setAttribute("aria-activedescendant", current.id);
      current.scrollIntoView({ block: "nearest" });
    }
  }

  function paint(snapshot: UniversalSearchSnapshot): void {
    if (!open || snapshot.query !== input.value) return;
    displayItems = grouped(
      snapshot.items
        .map((item) => entries.get(item.id))
        .filter((item): item is UniversalDesktopItem => item !== undefined),
    );
    selected = displayItems.length === 0 ? -1 : Math.min(Math.max(selected, 0), displayItems.length - 1);
    renderRows();

    const messages = [
      ...snapshot.failures.map((failure) => failure.message),
      snapshot.pending.length > 0 ? `Searching ${snapshot.pending.join(", ")}…` : "",
    ].filter(Boolean);
    if (displayItems.length === 0 && snapshot.pending.length === 0) {
      messages.unshift(`Nothing matches “${snapshot.query}”.`);
    }
    status.textContent = messages.join(" ");
  }

  function paintLocal(query: string): void {
    const local = remember(deps.localItems());
    const ranked = rankUniversalItems(query, local, { perKind: 8, total: 30 });
    paint({ query, generation: 0, items: ranked, pending: [], failures: [] });
  }

  function requestAsync(immediate = false): void {
    if (timer !== null) window.clearTimeout(timer);
    coordinator.close();
    const query = input.value;
    paintLocal(query);
    const request = (): void => {
      timer = null;
      void coordinator.search(query);
    };
    if (immediate || query.trimStart().startsWith(">")) request();
    else timer = window.setTimeout(request, ASYNC_DELAY_MS);
  }

  input.addEventListener("input", () => {
    selected = 0;
    requestAsync();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (displayItems.length === 0) return;
      selected = event.key === "ArrowDown"
        ? Math.min(selected + 1, displayItems.length - 1)
        : Math.max(selected - 1, 0);
      renderRows();
      return;
    }
    if (event.key === "Enter") {
      const item = displayItems[selected];
      if (item !== undefined) {
        event.preventDefault();
        execute(item);
      }
      return;
    }
    if (event.key === "Escape" && !helpPopover.isOpen()) {
      event.preventDefault();
      api.close();
    }
  });

  overlay.addEventListener("pointerdown", (event) => {
    if (event.target === overlay) api.close();
  });

  const api: UniversalSearch = {
    open(seed = ""): void {
      if (open) {
        input.value = seed;
        input.setSelectionRange(seed.length, seed.length);
        selected = 0;
        requestAsync(true);
        input.focus();
        return;
      }
      open = true;
      entries.clear();
      input.value = seed;
      selected = 0;
      overlay.hidden = false;
      void box.offsetHeight;
      overlay.dataset["state"] = "open";
      input.focus();
      input.setSelectionRange(seed.length, seed.length);
      requestAsync(true);
    },

    close(restoreFocus = true): void {
      if (!open) return;
      open = false;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      coordinator.close();
      helpPopover.close();
      delete overlay.dataset["state"];
      overlay.hidden = true;
      if (restoreFocus) deps.restoreFocus();
    },

    isOpen: () => open,
  };

  return api;
}
