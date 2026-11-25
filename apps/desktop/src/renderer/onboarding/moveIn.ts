/**
 * Move in: bring what you already use into ADCode.
 *
 * Two things stop somebody who already has an AI tool from trying another one: their
 * subscription is over there, and so are months of conversations. This screen answers both.
 *
 *  1. **Your accounts.** The coding CLIs found on this computer - Claude Code, Codex,
 *     OpenCode, Gemini CLI, Freebuff - each with the one next step that applies: use it as
 *     ADCode's model, sign it in, or install it. A CLI answers with its own account and
 *     models; ADCode never sees a password or key for it.
 *  2. **Your conversations.** What those tools keep on this computer - or in a folder somebody
 *     sent, or an export file - listed by title and project, with a tick beside each. The
 *     person chooses what is scanned (which tools, how far back, how many, one project only),
 *     can search, filter and sort the list, look at the opening of any conversation before
 *     bringing it over, and choose how it comes in: where it is filed, whether ones already
 *     imported are updated or left alone, and how much of each to keep. No message text
 *     reaches this window except a preview the person asked for.
 *
 * It opens from the welcome sheet and any time from the command palette. Nothing here is
 * required, and nothing is imported or started without a press.
 */
import type { AiProviderInfo, ChatImportEntry, ChatImportScan, ChatImportTool } from "../../shared/api.ts";
import { ALL_TOOLS, DEFAULT_VIEW, KEEP_CHOICES, PER_TOOL_CHOICES, SINCE_CHOICES, TOOL_NAMES, batches, filterImports, importOptions, initialSelection, readPrefs, sourceCounts, writePrefs, type ImportPrefs, type ImportSort, type ImportView } from "./importFilter.ts";
import { button, el, openFormModal } from "../dialogs/formDialog.ts";
import { cliConnectPlan, connectCli } from "../ai/cliConnect.ts";
import { createAdcodeMascot } from "../mascot/adcodeMascot.ts";

export interface MoveInDeps {
  /** Open the Connect screen on one provider, e.g. `cli-claude`. */
  readonly selectProvider: (providerId: string) => void;
  /** Write a setting: connecting a CLI makes it the active model. */
  readonly write: (id: string, value: string) => Promise<unknown>;
  /** Open a project folder the scan found. */
  readonly openFolder: (folder: string) => void;
  /** Run a command in a terminal tab: installing or signing in to a CLI. */
  readonly runInTerminal: (command: string) => void;
  /** Conversations were saved into the open project: refresh its list and show it. */
  readonly showConversations: () => void;
  readonly openApps: () => void;
  /** The project open now, if any: "only this project" and "put them here" need one. */
  readonly currentProject?: () => string | null;
}

/** Entries grouped by project folder, newest group first; no folder sorts last. */
export function groupImports(entries: readonly ChatImportEntry[]): { readonly folder: string | null; readonly entries: readonly ChatImportEntry[] }[] {
  const groups = new Map<string, ChatImportEntry[]>();
  for (const entry of entries) {
    const key = entry.folder ?? "";
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [entry]); else list.push(entry);
  }
  return [...groups].map(([folder, list]) => ({ folder: folder === "" ? null : folder, entries: list }))
    .sort((a, b) => Number(a.folder === null) - Number(b.folder === null) || (b.entries[0]?.updatedAt ?? 0) - (a.entries[0]?.updatedAt ?? 0));
}

function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? folder;
}

