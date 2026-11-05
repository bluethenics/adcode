/**
 * What the Plugins page and the Artifacts page share: the page frame (title, search,
 * segmented tabs, a status line), cards, lists, the profile card, stars and reporting.
 *
 * Each page owns its tabs and what they show; this owns how a tab appears, how failures are
 * said, and the one-time stagger when a tab first paints for a visit.
 */
import { compactCount, timeAgo, type ActivityItem, type CommunityMe } from "@adcode/community";
import type { CommunityProgressView } from "../../shared/community.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { indexForStagger, markFor } from "../motionFlip.ts";
import { createIcon, ICON } from "../workbench/icons.ts";

export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback;
}

export const plural = (count: number, one: string, many = `${one}s`): string => `${compactCount(count)} ${count === 1 ? one : many}`;

export function stat(label: string, value: string): HTMLElement {
  const node = el("span", "community-stat");
  node.append(el("strong", "", value), document.createTextNode(` ${label}`));
  return node;
}

export function chip(text: string, className = "community-chip"): HTMLElement {
  return el("span", className, text);
}

/** A plugin's tile: the first letter of its name on a keycap. Every plugin gets one, so none shouts. */
export function monogram(name: string): HTMLElement {
  const letter = [...name.trim()].find((char) => /[\p{L}\p{N}]/u.test(char)) ?? "P";
  const tile = el("span", "community-monogram", letter.toUpperCase());
  tile.setAttribute("aria-hidden", "true");
  return tile;
}

/** Replace an element with another, keeping keyboard focus where the person had it. */
export function swapIn(old: HTMLElement, next: HTMLElement): void {
  const focused = old.contains(document.activeElement);
  old.replaceWith(next);
  if (focused) next.focus({ preventScroll: true });
}

export function installedMark(text: string, fresh: boolean): HTMLElement {
  const mark = el("span", "community-installed-mark");
  mark.tabIndex = -1;
  if (fresh) mark.dataset["fresh"] = "true";
  mark.append(createIcon(ICON.check), document.createTextNode(text));
  return mark;
}

/** A tappable row from the design system: icon tile, title, one line, chevron. */
export function door(iconPath: string, name: string, text: string, run: () => void): HTMLElement {
  const row = el("button", "ad-card-row community-door");
  row.type = "button";
  const tile = el("span", "ad-card-icon");
  tile.append(createIcon(iconPath));
  const copy = el("span", "ad-card-copy");
  copy.append(el("span", "ad-card-title", name), el("span", "ad-card-sub", text));
  const chevron = el("span", "community-door-chevron");
  chevron.append(createIcon(ICON.chevronRight));
  row.append(tile, copy, chevron);
  row.addEventListener("click", run);
  return row;
}

export function section(titleText: string, note: string, body: HTMLElement, action?: HTMLElement): HTMLElement {
  const wrap = el("section", "community-section");
  const head = el("div", "community-section-head");
  const words = el("div", "");
  words.append(el("h2", "community-section-title", titleText));
  if (note) words.append(el("p", "community-section-note", note));
  head.append(words);
  if (action !== undefined) head.append(action);
  wrap.append(head, body);
  return wrap;
}

export function list(items: readonly HTMLElement[], empty: string): HTMLElement {
  if (items.length === 0) return el("p", "community-empty", empty);
  const node = el("ul", "community-installed");
  node.append(...items);
  return node;
}

/** A row with a close button in the dialog heading, the way every Community dialog opens. */
export function detailDialog(className: string, titleText: string): ReturnType<typeof openFormModal> {
  const modal = openFormModal(`community-dialog ${className}`, titleText, () => undefined);
  const headRow = el("div", "community-dialog-head");
  const close = el("button", "ad-icon-btn");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.append(createIcon(ICON.close));
  close.addEventListener("click", modal.finish);
  headRow.append(modal.title, close);
  modal.card.prepend(headRow);
  return modal;
}

export interface HubTab<T extends string> {
  readonly id: T;
  readonly label: string;
}

export interface HubShell<T extends string> {
  readonly element: HTMLElement;
  readonly search: HTMLInputElement;
  panel(tab: T): HTMLElement;
  current(): T;
  visible(): boolean;
  /** True while the current tab paints for the first time this visit. */
  entering(): boolean;
  showTab(tab: T): void;
  rerender(): void;
  say(message: string, kind?: "info" | "error"): void;
  attempt<R>(run: () => Promise<R>, fallback: string): Promise<R | null>;
  setSummary(text: string): void;
  setBadge(tab: T, count: number): void;
  setChip(text: string | null, onClick: () => void): void;
  grid(items: readonly HTMLElement[], empty: string): HTMLElement;
  loading(panel: HTMLElement): void;
  offline(panel: HTMLElement, message: string, retry: () => void): void;
  shown(): void;
  hidden(): void;
}

