/**
 * The composer's model picker: a popover above the model chip.
 *
 * Three columns, as T3 Code lays it out. On the left a rail - Favourites, then one tile per
 * connected provider. In the middle a search box and the models to pick from, each with a
 * star to keep it in Favourites; the first nine favourites answer to Ctrl+1 to Ctrl+9. On the
 * right, how hard the highlighted model thinks before it answers. The footer holds the one
 * other choice people make mid-conversation - whether edits land straight away - and the way
 * to connect more models.
 *
 * What is shown is decided in `modelPickerModel.ts`; this file draws it and handles keys.
 */
import { Check, Plug, Plus, Search, Star, type IconNode } from "lucide";
import type { AiStatus } from "../../shared/api.ts";
import { createIcon } from "../workbench/icons.ts";
import {
  EFFORT_SETTING,
  FAVORITES_SETTING,
  activeModelInfo,
  defaultFilter,
  effortFrom,
  favoriteForShortcut,
  parseFavorites,
  pickerView,
  reasoningView,
  serializeFavorites,
  shortcutLabel,
  toggleFavorite,
  type Effort,
  type FavoriteModel,
  type PickerFilter,
  type PickerRow,
  type PickerView,
} from "./modelPickerModel.ts";

const EDIT_POLICY_SETTING = "adcode.ai.editPolicy";

type Settings = Record<string, boolean | string>;

export interface ModelPickerDeps {
  /** The chip the popover sits above, and where focus goes back to. */
  readonly anchor: HTMLElement;
  readonly status: () => Promise<AiStatus>;
  readonly readSettings: () => Promise<Settings>;
  readonly writeSetting: (id: string, value: string) => Promise<Settings>;
  readonly onSettingsChanged: (listener: (values: Settings) => void) => void;
  /** Switch to this model. The widget's own switch, so a waiting turn carries on. */
  readonly chooseModel: (row: PickerRow) => Promise<void>;
  readonly openConnect: () => void;
  /** Something the chip shows changed (effort, model): read the status again. */
  readonly changed?: () => void;
  readonly isMac: boolean;
}

export interface ModelPicker {
  readonly element: HTMLElement;
  open(): Promise<void>;
  close(returnFocus: boolean): void;
  toggle(): void;
  isOpen(): boolean;
  /** The widget's 2-second status poll, so a shortcut knows the favourites without asking. */
  noteStatus(status: AiStatus): void;
  /** Ctrl+1-9 (Cmd on a Mac): picks that favourite. True when the key was handled. */
  handleShortcut(event: KeyboardEvent): boolean;
}

let uid = 0;

