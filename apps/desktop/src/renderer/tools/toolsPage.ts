/**
 * The Tools page: what the assistant and your agents can use.
 *
 * Four tabs of cards - ADCode's built-in tools, MCP servers, skills, and project memory - with
 * one search across all of them. Agents are who; tools are what. Every tool card says which
 * agents may use it, a server's failure is explained in plain words with the fix, a popular
 * server is one click away, and what the assistant has learned about the project can be read,
 * corrected and shared with other AI tools.
 *
 * The MCP and skill state is the main process's (see `assistantControlsService.ts`); this page
 * renders it and sends actions, with no optimistic copy of its own.
 */
import type { MemoryItemView } from "../../shared/api.ts";
import type { AssistantControlAction, AssistantControlsView, AssistantServerView, AssistantSkillView } from "../../shared/assistantControls.ts";
import { MCP_CATALOGUE } from "../../shared/mcpCatalogue.ts";
import { AGENT_PROFILES_SETTING, parseAgentProfiles, type AgentProfile } from "../ai/agentProfiles.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { createIcon, ICON } from "../workbench/icons.ts";
import { BUILT_IN_TOOLS_INFO, type BuiltInToolGroup } from "./builtInTools.ts";
import { explainMcpError, matchesQuery, serverSummary, toolUsers } from "./toolsModel.ts";
import { indexForStagger, markFor } from "../motionFlip.ts";

export type ToolsTab = "built-in" | "servers" | "skills" | "memory";

export interface ToolsPageDeps {
  readonly copy: (text: string) => Promise<unknown>;
}

export interface ToolsPage {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
  refresh(): Promise<void>;
  showTab(tab: ToolsTab): void;
  /** Open Add server on the catalogue. */
  addServer(): void;
}

const TABS: readonly { readonly id: ToolsTab; readonly label: string }[] = [
  { id: "built-in", label: "Built-in" },
  { id: "servers", label: "MCP servers" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
];

const GROUPS: readonly { readonly id: BuiltInToolGroup; readonly note: string }[] = [
  { id: "Read", note: "Look at the project without changing it." },
  { id: "Write", note: "Change files. Edits land or wait for review by your AI edit approval setting." },
  { id: "Run", note: "Run commands in the project folder." },
  { id: "Web", note: "Read pages and APIs on the internet." },
  { id: "Memory", note: "Remember decisions and conventions. Used by the chat." },
];

const MEMORY_KINDS: readonly { readonly id: MemoryItemView["type"]; readonly label: string }[] = [
  { id: "decision", label: "Decisions" },
  { id: "convention", label: "Conventions" },
  { id: "preference", label: "Preferences" },
  { id: "session", label: "Session notes" },
];

const HEALTH: Readonly<Record<AssistantServerView["status"], string>> = {
  connected: "Connected",
  connecting: "Connecting",
  error: "Needs attention",
  disconnected: "Off",
};

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback;
}

/** A switch that is a real checkbox underneath, so keyboard and screen readers get it for free. */
function toggle(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLLabelElement {
  const wrap = el("label", "tools-switch");
  const input = el("input", "");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.checked = checked;
  input.setAttribute("aria-label", label);
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, el("span", "tools-switch-track"));
  return wrap;
}