/** The frame both pages are drawn in. */
export function createHubShell<T extends string>(options: {
  readonly name: string;
  readonly title: string;
  readonly summary: string;
  readonly searchLabel: string;
  readonly tabs: readonly HubTab<T>[];
  readonly render: (tab: T) => Promise<void> | void;
}): HubShell<T> {
  const element = el("section", "community-page");
  element.setAttribute("aria-label", options.title);
  element.dataset["hub"] = options.name;

  const header = el("header", "community-header");
  const heading = el("div", "community-heading");
  const summary = el("p", "community-summary", options.summary);
  heading.append(el("h1", "community-title", options.title), summary);
  const actions = el("div", "community-header-actions");
  const searchField = el("label", "ad-search community-search");
  const search = el("input", "");
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", options.searchLabel);
  searchField.append(createIcon(ICON.search), search);
  const creatorChip = el("button", "community-creator-chip");
  creatorChip.type = "button";
  creatorChip.hidden = true;
  actions.append(searchField, creatorChip);
  header.append(heading, actions);

  const tabList = el("div", "ad-tabs community-tabs");
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", `${options.title} sections`);
  const tabButtons = new Map<T, HTMLButtonElement>();
  const badges = new Map<T, HTMLElement>();
  const panels = new Map<T, HTMLElement>();
  for (const tab of options.tabs) {
    const control = el("button", "ad-tab community-tab", tab.label);
    control.type = "button";
    control.id = `${options.name}-tab-${tab.id}`;
    control.setAttribute("role", "tab");
    control.setAttribute("aria-controls", `${options.name}-panel-${tab.id}`);
    control.addEventListener("click", () => showTab(tab.id));
    const badge = el("span", "community-tab-badge");
    badge.hidden = true;
    control.append(badge);
    badges.set(tab.id, badge);
    tabButtons.set(tab.id, control);
    tabList.append(control);
    const panel = el("div", "community-panel");
    panel.id = `${options.name}-panel-${tab.id}`;
    panel.dataset["tab"] = tab.id;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", control.id);
    panel.hidden = true;
    panels.set(tab.id, panel);
  }
  tabList.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = options.tabs.findIndex((tab) => tab.id === current);
    const next = options.tabs[(index + (event.key === "ArrowRight" ? 1 : options.tabs.length - 1)) % options.tabs.length]!;
    showTab(next.id);
    tabButtons.get(next.id)?.focus();
    event.preventDefault();
  });

  const notice = el("p", "community-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  element.append(header, tabList, notice, ...panels.values());

  let current: T = options.tabs[0]!.id;
  let isVisible = false;
  let isEntering = false;
  const entered = new Set<T>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function say(message: string, kind: "info" | "error" = "info"): void {
    notice.textContent = message;
    notice.dataset["kind"] = kind;
    delete notice.dataset["leaving"];
    if (notice.hidden) markFor(notice, "enter", "true", 300);
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.dataset["leaving"] = "true";
      noticeTimer = setTimeout(() => { notice.hidden = true; delete notice.dataset["leaving"]; }, 160);
    }, kind === "error" ? 9000 : 5000);
  }

  async function render(tab: T): Promise<void> {
    isEntering = !entered.has(tab);
    entered.add(tab);
    try { await options.render(tab); } finally { isEntering = false; }
  }

  function showTab(tab: T): void {
    current = tab;
    for (const [id, control] of tabButtons) {
      control.setAttribute("aria-selected", String(id === tab));
      control.tabIndex = id === tab ? 0 : -1;
    }
    for (const [id, panel] of panels) {
      const showing = id === tab;
      if (showing && panel.hidden) markFor(panel, "enter", "true", 260);
      panel.hidden = !showing;
    }
    if (isVisible) void render(tab);
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { if (isVisible) void render(current); }, 250);
  });

  showTab(current);

  return {
    element,
    search,
    panel: (tab) => panels.get(tab)!,
    current: () => current,
    visible: () => isVisible,
    entering: () => isEntering,
    showTab,
    rerender: () => { if (isVisible) void render(current); },
    say,
    async attempt(run, fallback) {
      try {
        return await run();
      } catch (error) {
        say(errorText(error, fallback), "error");
        return null;
      }
    },
    setSummary: (text) => { summary.textContent = text; },
    setBadge(tab, count) {
      const badge = badges.get(tab);
      if (badge === undefined) return;
      if (badge.hidden && count > 0) markFor(badge, "enter", "true", 300);
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? "99+" : String(count);
    },
    setChip(text, onClick) {
      creatorChip.hidden = text === null;
      creatorChip.textContent = text ?? "";
      creatorChip.onclick = onClick;
    },
    grid(items, empty) {
      if (items.length === 0) return el("p", "community-empty", empty);
      const node = el("div", "community-grid");
      node.append(...items);
      // Cards rise in once per visit to a tab; typing in search or changing a sort does not
      // animate, because motion on something done many times a minute is noise.
      if (isEntering) {
        node.dataset["stagger"] = "true";
        indexForStagger(node);
      }
      return node;
    },
    loading(panel) { if (panel.childElementCount === 0) panel.replaceChildren(el("p", "community-empty", "Loading")); },
    offline(panel, message, retry) {
      const box = el("div", "community-empty");
      box.append(el("p", "", message), button("Try again", "ad-btn", retry));
      panel.replaceChildren(box);
    },
    shown() {
      const first = !isVisible;
      isVisible = true;
      if (first) void render(current);
    },
    hidden() { isVisible = false; entered.clear(); },
  };
}