function when(at: number): string {
  if (at <= 0) return "";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 30 ? `${days.toString()} days ago` : new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function openMoveIn(deps: MoveInDeps): void {
  const mascot = createAdcodeMascot({ mood: "idle", interactive: true });
  // Settling is the dialog going away, however it went: that is when Buck stops for good.
  const modal = openFormModal("move-in", "Move in", () => mascot.destroy());
  const { card } = modal;
  const lead = el("div", "move-in-lead");
  lead.append(mascot.element, el("p", "result-summary", "Bring the AI accounts and conversations you already have. Nothing is connected, started or imported until you press its button."));
  card.append(lead);

  /* ── Accounts ── */
  const accounts = el("section", "move-in-section");
  accounts.append(el("h3", "move-in-heading", "Your AI accounts"), el("p", "move-in-note", "Coding CLIs on this computer answer in ADCode's chat with their own subscription and models."));
  const cliList = el("ul", "move-in-clis");
  cliList.setAttribute("role", "list");
  accounts.append(cliList);
  const recheck = button("Check again", "ad-btn", () => void paintClis(true));
  const appsDoor = button("Connect apps (Gmail, Supabase, Cloudflare…)", "ad-btn", () => { modal.finish(); deps.openApps(); });
  const accountActions = el("div", "move-in-actions");
  accountActions.append(recheck, appsDoor);
  accounts.append(accountActions);
  card.append(accounts);

  /** The model in use now, so a CLI that already is says Connected. */
  let active: string | null = null;
  const accountStatus = el("p", "move-in-status");
  accountStatus.setAttribute("role", "status");
  accounts.append(accountStatus);

  function cliRow(provider: AiProviderInfo): HTMLElement {
    const cli = provider.cli!;
    const row = el("li", "move-in-cli");
    row.dataset["installed"] = String(cli.installed);
    const text = el("div", "move-in-cli-text");
    text.append(el("strong", "", cli.name), el("span", "", !cli.installed ? "Not installed" : cli.headless ? `Installed${cli.version ? ` · ${cli.version.slice(0, 40)}` : ""}${cli.update ? ` · ${cli.latest ?? "a newer version"} is out` : ""}` : "Installed · runs in a terminal tab"));
    const actions = el("div", "move-in-cli-actions");
    // One button, doing whatever is next for this tool (cliConnect.ts).
    const plan = cliConnectPlan(provider, active);
    const connect = button(plan.label, "ad-btn ad-btn-primary", () => {
      connect.disabled = true;
      void connectCli(plan, cli.name, { write: deps.write, runInTerminal: deps.runInTerminal }).then((message) => {
        accountStatus.textContent = message;
        if (plan.kind === "terminal") modal.finish(); else void paintClis(false);
      }, () => { accountStatus.textContent = `${cli.name} did not connect. Try again.`; connect.disabled = false; });
    });
    connect.disabled = plan.kind === "unavailable" || plan.label === "Connected";
    connect.setAttribute("aria-label", `${plan.label} ${cli.name}`);
    actions.append(connect);
    row.append(text, actions);
    return row;
  }

  async function paintClis(fresh: boolean): Promise<void> {
    recheck.disabled = true;
    try {
      const status = await (fresh ? window.adcode.ai.refreshCliAgents() : window.adcode.ai.status());
      active = status.activeProvider;
      const clis = status.providers.filter((provider) => provider.cli !== undefined)
        .sort((a, b) => Number(b.cli!.installed) - Number(a.cli!.installed));
      cliList.replaceChildren(...(clis.length > 0 ? clis.map(cliRow) : [el("li", "move-in-empty", "Coding CLIs run in the desktop app.")]));
    } catch {
      cliList.replaceChildren(el("li", "move-in-empty", "Could not look for coding CLIs. Try Check again."));
    } finally {
      recheck.disabled = false;
    }
  }

  /* ── Conversations ── */
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  let prefs: ImportPrefs = readPrefs(storage);
  const remember = (next: ImportPrefs): void => { prefs = next; writePrefs(storage, next); };
  const project = (): string | null => deps.currentProject?.() ?? null;

  const chats = el("section", "move-in-section");
  chats.append(el("h3", "move-in-heading", "Your conversations"), el("p", "move-in-note", "From Claude Code, Codex and OpenCode on this computer, a folder of session files somebody sent you, or a file exported from Claude, ChatGPT or ADCode. Only titles are listed; nothing is imported until you choose."));
  const status = el("p", "move-in-status");
  status.setAttribute("role", "status");

  /* What to scan: which tools, how far back, how many, and whether only this project. */
  const scope = el("fieldset", "move-in-scope");
  scope.append(el("legend", "", "What to scan"));
  const toolRow = el("div", "move-in-scope-row");
  toolRow.append(el("span", "move-in-scope-label", "Tools"));
  const toolBoxes = new Map<ChatImportTool, HTMLInputElement>();
  for (const tool of ALL_TOOLS) {
    const label = el("label", "move-in-toggle");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = prefs.scan.tools.includes(tool);
    box.addEventListener("change", () => {
      const tools = ALL_TOOLS.filter((one) => toolBoxes.get(one)?.checked === true);
      remember({ ...prefs, scan: { ...prefs.scan, tools } });
      scan.disabled = tools.length === 0;
    });
    toolBoxes.set(tool, box);
    label.append(box, document.createTextNode(TOOL_NAMES[tool]));
    toolRow.append(label);
  }
  const choiceRow = el("div", "move-in-scope-row");
  const select = (label: string, options: readonly { value: string; text: string }[], value: string, change: (value: string) => void): HTMLLabelElement => {
    const wrap = el("label", "move-in-select") as HTMLLabelElement;
    const box = document.createElement("select");
    for (const option of options) { const item = document.createElement("option"); item.value = option.value; item.textContent = option.text; box.append(item); }
    box.value = value;
    box.addEventListener("change", () => change(box.value));
    wrap.append(el("span", "move-in-scope-label", label), box);
    return wrap;
  };
  const sinceKey = (days: number | null): string => days === null ? "any" : String(days);
  choiceRow.append(
    select("From", SINCE_CHOICES.map((choice) => ({ value: sinceKey(choice.days), text: choice.label })), sinceKey(prefs.scan.sinceDays), (value) => {
      remember({ ...prefs, scan: { ...prefs.scan, sinceDays: value === "any" ? null : Number(value) } });
    }),
    select("Up to", PER_TOOL_CHOICES.map((count) => ({ value: String(count), text: `${count.toLocaleString()} per tool` })), String(prefs.scan.perTool), (value) => {
      remember({ ...prefs, scan: { ...prefs.scan, perTool: Number(value) } });
    }),
  );
  const onlyHere = el("label", "move-in-toggle");
  const onlyHereBox = document.createElement("input");
  onlyHereBox.type = "checkbox";
  onlyHereBox.checked = prefs.scan.onlyCurrentProject && project() !== null;
  onlyHereBox.disabled = project() === null;
  onlyHere.title = project() === null ? "Open a project folder first" : `Only conversations that happened in ${folderName(project()!)}`;
  onlyHereBox.addEventListener("change", () => remember({ ...prefs, scan: { ...prefs.scan, onlyCurrentProject: onlyHereBox.checked } }));
  onlyHere.append(onlyHereBox, document.createTextNode(" Only the project open now"));
  choiceRow.append(onlyHere);
  scope.append(toolRow, choiceRow);

  const scan = button("Scan this computer", "ad-btn ad-btn-primary", () => void runScan());
  scan.disabled = prefs.scan.tools.length === 0;
  const folderPick = button("Scan a folder…", "ad-btn", () => void runFolder());
  folderPick.title = "A folder of Claude Code or Codex session files - from another computer, or sent by a teammate - or export files";
  const pick = button("Import an exported file…", "ad-btn", () => void runPick());
  pick.title = "A conversations.json exported from Claude or ChatGPT, or a conversation exported from ADCode";
  const chatActions = el("div", "move-in-actions");
  chatActions.append(scan, folderPick, pick);

  /* The list's own controls: search, sources, already imported, order, and selection. */
  let view: ImportView = { ...DEFAULT_VIEW };
  const toolbar = el("div", "move-in-toolbar");
  toolbar.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "move-in-search";
  search.placeholder = "Search titles and folders";
  search.setAttribute("aria-label", "Search the conversations found");
  search.addEventListener("input", () => { view = { ...view, query: search.value }; paintResults(); });
  const chips = el("div", "move-in-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", "Show conversations from");
  const hideImported = el("label", "move-in-toggle");
  const hideImportedBox = document.createElement("input");
  hideImportedBox.type = "checkbox";
  hideImportedBox.addEventListener("change", () => { view = { ...view, hideImported: hideImportedBox.checked }; paintResults(); });
  hideImported.append(hideImportedBox, document.createTextNode(" Hide ones already imported"));
  const sortSelect = select("Sort", [
    { value: "newest", text: "Newest first" }, { value: "oldest", text: "Oldest first" },
    { value: "messages", text: "Most messages" }, { value: "title", text: "Title A-Z" },
  ], "newest", (value) => { view = { ...view, sort: value as ImportSort }; paintResults(); });
  const selectShown = button("Select shown", "ad-btn ad-btn-ghost", () => { for (const entry of shownEntries()) chosen.add(entry.key); paintResults(); });
  const clearShown = button("Clear", "ad-btn ad-btn-ghost", () => { for (const entry of shownEntries()) chosen.delete(entry.key); paintResults(); });
  const toolbarTop = el("div", "move-in-toolbar-row");
  toolbarTop.append(search, sortSelect);
  const toolbarBottom = el("div", "move-in-toolbar-row");
  toolbarBottom.append(chips, hideImported, selectShown, clearShown);
  toolbar.append(toolbarTop, toolbarBottom);
  const counter = el("p", "move-in-counter");
  counter.setAttribute("aria-live", "polite");

  const results = el("div", "move-in-results");

  /* How to import: where each one goes, what happens to ones already imported, how much to keep. */
  const footer = el("div", "move-in-footer");
  footer.hidden = true;
  const how = el("div", "move-in-how");
  const where = select("Put them", [
    { value: "own", text: "Each under its own project" },
    { value: "here", text: "All in the project open now" },
  ], prefs.import.here ? "here" : "own", (value) => remember({ ...prefs, import: { ...prefs.import, here: value === "here" } }));
  const again = select("Already imported", [
    { value: "update", text: "Update them" },
    { value: "skip", text: "Leave them as they are" },
  ], prefs.import.skipImported ? "skip" : "update", (value) => { remember({ ...prefs, import: { ...prefs.import, skipImported: value === "skip" } }); paintResults(); });
  const keepKey = (messages: number | null): string => messages === null ? "all" : String(messages);
  const keep = select("Keep", KEEP_CHOICES.map((choice) => ({ value: keepKey(choice.messages), text: choice.label })), keepKey(prefs.import.lastMessages), (value) => {
    remember({ ...prefs, import: { ...prefs.import, lastMessages: value === "all" ? null : Number(value) } });
  });
  how.append(where, again, keep);
  const importButton = button("Import selected", "ad-btn ad-btn-primary", () => void runImport());
  footer.append(how, importButton);

  /*
   * What the scan found, and where: one line per tool saying which folder on this computer
   * was read and what was in it (or that it is not here), then the projects those
   * conversations belong to, with the tools that worked in each and a way to open it.
   */
  const report = el("div", "move-in-report");
  report.hidden = true;
  chats.append(scope, chatActions, status, report, toolbar, counter, results, footer);

  function paintReport(found: ChatImportScan): void {
    report.replaceChildren();
    const sources = found.found ?? [];
    const projects = found.projects ?? [];
    report.hidden = sources.length === 0 && projects.length === 0;
    if (sources.length > 0) {
      const list = el("ul", "move-in-sources");
      list.setAttribute("aria-label", "Where ADCode looked");
      for (const source of sources) {
        const row = el("li", "move-in-source");
        row.dataset["present"] = String(source.present);
        const text = el("div", "");
        text.append(el("strong", "", source.name), el("code", "", source.location));
        row.append(text, el("span", "move-in-source-count", !source.present ? "Not on this computer"
          : source.conversations === 0 ? "No conversations"
          : `${source.conversations.toString()} conversation${source.conversations === 1 ? "" : "s"} · ${source.projects.toString()} project${source.projects === 1 ? "" : "s"}`));
        list.append(row);
      }
      report.append(el("h4", "move-in-subheading", "Where ADCode looked"), list);
    }
    if (projects.length > 0) {
      const list = el("ul", "move-in-projects");
      list.setAttribute("aria-label", "Projects found");
      for (const project of projects.slice(0, 30)) {
        const row = el("li", "move-in-project");
        row.dataset["exists"] = String(project.exists);
        const text = el("div", "move-in-project-text");
        const name = el("strong", "", project.name);
        const path = el("span", "move-in-project-path", project.folder);
        path.title = project.folder;
        const by = el("div", "move-in-project-by");
        for (const source of project.sources) by.append(el("span", "move-in-chip", `${source.name} · ${source.conversations.toString()}`));
        text.append(name, path, by);
        const side = el("div", "move-in-project-side");
        side.append(el("small", "", when(project.lastUsed)));
        if (project.exists) {
          const openIt = button("Open", "ad-btn", () => { modal.finish(); deps.openFolder(project.folder); });
          openIt.setAttribute("aria-label", `Open ${project.name}`);
          side.append(openIt);
        } else side.append(el("small", "move-in-project-gone", "Moved or deleted"));
        row.append(text, side);
        list.append(row);
      }
      report.append(el("h4", "move-in-subheading", `${projects.length.toString()} project${projects.length === 1 ? "" : "s"} found`), list);
    }
  }
  card.append(chats);

  const close = el("div", "result-actions");
  close.append(button("Done", "ad-btn", () => modal.finish()));
  card.append(close);

  let chosen = new Set<string>();
  let current: ChatImportScan | null = null;
  /** Previews opened, by key: read once, on the person's press. */
  const previews = new Map<string, HTMLElement>();

  const shownEntries = (): ChatImportEntry[] => filterImports(current?.entries ?? [], view);

  function paintChips(): void {
    chips.replaceChildren();
    const counts = sourceCounts(current?.entries ?? []);
    if (counts.length < 2) { chips.hidden = true; return; }
    chips.hidden = false;
    const chip = (label: string, active: boolean, press: () => void): void => {
      const item = button(label, "move-in-filter", press);
      item.setAttribute("aria-pressed", String(active));
      chips.append(item);
    };
    chip("All", view.sources.length === 0, () => { view = { ...view, sources: [] }; paintResults(); });
    for (const { name, count } of counts) {
      const on = view.sources.includes(name);
      chip(`${name} ${count.toLocaleString()}`, on, () => {
        view = { ...view, sources: on ? view.sources.filter((one) => one !== name) : [...view.sources, name] };
        paintResults();
      });
    }
  }

  async function togglePreview(entry: ChatImportEntry, row: HTMLElement, trigger: HTMLButtonElement): Promise<void> {
    const open = previews.get(entry.key);
    if (open !== undefined) { open.remove(); previews.delete(entry.key); trigger.setAttribute("aria-expanded", "false"); trigger.textContent = "Preview"; return; }
    trigger.disabled = true;
    try {
      const preview = await window.adcode.ai.previewChatImport(entry.key);
      const box = el("div", "move-in-preview");
      if (preview === null || preview.messages.length === 0) box.append(el("p", "move-in-note", "This conversation could not be read."));
      else {
        for (const message of preview.messages) {
          const line = el("div", "move-in-preview-line");
          line.dataset["role"] = message.role;
          line.append(el("strong", "", message.role === "user" ? "You" : entry.sourceName), el("p", "", message.text));
          box.append(line);
        }
        if (preview.total > preview.messages.length) box.append(el("small", "", `…and ${(preview.total - preview.messages.length).toLocaleString()} more message${preview.total - preview.messages.length === 1 ? "" : "s"}`));
      }
      row.after(box);
      previews.set(entry.key, box);
      trigger.setAttribute("aria-expanded", "true");
      trigger.textContent = "Hide";
    } catch {
      status.textContent = "That conversation could not be previewed. It can still be imported.";
    } finally {
      trigger.disabled = false;
    }
  }

  function paintResults(): void {
    results.replaceChildren();
    previews.clear();
    const all = current?.entries ?? [];
    const shown = shownEntries();
    toolbar.hidden = all.length === 0;
    footer.hidden = all.length === 0;
    paintChips();
    const picked = all.filter((entry) => chosen.has(entry.key)).length;
    const reimports = all.filter((entry) => chosen.has(entry.key) && entry.imported === true).length;
    counter.textContent = all.length === 0 ? "" : `${picked.toLocaleString()} of ${all.length.toLocaleString()} selected${shown.length < all.length ? ` · ${shown.length.toLocaleString()} shown` : ""}${reimports > 0 ? ` · ${reimports.toLocaleString()} already imported${prefs.import.skipImported ? " (left as they are)" : " (will be updated)"}` : ""}`;
    importButton.disabled = picked === 0;
    importButton.textContent = picked === 0 ? "Import selected" : `Import ${picked.toLocaleString()} conversation${picked === 1 ? "" : "s"}`;
    where.querySelector("select")!.disabled = project() === null;
    if (all.length > 0 && shown.length === 0) { results.append(el("p", "move-in-empty", "Nothing matches. Clear the search or choose another source.")); return; }
    for (const group of groupImports(shown)) {
      const box = el("fieldset", "move-in-group");
      const legend = el("legend", "");
      const every = document.createElement("input");
      every.type = "checkbox";
      every.checked = group.entries.every((entry) => chosen.has(entry.key));
      every.indeterminate = !every.checked && group.entries.some((entry) => chosen.has(entry.key));
      every.setAttribute("aria-label", `Select everything in ${group.folder === null ? "no project" : folderName(group.folder)}`);
      every.addEventListener("change", () => {
        for (const entry of group.entries) if (every.checked) chosen.add(entry.key); else chosen.delete(entry.key);
        paintResults();
      });
      const name = el("span", "", group.folder === null ? "No project folder" : folderName(group.folder));
      if (group.folder !== null) name.title = group.folder;
      legend.append(every, name, el("small", "", `${group.entries.length.toString()}`));
      box.append(legend);
      for (const entry of group.entries) {
        const row = el("div", "move-in-chat");
        row.dataset["imported"] = String(entry.imported === true);
        const pickLabel = el("label", "move-in-chat-pick");
        const tick = document.createElement("input");
        tick.type = "checkbox";
        tick.checked = chosen.has(entry.key);
        tick.addEventListener("change", () => {
          if (tick.checked) chosen.add(entry.key); else chosen.delete(entry.key);
          paintResults();
        });
        const title = el("span", "move-in-chat-title", entry.title);
        title.title = entry.title;
        pickLabel.append(tick, title);
        const meta = el("small", "", [entry.sourceName, `${entry.messages.toString()} messages`, when(entry.updatedAt)].filter(Boolean).join(" · "));
        const side = el("div", "move-in-chat-side");
        if (entry.imported === true) side.append(el("span", "move-in-badge", "Imported"));
        const look = button("Preview", "ad-btn ad-btn-ghost move-in-preview-button", () => void togglePreview(entry, row, look));
        look.setAttribute("aria-expanded", "false");
        look.setAttribute("aria-label", `Preview ${entry.title}`);
        side.append(meta, look);
        row.append(pickLabel, side);
        box.append(row);
      }
      results.append(box);
    }
  }

  function show(found: ChatImportScan, empty: string): void {
    current = found;
    chosen = initialSelection(found.entries);
    view = { ...DEFAULT_VIEW };
    search.value = "";
    hideImportedBox.checked = false;
    sortSelect.querySelector("select")!.value = "newest";
    const already = found.entries.filter((entry) => entry.imported === true).length;
    status.textContent = found.entries.length === 0 ? empty
      : `Found ${found.entries.length.toString()} conversation${found.entries.length === 1 ? "" : "s"} from ${found.sources.join(", ")}.${already > 0 ? ` ${already.toString()} ${already === 1 ? "was" : "were"} imported before and ${already === 1 ? "is" : "are"} not ticked.` : ""}${found.skipped > 0 ? ` ${found.skipped.toString()} very large file${found.skipped === 1 ? " was" : "s were"} skipped.` : ""}`;
    mascot.setMood(found.entries.length === 0 ? "idle" : "proud");
    paintReport(found);
    paintResults();
  }

  async function runScan(): Promise<void> {
    const tools = prefs.scan.tools;
    if (tools.length === 0) return;
    scan.disabled = true;
    status.textContent = `Looking in ${tools.map((tool) => TOOL_NAMES[tool]).join(", ")}…`;
    mascot.setMood("searching");
    try {
      show(await window.adcode.ai.scanChatImports({ tools, perTool: prefs.scan.perTool, sinceDays: prefs.scan.sinceDays, onlyCurrentProject: prefs.scan.onlyCurrentProject && project() !== null }),
        prefs.scan.sinceDays !== null || prefs.scan.onlyCurrentProject
          ? "Nothing matched what you chose to scan. Try Any time, or untick Only the project open now."
          : "No conversations from those tools were found on this computer. Claude Desktop and ChatGPT keep theirs online: export them there, then use Import an exported file.");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "The scan did not finish. Try again.";
      mascot.setMood("error");
    } finally {
      scan.disabled = prefs.scan.tools.length === 0;
    }
  }

  async function runFolder(): Promise<void> {
    folderPick.disabled = true;
    try {
      status.textContent = "Choose a folder to scan…";
      const found = await window.adcode.ai.pickChatImportFolder();
      if (found === null) { status.textContent = ""; return; }
      show(found, "No conversations were found in that folder. Choose one that holds Claude Code or Codex session files (.jsonl), or exported conversations (.json).");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That folder could not be scanned.";
      mascot.setMood("error");
    } finally {
      folderPick.disabled = false;
    }
  }

  async function runPick(): Promise<void> {
    try {
      const found = await window.adcode.ai.pickChatImportFile();
      if (found !== null) show(found, "That file holds no conversations.");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "That file could not be read.";
      mascot.setMood("error");
    }
  }

  async function runImport(): Promise<void> {
    const keys = (current?.entries ?? []).filter((entry) => chosen.has(entry.key)).map((entry) => entry.key);
    if (keys.length === 0) return;
    importButton.disabled = true;
    mascot.setMood("loading");
    const here = prefs.import.here && project() !== null;
    const options = importOptions(prefs);
    let imported = 0, failed = 0, skipped = 0, landedHere = false;
    const folders = new Set<string>();
    try {
      // In batches, so a long import says how far it has got instead of sitting still.
      for (const batch of batches(keys, 20)) {
        status.textContent = `Importing ${Math.min(imported + failed + skipped + batch.length, keys.length).toLocaleString()} of ${keys.length.toLocaleString()}…`;
        const result = await window.adcode.ai.importChats(batch, here ? "current" : "own-folder", options);
        imported += result.imported; failed += result.failed; skipped += result.skipped ?? 0;
        landedHere ||= result.here;
        for (const folder of result.folders) folders.add(folder);
      }
      const whereText = landedHere ? " They are in this project's conversation list now." : folders.size > 0 ? ` Open ${folders.size === 1 ? folderName([...folders][0]!) : "each project"} to see ${imported === 1 ? "it" : "them"} in its conversation list.` : imported > 0 ? " Open a project folder to see them." : "";
      status.textContent = `Imported ${imported.toString()} conversation${imported === 1 ? "" : "s"}.${skipped > 0 ? ` ${skipped.toString()} already imported ${skipped === 1 ? "was" : "were"} left as ${skipped === 1 ? "it was" : "they were"}.` : ""}${failed > 0 ? ` ${failed.toString()} could not be read.` : ""}${whereText}`;
      // A burst of celebration, then he stands proud: a loop of confetti for as long as the dialog stays open would wear thin.
      if (imported > 0) { mascot.setMood("proud"); mascot.play("celebrating"); } else mascot.setMood(failed > 0 ? "error" : "idle");
      if (landedHere) deps.showConversations();
      // What was just imported is marked, so a second press does not surprise anybody.
      if (current !== null && imported > 0) {
        const done = new Set(keys);
        current = { ...current, entries: current.entries.map((entry) => done.has(entry.key) ? { ...entry, imported: true } : entry) };
        chosen.clear();
        paintResults();
      }
    } catch {
      status.textContent = imported > 0 ? `Imported ${imported.toString()} before something went wrong. Try again for the rest.` : "The import did not finish. Try again.";
      mascot.setMood("error");
    } finally {
      importButton.disabled = chosen.size === 0;
    }
  }

  void paintClis(false);
  modal.dialog.showModal();
}
