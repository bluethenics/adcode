/**
 * The Community page: ADCode's public plugin directory, project artifacts, the plugin Studio
 * and your creator profile.
 *
 * Five tabs, one job each:
 *
 * - Discover - what is featured and rising this week, and three doors: build a plugin, share
 *   this project, find a project that wants help.
 * - Plugins - the directory, plus what you have installed (on/off, updates, uninstall).
 * - Artifacts - shared projects. Remix one into a folder of your own, improve it with your AI,
 *   and send the improvement back; or share the open project and review what comes in.
 * - Studio - write a plugin: from a template, from any built-in feature ("edit any feature"),
 *   or by asking the assistant. Try it locally, then publish. Selling plugins is coming soon;
 *   the waitlist is open.
 * - You - level, badges, streak, activity, your improvement inbox, and what you published.
 *
 * State lives in the main process and the community service; this page renders it and sends
 * actions, keeping no copy that could disagree.
 */
import {
  PLUGIN_CATEGORIES, blankManifest, changeStats, checkPluginManifest, compactCount, describeContributions,
  draftFromPlugin, formatManifest, lineDiff, nextVersion, timeAgo,
  type ArtifactChange, type ArtifactListing, type ImprovementDetail, type ImprovementSummary, type ListingSort, type PluginListing,
  type RemixableFeature,
} from "@adcode/community";
import type {
  ArtifactDetail, CommunityHome, CommunityMe, InstalledPluginView, PluginDetail, ProjectLinkView,
} from "../../shared/community.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { createIcon, ICON, iconButton } from "../workbench/icons.ts";
import { indexForStagger, markFor } from "../motionFlip.ts";
import {
  CONTRIBUTION_LABELS, addContribution, aiBuildPrompt, featureDraftText, formatBytes, installSummary, type ContributionKind,
} from "./communityModel.ts";

export type CommunityTab = "discover" | "plugins" | "artifacts" | "studio" | "you";

export interface CommunityPageDeps {
  readonly notify: (message: string) => void;
  readonly openFolder: (root: string) => Promise<void>;
  /** Send a request to the assistant now. */
  readonly askAssistant: (prompt: string) => void;
  readonly features: () => readonly RemixableFeature[];
  readonly builtInSlash: () => readonly string[];
  readonly signIn: () => void;
  /** Unread activity, for the badge on the page's navigation entry. */
  readonly onUnread: (count: number) => void;
}

export interface CommunityPage {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  showTab(tab: CommunityTab): void;
  /** Open the Studio with this manifest text, or a fresh draft. */
  openStudio(text?: string): void;
  /** Open the Studio on a copy of a built-in feature. */
  remixFeature(featureId: string): void;
  shareProject(): void;
  /** Check for unread activity without opening the page. */
  poll(): Promise<void>;
}

const TABS: readonly { readonly id: CommunityTab; readonly label: string }[] = [
  { id: "discover", label: "Discover" },
  { id: "plugins", label: "Plugins" },
  { id: "artifacts", label: "Artifacts" },
  { id: "studio", label: "Studio" },
  { id: "you", label: "You" },
];

const SORTS: readonly { readonly id: ListingSort; readonly label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Most used" },
];

const STUDIO_DRAFT = "adcode.community.studioDraft";

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback;
}

const plural = (count: number, one: string, many = `${one}s`): string => `${compactCount(count)} ${count === 1 ? one : many}`;

function stat(label: string, value: string): HTMLElement {
  const node = el("span", "community-stat");
  node.append(el("strong", "", value), document.createTextNode(` ${label}`));
  return node;
}

function chip(text: string, className = "community-chip"): HTMLElement {
  return el("span", className, text);
}

/** A plugin's tile: the first letter of its name on a keycap. Every plugin gets one, so none shouts. */
function monogram(name: string): HTMLElement {
  const letter = [...name.trim()].find((char) => /[\p{L}\p{N}]/u.test(char)) ?? "P";
  const tile = el("span", "community-monogram", letter.toUpperCase());
  tile.setAttribute("aria-hidden", "true");
  return tile;
}

/** Replace an element with another, keeping keyboard focus where the person had it. */
function swapIn(old: HTMLElement, next: HTMLElement): void {
  const focused = old.contains(document.activeElement);
  old.replaceWith(next);
  if (focused) next.focus({ preventScroll: true });
}

