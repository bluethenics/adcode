/**
 * The Plugins page: plugins made by ADCode, the public directory, what you installed, the
 * Studio, and your own plugins.
 *
 * - Discover - three doors (build one, customize a built-in feature, browse add-ons), the
 *   plugins ADCode ships, then the community directory by category.
 * - Installed - on/off, updates, uninstall. Turning one off puts back what it changed.
 * - Studio - write a plugin from a template, from any built-in feature, or by asking the
 *   assistant. Try it here, then publish. Selling plugins is coming soon; the waitlist is open.
 * - Your plugins - your level and badges, what you published, and what happened to it.
 */
import {
  PLUGIN_CATEGORIES, blankManifest, checkPluginManifest, compactCount, describeContributions, draftFromPlugin, formatManifest,
  nextVersion, timeAgo, type CommunityMe, type ListingSort, type PluginListing, type PluginManifest, type RemixableFeature,
} from "@adcode/community";
import type { InstalledPluginView, PluginDetail } from "../../shared/community.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { communityMe } from "./communityMe.ts";
import { button, el, field } from "../dialogs/formDialog.ts";
import { markFor } from "../motionFlip.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import { createComposioAppsView } from "./composioAppsView.ts";
import { CONTRIBUTION_LABELS, addContribution, aiBuildPrompt, featureDraftText, installSummary, type ContributionKind } from "./communityModel.ts";
import {
  activityFor, activityList, chip, createHubShell, detailDialog, door, errorText, installedMark, list, monogram, plural, profileCard,
  progressBar, reportDialog, section, signedOutBox, starButton, stat, swapIn, watchProgress,
} from "./communityShell.ts";

export type PluginsTab = "discover" | "apps" | "installed" | "studio" | "mine";

export interface PluginsPageDeps {
  readonly askAssistant: (prompt: string) => void;
  /** Open the Tools page, where a connector's own tools are switched on and off. */
  readonly openTools: () => void;
  readonly features: () => readonly RemixableFeature[];
  readonly builtInSlash: () => readonly string[];
  readonly signIn: () => void;
  readonly onUnread: (count: number) => void;
  /** A product event for the "Help improve ADCode" counts: a fixed name, never content. */
  readonly track: (event: string) => void;
}

export interface PluginsPage {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  showTab(tab: PluginsTab): void;
  openStudio(text?: string): void;
  remixFeature(featureId: string): void;
  /** Discover, filtered to add-ons. */
  showAddons(): void;
  focusRemixPicker(): void;
  showMonetize(): void;
  poll(): Promise<void>;
}

const SORTS: readonly { readonly id: ListingSort; readonly label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "top", label: "Most used" },
];

const STUDIO_DRAFT = "adcode.community.studioDraft";