/** Star with its count. The count ticks the moment it is pressed, and settles to the server's answer. */
export function starButton(kind: "plugin" | "artifact", id: string, starred: boolean, stars: number, say: (message: string, kind: "error") => void): HTMLButtonElement {
  let on = starred, count = stars;
  const control = el("button", "ad-btn community-star");
  control.type = "button";
  const paint = (): void => {
    control.setAttribute("aria-pressed", String(on));
    control.replaceChildren(el("span", "community-star-label", on ? "Starred" : "Star"), el("span", "community-star-count", compactCount(count)));
  };
  paint();
  control.addEventListener("click", () => {
    const was = { on, count };
    on = !on;
    count = Math.max(0, count + (on ? 1 : -1));
    paint();
    markFor(control, "bump", "true", 400);
    void window.adcode.community.star(kind, id, on).then((result) => { on = result.starred; count = result.stars; paint(); }, (error: unknown) => {
      on = was.on; count = was.count; paint();
      say(errorText(error, "Could not star it."), "error");
    });
  });
  return control;
}

export function reportDialog(kind: "plugin" | "artifact", id: string, name: string, say: (message: string, kind?: "info" | "error") => void): void {
  const { dialog, card, finish } = openFormModal("community-dialog community-report", `Report ${name}`, () => undefined);
  const form = el("form", "form-dialog-form");
  const reason = el("textarea", "form-input");
  reason.rows = 3;
  reason.maxLength = 500;
  reason.required = true;
  form.append(field("What is wrong with it?", reason, "Spam, harmful prompts, stolen work, or something that does not do what it says. Five reports hide a listing until it is reviewed."));
  const buttons = el("div", "confirm-buttons");
  const submit = el("button", "result-close", "Send report");
  submit.type = "submit";
  buttons.append(button("Cancel", "confirm-cancel", finish), submit);
  form.append(buttons);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void window.adcode.community.report(kind, id, reason.value).then(() => { finish(); say("Thanks. The report was sent"); }, (error: unknown) => say(errorText(error, "The report could not be sent."), "error"));
  });
  card.append(form);
  dialog.showModal();
  reason.focus();
}

/** Level, points, progress, totals and badges - the same card on both pages. */
export function profileCard(me: CommunityMe, entering: boolean): HTMLElement {
  const { profile } = me;
  const card = el("section", "community-profile");
  const level = el("div", "community-level");
  level.append(el("strong", "community-level-name", profile.level.name), el("span", "community-card-by", `${compactCount(profile.points)} points${profile.level.next ? ` · ${compactCount(profile.level.toNext)} to ${profile.level.next}` : ""}`));
  const bar = el("div", "ad-progress community-progress");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Progress to the next level");
  bar.setAttribute("aria-valuenow", String(Math.round(profile.level.progress * 100)));
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const fill = el("span", "community-progress-fill");
  fill.style.setProperty("--progress", String(Math.max(0.02, profile.level.progress)));
  bar.append(fill);
  const totals = el("div", "community-card-meta");
  totals.append(
    stat("installs", compactCount(profile.totals.installs)), stat(profile.totals.stars === 1 ? "star" : "stars", compactCount(profile.totals.stars)), stat("remixes", compactCount(profile.totals.remixes)),
    stat("improvements accepted", compactCount(profile.totals.acceptedImprovements)), stat("day streak", compactCount(profile.totals.streakDays)),
  );
  const badges = el("ul", "community-badges");
  badges.dataset["stagger"] = entering ? "true" : "false";
  for (const badge of profile.badges) {
    const item = el("li", badge.earned ? "community-badge community-badge-earned" : "community-badge");
    item.title = badge.detail;
    item.style.setProperty("--i", String(badges.childElementCount));
    item.append(el("strong", "", badge.name), el("span", "", badge.earned ? "Earned" : badge.detail));
    badges.append(item);
  }
  card.append(level, bar, totals, badges);
  return card;
}