export function createModelPicker(deps: ModelPickerDeps): ModelPicker {
  const id = `model-picker-${String(++uid)}`;
  const root = document.createElement("div");
  root.className = "model-picker";
  root.id = id;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Choose a model");

  /* ── State ── */
  let status: AiStatus | null = null;
  let favorites: FavoriteModel[] = [];
  let favoritesRaw = "";
  let effort: Effort = "auto";
  let editPolicy: "trusted" | "review" = "trusted";
  let filter: PickerFilter = "favorites";
  let query = "";
  const expanded = new Set<string>();
  let view: PickerView = { rail: [], groups: [], rows: [], empty: null };
  let activeIndex = 0;
  /** The row whose thinking levels the right pane shows. */
  let highlightKey: string | null = null;
  let opened = false;
  let busy = false;

  /* ── Skeleton ── */
  const body = document.createElement("div");
  body.className = "model-picker-body";

  const rail = document.createElement("div");
  rail.className = "model-picker-rail";
  rail.setAttribute("role", "toolbar");
  rail.setAttribute("aria-orientation", "vertical");
  rail.setAttribute("aria-label", "Show models from");

  const main = document.createElement("div");
  main.className = "model-picker-main";
  const search = document.createElement("label");
  search.className = "ad-search model-picker-search";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search models…";
  searchInput.setAttribute("aria-label", "Search models");
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  search.append(createIcon(Search), searchInput);
  const list = document.createElement("div");
  list.className = "model-picker-list";
  list.id = `${id}-list`;
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "Models");
  searchInput.setAttribute("aria-controls", list.id);
  main.append(search, list);

  const reasoning = document.createElement("section");
  reasoning.className = "model-picker-reasoning";
  const reasoningTitle = document.createElement("h3");
  reasoningTitle.className = "model-picker-reasoning-title";
  reasoningTitle.id = `${id}-reasoning`;
  reasoningTitle.textContent = "Reasoning";
  reasoning.setAttribute("aria-labelledby", reasoningTitle.id);
  const reasoningFor = document.createElement("p");
  reasoningFor.className = "model-picker-reasoning-for";
  const reasoningGroup = document.createElement("div");
  reasoningGroup.className = "model-picker-efforts";
  reasoningGroup.setAttribute("role", "radiogroup");
  reasoningGroup.setAttribute("aria-labelledby", reasoningTitle.id);
  const reasoningNote = document.createElement("p");
  reasoningNote.className = "model-picker-reasoning-note";
  reasoning.append(reasoningTitle, reasoningFor, reasoningGroup, reasoningNote);

  body.append(rail, main, reasoning);

  const footer = document.createElement("div");
  footer.className = "model-picker-footer";
  const access = document.createElement("label");
  access.className = "model-picker-access";
  const accessText = document.createElement("span");
  accessText.textContent = "When it changes files";
  const accessSelect = document.createElement("select");
  accessSelect.className = "ad-select model-picker-access-select";
  accessSelect.setAttribute("aria-label", "When the assistant changes files");
  for (const [value, label] of [["trusted", "Change them right away"], ["review", "Ask me first"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    accessSelect.append(option);
  }
  access.append(accessText, accessSelect);
  const connect = document.createElement("button");
  connect.type = "button";
  connect.className = "model-picker-connect";
  connect.append(createIcon(Plus), document.createTextNode("Connect more models"));
  connect.setAttribute("aria-label", "Connect more models");
  footer.append(access, connect);

  root.append(body, footer);

  /*
   * One highlight per column, moved with translate between items rather than redrawn on
   * each: the model under the keyboard or pointer, the thinking level in use, the provider
   * shown. They ride inside their scrolling column, so they scroll with it.
   */
  const indicator = (extra: string): HTMLElement => {
    const element = document.createElement("div");
    element.className = `model-picker-indicator ${extra}`;
    element.setAttribute("aria-hidden", "true");
    element.dataset["shown"] = "false";
    return element;
  };
  const listIndicator = indicator("model-picker-list-indicator");
  const effortIndicator = indicator("model-picker-effort-indicator");
  const railIndicator = indicator("model-picker-rail-indicator");

  function placeIndicator(element: HTMLElement, target: HTMLElement | null): void {
    if (target === null) { element.dataset["shown"] = "false"; return; }
    element.style.height = `${String(target.offsetHeight)}px`;
    element.style.transform = `translateY(${String(target.offsetTop)}px)`;
    element.dataset["shown"] = "true";
    // The first placement lands; only later ones slide.
    if (element.dataset["placed"] !== "true") requestAnimationFrame(() => { element.dataset["placed"] = "true"; });
  }

  const motionAllowed = (): boolean =>
    document.documentElement.dataset["reducedMotion"] !== "true" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Items of a freshly shown column come in one after another: 25ms apart, eight at most. */
  const stagger = (element: HTMLElement, at: number): void => { element.dataset["stagger"] = String(Math.min(at, 7)); };

  /** What the check marks last showed, so a check only draws in when it moved. */
  let shownCurrentKey: string | null = null;
  let shownEffort: string | null = null;

  /*
   * The popover's height follows its rows. Switching provider, Show more, a search or a
   * star changes how many there are, and a box that jumps reads as broken: the body is
   * eased from its height on screen - mid-animation included - to the new one.
   */
  let heightMotion: { animation: Animation; from: number; to: number } | null = null;
  /** Off while the picker opens: the open has its own motion. */
  let heightReady = false;
  /**
   * The height on screen now. Mid-animation it is worked out from the animation's own eased
   * progress rather than read from layout: an animation started this frame has not applied
   * yet, and reading layout then would restart from the end and snap.
   */
  function heightBefore(): number | null {
    if (!heightReady || !opened || !root.isConnected) return null;
    if (heightMotion !== null) {
      const progress = heightMotion.animation.effect?.getComputedTiming().progress ?? 0;
      return heightMotion.from + (heightMotion.to - heightMotion.from) * (progress ?? 0);
    }
    return body.offsetHeight;
  }
  function settleHeight(from: number | null): void {
    if (from === null) return;
    heightMotion?.animation.cancel();
    heightMotion = null;
    const to = body.offsetHeight;
    if (Math.abs(to - from) < 1 || !motionAllowed()) return;
    const animation = body.animate([{ height: `${String(from)}px` }, { height: `${String(to)}px` }], {
      duration: 220,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
    });
    const motion = { animation, from, to };
    heightMotion = motion;
    animation.addEventListener("finish", () => { if (heightMotion === motion) heightMotion = null; });
  }

  /* ── Rendering ── */

  function recompute(): void {
    if (status === null) return;
    view = pickerView(status, favorites, { filter, query, expanded });
    if (activeIndex >= view.rows.length) activeIndex = Math.max(0, view.rows.length - 1);
  }

  function renderRail(enter = false): void {
    const fromHeight = heightBefore();
    const focusedId = rail.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["rail"] : undefined;
    const buttons = view.rail.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-picker-rail-button";
      button.dataset["rail"] = item.id;
      button.dataset["inUse"] = String(item.inUse);
      button.setAttribute("aria-pressed", String(item.selected));
      button.setAttribute("aria-label", item.id === "favorites" ? "Show favourite models" : `Show ${item.label} models${item.inUse ? ", in use now" : ""}`);
      // The whole name on hover, for one the column cuts short.
      button.title = item.inUse ? `${item.label} (in use now)` : item.label;
      if (item.id === "favorites") button.append(createIcon(Star));
      const name = document.createElement("span");
      name.className = "model-picker-rail-name";
      name.textContent = item.label;
      button.append(name);
      if (item.inUse) {
        const dot = document.createElement("span");
        dot.className = "model-picker-rail-dot";
        dot.setAttribute("aria-hidden", "true");
        button.append(dot);
      }
      button.addEventListener("click", () => {
        filter = item.id === "favorites" ? "favorites" : { provider: item.id };
        query = "";
        searchInput.value = "";
        activeIndex = 0;
        recompute();
        const current = view.rows.findIndex((row) => row.current);
        if (current >= 0) activeIndex = current;
        highlightKey = view.rows[activeIndex]?.key ?? null;
        renderRail();
        renderList(true);
        renderReasoning();
        rail.querySelector<HTMLElement>(`[data-rail="${CSS.escape(item.id)}"]`)?.focus();
      });
      return button;
    });
    const tabStop = buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? buttons[0];
    for (const button of buttons) button.tabIndex = button === tabStop ? 0 : -1;
    if (enter) buttons.forEach(stagger);
    rail.replaceChildren(railIndicator, ...buttons);
    placeIndicator(railIndicator, buttons.find((button) => button.getAttribute("aria-pressed") === "true") ?? null);
    if (focusedId !== undefined) rail.querySelector<HTMLElement>(`[data-rail="${CSS.escape(focusedId)}"]`)?.focus();
    settleHeight(fromHeight);
  }

  let rowElements: { row: PickerRow; element: HTMLElement; pick: HTMLButtonElement; star: HTMLButtonElement }[] = [];

  function renderList(enter = false): void {
    const fromHeight = heightBefore();
    // Rows that were not on screen before fade and slide in; the rest stay put.
    const shownBefore = new Set(rowElements.map((one) => one.row.key));
    let entering = 0;
    const children: HTMLElement[] = [];
    const currentKey = view.rows.find((row) => row.current)?.key ?? null;
    const checkMoved = currentKey !== shownCurrentKey;
    shownCurrentKey = currentKey;
    rowElements = [];
    let index = 0;
    for (const group of view.groups) {
      if (group.heading !== null) {
        const heading = document.createElement("p");
        heading.className = "model-picker-group";
        heading.textContent = group.heading;
        children.push(heading);
      }
      for (const row of group.rows) {
        const at = index++;
        const element = document.createElement("div");
        element.className = "model-picker-row";
        element.dataset["current"] = String(row.current);
        element.dataset["favorite"] = String(row.favorite);

        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "model-picker-pick";
        pick.id = `${id}-row-${String(at)}`;
        pick.tabIndex = -1;
        const text = document.createElement("span");
        text.className = "model-picker-text";
        const name = document.createElement("span");
        name.className = "model-picker-name";
        name.textContent = row.modelName;
        // The full name on hover, for one the column cuts short.
        name.title = row.modelName;
        text.append(name);
        if (row.note !== "") {
          const note = document.createElement("span");
          note.className = "model-picker-note";
          note.textContent = row.note;
          note.title = row.note;
          text.append(note);
        }
        pick.append(text);
        if (row.shortcut !== null) {
          const kbd = document.createElement("kbd");
          kbd.className = "model-picker-kbd";
          kbd.textContent = shortcutLabel(row.shortcut, deps.isMac);
          pick.append(kbd);
        }
        const check = document.createElement("span");
        check.className = "model-picker-check";
        check.setAttribute("aria-hidden", "true");
        if (row.current) check.append(createIcon(Check));
        if (row.current && checkMoved) check.dataset["fresh"] = "true";
        pick.append(check);
        pick.setAttribute("aria-label", [
          `Use ${row.modelName}`,
          row.providerName === "" ? "" : `from ${row.providerName}`,
          row.current ? "(in use now)" : "",
          row.shortcut === null ? "" : `, shortcut ${shortcutLabel(row.shortcut, deps.isMac)}`,
        ].filter(Boolean).join(" "));
        if (row.current) pick.setAttribute("aria-current", "true");
        pick.addEventListener("click", () => void choose(row));
        pick.addEventListener("focus", () => setActive(at, false));

        const star = document.createElement("button");
        star.type = "button";
        star.className = "ad-icon-btn model-picker-star";
        star.tabIndex = -1;
        star.setAttribute("aria-pressed", String(row.favorite));
        star.setAttribute("aria-label", row.favorite ? `Remove ${row.modelName} from favourites` : `Add ${row.modelName} to favourites`);
        star.title = row.favorite ? "Remove from favourites" : "Add to favourites";
        star.append(createIcon(Star));
        star.addEventListener("click", () => toggleStar(row, at));
        star.addEventListener("focus", () => setActive(at, false));

        element.addEventListener("pointermove", () => { if (activeIndex !== at || highlightKey !== row.key) setActive(at, false); });
        element.append(pick, star);
        if (enter) stagger(element, at);
        else if (shownBefore.size > 0 && !shownBefore.has(row.key)) stagger(element, entering++);
        children.push(element);
        rowElements.push({ row, element, pick, star });
      }
      if (group.hidden > 0) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "model-picker-more";
        more.textContent = `Show ${String(group.hidden)} more`;
        more.setAttribute("aria-label", `Show ${String(group.hidden)} more ${group.heading ?? "models"}`.trim());
        const firstHidden = index;
        more.addEventListener("click", () => {
          expanded.add(group.id);
          recompute();
          renderList();
          // Focus the first row that was hidden, so the keyboard carries on from there.
          rowElements[Math.min(firstHidden, rowElements.length - 1)]?.pick.focus();
        });
        children.push(more);
      }
    }
    if (view.empty !== null) {
      const empty = document.createElement("div");
      empty.className = "model-picker-empty";
      const icon: IconNode = query.trim() !== "" ? Search : filter === "favorites" && view.rail.length > 1 ? Star : Plug;
      const line = document.createElement("p");
      line.textContent = view.empty;
      empty.append(createIcon(icon), line);
      if (enter) stagger(empty, 0);
      children.push(empty);
      if (status !== null && view.rail.length <= 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ad-btn ad-btn-primary model-picker-empty-action";
        button.textContent = "Connect a model";
        button.addEventListener("click", () => { close(false); deps.openConnect(); });
        children.push(button);
      }
    }
    list.replaceChildren(listIndicator, ...children);
    paintActive(false);
    settleHeight(fromHeight);
  }

  function paintActive(scroll: boolean): void {
    rowElements.forEach(({ element, pick }, at) => {
      const active = at === activeIndex;
      element.dataset["active"] = String(active);
      pick.tabIndex = active ? 0 : -1;
      if (active && scroll) element.scrollIntoView({ block: "nearest" });
    });
    const active = rowElements[activeIndex];
    placeIndicator(listIndicator, active?.element ?? null);
    if (active === undefined) searchInput.removeAttribute("aria-activedescendant");
    else searchInput.setAttribute("aria-activedescendant", active.pick.id);
  }

  function setActive(at: number, scroll: boolean): void {
    activeIndex = at;
    const key = view.rows[at]?.key ?? null;
    const changed = key !== highlightKey;
    highlightKey = key;
    paintActive(scroll);
    if (changed) renderReasoning();
  }

  /** The row the right pane describes: the highlighted one, else the model in use. */
  function highlighted(): PickerRow | null {
    return view.rows.find((row) => row.key === highlightKey) ?? view.rows.find((row) => row.current) ?? null;
  }

  function renderReasoning(enter = false): void {
    if (status === null) return;
    const fromHeight = heightBefore();
    const row = highlighted();
    const info = row?.info ?? (row === null ? activeModelInfo(status) : undefined);
    const name = row?.modelName ?? info?.name ?? (status.activeModel || "this model");
    const model = reasoningView(info, effort);
    reasoning.dataset["supported"] = String(model.supported);
    reasoningFor.textContent = model.supported ? `How hard ${name} thinks before it answers.` : name;
    const focusedValue = reasoningGroup.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset["effort"] : undefined;
    const checkedValue = model.options.find((option) => option.checked)?.value ?? null;
    const checkMoved = checkedValue !== shownEffort;
    shownEffort = checkedValue;
    const options = model.options.map((option, at) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "model-picker-effort";
      button.dataset["effort"] = option.value;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(option.checked));
      button.setAttribute("aria-label", `${option.label}: ${option.detail}`);
      const label = document.createElement("span");
      label.className = "model-picker-effort-label";
      label.textContent = option.label;
      const detail = document.createElement("span");
      detail.className = "model-picker-effort-detail";
      detail.textContent = option.detail;
      const text = document.createElement("span");
      text.className = "model-picker-text";
      text.append(label, detail);
      const check = document.createElement("span");
      check.className = "model-picker-check";
      check.setAttribute("aria-hidden", "true");
      if (option.checked) check.append(createIcon(Check));
      if (option.checked && checkMoved) check.dataset["fresh"] = "true";
      button.append(text, check);
      if (enter) stagger(button, at);
      button.addEventListener("click", () => void chooseEffort(option.value, row));
      return button;
    });
    const tabStop = options.find((button) => button.getAttribute("aria-checked") === "true") ?? options[0];
    for (const button of options) button.tabIndex = button === tabStop ? 0 : -1;
    reasoningGroup.hidden = !model.supported;
    reasoningGroup.replaceChildren(effortIndicator, ...options);
    placeIndicator(effortIndicator, options.find((button) => button.getAttribute("aria-checked") === "true") ?? null);
    settleHeight(fromHeight);
    reasoningNote.textContent = model.note ?? "";
    reasoningNote.hidden = model.note === null;
    if (focusedValue !== undefined) reasoningGroup.querySelector<HTMLElement>(`[data-effort="${focusedValue}"]`)?.focus();
  }

  function renderFooter(): void {
    accessSelect.value = editPolicy;
  }

  function renderAll(enter = false): void {
    renderRail(enter);
    renderList(enter);
    renderReasoning(enter);
    renderFooter();
  }

  /* ── Actions ── */

  async function choose(row: PickerRow): Promise<void> {
    if (busy) return;
    if (row.current) { close(true); return; }
    busy = true;
    try {
      await deps.chooseModel(row);
      deps.changed?.();
    } finally {
      busy = false;
    }
    close(true);
  }

  async function chooseEffort(value: Effort, row: PickerRow | null): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      // Picking a level for a model that is not in use picks that model too: one click, both choices.
      if (row !== null && !row.current) await deps.chooseModel(row);
      if (value !== effort) await deps.writeSetting(EFFORT_SETTING, value);
      effort = value;
      status = await deps.status().catch(() => status);
      if (status !== null) effort = effortFrom(status.effort);
      deps.changed?.();
    } finally {
      busy = false;
    }
    if (!opened) return;
    recompute();
    renderList();
    renderReasoning();
    reasoningGroup.querySelector<HTMLElement>(`[data-effort="${value}"]`)?.focus();
  }

  function toggleStar(row: PickerRow, at: number): void {
    const before = favorites;
    favorites = toggleFavorite(favorites, row.provider, row.model);
    favoritesRaw = serializeFavorites(favorites);
    recompute();
    renderList();
    const same = rowElements.find((one) => one.row.key === row.key);
    (same?.star ?? rowElements[Math.min(at, rowElements.length - 1)]?.pick ?? searchInput).focus();
    void deps.writeSetting(FAVORITES_SETTING, favoritesRaw).catch(() => {
      favorites = before;
      favoritesRaw = serializeFavorites(before);
      if (!opened) return;
      recompute();
      renderList();
    });
  }

  function moveActive(step: number | "first" | "last"): void {
    const count = rowElements.length;
    if (count === 0) return;
    const next = step === "first" ? 0 : step === "last" ? count - 1 : (activeIndex + step + count) % count;
    setActive(next, true);
  }

  /* ── Keys ── */

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    activeIndex = 0;
    recompute();
    highlightKey = view.rows[0]?.key ?? null;
    renderRail();
    renderList();
    renderReasoning();
  });
  searchInput.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = view.rows[activeIndex];
      if (row !== undefined) void choose(row);
    }
  });

  list.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    const at = rowElements.findIndex((one) => one.pick === target || one.star === target);
    if (at < 0) return;
    const entry = rowElements[at]!;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : event.key === "Home" ? "first" : "last");
      rowElements[activeIndex]?.pick.focus();
    } else if (event.key === "ArrowRight" && target === entry.pick) {
      event.preventDefault();
      entry.star.focus();
    } else if (event.key === "ArrowLeft" && target === entry.star) {
      event.preventDefault();
      entry.pick.focus();
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
      // Typing anywhere in the list searches.
      searchInput.focus();
    }
  });

  const roving = (container: HTMLElement, selector: string, vertical: boolean) => (event: KeyboardEvent): void => {
    const items = [...container.querySelectorAll<HTMLElement>(selector)];
    const at = items.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    let next = -1;
    if (event.key === forward) next = (at + 1) % items.length;
    else if (event.key === back) next = (at - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    for (const item of items) item.tabIndex = -1;
    items[next]!.tabIndex = 0;
    items[next]!.focus();
  };
  rail.addEventListener("keydown", roving(rail, ".model-picker-rail-button", true));
  reasoningGroup.addEventListener("keydown", roving(reasoningGroup, ".model-picker-effort", true));

  accessSelect.addEventListener("change", () => {
    const next = accessSelect.value === "review" ? "review" : "trusted";
    void deps.writeSetting(EDIT_POLICY_SETTING, next).then((values) => {
      editPolicy = values[EDIT_POLICY_SETTING] === "review" ? "review" : "trusted";
      renderFooter();
    }, () => renderFooter());
  });
  connect.addEventListener("click", () => {
    close(false);
    deps.openConnect();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (handleShortcut(event)) return;
    // Keys typed in the picker stay in it: the workbench's own shortcuts wait until it closes.
    if (event.key !== "Tab") event.stopPropagation();
  });
  root.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !root.contains(next) && next !== deps.anchor) close(false);
  });

  /* ── Dismissal and placement ── */

  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node) || root.contains(target) || deps.anchor.contains(target)) return;
    close(false);
  };
  const onResize = (): void => close(false);

  function place(): void {
    const margin = 8;
    const gap = 6;
    const rect = deps.anchor.getBoundingClientRect();
    const width = Math.min(640, window.innerWidth - margin * 2);
    const left = Math.min(Math.max(rect.right - width, margin), window.innerWidth - width - margin);
    const above = rect.top - margin - gap;
    const below = window.innerHeight - rect.bottom - margin - gap;
    const upward = above >= 300 || above >= below;
    root.style.width = `${String(width)}px`;
    root.style.left = `${String(Math.round(left))}px`;
    root.style.maxHeight = `${String(Math.max(200, Math.min(480, upward ? above : below)))}px`;
    if (upward) {
      root.style.top = "";
      root.style.bottom = `${String(Math.round(window.innerHeight - rect.top + gap))}px`;
    } else {
      root.style.bottom = "";
      root.style.top = `${String(Math.round(rect.bottom + gap))}px`;
    }
    root.dataset["side"] = upward ? "above" : "below";
  }

  /* ── Lifecycle ── */

  /** A close still fading out: finished at once if the picker opens again meanwhile. */
  let removal: number | null = null;
  function finishRemoval(): void {
    if (removal !== null) window.clearTimeout(removal);
    removal = null;
    root.removeEventListener("animationend", onExitEnd);
    delete root.dataset["state"];
    root.remove();
  }
  function onExitEnd(event: AnimationEvent): void {
    if (event.target === root) finishRemoval();
  }

  async function open(): Promise<void> {
    if (opened) return;
    opened = true;
    if (removal !== null) finishRemoval();
    heightReady = false;
    heightMotion?.animation.cancel();
    heightMotion = null;
    rowElements = [];
    deps.anchor.setAttribute("aria-expanded", "true");
    const [freshStatus, settings] = await Promise.all([
      deps.status().catch(() => status),
      deps.readSettings().catch(() => ({} as Settings)),
    ]);
    if (!opened) return;
    status = freshStatus;
    adoptSettings(settings);
    effort = effortFrom(status?.effort);
    filter = status === null ? "favorites" : defaultFilter(status, favorites);
    query = "";
    searchInput.value = "";
    expanded.clear();
    activeIndex = 0;
    recompute();
    const current = view.rows.findIndex((row) => row.current);
    if (current >= 0) activeIndex = current;
    highlightKey = view.rows[activeIndex]?.key ?? null;
    if (status === null) {
      view = { rail: [], groups: [], rows: [], empty: "Could not read which models are connected. Try again in a moment." };
    }
    shownCurrentKey = null;
    shownEffort = null;
    for (const element of [listIndicator, effortIndicator, railIndicator]) element.dataset["placed"] = "false";
    document.body.append(root);
    place();
    root.dataset["state"] = "open";
    renderAll(true);
    heightReady = true;
    paintActive(true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onResize);
    searchInput.focus();
  }

  function close(returnFocus: boolean): void {
    if (!opened) return;
    opened = false;
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("blur", onResize);
    deps.anchor.setAttribute("aria-expanded", "false");
    heightReady = false;
    if (returnFocus) deps.anchor.focus();
    // It leaves faster than it came, back toward the chip; at once when motion is off.
    if (!root.isConnected || !motionAllowed()) { finishRemoval(); return; }
    root.dataset["state"] = "closing";
    root.addEventListener("animationend", onExitEnd);
    removal = window.setTimeout(finishRemoval, 240);
  }

  function adoptSettings(values: Settings): void {
    const raw = values[FAVORITES_SETTING];
    if (typeof raw === "string" && raw !== favoritesRaw) {
      favoritesRaw = raw;
      favorites = parseFavorites(raw);
    }
    editPolicy = values[EDIT_POLICY_SETTING] === "review" ? "review" : "trusted";
    effort = effortFrom(values[EFFORT_SETTING]);
  }

  void deps.readSettings().then(adoptSettings, () => undefined);
  deps.onSettingsChanged((values) => {
    const before = favoritesRaw;
    adoptSettings(values);
    if (!opened) return;
    if (favoritesRaw !== before) { recompute(); renderList(); }
    renderFooter();
  });

  function handleShortcut(event: KeyboardEvent): boolean {
    const mod = deps.isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.shiftKey || event.altKey || event.isComposing) return false;
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null);
    if (digit === null || status === null) return false;
    const favorite = favoriteForShortcut(status, favorites, Number(digit));
    if (favorite === null) return false;
    const row = pickerView(status, favorites, { filter: "favorites", query: "", expanded: new Set() }).rows
      .find((one) => one.provider === favorite.provider && one.model === favorite.model);
    if (row === undefined) return false;
    event.preventDefault();
    event.stopPropagation();
    if (opened) void choose(row);
    else if (!row.current) void deps.chooseModel(row).then(() => deps.changed?.(), () => undefined);
    return true;
  }

  return {
    element: root,
    open,
    close,
    toggle: () => { if (opened) close(true); else void open(); },
    isOpen: () => opened,
    noteStatus: (next) => { if (!opened) status = next; },
    handleShortcut,
  };
}