export function createPluginsPage(deps: PluginsPageDeps): PluginsPage {
  let installed: readonly InstalledPluginView[] = [];
  let starters: readonly PluginManifest[] = [];
  let me: CommunityMe | null = null;
  let sort: ListingSort = "trending";
  let category: string | null = null;

  const shell = createHubShell<PluginsTab>({
    name: "plugins",
    title: "Plugins",
    summary: "Add AI actions, chat commands, skills, themes and add-ons to ADCode",
    searchLabel: "Search plugins",
    tabs: [
      { id: "discover", label: "Discover" },
      { id: "apps", label: "Apps" },
      { id: "installed", label: "Installed" },
      { id: "studio", label: "Studio" },
      { id: "mine", label: "Your plugins" },
    ],
    render: (tab) => (tab === "discover" ? renderDiscover() : tab === "apps" ? renderApps() : tab === "installed" ? renderInstalled() : tab === "studio" ? renderStudio() : renderMine()),
  });
  const { say, attempt } = shell;
  const apps = createComposioAppsView({ query: () => shell.search.value, askAssistant: deps.askAssistant, say, openTools: deps.openTools });

  function renderApps(): Promise<void> {
    return apps.render(shell.panel("apps"));
  }

  async function refreshInstalled(): Promise<void> {
    installed = await attempt(() => window.adcode.community.installed(), "Could not read installed plugins.") ?? installed;
    shell.setBadge("installed", installed.filter((one) => one.update !== null).length);
  }

  /* ---------- cards ---------- */

  function installControl(id: string, name: string, starter: boolean): HTMLElement {
    const mine = installed.find((one) => one.manifest.id === id);
    if (mine !== undefined) return installedMark(mine.update !== null ? "Update available" : mine.enabled ? "Installed" : "Installed, off", false);
    const control = button("Install", "ad-btn ad-btn-primary community-install", () => void install(id, name, starter, control));
    return control;
  }

  function pluginCard(plugin: PluginListing): HTMLElement {
    const card = el("article", "community-card community-plugin-card");
    const top = el("div", "community-card-top");
    const names = el("div", "community-card-names");
    names.append(button(plugin.name, "community-card-title", () => void openPlugin(plugin.id)), el("span", "community-card-by", `by ${plugin.ownerName}`));
    top.append(monogram(plugin.name), names);
    if (plugin.featured) top.append(chip("Featured", "community-chip community-chip-featured"));
    const meta = el("div", "community-card-meta");
    meta.append(stat(plugin.installs === 1 ? "install" : "installs", compactCount(plugin.installs)), stat(plugin.stars === 1 ? "star" : "stars", compactCount(plugin.stars)));
    if (plugin.installsWeek > 0) meta.append(el("span", "community-rising", `+${compactCount(plugin.installsWeek)} this week`));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", plugin.contributes), installControl(plugin.id, plugin.name, false));
    card.append(top, el("p", "community-card-text", plugin.description), meta, foot);
    return card;
  }

  function starterCard(manifest: PluginManifest): HTMLElement {
    const card = el("article", "community-card community-plugin-card");
    const top = el("div", "community-card-top");
    const names = el("div", "community-card-names");
    names.append(button(manifest.name, "community-card-title", () => openStarter(manifest)), el("span", "community-card-by", "by ADCode"));
    top.append(monogram(manifest.name), names);
    const slots = manifest.contributes.addons.map((addon) => addon.slot === "statusbar" ? "status bar" : addon.slot);
    if (slots.length > 0) top.append(chip(`In the ${[...new Set(slots)].join(", ")}`));
    const foot = el("div", "community-card-foot");
    foot.append(el("span", "community-card-contributes", describeContributions(manifest.contributes)), installControl(manifest.id, manifest.name, true));
    card.append(top, el("p", "community-card-text", manifest.description), foot);
    return card;
  }

  /* ---------- Discover ---------- */

  async function renderDiscover(): Promise<void> {
    const panel = shell.panel("discover");
    shell.loading(panel);
    await refreshInstalled();
    if (starters.length === 0) starters = await attempt(() => window.adcode.community.starters(), "Could not read ADCode's plugins.") ?? [];
    const query = shell.search.value.trim().toLowerCase();
    const matches = (manifest: PluginManifest): boolean => (category === null || manifest.category === category) && (query === "" || `${manifest.name} ${manifest.description} ${manifest.tags.join(" ")}`.toLowerCase().includes(query));

    const doors = el("div", "community-doors");
    doors.append(
      door(ICON.edit, "Build a plugin", "Describe it and the assistant writes it, or start from a template", () => shell.showTab("studio")),
      door(ICON.tool, "Customize a built-in feature", "Make your own version of anything ADCode does, then share it", () => focusRemixPicker()),
      door(ICON.plug, "Connect your apps", "Gmail, Supabase, Cloudflare, GitHub, Slack and more, with one sign-in", () => shell.showTab("apps")),
      door(ICON.plug, "Add-ons", "Small panels for the chat, the sidebar and the status bar", () => showAddons()),
    );

    const bar = el("div", "community-bar");
    const categories = el("div", "community-categories");
    categories.setAttribute("role", "group");
    categories.setAttribute("aria-label", "Category");
    for (const option of [{ id: null, label: "All" }, ...PLUGIN_CATEGORIES]) {
      const control = button(option.label, "community-category", () => { category = option.id; void renderDiscover(); });
      control.setAttribute("aria-pressed", String(category === option.id));
      categories.append(control);
    }
    const sortSelect = el("select", "ad-select community-sort");
    sortSelect.setAttribute("aria-label", "Sort plugins");
    for (const option of SORTS) sortSelect.append(new Option(option.label, option.id, false, option.id === sort));
    sortSelect.addEventListener("change", () => { sort = sortSelect.value as ListingSort; void renderDiscover(); });
    bar.append(categories, sortSelect);

    const listings = await window.adcode.community.plugins(sort, shell.search.value.trim(), category).then((value) => value, () => null);
    const shipped = starters.filter(matches);
    panel.replaceChildren(
      ...(query === "" && category === null ? [doors] : []),
      bar,
      section("Made by ADCode", "Install in one click, no account needed. Open one in the Studio to see how it is built", shell.grid(shipped.map(starterCard), "None of ADCode's plugins match")),
      section("From the community", listings === null ? "" : "Rising this week, counted once per person",
        listings === null ? el("p", "community-empty", "The community directory could not be reached. ADCode's own plugins above still work")
          : shell.grid(listings.map(pluginCard), query ? `No community plugins match "${shell.search.value.trim()}". Build it in the Studio` : "No community plugins here yet. Publish the first one from the Studio")),
    );
  }

  /* ---------- Installed ---------- */

  async function renderInstalled(): Promise<void> {
    const panel = shell.panel("installed");
    shell.loading(panel);
    await refreshInstalled();
    const rows = installed.map((plugin) => {
      const row = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      const source = plugin.source === "starter" ? "by ADCode" : plugin.source === "local" ? "tried from the Studio" : "from the community";
      names.append(
        button(plugin.manifest.name, "community-card-title", () => void (plugin.source === "directory" ? openPlugin(plugin.manifest.id) : openStudio(formatManifest(plugin.manifest)))),
        el("span", "community-card-by", `v${plugin.manifest.version}${plugin.pinned ? " (kept)" : ""} · ${describeContributions(plugin.manifest.contributes)} · ${source}`),
      );
      const actions = el("div", "community-row-actions");
      if (plugin.update !== null) {
        const update = button(`Update to ${plugin.update}`, "ad-btn ad-btn-primary", () => void install(plugin.manifest.id, plugin.manifest.name, plugin.source === "starter", update));
        actions.append(update);
      }
      if (plugin.manifest.options.length > 0) actions.append(button("Settings", "ad-btn ad-btn-tertiary", () => optionsDialog(plugin)));
      if (plugin.source === "directory") actions.append(button("Versions", "ad-btn ad-btn-tertiary", () => void versionsDialog(plugin.manifest.id)));
      const toggle = el("label", "ad-switch");
      const input = el("input", "");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = plugin.enabled;
      input.setAttribute("aria-label", `${plugin.manifest.name} on`);
      input.addEventListener("change", () => void attempt(async () => {
        installed = await window.adcode.community.setEnabled(plugin.manifest.id, input.checked);
        say(`${plugin.manifest.name} is ${input.checked ? "on" : "off"}`);
      }, "Could not change that plugin."));
      toggle.append(input);
      actions.append(toggle, button("Uninstall", "ad-btn", () => void uninstall(plugin)));
      row.append(monogram(plugin.manifest.name), names, actions);
      return row;
    });
    panel.replaceChildren(section("Installed", "Changes apply at once. Turning a plugin off puts back the settings it changed", list(rows, "Nothing installed yet. Discover has eight plugins made by ADCode to start with"), button("Check for updates", "ad-btn", () => void checkUpdates())));
  }

  async function checkUpdates(): Promise<void> {
    const result = await attempt(() => window.adcode.community.checkUpdates(), "Could not check for updates.");
    if (result === null) return;
    installed = result;
    const count = result.filter((one) => one.update !== null).length;
    shell.setBadge("installed", count);
    say(count === 0 ? "Every installed plugin is up to date" : `${plural(count, "update")} available`);
    shell.rerender();
  }

  async function install(id: string, name: string, starter: boolean, from?: HTMLButtonElement, version: string | null = null): Promise<void> {
    const manifest = starter ? starters.find((one) => one.id === id) ?? null : version !== null ? { ...(await attempt<PluginDetail>(() => window.adcode.community.plugin(id), "That plugin could not be loaded."))?.manifest, version } as PluginManifest : (await attempt<PluginDetail>(() => window.adcode.community.plugin(id), "That plugin could not be loaded."))?.manifest ?? null;
    if (manifest === null || manifest.contributes === undefined) return;
    const lines = installSummary(manifest);
    const addons = manifest.contributes.addons.length > 0;
    const ok = await askThemed({
      title: `Install ${name}?`,
      body: `It will add:\n• ${lines.join("\n• ")}\n\n${addons ? "Add-ons run sealed: no internet, no files, no account - only the data listed above. " : ""}You can turn it off or uninstall it any time.`,
      confirmLabel: "Install",
    });
    if (!ok) return;
    const bar = progressBar("Downloading");
    if (from !== undefined && from.isConnected) swapIn(from, bar.element);
    const stop = watchProgress(`install:${id}`, bar.update);
    const keep = version !== null;
    const result = await attempt(() => (starter ? window.adcode.community.installStarter(id) : window.adcode.community.install(id, version, keep)), "That plugin could not be installed.");
    stop();
    if (result === null) {
      if (bar.element.isConnected && from !== undefined) bar.element.replaceWith(from);
      return;
    }
    if (bar.element.isConnected) await bar.complete();
    installed = result;
    deps.track(starter ? "plugin_starter_installed" : version !== null ? "plugin_version_changed" : "plugin_installed");
    const where = addons ? ` Look for it in ${manifest.contributes.addons.map((addon) => addon.slot === "statusbar" ? "the status bar" : addon.slot === "chat" ? "the chat" : "the sidebar").join(" and ")}` : manifest.contributes.actions.length > 0 ? " Its actions are in the command palette" : manifest.contributes.slashCommands.length > 0 ? " Type / in the chat to use it" : "";
    if (bar.element.isConnected) swapIn(bar.element, installedMark(keep ? `Kept at ${version}` : "Installed", true));
    else shell.rerender();
    say(keep ? `${name} ${version} installed and kept at that version. Let it update again from Versions` : `${name} installed.${where}`);
  }

  async function uninstall(plugin: InstalledPluginView): Promise<void> {
    const ok = await askThemed({ title: `Uninstall ${plugin.manifest.name}?`, body: "Its commands, skills, add-ons and theme are removed, and any settings it changed are put back.", confirmLabel: "Uninstall", danger: true });
    if (!ok) return;
    const result = await attempt(() => window.adcode.community.uninstall(plugin.manifest.id), "That plugin could not be uninstalled.");
    if (result === null) return;
    installed = result;
    deps.track("plugin_uninstalled");
    say(`${plugin.manifest.name} uninstalled`);
    shell.rerender();
  }

  function addsList(manifest: PluginManifest): HTMLElement {
    const adds = el("ul", "community-adds");
    for (const line of installSummary(manifest)) adds.append(el("li", "", line));
    return adds;
  }

  function openStarter(manifest: PluginManifest): void {
    const { dialog, card, finish } = detailDialog("community-detail", manifest.name);
    card.append(el("p", "community-card-by", `by ADCode · v${manifest.version}`), el("p", "result-summary", manifest.description));
    card.append(el("h3", "community-dialog-subtitle", "What it adds"), addsList(manifest));
    if (manifest.readme) card.append(el("h3", "community-dialog-subtitle", "Read me"), el("p", "community-readme-text", manifest.readme));
    const buttons = el("div", "confirm-buttons community-dialog-actions");
    buttons.append(button("Open in Studio", "ad-btn", () => { finish(); openStudio(formatManifest(draftFromPlugin(manifest, `My ${manifest.name}`))); }));
    const mine = installed.find((one) => one.manifest.id === manifest.id);
    if (mine === undefined) buttons.append(button("Install", "result-close", () => { finish(); void install(manifest.id, manifest.name, true); }));
    else buttons.append(button("Uninstall", "result-close", () => { finish(); void uninstall(mine); }));
    card.append(buttons);
    dialog.showModal();
  }

  async function openPlugin(id: string): Promise<void> {
    const detail = await attempt<PluginDetail>(() => window.adcode.community.plugin(id), "That plugin could not be loaded.");
    if (detail === null) return;
    const { dialog, card, finish } = detailDialog("community-detail", detail.name);
    card.append(el("p", "community-card-by", `by ${detail.ownerName} · v${detail.version} · updated ${timeAgo(detail.updatedAt, Date.now())}${detail.remixOf ? ` · remix of ${detail.remixOf.replace(/^(plugin|feature):/, "")}` : ""}`));
    card.append(el("p", "result-summary", detail.description));
    const meta = el("div", "community-card-meta");
    meta.append(stat("installs", compactCount(detail.installs)), stat("remixes", compactCount(detail.remixes)));
    card.append(meta, el("h3", "community-dialog-subtitle", "What it adds"), addsList(detail.manifest));
    if (detail.manifest.readme) card.append(el("h3", "community-dialog-subtitle", "Read me"), el("p", "community-readme-text", detail.manifest.readme));
    if (detail.versions.length > 1) card.append(el("h3", "community-dialog-subtitle", "Versions"), versionList(detail, finish));
    const buttons = el("div", "confirm-buttons community-dialog-actions");
    buttons.append(
      starButton("plugin", detail.id, detail.starred, detail.stars, say),
      button("Report", "ad-btn", () => { finish(); reportDialog("plugin", detail.id, detail.name, say); }),
      button("Remix in Studio", "ad-btn", () => { finish(); openStudio(formatManifest(draftFromPlugin(detail.manifest, `${detail.name} remix`))); }),
    );
    const mine = installed.find((one) => one.manifest.id === detail.id);
    if (mine === undefined || mine.update !== null) buttons.append(button(mine === undefined ? "Install" : `Update to ${detail.version}`, "result-close", () => { finish(); void install(detail.id, detail.name, false); }));
    else buttons.append(button("Uninstall", "result-close", () => { finish(); void uninstall(mine); }));
    card.append(buttons);
    dialog.showModal();
  }

  /* ---------- Settings and versions ---------- */

  /** Every version with its notes; any other installable one has its own Install button. */
  function versionList(detail: PluginDetail, done: () => void): HTMLElement {
    const mine = installed.find((one) => one.manifest.id === detail.id);
    const rows = detail.versions.slice(0, 15).map((version) => {
      const row = el("li", "community-installed-row community-version-row");
      const names = el("div", "community-card-names");
      names.append(el("strong", "community-version-number", version.version), el("span", "community-card-by", `${timeAgo(version.at, Date.now())}${version.notes ? ` - ${version.notes}` : ""}`));
      row.append(names);
      if (mine?.manifest.version === version.version) row.append(installedMark(mine.pinned ? "Installed, kept" : "Installed", false));
      else if (version.available) row.append(button(version.version === detail.version ? "Install latest" : "Install this version", "ad-btn", () => { done(); void install(detail.id, detail.name, false, undefined, version.version === detail.version ? null : version.version); }));
      else row.append(el("span", "community-card-by", "No longer available"));
      return row;
    });
    return list(rows, "");
  }

  async function versionsDialog(id: string): Promise<void> {
    const detail = await attempt<PluginDetail>(() => window.adcode.community.plugin(id), "That plugin could not be loaded.");
    if (detail === null) return;
    const mine = installed.find((one) => one.manifest.id === id);
    const { dialog, card, finish } = detailDialog("community-detail", `${detail.name} versions`);
    card.append(el("p", "result-summary", "Install any published version. An older version is kept where it is: no updates are offered until you let it go."));
    if (mine !== undefined) {
      const keep = el("label", "ad-switch community-keep");
      const input = el("input", "");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = mine.pinned;
      input.addEventListener("change", () => void attempt(async () => {
        installed = await window.adcode.community.setPinned(id, input.checked);
        say(input.checked ? `${detail.name} stays at ${mine.manifest.version}` : `${detail.name} will offer updates again`);
      }, "Could not change that."));
      keep.append(input, document.createTextNode(`Keep ${mine.manifest.version} (do not offer updates)`));
      card.append(keep);
    }
    card.append(versionList(detail, finish));
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Close", "confirm-cancel", finish));
    card.append(buttons);
    dialog.showModal();
  }

  /** A plugin's own settings, drawn from its manifest with the design system's controls. */
  function optionsDialog(plugin: InstalledPluginView): void {
    const { dialog, card, finish } = detailDialog("community-detail", `${plugin.manifest.name} settings`);
    const form = el("form", "form-dialog-form");
    const read: (() => [string, boolean | number | string])[] = [];
    for (const option of plugin.manifest.options) {
      const current = plugin.options[option.id] ?? option.default;
      if (option.type === "toggle") {
        const wrap = el("label", "ad-switch community-option-toggle");
        const input = el("input", "");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.checked = current === true;
        wrap.append(input, document.createTextNode(option.label));
        form.append(wrap);
        if (option.help) form.append(el("small", "form-field-hint", option.help));
        read.push(() => [option.id, input.checked]);
        continue;
      }
      if (option.type === "choice") {
        const select = el("select", "form-select");
        for (const choice of option.choices) select.append(new Option(choice.label, choice.value, false, choice.value === current));
        form.append(field(option.label, select, option.help || undefined));
        read.push(() => [option.id, select.value]);
        continue;
      }
      const input = el("input", "form-input");
      if (option.type === "number") {
        input.type = "number"; input.min = String(option.min); input.max = String(option.max); input.step = String(option.step);
        input.value = String(current);
        read.push(() => [option.id, Number(input.value)]);
      } else {
        input.maxLength = option.maxLength;
        input.value = String(current);
        read.push(() => [option.id, input.value]);
      }
      form.append(field(option.label, input, option.help || undefined));
    }
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Save");
    save.type = "submit";
    buttons.append(button("Reset", "confirm-cancel", () => void attempt(async () => {
      installed = await window.adcode.community.setOptions(plugin.manifest.id, {});
      finish();
      say(`${plugin.manifest.name} is back to its defaults`);
    }, "Could not reset it.")), save);
    form.append(buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void attempt(async () => {
        installed = await window.adcode.community.setOptions(plugin.manifest.id, Object.fromEntries(read.map((get) => get())));
        finish();
        deps.track("plugin_settings_changed");
        say(`Saved. ${plugin.manifest.name} uses the new settings now`);
      }, "Could not save those settings.");
    });
    card.append(form);
    dialog.showModal();
  }

  /* ---------- Studio ---------- */

  const studio = el("div", "community-studio");
  const editor = el("textarea", "ad-textarea community-studio-editor");
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Plugin manifest (JSON)");
  const problemsBox = el("div", "community-studio-check");
  problemsBox.setAttribute("aria-live", "polite");
  const remixSelect = el("select", "ad-select community-studio-remix");
  let studioBuilt = false;
  let lastVerdict: boolean | null = null;

  function saveDraft(): void {
    try { localStorage.setItem(STUDIO_DRAFT, editor.value); } catch { /* Private storage off: the draft lives only in the box. */ }
  }

  function validate(): void {
    const result = checkPluginManifest(editor.value, deps.builtInSlash());
    if (lastVerdict !== null && lastVerdict !== result.ok) markFor(problemsBox, "flip", "true", 300);
    lastVerdict = result.ok;
    problemsBox.dataset["verdict"] = result.ok ? "ok" : "problems";
    problemsBox.replaceChildren();
    if (result.ok) {
      const ok = el("p", "community-studio-ok");
      ok.append(createIcon(ICON.check), document.createTextNode("Ready to try or publish"));
      const preview = el("div", "community-studio-preview");
      preview.append(ok, el("strong", "", `${result.manifest.name} ${result.manifest.version}`), el("p", "community-card-text", result.manifest.description), addsList(result.manifest));
      problemsBox.append(preview);
    } else {
      problemsBox.append(el("p", "community-studio-bad", `${plural(result.problems.length, "thing")} to fix`));
      const items = el("ul", "community-problems");
      for (const problem of result.problems.slice(0, 20)) items.append(el("li", "", problem));
      problemsBox.append(items);
    }
  }

  function fillRemixPicker(): void {
    if (remixSelect.options.length > 1) return;
    for (const feature of deps.features()) remixSelect.append(new Option(feature.title, feature.id));
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
    const add = el("select", "ad-select");
    add.setAttribute("aria-label", "Add a contribution");
    add.append(new Option("Add…", ""));
    for (const [kind, label] of Object.entries(CONTRIBUTION_LABELS)) add.append(new Option(label, kind));
    add.addEventListener("change", () => {
      const kind = add.value as ContributionKind;
      add.value = "";
      const next = addContribution(editor.value, kind);
      if (next === null) { say("Fix the JSON first - the draft is not valid JSON right now", "error"); return; }
      setStudio(next);
    });
    remixSelect.setAttribute("aria-label", "Start from a built-in feature");
    remixSelect.append(new Option("Customize a built-in feature…", ""));
    remixSelect.addEventListener("focus", fillRemixPicker);
    remixSelect.addEventListener("change", () => {
      const id = remixSelect.value;
      remixSelect.value = "";
      if (id) remixFeature(id);
    });
    toolbar.append(
      button("New", "ad-btn", () => void (async () => {
        if (!await askThemed({ title: "Start a new plugin?", body: "The current draft is replaced.", confirmLabel: "Start over" })) return;
        setStudio(formatManifest(blankManifest()));
      })()),
      add, remixSelect,
      button("Load adcode-plugin.json", "ad-btn", () => void attempt(async () => {
        const text = await window.adcode.community.readProjectManifest();
        if (text === null) { say("The open project has no adcode-plugin.json at its root yet"); return; }
        setStudio(text);
        say("Loaded adcode-plugin.json from the project");
      }, "Could not read the project's plugin file.")),
      button("Save to project", "ad-btn", () => void attempt(async () => {
        say(`Saved to ${await window.adcode.community.writeProjectManifest(editor.value)}`);
      }, "Open a project folder to save the plugin into it.")),
    );

    const ai = el("form", "community-studio-ai");
    const idea = el("input", "ad-input");
    idea.placeholder = "Describe a plugin: a word counter in the status bar";
    idea.setAttribute("aria-label", "Describe the plugin you want");
    const build = el("button", "ad-btn ad-btn-primary", "Build with AI");
    build.type = "submit";
    ai.append(idea, build);
    ai.addEventListener("submit", (event) => {
      event.preventDefault();
      if (idea.value.trim().length < 5) { idea.focus(); return; }
      deps.askAssistant(aiBuildPrompt(idea.value, deps.builtInSlash()));
      deps.track("studio_ai_build");
      say("The assistant is writing adcode-plugin.json in the open project. When it is done, press Load adcode-plugin.json");
    });

    const actions = el("div", "community-studio-actions");
    actions.append(
      button("Try it here", "ad-btn", () => void attempt(async () => {
        installed = await window.adcode.community.installLocal(editor.value);
        deps.track("plugin_tried");
        say("Installed on this computer only. Add-ons appear where they belong; actions are in the command palette");
      }, "Fix the problems listed first.")),
      button("Publish…", "ad-btn ad-btn-primary", () => publishDraft()),
    );

    const layout = el("div", "community-studio-layout");
    const left = el("div", "community-studio-left");
    left.append(toolbar, editor);
    const right = el("div", "community-studio-right");
    right.append(problemsBox, actions, monetizeCard());
    layout.append(left, right);
    studio.append(
      el("p", "community-section-note", "A plugin is one JSON file. Most of it is words - prompts, skills, colours, settings. Add-ons add small panels of your own HTML, which run sealed with no internet, files or account access"),
      ai, layout,
    );
    validate();
  }

  function setStudio(text: string): void {
    buildStudio();
    editor.value = text;
    saveDraft();
    validate();
  }

  function renderStudio(): void {
    const panel = shell.panel("studio");
    buildStudio();
    if (studio.parentElement !== panel) panel.replaceChildren(studio);
  }

  function publishDraft(): void {
    const result = checkPluginManifest(editor.value, deps.builtInSlash());
    if (!result.ok) { say("Fix the problems listed beside the editor first", "error"); return; }
    const { dialog, card, finish } = detailDialog("community-share", `Publish ${result.manifest.name} ${result.manifest.version}`);
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
      void window.adcode.community.publishPlugin(editor.value, notes.value).then((detail) => {
        finish();
        deps.track("plugin_published");
        say(`${detail.name} ${detail.version} is in the directory`);
        const parsed = JSON.parse(editor.value) as Record<string, unknown>;
        setStudio(formatManifest({ ...parsed, version: nextVersion(detail.version) }));
      }, (failure: unknown) => {
        error.textContent = errorText(failure, "It could not be published.");
        error.hidden = false;
        submit.disabled = false;
      });
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
    card.append(head, el("p", "", "Set a price, keep most of every sale, and get paid monthly with your ad earnings. Free plugins stay free."));
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
      status.textContent = state.joined ? `You are #${state.position} of ${compactCount(state.waiting)} creators on the waitlist${state.price !== null ? ` at $${state.price}` : ""}. We will tell you the day it opens` : `${compactCount(state.waiting)} creators are waiting`;
      join.textContent = state.joined ? "Update" : "Join the waitlist";
    };
    if (me !== null) show(me.monetization);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void attempt(async () => {
        show(await window.adcode.community.waitlist(true, price.value.trim() === "" ? null : Number(price.value), ""));
        deps.track("waitlist_joined");
        say("You are on the waitlist for selling plugins");
      }, "Sign in to join the waitlist.");
    });
    card.append(form, status);
    return card;
  }

  function openStudio(text?: string): void {
    if (text !== undefined) setStudio(text);
    shell.showTab("studio");
  }

  function remixFeature(featureId: string): void {
    const feature = deps.features().find((one) => one.id === featureId);
    if (feature === undefined) { say("That feature has no switches, commands or prompts a plugin can change yet", "error"); return; }
    openStudio(featureDraftText(feature));
    deps.track("feature_customized");
    say(`Started a plugin from ${feature.title}. Change what you like, try it here, then publish your version`);
  }

  function focusRemixPicker(): void {
    shell.showTab("studio");
    fillRemixPicker();
    requestAnimationFrame(() => { remixSelect.focus(); try { remixSelect.showPicker(); } catch { /* Not every engine opens a select from script. */ } });
  }

  /* ---------- Your plugins ---------- */

  async function renderMine(): Promise<void> {
    const panel = shell.panel("mine");
    shell.loading(panel);
    try {
      me = await communityMe();
    } catch (error) {
      panel.replaceChildren(/sign in/i.test(errorText(error, "")) ? signedOutBox("Sign in to publish plugins and see who installed and starred them", deps.signIn) : el("p", "community-empty", "Your profile could not be loaded"));
      return;
    }
    const result = me;
    applyUnread(result);
    const rows = result.plugins.map((plugin) => {
      const row = el("li", "community-installed-row");
      const names = el("div", "community-card-names");
      names.append(
        button(plugin.name, "community-card-title", () => void attempt(async () => {
          const detail = await window.adcode.community.plugin(plugin.id);
          openStudio(formatManifest({ ...detail.manifest, version: nextVersion(detail.manifest.version) }));
          say(`Editing ${plugin.name}. Publishing saves it as version ${nextVersion(detail.manifest.version)}`);
        }, "Could not load it.")),
        el("span", "community-card-by", `v${plugin.version} · ${plural(plugin.installs, "install")} · ${plural(plugin.stars, "star")}`),
      );
      row.append(monogram(plugin.name), names, button("Unpublish", "ad-btn", () => void (async () => {
        if (!await askThemed({ title: `Unpublish ${plugin.name}?`, body: "It leaves the directory. People who installed it keep their copy, and the id stays yours.", confirmLabel: "Unpublish", danger: true })) return;
        if (await attempt(() => window.adcode.community.removePlugin(plugin.id), "Could not unpublish it.") !== null) { say(`${plugin.name} is unpublished`); shell.rerender(); }
      })()));
      return row;
    });
    panel.replaceChildren(
      profileCard(result, shell.entering()),
      section("Your plugins", "Open one to edit it and publish the next version", list(rows, "No plugins published yet"), button("Open the Studio", "ad-btn", () => shell.showTab("studio"))),
      section("Activity", "Installs, stars, remixes and badges", activityList(result.activity.filter((item) => activityFor("plugins", item)), "Nothing yet")),
      monetizeCard(),
    );
    if (result.unread > 0) void window.adcode.community.markRead().then(() => { shell.setBadge("mine", 0); deps.onUnread(0); }, () => {});
  }

  function applyUnread(result: CommunityMe): void {
    const unread = result.activity.filter((item) => !item.read && activityFor("plugins", item)).length;
    shell.setBadge("mine", unread);
    shell.setChip(`${result.profile.level.name} · ${compactCount(result.profile.points)} pts`, () => shell.showTab("mine"));
    deps.onUnread(unread);
  }

  function showAddons(): void {
    category = "add-ons";
    shell.search.value = "";
    if (shell.current() === "discover") shell.rerender(); else shell.showTab("discover");
  }

  window.adcode.community.onPluginsChanged((next) => {
    installed = next;
    if (shell.visible() && shell.current() === "installed") shell.rerender();
  });

  return {
    element: shell.element,
    shown: () => { if (!shell.visible()) deps.track("plugins_opened"); shell.shown(); },
    hidden: shell.hidden,
    showTab: shell.showTab,
    openStudio,
    remixFeature,
    showAddons,
    focusRemixPicker,
    showMonetize() {
      shell.showTab("studio");
      requestAnimationFrame(() => shell.element.querySelector<HTMLElement>(".community-monetize")?.scrollIntoView({ block: "center" }));
    },
    async poll() {
      try { me = await communityMe(); applyUnread(me); } catch { /* Signed out or offline: no badge. */ }
    },
  };
}