export function createCommunityPage(deps: CommunityPageDeps): CommunityPage {
  const element = el("section", "community-page");
  element.setAttribute("aria-label", "Community");

  /* ---------- header and tabs ---------- */

  const header = el("header", "community-header");
  const heading = el("div", "community-heading");
  const title = el("h1", "community-title", "Community");
  const summary = el("p", "community-summary", "Plugins and projects made by people who use ADCode");
  heading.append(title, summary);
  const headerActions = el("div", "community-header-actions");
  const searchField = el("label", "ad-search community-search");
  const search = el("input", "");
  searchField.append(createIcon(ICON.search), search);
  search.type = "search";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search plugins and artifacts");
  const creatorChip = el("button", "community-creator-chip");
  creatorChip.type = "button";
  creatorChip.hidden = true;
  creatorChip.addEventListener("click", () => showTab("you"));
  headerActions.append(searchField, creatorChip);
  header.append(heading, headerActions);

  const tabList = el("div", "ad-tabs community-tabs");
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Community sections");
  const tabButtons = new Map<CommunityTab, HTMLButtonElement>();
  const panels = new Map<CommunityTab, HTMLElement>();
  for (const tab of TABS) {
    const control = el("button", "ad-tab community-tab", tab.label);
    control.type = "button";
    control.id = `community-tab-${tab.id}`;
    control.setAttribute("role", "tab");
    control.setAttribute("aria-controls", `community-panel-${tab.id}`);
    control.addEventListener("click", () => showTab(tab.id));
    tabButtons.set(tab.id, control);
    tabList.append(control);
    const panel = el("div", "community-panel");
    panel.id = `community-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", control.id);
    panel.hidden = true;
    panels.set(tab.id, panel);
  }
  tabList.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = TABS.findIndex((tab) => tab.id === current);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length]!;
    showTab(next.id);
    tabButtons.get(next.id)?.focus();
    event.preventDefault();
  });
  const youBadge = el("span", "community-tab-badge");
  youBadge.hidden = true;
  tabButtons.get("you")!.append(youBadge);

  const notice = el("p", "community-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  element.append(header, tabList, notice, ...panels.values());

  let current: CommunityTab = "discover";
  /** True while a tab paints for the first time since it was opened: the one time its cards animate in. */
  let entering = false;
  const entered = new Set<CommunityTab>();
  let visible = false;
  let installed: readonly InstalledPluginView[] = [];
  let me: CommunityMe | null = null;
  let signedOut = false;

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
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Run an action, reporting failure on the page rather than throwing into nowhere. */
  async function attempt<T>(run: () => Promise<T>, fallback: string): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      const message = errorText(error, fallback);
      say(message, "error");
      if (/sign in/i.test(message)) signedOut = true;
      return null;
    }
  }

  function loading(panel: HTMLElement, text = "Loading"): void {
    panel.replaceChildren(el("p", "community-empty", text));
  }

  function offline(panel: HTMLElement, message: string, retry: () => void): void {
    const box = el("div", "community-empty");
    box.append(el("p", "", message), button("Try again", "ad-btn", retry));
    panel.replaceChildren(box);
  }

  function showTab(tab: CommunityTab): void {
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
    if (visible) void render(tab);
  }

  async function render(tab: CommunityTab): Promise<void> {
    entering = !entered.has(tab);
    entered.add(tab);
    try { await renderTab(tab); } finally { entering = false; }
  }

  async function renderTab(tab: CommunityTab): Promise<void> {
    if (tab === "discover") await renderDiscover();
    else if (tab === "plugins") await renderPlugins();
    else if (tab === "artifacts") await renderArtifacts();
    else if (tab === "studio") renderStudio();
    else await renderYou();
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (current !== "plugins" && current !== "artifacts") showTab(search.value.trim() ? "plugins" : current);
      else void render(current);
    }, 250);
  });

  /* ---------- cards ---------- */

  function pluginCard(plugin: PluginListing): HTMLElement {
    const card = el("article", "community-card community-plugin-card");
    const top = el("div", "community-card-top");
    const icon = monogram(plugin.name);
    const names = el("div", "community-card-names");
    const open = button(plugin.name, "community-card-title", () => void openPlugin(plugin.id));
    names.append(open, el("span", "community-card-by", `by ${plugin.ownerName}`));
    top.append(icon, names);
    if (plugin.featured) top.append(chip("Featured", "community-chip community-chip-featured"));
    const description = el("p", "community-card-text", plugin.description);
    const meta = el("div", "community-card-meta");
    meta.append(stat(plugin.installs === 1 ? "install" : "installs", compactCount(plugin.installs)), stat(plugin.stars === 1 ? "star" : "stars", compactCount(plugin.stars)));
    if (plugin.installsWeek > 0) meta.append(el("span", "community-rising", `+${compactCount(plugin.installsWeek)} this week`));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", plugin.contributes));
    const mine = installed.find((one) => one.manifest.id === plugin.id);
    if (mine === undefined) {
      const control = button("Install", "ad-btn ad-btn-primary community-install", () => void install(plugin.id, plugin.name, control));
      foot.append(control);
    } else foot.append(installedMark(mine.update !== null ? "Update available" : "Installed", false));
    card.append(top, description, meta, foot);
    return card;
  }

  function installedMark(text: string, fresh: boolean): HTMLElement {
    const mark = el("span", "community-installed-mark");
    mark.tabIndex = -1;
    if (fresh) mark.dataset["fresh"] = "true";
    mark.append(createIcon(ICON.check), document.createTextNode(text));
    return mark;
  }

  function artifactCard(artifact: ArtifactListing): HTMLElement {
    const card = el("article", "community-card community-artifact-card");
    const top = el("div", "community-card-top");
    const names = el("div", "community-card-names");
    names.append(button(artifact.title, "community-card-title", () => void openArtifact(artifact.id)), el("span", "community-card-by", `by ${artifact.ownerName} · v${artifact.version} · ${timeAgo(artifact.updatedAt, Date.now())}`));
    top.append(names);
    card.append(top, el("p", "community-card-text", artifact.description));
    if (artifact.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Help wanted: "), document.createTextNode(artifact.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat(artifact.remixes === 1 ? "remix" : "remixes", compactCount(artifact.remixes)), stat(artifact.stars === 1 ? "star" : "stars", compactCount(artifact.stars)), stat(artifact.contributors === 1 ? "contributor" : "contributors", compactCount(artifact.contributors)));
    for (const tag of artifact.tags.slice(0, 3)) meta.append(chip(tag));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", `${plural(artifact.fileCount, "file")} · ${formatBytes(artifact.bytes)}`), button("Remix", "ad-btn ad-btn-primary", () => void remix(artifact.id, artifact.title)));
    card.append(meta, foot);
    return card;
  }

  /**
   * A grid of cards. On a tab's first paint for this visit the cards rise in with a short
   * stagger; re-renders from typing in search or changing a sort do not animate, because
   * motion on something done many times a minute is noise (Emil Kowalski, remove-animations).
   */
  function grid(items: readonly HTMLElement[], empty: string): HTMLElement {
    if (items.length === 0) return el("p", "community-empty", empty);
    const list = el("div", "community-grid");
    list.append(...items);
    if (entering) {
      list.dataset["stagger"] = "true";
      indexForStagger(list);
    }
    return list;
  }

  function section(titleText: string, note: string, body: HTMLElement, action?: HTMLElement): HTMLElement {
    const wrap = el("section", "community-section");
    const head = el("div", "community-section-head");
    const words = el("div", "");
    words.append(el("h2", "community-section-title", titleText), el("p", "community-section-note", note));
    head.append(words);
    if (action !== undefined) head.append(action);
    wrap.append(head, body);
    return wrap;
  }

  /* ---------- Discover ---------- */

  async function renderDiscover(): Promise<void> {
    const panel = panels.get("discover")!;
    if (panel.childElementCount === 0) loading(panel);
    const home = await attempt<CommunityHome>(() => window.adcode.community.home(), "The community could not be reached.");
    if (home === null) { offline(panel, "The community could not be reached. Check your connection.", () => void renderDiscover()); return; }
    summary.textContent = `${plural(home.totals.plugins, "plugin")} · ${plural(home.totals.artifacts, "artifact")} · ${plural(home.totals.creators, "creator")} · ${plural(home.totals.installs, "install")}`;

    const doors = el("div", "community-doors");
    const door = (iconPath: string, name: string, text: string, run: () => void): HTMLElement => {
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
    };
    doors.append(
      door(ICON.edit, "Build a plugin", "Add AI actions, chat commands, skills or a theme - or remix any built-in feature.", () => showTab("studio")),
      door(ICON.projects, "Share this project", "Publish the open project so others can remix it and send you improvements.", () => shareProject()),
      door(ICON.checklist, "Help someone", "Pick a project that asks for help, improve it with your AI, send it back.", () => { helpOnly = true; showTab("artifacts"); }),
    );

    panel.replaceChildren(
      doors,
      section("Featured this week", "Picked by installs, stars and remixes in the last 7 days", el("div", "community-featured")),
      section("Trending plugins", "Rising this week, counted once per person", grid(home.trendingPlugins.map(pluginCard), "No plugins yet. Build the first one in the Studio"), button("All plugins", "ad-btn", () => showTab("plugins"))),
      section("Help wanted", "Owners asked for a hand. An accepted improvement is worth 20 points", grid(home.helpWanted.map(artifactCard), "Nobody is asking for help right now"), button("All artifacts", "ad-btn", () => showTab("artifacts"))),
      section("Trending artifacts", "Projects people are remixing", grid(home.trendingArtifacts.map(artifactCard), "No shared projects yet")),
    );
    const featured = panel.querySelector(".community-featured")!;
    featured.replaceWith(grid(home.featured.map((plugin) => pluginCard({ ...plugin, featured: true })), "Nothing featured yet"));
  }

  /* ---------- Plugins ---------- */

  let pluginSort: ListingSort = "trending";
  let pluginCategory: string | null = null;

  async function renderPlugins(): Promise<void> {
    const panel = panels.get("plugins")!;
    if (panel.childElementCount === 0) loading(panel);
    installed = await attempt(() => window.adcode.community.installed(), "Could not read installed plugins.") ?? installed;

    const bar = el("div", "community-bar");
    const sort = el("select", "ad-select community-sort");
    sort.setAttribute("aria-label", "Sort plugins");
    for (const option of SORTS) sort.append(new Option(option.label, option.id, false, option.id === pluginSort));
    sort.addEventListener("change", () => { pluginSort = sort.value as ListingSort; void renderPlugins(); });
    const categories = el("div", "community-categories");
    categories.setAttribute("role", "group");
    categories.setAttribute("aria-label", "Category");
    for (const category of [{ id: null, label: "All" }, ...PLUGIN_CATEGORIES]) {
      const control = button(category.label, "community-category", () => { pluginCategory = category.id; void renderPlugins(); });
      control.setAttribute("aria-pressed", String(pluginCategory === category.id));
      categories.append(control);
    }
    bar.append(categories, sort);

    const listings = await attempt(() => window.adcode.community.plugins(pluginSort, search.value.trim(), pluginCategory), "The directory could not be reached.");
    const parts: HTMLElement[] = [];
    if (installed.length > 0) parts.push(section("Installed", "Changes apply at once. Turning a plugin off puts back the settings it changed", installedList(), button("Check for updates", "ad-btn", () => void checkUpdates())));
    parts.push(bar);
    if (listings === null) parts.push(el("p", "community-empty", "The directory could not be reached. Your installed plugins still work."));
    else parts.push(grid(listings.map(pluginCard), search.value.trim() ? `No plugins match "${search.value.trim()}". Build it yourself in the Studio?` : "No plugins in this category yet"));
    panel.replaceChildren(...parts);
  }

  function installedList(): HTMLElement {
    const list = el("ul", "community-installed");
    for (const plugin of installed) {
      const row = el("li", "community-installed-row");
      row.append(monogram(plugin.manifest.name));
      const names = el("div", "community-card-names");
      names.append(
        button(plugin.manifest.name, "community-card-title", () => void (plugin.source === "directory" ? openPlugin(plugin.manifest.id) : openStudio(formatManifest(plugin.manifest)))),
        el("span", "community-card-by", `v${plugin.manifest.version} · ${describeContributions(plugin.manifest.contributes)}${plugin.source === "local" ? " · tried from the Studio" : ""}`),
      );
      const actions = el("div", "community-row-actions");
      if (plugin.update !== null) actions.append(button(`Update to ${plugin.update}`, "ad-btn ad-btn-primary", () => void install(plugin.manifest.id, plugin.manifest.name)));
      const toggle = el("label", "ad-switch");
      const input = el("input", "");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = plugin.enabled;
      input.setAttribute("aria-label", `${plugin.manifest.name} on`);
      input.addEventListener("change", () => void attempt(async () => {
        installed = await window.adcode.community.setEnabled(plugin.manifest.id, input.checked);
        say(`${plugin.manifest.name} is ${input.checked ? "on" : "off"}.`);
      }, "Could not change that plugin."));
      toggle.append(input);
      actions.append(toggle, button("Uninstall", "ad-btn", () => void uninstall(plugin)));
      row.append(names, actions);
      list.append(row);
    }
    return list;
  }

  async function checkUpdates(): Promise<void> {
    const result = await attempt(() => window.adcode.community.checkUpdates(), "Could not check for updates.");
    if (result === null) return;
    installed = result;
    const count = result.filter((one) => one.update !== null).length;
    say(count === 0 ? "Every installed plugin is up to date." : `${plural(count, "update")} available.`);
    if (current === "plugins") void renderPlugins();
  }

  async function install(id: string, name: string, from?: HTMLButtonElement): Promise<void> {
    const detail = await attempt(() => window.adcode.community.plugin(id), "That plugin could not be loaded.");
    if (detail === null) return;
    const lines = installSummary(detail.manifest);
    const ok = await askThemed({ title: `Install ${name}?`, body: `It will add:\n• ${lines.join("\n• ")}\n\nPlugins are prompts, skills, colours and setting values - never programs. You can turn it off or uninstall it any time.`, confirmLabel: "Install" });
    if (!ok) return;
    if (from !== undefined) { from.disabled = true; from.textContent = "Installing"; from.dataset["busy"] = "true"; }
    const result = await attempt(() => window.adcode.community.install(id), "That plugin could not be installed.");
    if (result === null) {
      if (from !== undefined) { from.disabled = false; from.textContent = "Install"; delete from.dataset["busy"]; }
      return;
    }
    installed = result;
    if (from !== undefined && from.isConnected) {
      swapIn(from, installedMark("Installed", true));
      say(`${name} installed`);
      return;
    }
    say(`${name} installed. ${detail.manifest.contributes.actions.length > 0 ? "Its actions are in the command palette (Ctrl+Shift+P)." : detail.manifest.contributes.slashCommands.length > 0 ? "Type / in the chat to use its commands." : ""}`.trim());
    void render(current);
  }

  async function uninstall(plugin: InstalledPluginView): Promise<void> {
    const ok = await askThemed({ title: `Uninstall ${plugin.manifest.name}?`, body: "Its commands, skills and theme are removed, and any settings it changed are put back.", confirmLabel: "Uninstall", danger: true });
    if (!ok) return;
    const result = await attempt(() => window.adcode.community.uninstall(plugin.manifest.id), "That plugin could not be uninstalled.");
    if (result === null) return;
    installed = result;
    say(`${plugin.manifest.name} uninstalled.`);
    void render(current);
  }

  async function openPlugin(id: string): Promise<void> {
    const detail = await attempt<PluginDetail>(() => window.adcode.community.plugin(id), "That plugin could not be loaded.");
    if (detail === null) return;
    const { dialog, card, title: titleNode, finish } = openFormModal("community-detail", detail.name, () => undefined);
    const headRow = el("div", "community-dialog-head");
    const close = iconButton("Close", ICON.close, "ad-icon-btn");
    close.addEventListener("click", finish);
    headRow.append(titleNode, close);
    card.prepend(headRow);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · v${detail.version} · updated ${timeAgo(detail.updatedAt, Date.now())}${detail.remixOf ? ` · remix of ${detail.remixOf.replace(/^(plugin|feature):/, "")}` : ""}`));
    card.append(el("p", "result-summary", detail.description));
    const meta = el("div", "community-card-meta");
    meta.append(stat("installs", compactCount(detail.installs)), stat("remixes", compactCount(detail.remixes)));
    card.append(meta);
    const adds = el("ul", "community-adds");
    for (const line of installSummary(detail.manifest)) adds.append(el("li", "", line));
    card.append(el("h3", "community-dialog-subtitle", "What it adds"), adds);
    if (detail.manifest.readme) card.append(el("h3", "community-dialog-subtitle", "Read me"), el("pre", "community-readme", detail.manifest.readme));
    if (detail.versions.length > 1) {
      const versions = el("ul", "community-versions");
      for (const version of detail.versions.slice(0, 6)) versions.append(el("li", "", `${version.version} · ${timeAgo(version.at, Date.now())}${version.notes ? ` - ${version.notes}` : ""}`));
      card.append(el("h3", "community-dialog-subtitle", "Versions"), versions);
    }
    const buttons = el("div", "confirm-buttons community-dialog-actions");
    const star = starButton("plugin", detail.id, detail.starred, detail.stars);
    buttons.append(
      star,
      button("Report", "ad-btn", () => { finish(); void report("plugin", detail.id, detail.name); }),
      button("Remix in Studio", "ad-btn", () => { finish(); openStudio(formatManifest(draftFromPlugin(detail.manifest, `${detail.name} remix`))); }),
    );
    const mine = installed.find((one) => one.manifest.id === detail.id);
    if (mine === undefined || mine.update !== null) buttons.append(button(mine === undefined ? "Install" : `Update to ${detail.version}`, "result-close", () => { finish(); void install(detail.id, detail.name); }));
    else buttons.append(button("Uninstall", "result-close", () => { finish(); void uninstall(mine); }));
    card.append(buttons);
    dialog.showModal();
  }

  /** Star with its count. The count ticks the moment it is pressed, and settles to the server's answer. */
  function starButton(kind: "plugin" | "artifact", id: string, starred: boolean, stars: number): HTMLButtonElement {
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

  async function report(kind: "plugin" | "artifact", id: string, name: string): Promise<void> {
    const { dialog, card, finish } = openFormModal("community-report", `Report ${name}`, () => undefined);
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
      void attempt(async () => { await window.adcode.community.report(kind, id, reason.value); finish(); say("Thanks. The report was sent."); }, "The report could not be sent.");
    });
    card.append(form);
    dialog.showModal();
    reason.focus();
  }

  /* ---------- Artifacts ---------- */

  let artifactSort: ListingSort = "trending";
  let helpOnly = false;

  async function renderArtifacts(): Promise<void> {
    const panel = panels.get("artifacts")!;
    if (panel.childElementCount === 0) loading(panel);
    const link = await attempt<ProjectLinkView>(() => window.adcode.community.projectLink(), "Could not read the open project.");
    const parts: HTMLElement[] = [projectBanner(link)];
    const bar = el("div", "community-bar");
    const sort = el("select", "ad-select community-sort");
    sort.setAttribute("aria-label", "Sort artifacts");
    for (const option of SORTS) sort.append(new Option(option.id === "top" ? "Most remixed" : option.label, option.id, false, option.id === artifactSort));
    sort.addEventListener("change", () => { artifactSort = sort.value as ListingSort; void renderArtifacts(); });
    const help = button("Help wanted only", "community-category", () => { helpOnly = !helpOnly; void renderArtifacts(); });
    help.setAttribute("aria-pressed", String(helpOnly));
    bar.append(el("p", "community-section-note", "Remix a project into a folder of your own. Improve it with your AI, then send the improvement back - the owner reviews it file by file."), help, sort);
    parts.push(bar);
    const listings = await attempt(() => window.adcode.community.artifacts(artifactSort, search.value.trim(), helpOnly), "The community could not be reached.");
    parts.push(listings === null ? el("p", "community-empty", "The community could not be reached.") : grid(listings.map(artifactCard), helpOnly ? "Nobody is asking for help right now" : "No shared projects yet"));
    panel.replaceChildren(...parts);
  }

  /** What the open project is to the community: unshared, yours, or a remix with changes to send. */
  function projectBanner(link: ProjectLinkView | null): HTMLElement {
    const banner = el("div", "community-banner");
    if (link === null || link.root === null) {
      banner.append(el("p", "", "Open a project to share it, or remix one below."));
      return banner;
    }
    const changed = link.changes.length;
    const behind = link.link !== null && link.latestVersion !== null && link.latestVersion > link.link.version;
    if (link.link === null) {
      banner.append(el("p", "", "This project is not shared yet. Share it and anyone on ADCode can remix it and send you improvements."), button("Share this project", "ad-btn ad-btn-primary", () => shareProject()));
    } else if (link.link.role === "owner") {
      const words = el("p", "");
      words.append(el("strong", "", link.link.title), document.createTextNode(` · you share this as version ${link.link.version}. ${changed === 0 ? "No local changes since." : `${plural(changed, "file")} changed since.`}${behind ? ` Version ${link.latestVersion} has accepted improvements.` : ""}`));
      banner.append(words);
      const actions = el("div", "community-row-actions");
      if (behind) actions.append(button(`Get version ${link.latestVersion}`, "ad-btn ad-btn-primary", () => void pullLatest()));
      actions.append(button(changed > 0 ? "Publish new version" : "Edit listing", changed > 0 && !behind ? "ad-btn ad-btn-primary" : "ad-btn", () => shareProject()));
      actions.append(button("Open", "ad-btn", () => void openArtifact(link.link!.artifactId)));
      banner.append(actions);
    } else {
      const words = el("p", "");
      words.append(document.createTextNode("Remix of "), el("strong", "", link.link.title), document.createTextNode(` v${link.link.version}. ${changed === 0 ? "Change something, then send it back as an improvement." : `${plural(changed, "file")} changed - ready to send.`}${behind ? ` The original is at version ${link.latestVersion}.` : ""}`));
      banner.append(words);
      const actions = el("div", "community-row-actions");
      if (behind) actions.append(button("Get latest", "ad-btn", () => void pullLatest()));
      const send = button("Send improvement", "ad-btn ad-btn-primary", () => sendImprovement(link));
      send.disabled = changed === 0;
      actions.append(send, button("Share as my own", "ad-btn", () => shareProject()));
      banner.append(actions);
    }
    return banner;
  }

  async function pullLatest(): Promise<void> {
    const result = await attempt(() => window.adcode.community.pullLatest(), "Could not get the latest version.");
    if (result === null) return;
    say(result.conflicts.length === 0
      ? `Updated to version ${result.version}: ${plural(result.applied, "file")} changed.`
      : `Updated to version ${result.version}. ${plural(result.conflicts.length, "file")} you edited locally were left alone: ${result.conflicts.slice(0, 4).join(", ")}.`);
    void renderArtifacts();
  }

  async function remix(id: string, name: string): Promise<void> {
    const ok = await askThemed({ title: `Remix ${name}?`, body: "ADCode copies the latest version into a new folder in Documents › ADCode Projects and opens it. Change anything; when you are happy, send your improvement back from the Artifacts tab.", confirmLabel: "Remix" });
    if (!ok) return;
    const root = await attempt(() => window.adcode.community.remix(id), "That artifact could not be remixed.");
    if (root === null) return;
    say(`Remixed into ${root}.`);
    await deps.openFolder(root);
  }

  async function openArtifact(id: string): Promise<void> {
    const detail = await attempt<ArtifactDetail>(() => window.adcode.community.artifact(id), "That artifact could not be loaded.");
    if (detail === null) return;
    const { dialog, card, title: titleNode, finish } = openFormModal("community-detail", detail.title, () => undefined);
    const headRow = el("div", "community-dialog-head");
    const close = iconButton("Close", ICON.close, "ad-icon-btn");
    close.addEventListener("click", finish);
    headRow.append(titleNode, close);
    card.prepend(headRow);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · version ${detail.version} · ${plural(detail.fileCount, "file")} · ${formatBytes(detail.bytes)}`));
    card.append(el("p", "result-summary", detail.description));
    if (detail.helpWanted) {
      const help = el("p", "community-help-wanted");
      help.append(el("strong", "", "Help wanted: "), document.createTextNode(detail.helpWanted));
      card.append(help);
    }
    const meta = el("div", "community-card-meta");
    meta.append(stat("remixes", compactCount(detail.remixes)), stat("improvements", compactCount(detail.improvements)));
    card.append(meta);
    if (detail.contributorNames.length > 0) card.append(el("p", "community-card-by", `Improved by ${detail.contributorNames.join(", ")}`));
    if (detail.readme) card.append(el("h3", "community-dialog-subtitle", "Read me"), el("pre", "community-readme", detail.readme));
    const files = el("details", "community-files");
    files.append(el("summary", "", plural(detail.paths.length, "file")));
    const list = el("ul", "");
    for (const path of detail.paths.slice(0, 300)) list.append(el("li", "", path));
    files.append(list);
    card.append(files);
    if (detail.versions.length > 0) {
      const versions = el("ul", "community-versions");
      for (const version of detail.versions.slice(0, 8)) versions.append(el("li", "", `v${version.version} · ${version.authorName} · ${timeAgo(version.at, Date.now())} - ${version.message}`));
      card.append(el("h3", "community-dialog-subtitle", "History"), versions);
    }
    const buttons = el("div", "confirm-buttons community-dialog-actions");
    const star = starButton("artifact", detail.id, detail.starred, detail.stars);
    buttons.append(star, button("Report", "ad-btn", () => { finish(); void report("artifact", detail.id, detail.title); }), button("Remix", "result-close", () => { finish(); void remix(detail.id, detail.title); }));
    card.append(buttons);
    dialog.showModal();
  }

  function shareProject(): void {
    void (async () => {
      const preview = await attempt(() => window.adcode.community.previewArtifact(), "Open a project folder first.");
      if (preview === null) return;
      const owned = preview.link?.role === "owner";
      const { dialog, card, finish } = openFormModal("community-share", owned ? `Publish a new version of ${preview.link!.title}` : `Share ${preview.name}`, () => undefined);
      card.append(el("p", "result-summary", `${plural(preview.files, "file")} · ${formatBytes(preview.bytes)} will be public. Anyone signed in to ADCode can remix it.`));
      if (preview.skipped.length > 0) {
        const skipped = el("details", "community-files");
        skipped.append(el("summary", "", "What stays private"));
        const list = el("ul", "");
        for (const one of preview.skipped) list.append(el("li", "", `${compactCount(one.count)} × ${one.reason}`));
        skipped.append(list);
        card.append(skipped);
      }
      const form = el("form", "form-dialog-form");
      const titleInput = el("input", "form-input");
      titleInput.required = true; titleInput.minLength = 3; titleInput.maxLength = 80;
      titleInput.value = owned ? preview.link!.title : preview.name;
      const description = el("textarea", "form-input");
      description.rows = 3; description.required = true; description.minLength = 10; description.maxLength = 500;
      description.value = preview.readme?.replace(/^#.*\n/, "").trim().slice(0, 300) ?? "";
      const help = el("input", "form-input");
      help.maxLength = 500;
      help.placeholder = "e.g. Add dark mode, write tests, make it work on phones";
      const tags = el("input", "form-input");
      tags.placeholder = "game, beginner, react";
      const message = el("input", "form-input");
      message.maxLength = 300;
      message.placeholder = owned ? "What changed in this version" : "First version";
      form.append(
        field("Title", titleInput),
        field("What is it?", description, "One or two sentences. The README is shown on the page too."),
        field("What would you like help with?", help, "Optional. Projects that ask for help are listed under Help wanted, where people look for something to improve."),
        field("Tags", tags, "Up to 6, separated by commas."),
        field("Note for this version", message),
      );
      const problems = el("ul", "community-problems");
      for (const problem of preview.problems) problems.append(el("li", "", problem));
      if (preview.problems.length > 0) form.append(el("p", "form-notice", "Fix these before sharing:"), problems);
      const error = el("p", "form-notice");
      error.setAttribute("role", "alert");
      error.hidden = true;
      const buttons = el("div", "confirm-buttons");
      const submit = el("button", "result-close", owned ? "Publish version" : "Share publicly");
      submit.type = "submit";
      submit.disabled = preview.problems.length > 0;
      buttons.append(button("Cancel", "confirm-cancel", finish), submit);
      form.append(error, buttons);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Sharing…";
        void (async () => {
          try {
            const detail = await window.adcode.community.publishArtifact({
              title: titleInput.value, description: description.value, helpWanted: help.value, message: message.value,
              tags: tags.value.split(",").map((tag) => tag.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "")).filter(Boolean).slice(0, 6),
            });
            finish();
            say(`${detail.title} is shared as version ${detail.version}. You will see remixes and improvements under You.`);
            showTab("artifacts");
          } catch (failure) {
            error.textContent = errorText(failure, "It could not be shared.");
            error.hidden = false;
            submit.disabled = false;
            submit.textContent = owned ? "Publish version" : "Share publicly";
          }
        })();
      });
      card.append(form);
      dialog.showModal();
      titleInput.focus();
    })();
  }

  function sendImprovement(link: ProjectLinkView): void {
    const { dialog, card, finish } = openFormModal("community-share", `Send an improvement to ${link.link!.title}`, () => undefined);
    const files = el("ul", "community-changes");
    for (const change of link.changes.slice(0, 40)) {
      const row = el("li", "");
      row.append(chip(change.kind, `community-change community-change-${change.kind}`), document.createTextNode(` ${change.path} `), el("span", "community-diffstat", `+${change.added} −${change.removed}`));
      files.append(row);
    }
    card.append(el("p", "result-summary", `${plural(link.changes.length, "file")} changed since version ${link.link!.version}. The owner sees exactly these changes and accepts or declines them.`), files);
    const form = el("form", "form-dialog-form");
    const titleInput = el("input", "form-input");
    titleInput.required = true; titleInput.minLength = 3; titleInput.maxLength = 100;
    titleInput.placeholder = "e.g. Add a delete button to each todo";
    const message = el("textarea", "form-input");
    message.rows = 4; message.maxLength = 4000;
    message.placeholder = "What you changed and why, and how to check it works.";
    const error = el("p", "form-notice");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const submit = el("button", "result-close", "Send improvement");
    submit.type = "submit";
    buttons.append(button("Ask AI to describe it", "ad-btn", () => {
      finish();
      deps.askAssistant(`I changed these files in my remix of "${link.link!.title}": ${link.changes.map((change) => `${change.path} (${change.kind})`).join(", ")}. Read them and write a short title (under 80 characters) and a description for the owner: what changed, why it is better, and how to check it works.`);
    }), button("Cancel", "confirm-cancel", finish), submit);
    form.append(field("Title", titleInput), field("Message to the owner", message), error, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      void (async () => {
        try {
          await window.adcode.community.sendImprovement(titleInput.value, message.value);
          finish();
          say("Improvement sent. You will hear here when the owner decides.");
        } catch (failure) {
          error.textContent = errorText(failure, "It could not be sent.");
          error.hidden = false;
          submit.disabled = false;
        }
      })();
    });
    card.append(form);
    dialog.showModal();
    titleInput.focus();
  }

  function diffView(change: ArtifactChange): HTMLElement {
    const details = el("details", "community-diff");
    const stats = changeStats(change);
    const summaryRow = el("summary", "");
    summaryRow.append(chip(change.kind, `community-change community-change-${change.kind}`), document.createTextNode(` ${change.path} `), el("span", "community-diffstat", `+${stats.added} −${stats.removed}`));
    details.append(summaryRow);
    const pre = el("pre", "community-diff-lines");
    for (const line of lineDiff(change.before, change.after).slice(0, 800)) {
      const row = el("span", `community-diff-${line.kind}`, `${line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : line.kind === "skip" ? "⋯ " : "  "}${line.text}\n`);
      pre.append(row);
    }
    details.append(pre);
    return details;
  }

  async function reviewImprovement(summaryRow: ImprovementSummary, owner: boolean): Promise<void> {
    const detail = await attempt<ImprovementDetail>(() => window.adcode.community.improvement(summaryRow.id), "That improvement could not be loaded.");
    if (detail === null) return;
    const { dialog, card, title: titleNode, finish } = openFormModal("community-review", detail.title, () => undefined);
    const headRow = el("div", "community-dialog-head");
    const close = iconButton("Close", ICON.close, "ad-icon-btn");
    close.addEventListener("click", finish);
    headRow.append(titleNode, close);
    card.prepend(headRow);
    card.append(el("p", "community-card-by", `${detail.authorName} → ${detail.artifactTitle} · from version ${detail.baseVersion} · ${timeAgo(detail.at, Date.now())} · ${detail.status}`));
    if (detail.message) card.append(el("p", "result-summary", detail.message));
    if (detail.conflicts.length > 0) card.append(el("p", "form-notice", `These files changed since this was made: ${detail.conflicts.join(", ")}. "Accept, use theirs" replaces them with the contributor's version.`));
    const diffs = el("div", "community-diffs");
    for (const change of detail.changes) diffs.append(diffView(change));
    if (diffs.firstElementChild instanceof HTMLDetailsElement && detail.changes.length <= 3) diffs.querySelectorAll("details").forEach((one) => { one.open = true; });
    card.append(diffs);
    if (detail.reply) card.append(el("p", "community-card-by", `Owner's reply: ${detail.reply}`));
    if (owner && detail.status === "open") {
      const reply = el("textarea", "form-input");
      reply.rows = 2; reply.maxLength = 2000;
      reply.placeholder = "Say thanks, or why not (optional)";
      card.append(field("Reply", reply));
      const buttons = el("div", "confirm-buttons community-dialog-actions");
      const decide = (accept: boolean, force: boolean) => void attempt(async () => {
        const result = await window.adcode.community.decide(detail.id, accept, reply.value, force);
        finish();
        say(accept ? `Accepted. ${detail.artifactTitle} is at version ${result.mergedVersion}. Use "Get version ${result.mergedVersion}" on the Artifacts tab to bring it into your folder.` : "Declined. The contributor was told.");
        void renderYou();
      }, accept ? "It could not be accepted." : "It could not be declined.");
      buttons.append(button("Ask AI to review it", "ad-btn", () => {
        finish();
        deps.askAssistant(`Review this improvement someone sent to my project "${detail.artifactTitle}". Title: ${detail.title}. Message: ${detail.message || "(none)"}. Changes:\n\n${detail.changes.slice(0, 20).map((change) => `--- ${change.path} (${change.kind})\n${lineDiff(change.before, change.after).filter((line) => line.kind !== "same").slice(0, 120).map((line) => `${line.kind === "add" ? "+" : line.kind === "remove" ? "-" : "…"} ${line.text}`).join("\n")}`).join("\n\n")}\n\nIs it safe and correct? List concerns, most serious first, and say whether you would accept it.`);
      }), button("Decline", "ad-btn", () => decide(false, false)));
      if (detail.conflicts.length > 0) buttons.append(button("Accept, use theirs", "result-close", () => decide(true, true)));
      else buttons.append(button("Accept", "result-close", () => decide(true, false)));
      card.append(buttons);
    }
    dialog.showModal();
  }

  /* ---------- Studio ---------- */

  const studio = el("div", "community-studio");
  const editor = el("textarea", "ad-textarea community-studio-editor");
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Plugin manifest (JSON)");
  const problemsBox = el("div", "community-studio-check");
  problemsBox.setAttribute("aria-live", "polite");
  let studioBuilt = false;

  function saveDraft(): void {
    try { localStorage.setItem(STUDIO_DRAFT, editor.value); } catch { /* Private storage off: the draft lives only in the box. */ }
  }

  let lastVerdict: boolean | null = null;
  function validate(): void {
    const result = checkPluginManifest(editor.value, deps.builtInSlash());
    if (lastVerdict !== null && lastVerdict !== result.ok) markFor(problemsBox, "flip", "true", 300);
    lastVerdict = result.ok;
    problemsBox.dataset["verdict"] = result.ok ? "ok" : "problems";
    problemsBox.replaceChildren();
    if (result.ok) {
      const manifest = result.manifest;
      const preview = el("div", "community-studio-preview");
      const ok = el("p", "community-studio-ok");
      ok.append(createIcon(ICON.check), document.createTextNode("Ready to try or publish"));
      preview.append(ok, el("strong", "", `${manifest.name} ${manifest.version}`), el("p", "community-card-text", manifest.description));
      const adds = el("ul", "community-adds");
      for (const line of installSummary(manifest)) adds.append(el("li", "", line));
      preview.append(adds);
      problemsBox.append(preview);
    } else {
      problemsBox.append(el("p", "community-studio-bad", `${plural(result.problems.length, "thing")} to fix`));
      const list = el("ul", "community-problems");
      for (const problem of result.problems.slice(0, 20)) list.append(el("li", "", problem));
      problemsBox.append(list);
    }
  }

  function buildStudio(): void {
    if (studioBuilt) return;
    studioBuilt = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem(STUDIO_DRAFT); } catch { saved = null; }
    editor.value = saved ?? formatManifest(blankManifest());
    editor.addEventListener("input", () => { saveDraft(); validate(); });
    editor.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.shiftKey) return;
      event.preventDefault();
      editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(new Event("input"));
    });

    const toolbar = el("div", "community-studio-toolbar");
    toolbar.append(button("New", "ad-btn", () => void (async () => {
      if (!await askThemed({ title: "Start a new plugin?", body: "The current draft is replaced.", confirmLabel: "Start over" })) return;
      setStudio(formatManifest(blankManifest()));
    })()));
    const add = el("select", "ad-select");
    add.setAttribute("aria-label", "Add a contribution");
    add.append(new Option("Add…", ""));
    for (const [kind, label] of Object.entries(CONTRIBUTION_LABELS)) add.append(new Option(label, kind));
    add.addEventListener("change", () => {
      const kind = add.value as ContributionKind;
      add.value = "";
      const next = addContribution(editor.value, kind);
      if (next === null) { say("Fix the JSON first - the draft is not valid JSON right now.", "error"); return; }
      setStudio(next);
    });
    const remixSelect = el("select", "ad-select community-studio-remix");
    remixSelect.setAttribute("aria-label", "Start from a built-in feature");
    remixSelect.append(new Option("Remix a built-in feature…", ""));
    remixSelect.addEventListener("focus", () => {
      if (remixSelect.options.length > 1) return;
      for (const feature of deps.features()) remixSelect.append(new Option(feature.title, feature.id));
    });
    remixSelect.addEventListener("change", () => {
      const id = remixSelect.value;
      remixSelect.value = "";
      if (id) remixFeature(id);
    });
    toolbar.append(add, remixSelect,
      button("Load adcode-plugin.json", "ad-btn", () => void attempt(async () => {
        const text = await window.adcode.community.readProjectManifest();
        if (text === null) { say("The open project has no adcode-plugin.json at its root yet."); return; }
        setStudio(text);
        say("Loaded adcode-plugin.json from the project.");
      }, "Could not read the project's plugin file.")),
      button("Save to project", "ad-btn", () => void attempt(async () => {
        const path = await window.adcode.community.writeProjectManifest(editor.value);
        say(`Saved to ${path}.`);
      }, "Open a project folder to save the plugin into it.")),
    );

    const ai = el("form", "community-studio-ai");
    const idea = el("input", "ad-input");
    idea.placeholder = "Describe a plugin: explain errors like a patient teacher";
    idea.setAttribute("aria-label", "Describe the plugin you want");
    const build = el("button", "ad-btn ad-btn-primary", "Build with AI");
    build.type = "submit";
    ai.append(idea, build);
    ai.addEventListener("submit", (event) => {
      event.preventDefault();
      if (idea.value.trim().length < 5) { idea.focus(); return; }
      deps.askAssistant(aiBuildPrompt(idea.value, deps.builtInSlash()));
      say("The assistant is writing adcode-plugin.json in the open project. When it is done, press \"Load adcode-plugin.json\".");
    });

    const actions = el("div", "community-studio-actions");
    actions.append(
      button("Try it here", "ad-btn", () => void attempt(async () => {
        installed = await window.adcode.community.installLocal(editor.value);
        say("Installed on this computer only. Find its actions in the command palette and its commands behind / in the chat.");
      }, "Fix the problems listed first.")),
      button("Publish…", "ad-btn ad-btn-primary", () => publishDraft()),
    );

    const layout = el("div", "community-studio-layout");
    const left = el("div", "community-studio-left");
    left.append(toolbar, editor);
    const right = el("div", "community-studio-right");
    right.append(problemsBox, actions, monetizeCard());
    layout.append(left, right);

    const intro = el("p", "community-section-note", "A plugin is a JSON file of prompts, skills, colours and setting values - never a program, so anyone can install it safely. Start from a template, remix any built-in feature, or describe it and let the assistant write it.");
    studio.append(intro, ai, layout);
    validate();
  }

  function setStudio(text: string): void {
    buildStudio();
    editor.value = text;
    saveDraft();
    validate();
  }

  function renderStudio(): void {
    const panel = panels.get("studio")!;
    buildStudio();
    if (studio.parentElement !== panel) panel.replaceChildren(studio);
  }

  function publishDraft(): void {
    const result = checkPluginManifest(editor.value, deps.builtInSlash());
    if (!result.ok) { say("Fix the problems listed beside the editor first.", "error"); return; }
    const manifest = result.manifest;
    const { dialog, card, finish } = openFormModal("community-share", `Publish ${manifest.name} ${manifest.version}`, () => undefined);
    card.append(el("p", "result-summary", "It goes into the public directory under your name. People who installed an earlier version are told about the update."));
    const form = el("form", "form-dialog-form");
    const notes = el("textarea", "form-input");
    notes.rows = 3; notes.maxLength = 1000;
    notes.placeholder = "What is new in this version";
    const error = el("p", "form-notice");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const submit = el("button", "result-close", "Publish");
    submit.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), submit);
    form.append(field("Release notes", notes), error, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit.disabled = true;
      void (async () => {
        try {
          const detail = await window.adcode.community.publishPlugin(editor.value, notes.value);
          finish();
          say(`${detail.name} ${detail.version} is in the directory.`);
          // The next edit is the next version.
          const parsed = JSON.parse(editor.value) as Record<string, unknown>;
          setStudio(formatManifest({ ...parsed, version: nextVersion(detail.version) }));
        } catch (failure) {
          error.textContent = errorText(failure, "It could not be published.");
          error.hidden = false;
          submit.disabled = false;
        }
      })();
    });
    card.append(form);
    dialog.showModal();
    notes.focus();
  }

  /** Selling plugins is not built yet. This says so plainly and lets creators get in line. */
  function monetizeCard(): HTMLElement {
    const card = el("section", "community-monetize");
    const head = el("div", "community-monetize-head");
    head.append(el("h3", "", "Sell your plugins"), chip("Coming soon", "community-chip community-chip-soon"));
    card.append(head, el("p", "", "Set a price, keep most of every sale, and get paid monthly with your ad earnings. Free plugins stay free; nothing changes for them."));
    const status = el("p", "community-card-by");
    const form = el("form", "community-monetize-form");
    const price = el("input", "ad-input");
    price.type = "number"; price.min = "0"; price.max = "500"; price.step = "0.5";
    price.placeholder = "Your price in $";
    price.setAttribute("aria-label", "Price you would charge, in US dollars");
    const join = el("button", "ad-btn", "Join the waitlist");
    join.type = "submit";
    form.append(price, join);
    const show = (state: CommunityMe["monetization"]): void => {
      status.textContent = state.joined ? `You are #${state.position} of ${compactCount(state.waiting)} creators on the waitlist${state.price !== null ? ` at $${state.price}` : ""}. We will tell you the day it opens.` : `${compactCount(state.waiting)} creators are waiting.`;
      join.textContent = state.joined ? "Update" : "Join the waitlist";
    };
    if (me !== null) show(me.monetization);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void attempt(async () => {
        const value = price.value.trim() === "" ? null : Number(price.value);
        show(await window.adcode.community.waitlist(true, value, ""));
        say("You are on the waitlist for selling plugins.");
      }, "Sign in to join the waitlist.");
    });
    card.append(form, status);
    return card;
  }

  function openStudio(text?: string): void {
    if (text !== undefined) setStudio(text);
    showTab("studio");
  }

  function remixFeature(featureId: string): void {
    const feature = deps.features().find((one) => one.id === featureId);
    if (feature === undefined) { say("That feature has no switches, commands or prompts a plugin can change yet.", "error"); return; }
    openStudio(featureDraftText(feature));
    say(`Started a plugin from "${feature.title}". Change what you like, try it here, then publish your version.`);
  }

  /* ---------- You ---------- */

  async function renderYou(): Promise<void> {
    const panel = panels.get("you")!;
    if (panel.childElementCount === 0) loading(panel);
    // Not through attempt(): signed out is a state this tab shows in place, not an error to
    // leave in the notice line above every other tab.
    let result: CommunityMe | null = null;
    try {
      result = await window.adcode.community.me();
    } catch (error) {
      signedOut = /sign in/i.test(errorText(error, ""));
    }
    if (result === null) {
      const box = el("div", "community-empty");
      box.append(el("p", "", signedOut ? "Sign in to publish plugins, share projects, and see who installed and improved your work." : "Your profile could not be loaded."), button(signedOut ? "Sign in" : "Try again", "ad-btn ad-btn-primary", () => (signedOut ? deps.signIn() : void renderYou())));
      panel.replaceChildren(box);
      return;
    }
    me = result;
    applyUnread(result.unread);
    const { profile } = result;

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

    const open = result.inbox.filter((one) => one.status === "open");
    const improvementRow = (item: ImprovementSummary, owner: boolean): HTMLElement => {
      const row = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(item.title, "community-card-title", () => void reviewImprovement(item, owner)), el("span", "community-card-by", `${owner ? `from ${item.authorName}` : `to ${item.artifactTitle}`} · ${plural(item.files, "file")} · ${timeAgo(item.at, Date.now())}`));
      row.append(names, chip(item.status, `community-chip community-status-${item.status}`));
      return row;
    };
    const list = (items: readonly HTMLElement[], empty: string): HTMLElement => {
      if (items.length === 0) return el("p", "community-empty", empty);
      const node = el("ul", "community-installed");
      node.append(...items);
      return node;
    };

    const activity = el("ul", "community-activity");
    for (const item of result.activity.slice(0, 20)) {
      const row = el("li", item.read ? "" : "community-unread");
      row.append(el("span", "", item.text), el("time", "community-card-by", timeAgo(item.at, Date.now())));
      activity.append(row);
    }

    const mineRow = (name: string, detail: string, openIt: () => void, remove: () => void): HTMLElement => {
      const row = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(button(name, "community-card-title", openIt), el("span", "community-card-by", detail));
      row.append(names, button("Unpublish", "ad-btn", remove));
      return row;
    };
    const plugins = result.plugins.map((plugin) => mineRow(plugin.name, `v${plugin.version} · ${plural(plugin.installs, "install")} · ${plural(plugin.stars, "star")}`, () => void attempt(async () => {
      const detail = await window.adcode.community.plugin(plugin.id);
      openStudio(formatManifest({ ...detail.manifest, version: nextVersion(detail.manifest.version) }));
      say(`Editing ${plugin.name}. Publishing saves it as version ${nextVersion(detail.manifest.version)}.`);
    }, "Could not load it."), () => void (async () => {
      if (!await askThemed({ title: `Unpublish ${plugin.name}?`, body: "It leaves the directory. People who installed it keep their copy, and the id stays yours.", confirmLabel: "Unpublish", danger: true })) return;
      if (await attempt(() => window.adcode.community.removePlugin(plugin.id), "Could not unpublish it.") !== null) { say(`${plugin.name} is unpublished.`); void renderYou(); }
    })()));
    const artifacts = result.artifacts.map((artifact) => mineRow(artifact.title, `v${artifact.version} · ${plural(artifact.remixes, "remix", "remixes")} · ${artifact.openImprovements} waiting`, () => void openArtifact(artifact.id), () => void (async () => {
      if (!await askThemed({ title: `Stop sharing ${artifact.title}?`, body: "It leaves the community. Remixes people already made stay theirs.", confirmLabel: "Stop sharing", danger: true })) return;
      if (await attempt(() => window.adcode.community.removeArtifact(artifact.id), "Could not stop sharing it.") !== null) { say(`${artifact.title} is no longer shared.`); void renderYou(); }
    })()));

    panel.replaceChildren(
      card,
      section(`Improvements for you${open.length > 0 ? ` (${open.length} waiting)` : ""}`, "What people sent to your artifacts, waiting ones first", list(result.inbox.map((item) => improvementRow(item, true)), "Nothing yet. Share a project and say what you need help with")),
      section("Activity", "Installs, stars, remixes, accepted work and badges", result.activity.length === 0 ? el("p", "community-empty", "Nothing yet") : activity),
      section("Improvements you sent", "Their status and the owner's reply", list(result.sent.map((item) => improvementRow(item, false)), "None yet. Help wanted on Discover is a good place to start")),
      section("Your plugins", "Open one to edit it and publish the next version", list(plugins, "No plugins published yet"), button("Open the Studio", "ad-btn", () => showTab("studio"))),
      section("Your artifacts", "Projects you share", list(artifacts, "No projects shared yet"), button("Share this project", "ad-btn", () => shareProject())),
      monetizeCard(),
    );
    if (result.unread > 0) void window.adcode.community.markRead().then(() => applyUnread(0), () => {});
  }

  function applyUnread(count: number): void {
    if (youBadge.hidden && count > 0) markFor(youBadge, "enter", "true", 300);
    youBadge.hidden = count === 0;
    youBadge.textContent = count > 99 ? "99+" : String(count);
    if (me !== null) {
      creatorChip.hidden = false;
      creatorChip.textContent = `${me.profile.level.name} · ${compactCount(me.profile.points)} pts`;
    }
    deps.onUnread(count);
  }

  window.adcode.community.onPluginsChanged((next) => {
    installed = next;
    if (visible && current === "plugins") void renderPlugins();
  });

  showTab("discover");

  return {
    element,
    shown() {
      const first = !visible;
      visible = true;
      if (first) void render(current);
    },
    hidden() { visible = false; entered.clear(); },
    showTab,
    openStudio,
    remixFeature,
    shareProject,
    async poll() {
      try {
        me = await window.adcode.community.me();
        applyUnread(me.unread);
      } catch {
        // Signed out or offline: no badge, and nothing to say about it.
      }
    },
  };
}