export function activityList(items: readonly ActivityItem[], empty: string): HTMLElement {
  if (items.length === 0) return el("p", "community-empty", empty);
  const node = el("ul", "community-activity");
  for (const item of items.slice(0, 20)) {
    const row = el("li", item.read ? "" : "community-unread");
    row.append(el("span", "", item.text), el("time", "community-card-by", timeAgo(item.at, Date.now())));
    node.append(row);
  }
  return node;
}

/** Which page an activity item belongs to. Badges and featuring are about the person, so both. */
export function activityFor(page: "plugins" | "artifacts", item: ActivityItem): boolean {
  if (item.kind === "badge.earned" || item.kind === "featured") return true;
  return page === "plugins" ? item.kind.startsWith("plugin.") : item.kind.startsWith("artifact.") || item.kind.startsWith("improvement.");
}

/** The signed-out state, said in place rather than as an error. */
export function signedOutBox(text: string, signIn: () => void): HTMLElement {
  const box = el("div", "community-empty");
  box.append(el("p", "", text), button("Sign in", "ad-btn ad-btn-primary", signIn));
  return box;
}

/* ---------- progress ---------- */

const progressWatchers = new Map<string, Set<(progress: CommunityProgressView) => void>>();
let progressSubscribed = false;

/** Follow one download or install by its key ("install:usage-meter", "remix:<id>"). */
export function watchProgress(key: string, listener: (progress: CommunityProgressView) => void): () => void {
  if (!progressSubscribed) {
    progressSubscribed = true;
    window.adcode.community.onProgress((progress) => progressWatchers.get(progress.key)?.forEach((one) => one(progress)));
  }
  const set = progressWatchers.get(key) ?? new Set();
  set.add(listener);
  progressWatchers.set(key, set);
  return () => { set.delete(listener); if (set.size === 0) progressWatchers.delete(key); };
}

const PHASE_WORDS: Readonly<Record<CommunityProgressView["phase"], string>> = { download: "Downloading", install: "Installing", write: "Copying files", done: "Done", failed: "Failed" };

/**
 * A bar that says what is happening: indeterminate while the length is unknown (a download
 * in flight), filling as files are written, full on done. Movement is transform-only and
 * stops under reduced motion, where the words alone carry it.
 */
export function progressBar(label: string): { readonly element: HTMLElement; update(progress: CommunityProgressView): void; complete(): Promise<void> } {
  const element = el("span", "community-progress-pill");
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "100");
  const words = el("span", "community-progress-label", label);
  const track = el("span", "community-progress-track");
  const bar = el("span", "community-progress-bar");
  track.append(bar);
  element.append(words, track);
  element.dataset["indeterminate"] = "true";
  element.setAttribute("aria-label", label);
  let shownAt = performance.now();
  const set = (fraction: number | null): void => {
    if (fraction === null) { element.dataset["indeterminate"] = "true"; element.removeAttribute("aria-valuenow"); return; }
    delete element.dataset["indeterminate"];
    bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, fraction))})`;
    element.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
  };
  return {
    element,
    update(progress) {
      const total = progress.total;
      words.textContent = progress.phase === "write" && total > 0 ? `${PHASE_WORDS.write} ${progress.done} of ${total}` : PHASE_WORDS[progress.phase];
      set(progress.phase === "done" ? 1 : total > 0 ? progress.done / total : null);
      if (progress.phase === "download") shownAt = Math.min(shownAt, performance.now());
    },
    /** Fill to the end and hold a beat, so a fast install still reads as done rather than vanishing. */
    async complete() {
      set(1);
      words.textContent = PHASE_WORDS.done;
      const held = performance.now() - shownAt;
      await new Promise((resolve) => setTimeout(resolve, Math.max(220, 520 - held)));
    },
  };
}