export function createToolsPage(deps: ToolsPageDeps): ToolsPage {
  const element = el("div", "tools-page");
  element.setAttribute("aria-labelledby", "tools-title");

  /* ── Header, search and tabs ───────────────────────────────────────────── */
  const header = el("header", "tools-header");
  const heading = el("div", "tools-heading");
  const title = el("h1", "tools-title", "Tools");
  title.id = "tools-title";
  const summary = el("p", "tools-summary", "What the assistant and your agents can use.");
  heading.append(title, summary);
  const search = el("input", "form-input tools-search");
  search.type = "search";
  search.placeholder = "Search tools, servers, skills and memory";
  search.setAttribute("aria-label", "Search tools, servers, skills and memory");
  header.append(heading, search);

  const tabList = el("div", "tools-tabs");
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Kinds of tools");
  const tabButtons = new Map<ToolsTab, HTMLButtonElement>();
  const panels = new Map<ToolsTab, HTMLElement>();
  const counts = new Map<ToolsTab, HTMLElement>();
  for (const tab of TABS) {
    const control = el("button", "tools-tab");
    control.type = "button";
    control.id = `tools-tab-${tab.id}`;
    control.setAttribute("role", "tab");
    control.setAttribute("aria-controls", `tools-panel-${tab.id}`);
    const count = el("span", "tools-tab-count", "0");
    control.append(document.createTextNode(tab.label), count);
    control.addEventListener("click", () => showTab(tab.id));
    control.addEventListener("keydown", (event) => {
      const index = TABS.findIndex((item) => item.id === tab.id);
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = TABS[(index + step + TABS.length) % TABS.length]!.id;
      showTab(next);
      tabButtons.get(next)?.focus();
    });
    const panel = el("section", "tools-panel");
    panel.id = `tools-panel-${tab.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", control.id);
    tabButtons.set(tab.id, control);
    panels.set(tab.id, panel);
    counts.set(tab.id, count);
    tabList.append(control);
  }

  const notice = el("p", "tools-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  let noticeTimer: number | undefined;
  function say(text: string): void {
    notice.textContent = text;
    notice.hidden = text === "";
    if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
    if (text !== "") noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 9_000);
  }

  element.append(header, tabList, notice, ...panels.values());

  /* ── State ─────────────────────────────────────────────────────────────── */
  let controls: AssistantControlsView | null = null;
  let memories: readonly MemoryItemView[] = [];
  let agents: readonly AgentProfile[] = [];
  let memoryCommand: { command: string; available: boolean } | null = null;
  let skillScope: "all" | "workspace" | "system" = "all";
  let visible = false;

  function showTab(tab: ToolsTab): void {
    for (const [id, control] of tabButtons) {
      const selected = id === tab;
      control.setAttribute("aria-selected", String(selected));
      control.tabIndex = selected ? 0 : -1;
      const panel = panels.get(id)!;
      // A tab being opened deals its cards in; typing in search never does.
      if (selected && panel.hidden) markFor(panel, "stagger", "true", 900);
      panel.hidden = !selected;
    }
  }

  async function act(action: AssistantControlAction, success?: string): Promise<boolean> {
    try {
      controls = await window.adcode.ai.control(action);
      render();
      if (success !== undefined) say(success);
      return true;
    } catch (error) {
      say(errorText(error, "That did not work. Try again."));
      return false;
    }
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  function render(): void {
    const query = search.value;
    renderBuiltIn(query);
    renderServers(query);
    renderSkills(query);
    renderMemory(query);
    for (const panel of panels.values()) for (const grid of panel.querySelectorAll<HTMLElement>("ul")) indexForStagger(grid);
    const serverCount = controls?.servers.length ?? 0;
    const skillCount = controls?.skills.length ?? 0;
    counts.get("built-in")!.textContent = String(BUILT_IN_TOOLS_INFO.length);
    counts.get("servers")!.textContent = String(serverCount);
    counts.get("skills")!.textContent = String(skillCount);
    counts.get("memory")!.textContent = String(memories.length);
    summary.textContent = `${BUILT_IN_TOOLS_INFO.length} built-in · ${serverCount} MCP server${serverCount === 1 ? "" : "s"} · ${skillCount} skill${skillCount === 1 ? "" : "s"} · ${memories.length} memor${memories.length === 1 ? "y" : "ies"}`;
  }

  function emptyNote(text: string): HTMLElement {
    return el("p", "tools-empty", text);
  }

  function renderBuiltIn(query: string): void {
    const panel = panels.get("built-in")!;
    panel.replaceChildren(el("p", "tools-panel-intro", "ADCode's own tools. The chat has all of them; each saved agent has the ones its tool access allows."));
    let shown = 0;
    for (const group of GROUPS) {
      const tools = BUILT_IN_TOOLS_INFO.filter((tool) => tool.group === group.id && matchesQuery(query, [tool.label, tool.name, tool.description, group.id]));
      if (tools.length === 0) continue;
      shown += tools.length;
      const section = el("section", "tools-group");
      const head = el("div", "tools-group-head");
      head.append(el("h2", "tools-group-title", group.id), el("span", "tools-group-note", group.note));
      const grid = el("ul", "tools-grid");
      grid.setAttribute("role", "list");
      for (const tool of tools) {
        const card = el("li", "tool-card");
        card.setAttribute("role", "listitem");
        const users = toolUsers(tool.name, agents);
        card.append(
          el("strong", "tool-card-name", tool.label),
          el("code", "tool-card-id", tool.name),
          el("p", "tool-card-text", tool.description),
          el("p", "tool-card-users", `Used by: ${users.join(", ")}`),
        );
        grid.append(card);
      }
      section.append(head, grid);
      panel.append(section);
    }
    if (shown === 0) panel.append(emptyNote("No built-in tool matches that search."));
  }

  function renderServers(query: string): void {
    const panel = panels.get("servers")!;
    const bar = el("div", "tools-bar");
    bar.append(el("p", "tools-panel-intro", "Extra tools from MCP servers - browsers, docs, design files, deploys. The chat can use them; each call asks you first."));
    const add = button("Add server", "agents-primary", () => openAddServer("catalogue"));
    add.prepend(createIcon(ICON.plus));
    bar.append(add);
    panel.replaceChildren(bar);
    const servers = (controls?.servers ?? []).filter((server) => matchesQuery(query, [server.name, server.id, server.endpoint, ...server.tools.map((tool) => tool.name)]));
    if (controls !== null && controls.workspace === null) panel.append(emptyNote("Open a project to use MCP servers - they start in its folder."));
    if (servers.length === 0) {
      panel.append(emptyNote(query.trim() ? "No servers or tools match that search." : "No MCP servers yet. Add one from the catalogue in one click."));
      return;
    }
    const grid = el("ul", "tools-grid");
    grid.setAttribute("role", "list");
    for (const server of servers) grid.append(serverCard(server));
    panel.append(grid);
  }

  function serverCard(server: AssistantServerView): HTMLLIElement {
    const card = el("li", "tool-card tool-server");
    card.setAttribute("role", "listitem");
    card.dataset["status"] = server.status;
    const head = el("div", "tool-card-head");
    const light = el("span", "tools-health");
    light.dataset["status"] = server.status;
    light.setAttribute("aria-hidden", "true");
    head.append(light, el("strong", "tool-card-name", server.name), el("span", "tools-health-label", HEALTH[server.status]));
    card.append(head, el("code", "tool-card-id", server.transport === "http" ? server.endpoint : [server.endpoint, ...server.args].join(" ")));
    card.append(el("p", "tool-card-text", serverSummary(server.tools)));
    const problem = explainMcpError(server.error);
    if (problem !== null) {
      const warning = el("p", "tool-card-problem", problem);
      warning.setAttribute("role", "alert");
      card.append(warning);
    }
    card.append(el("p", "tool-card-users", "Used by: Chat"));
    const actions = el("div", "tool-card-actions");
    if (server.status === "connected") {
      actions.append(button("Tools", "agent-box-action agent-box-action-primary", () => openServerTools(server.id)));
      actions.append(button("Disconnect", "agent-box-action", () => void act({ kind: "disconnect", id: server.id }, `${server.name} disconnected.`)));
    } else {
      actions.append(button(server.status === "error" ? "Retry" : "Connect", "agent-box-action agent-box-action-primary", () => void act({ kind: "connect", id: server.id })));
    }
    actions.append(button("Remove", "agent-box-action", () => void (async () => {
      if (!await askThemed({ title: `Remove ${server.name}?`, body: "The assistant stops using its tools. You can add it again later.", confirmLabel: "Remove", danger: true })) return;
      await act({ kind: "remove-server", id: server.id }, `${server.name} removed.`);
    })()));
    for (const control of actions.querySelectorAll("button")) {
      const text = control.textContent ?? "";
      control.setAttribute("aria-label", `${text} ${server.name}`);
    }
    card.append(actions);
    return card;
  }

  function renderSkills(query: string): void {
    const panel = panels.get("skills")!;
    const bar = el("div", "tools-bar");
    bar.append(el("p", "tools-panel-intro", "Written know-how the assistant loads when a task calls for it. Turn one on to offer it."));
    const scope = el("select", "form-select tools-scope");
    scope.setAttribute("aria-label", "Skill location");
    for (const [value, label] of [["all", "All locations"], ["workspace", "This project"], ["system", "This computer"]] as const) {
      const option = el("option", "", label);
      option.value = value;
      scope.append(option);
    }
    scope.value = skillScope;
    scope.addEventListener("change", () => { skillScope = scope.value as typeof skillScope; render(); });
    const add = button("New skill", "agents-primary", () => openNewSkill());
    add.prepend(createIcon(ICON.plus));
    bar.append(scope, add);
    panel.replaceChildren(bar);
    const skills = (controls?.skills ?? []).filter((skill) => (skillScope === "all" || skill.scope === skillScope) && matchesQuery(query, [skill.name, skill.description, skill.source]));
    if (skills.length === 0) {
      panel.append(emptyNote(query.trim() || skillScope !== "all" ? "No skills match." : "No skills yet. Write one to teach the assistant a routine it should follow."));
      return;
    }
    const grid = el("ul", "tools-grid");
    grid.setAttribute("role", "list");
    for (const skill of skills) grid.append(skillCard(skill));
    panel.append(grid);
  }

  function skillCard(skill: AssistantSkillView): HTMLLIElement {
    const card = el("li", "tool-card");
    card.setAttribute("role", "listitem");
    const head = el("div", "tool-card-head");
    head.append(
      el("strong", "tool-card-name", skill.name),
      el("span", "tools-badge", skill.scope === "workspace" ? "This project" : "This computer"),
      toggle(`Offer ${skill.name}`, skill.enabled, (enabled) => void act({ kind: "set-skill", id: skill.id, enabled })),
    );
    card.append(head, el("p", "tool-card-text", skill.description));
    card.append(el("p", "tool-card-users", `${skill.source} · about ${skill.estimatedTokens.toLocaleString()} tokens when used`));
    if (skill.error !== null) {
      const warning = el("p", "tool-card-problem", skill.error);
      warning.setAttribute("role", "alert");
      card.append(warning);
    }
    const actions = el("div", "tool-card-actions");
    const preview = button("Preview", "agent-box-action", () => void openSkillPreview(skill));
    preview.setAttribute("aria-label", `Preview ${skill.name}`);
    actions.append(preview);
    card.append(actions);
    return card;
  }

  function renderMemory(query: string): void {
    const panel = panels.get("memory")!;
    const bar = el("div", "tools-bar");
    bar.append(el("p", "tools-panel-intro", "What the assistant has learned about this project, so nobody has to say it twice. Correct it, delete it, or add your own."));
    const add = button("Add memory", "agents-primary", () => openMemoryEditor(null));
    add.prepend(createIcon(ICON.plus));
    bar.append(add);
    panel.replaceChildren(bar);

    const share = el("section", "tool-card tools-share");
    share.append(el("strong", "tool-card-name", "Share with your other AI tools"), el("p", "tool-card-text", "Claude Code, Cursor and other agents can read and write this same memory over MCP. Run this command once in the project:"));
    const command = el("code", "tools-share-command", memoryCommand?.command ?? "Loading…");
    const copy = button("Copy", "agent-box-action", () => void (async () => {
      if (memoryCommand === null || !memoryCommand.available) return;
      await deps.copy(memoryCommand.command);
      say("Command copied.");
    })());
    copy.disabled = memoryCommand === null || !memoryCommand.available;
    copy.setAttribute("aria-label", "Copy the memory sharing command");
    const commandRow = el("div", "tools-share-row");
    commandRow.append(command, copy);
    share.append(commandRow);
    panel.append(share);

    const shown = memories.filter((memory) => matchesQuery(query, [memory.name, memory.description, memory.body, memory.type]));
    if (memories.length === 0) {
      panel.append(emptyNote("Nothing remembered yet. The chat writes here as you work, or add something yourself."));
      return;
    }
    if (shown.length === 0) {
      panel.append(emptyNote("No memory matches that search."));
      return;
    }
    for (const kind of MEMORY_KINDS) {
      const items = shown.filter((memory) => memory.type === kind.id);
      if (items.length === 0) continue;
      const section = el("section", "tools-group");
      const head = el("div", "tools-group-head");
      head.append(el("h2", "tools-group-title", kind.label));
      const grid = el("ul", "tools-grid");
      grid.setAttribute("role", "list");
      for (const memory of items) grid.append(memoryCard(memory));
      section.append(head, grid);
      panel.append(section);
    }
  }

  function memoryCard(memory: MemoryItemView): HTMLLIElement {
    const card = el("li", "tool-card");
    card.setAttribute("role", "listitem");
    card.append(el("strong", "tool-card-name", memory.description), el("code", "tool-card-id", memory.name), el("p", "tool-card-text tool-card-body", memory.body));
    card.append(el("p", "tool-card-users", `${memory.agents.length > 0 ? `Written by ${memory.agents.join(", ")}` : "Written"} · ${memory.created}`));
    const actions = el("div", "tool-card-actions");
    if (memory.type !== "session") {
      const edit = button("Edit", "agent-box-action", () => openMemoryEditor(memory));
      edit.setAttribute("aria-label", `Edit ${memory.name}`);
      actions.append(edit);
    }
    const remove = button("Delete", "agent-box-action", () => void (async () => {
      if (!await askThemed({ title: "Delete this memory?", body: `"${memory.description}" is forgotten by the assistant and every agent sharing it.`, confirmLabel: "Delete", danger: true })) return;
      try {
        if (await window.adcode.memory.remove(memory.name)) say("Memory deleted.");
        await loadMemory();
      } catch (error) {
        say(errorText(error, "Could not delete that memory."));
      }
    })());
    remove.setAttribute("aria-label", `Delete ${memory.name}`);
    actions.append(remove);
    card.append(actions);
    return card;
  }

  /* ── Dialogs ───────────────────────────────────────────────────────────── */
  function openAddServer(start: "catalogue" | "custom"): void {
    const { dialog, card, finish } = openFormModal("tools-add-server", "Add an MCP server", () => undefined);
    const switcher = el("div", "tools-tabs tools-dialog-tabs");
    switcher.setAttribute("role", "tablist");
    const catalogueTab = button("Catalogue", "tools-tab", () => pick("catalogue"));
    const customTab = button("Custom", "tools-tab", () => pick("custom"));
    for (const tab of [catalogueTab, customTab]) tab.setAttribute("role", "tab");
    switcher.append(catalogueTab, customTab);

    const catalogue = el("ul", "tools-catalogue");
    catalogue.setAttribute("role", "list");
    const existing = new Set((controls?.servers ?? []).map((server) => server.id));
    for (const entry of MCP_CATALOGUE) {
      const item = el("li", "tools-catalogue-item");
      const text = el("div", "tools-catalogue-text");
      text.append(el("strong", "", entry.name), el("p", "", entry.purpose));
      if (entry.before !== null) text.append(el("small", "", entry.before));
      const added = existing.has(entry.id);
      const addEntry = button(added ? "Added" : "Add", added ? "agent-box-action" : "agent-box-action agent-box-action-primary", () => void (async () => {
        addEntry.disabled = true;
        const saved = await act({ kind: "save-server", server: { id: entry.id, name: entry.name, transport: entry.transport, endpoint: entry.endpoint, args: [...entry.args] } });
        if (!saved) { addEntry.disabled = false; return; }
        addEntry.textContent = "Added";
        finish();
        showTab("servers");
        await act({ kind: "connect", id: entry.id }, `${entry.name} added. Connecting…`);
      })());
      addEntry.disabled = added;
      addEntry.setAttribute("aria-label", `Add ${entry.name}`);
      item.append(text, addEntry);
      catalogue.append(item);
    }

    const form = el("form", "form-dialog-form");
    const name = el("input", "form-input");
    name.required = true;
    name.maxLength = 100;
    name.placeholder = "e.g. Project search";
    const id = el("input", "form-input");
    id.required = true;
    id.maxLength = 48;
    id.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
    id.placeholder = "project-search";
    const transport = el("select", "form-select");
    for (const [value, label] of [["stdio", "Local command (stdio)"], ["http", "Remote URL (HTTP)"]] as const) {
      const option = el("option", "", label);
      option.value = value;
      transport.append(option);
    }
    const endpoint = el("input", "form-input");
    endpoint.required = true;
    endpoint.placeholder = "e.g. npx";
    const args = el("input", "form-input");
    args.value = "[]";
    args.placeholder = '["-y", "your-mcp-server"]';
    transport.addEventListener("change", () => {
      endpoint.placeholder = transport.value === "http" ? "https://example.com/mcp" : "e.g. npx";
      args.disabled = transport.value === "http";
    });
    const problem = el("p", "form-notice");
    problem.setAttribute("role", "alert");
    problem.hidden = true;
    const row = el("div", "form-row");
    row.append(field("Server ID", id, "Lowercase words joined by hyphens."), field("Connection", transport));
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Save server");
    save.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(field("Name", name), row, field("Command or URL", endpoint), field("Arguments (a JSON list)", args, "Local commands run with your account's permissions. Keep keys and passwords out of these fields - use the server's own sign-in."), problem, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      let parsed: unknown;
      try { parsed = JSON.parse(args.value || "[]"); } catch { parsed = null; }
      if (transport.value === "stdio" && (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string"))) {
        problem.hidden = false;
        problem.textContent = 'Arguments must be a JSON list of strings, like ["-y", "server-name"].';
        return;
      }
      const argsList = transport.value === "http" ? [] : (parsed as string[]);
      void act({ kind: "save-server", server: { id: id.value.trim(), name: name.value.trim(), transport: transport.value as "stdio" | "http", endpoint: endpoint.value.trim(), args: argsList } }, `${name.value.trim()} saved. Connect it from its card.`).then((ok) => {
        if (ok) { finish(); showTab("servers"); }
      });
    });

    function pick(which: "catalogue" | "custom"): void {
      catalogueTab.setAttribute("aria-selected", String(which === "catalogue"));
      customTab.setAttribute("aria-selected", String(which === "custom"));
      catalogue.hidden = which !== "catalogue";
      form.hidden = which !== "custom";
    }
    const closeRow = el("div", "confirm-buttons");
    closeRow.append(button("Close", "confirm-cancel", finish));
    card.append(switcher, catalogue, form, closeRow);
    pick(start);
    dialog.showModal();
    (start === "custom" ? name : catalogueTab).focus();
  }

  function openServerTools(serverId: string): void {
    const server = controls?.servers.find((candidate) => candidate.id === serverId);
    if (server === undefined) return;
    const { dialog, card, finish } = openFormModal("tools-server-detail", server.name, () => undefined);
    card.append(el("p", "result-summary", "Turn on the tools the assistant may call. Each call still asks you first."));
    const list = el("ul", "tools-tool-list");
    list.setAttribute("role", "list");
    for (const tool of server.tools) {
      const item = el("li", "tools-tool");
      const text = el("div", "tools-tool-text");
      text.append(el("strong", "", tool.name), el("p", "", tool.description));
      const stats = [tool.calls > 0 ? `${tool.calls} call${tool.calls === 1 ? "" : "s"}` : "Not used yet", tool.lastDurationMs !== null ? `last took ${tool.lastDurationMs} ms` : ""].filter(Boolean).join(" · ");
      text.append(el("small", "", stats));
      if (tool.lastError !== null) text.append(el("small", "tool-card-problem", tool.lastError));
      item.append(text, toggle(`Allow ${tool.name}`, tool.enabled, (enabled) => void act({ kind: "set-tool", id: server.id, tool: tool.name, enabled })));
      list.append(item);
    }
    if (server.tools.length === 0) list.append(el("li", "tools-empty", "This server has not offered any tools."));
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Done", "result-close", finish));
    card.append(list, buttons);
    dialog.showModal();
  }

  async function openSkillPreview(skill: AssistantSkillView): Promise<void> {
    let text: string;
    try { text = await window.adcode.ai.previewSkill(skill.id); } catch (error) { say(errorText(error, "Could not read that skill.")); return; }
    const { dialog, card, finish } = openFormModal("tools-skill-preview", skill.name, () => undefined);
    const pre = el("pre", "tools-preview", text);
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Close", "result-close", finish));
    card.append(el("p", "result-summary", skill.path), pre, buttons);
    dialog.showModal();
  }

  function openNewSkill(): void {
    const { dialog, card, finish } = openFormModal("tools-new-skill", "New skill", () => undefined);
    const form = el("form", "form-dialog-form");
    const name = el("input", "form-input");
    name.required = true;
    name.maxLength = 64;
    name.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
    name.placeholder = "review-code";
    const description = el("input", "form-input");
    description.required = true;
    description.maxLength = 1024;
    description.placeholder = "Review code changes for bugs and missing tests";
    const instructions = el("textarea", "form-input");
    instructions.rows = 8;
    instructions.required = true;
    instructions.maxLength = 55_000;
    instructions.placeholder = "The steps, the checks, and what a good result looks like…";
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Create skill");
    save.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(field("Name", name, "Lowercase words joined by hyphens."), field("When to use it", description), field("Instructions", instructions), buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void act({ kind: "create-skill", name: name.value.trim(), description: description.value.trim(), instructions: instructions.value }, `${name.value.trim()} created in this project.`).then((ok) => { if (ok) finish(); });
    });
    card.append(form);
    dialog.showModal();
    name.focus();
  }

  function openMemoryEditor(memory: MemoryItemView | null): void {
    const { dialog, card, finish } = openFormModal("tools-memory-editor", memory ? "Edit memory" : "Add memory", () => undefined);
    const form = el("form", "form-dialog-form");
    const name = el("input", "form-input");
    name.required = true;
    name.maxLength = 128;
    name.pattern = "[a-z0-9][a-z0-9-]*";
    name.placeholder = "use-pnpm";
    name.value = memory?.name ?? "";
    name.readOnly = memory !== null;
    const kind = el("select", "form-select");
    for (const option of MEMORY_KINDS.filter((item) => item.id !== "session")) {
      const node = el("option", "", option.label.replace(/s$/, ""));
      node.value = option.id;
      kind.append(node);
    }
    kind.value = memory?.type === "session" || memory === null ? "convention" : memory.type;
    const description = el("input", "form-input");
    description.required = true;
    description.maxLength = 300;
    description.placeholder = "The project uses pnpm, never npm";
    description.value = memory?.description ?? "";
    const body = el("textarea", "form-input");
    body.rows = 6;
    body.required = true;
    body.maxLength = 20_000;
    body.placeholder = "The detail an agent needs, and why.";
    body.value = memory?.body ?? "";
    const problem = el("p", "form-notice");
    problem.setAttribute("role", "alert");
    problem.hidden = true;
    const row = el("div", "form-row");
    row.append(field("Name", name, "Lowercase words joined by hyphens."), field("Kind", kind));
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Save");
    save.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(row, field("In one line", description), field("Details", body), problem, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        try {
          const written = await window.adcode.memory.write({ name: name.value.trim(), description: description.value, type: kind.value as "decision" | "convention" | "preference", body: body.value });
          if (written === null) {
            problem.hidden = false;
            problem.textContent = "That could not be saved. Check the name uses only lowercase letters, digits and hyphens, and that a project is open.";
            return;
          }
          finish();
          say("Memory saved. The assistant and shared agents will use it.");
          await loadMemory();
        } catch (error) {
          problem.hidden = false;
          problem.textContent = errorText(error, "Could not save that memory.");
        }
      })();
    });
    card.append(form);
    dialog.showModal();
    (memory ? description : name).focus();
  }

  /* ── Data ──────────────────────────────────────────────────────────────── */
  async function loadMemory(): Promise<void> {
    const [list, connection] = await Promise.all([
      window.adcode.memory.list().catch(() => [] as readonly MemoryItemView[]),
      window.adcode.memory.connection().catch(() => null),
    ]);
    memories = list;
    memoryCommand = connection;
    render();
  }

  async function refresh(): Promise<void> {
    try {
      const [view, values] = await Promise.all([window.adcode.ai.controls(), window.adcode.settings.read()]);
      controls = view;
      agents = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
      if (view.notice) say(view.notice);
      await loadMemory();
    } catch (error) {
      say(errorText(error, "Could not load tools."));
    }
  }

  search.addEventListener("input", () => render());
  window.adcode.ai.onControlsChanged(() => { if (visible) void window.adcode.ai.controls().then((view) => { controls = view; render(); }).catch(() => undefined); });
  window.adcode.settings.onChanged((values) => { agents = parseAgentProfiles(values[AGENT_PROFILES_SETTING]); if (visible) render(); });
  window.adcode.workspace.onChanged(() => { if (visible) void refresh(); });

  showTab("built-in");
  render();
  return {
    element,
    shown(): void {
      visible = true;
      void refresh();
    },
    hidden(): void {
      visible = false;
    },
    refresh,
    showTab,
    addServer: () => openAddServer("catalogue"),
  };
}
