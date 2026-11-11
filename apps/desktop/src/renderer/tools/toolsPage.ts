/**
 * The Tools page: what the assistant and your agents can use.
 *
 * Four tabs of cards - ADCode's built-in tools, connectors, skills, and project memory -
 * with one search across all of them. Agents are who; tools are what.
 *
 * The connectors tab is the front door for everything that comes from outside: MCP
 * servers added by hand or imported from Claude Desktop, Claude Code, Cursor, Windsurf
 * or VS Code; Claude Desktop extensions (`.mcpb`); Claude Code plugins; and OpenAPI
 * descriptions standing in for ChatGPT plugins and GPT Actions. Each card carries a badge
 * saying which it is, and the import dialog never installs anything until Add is pressed.
 *
 * The connector and skill state is the main process's (see `assistantControlsService.ts`);
 * this page renders it and sends actions, with no optimistic copy of its own.
 */
import type { McpConnectionInfo, MemoryItemView, ToolBridgeView } from "../../shared/api.ts";
import type {
  AssistantConnectorKind,
  AssistantControlAction,
  AssistantControlsView,
  AssistantServerView,
  AssistantSkillView,
  ConnectorDraftView,
} from "../../shared/assistantControls.ts";
import { mcpCatalogueFor } from "../../shared/mcpCatalogue.ts";
import { SKILL_SORTS, isSkillSort, skillSources, sortSkills, type SkillSort } from "../../shared/skillOrder.ts";

const SKILL_SORT_KEY = "adcode.tools.skillSort";
function storedSkillSort(): SkillSort {
  try {
    const saved = localStorage.getItem(SKILL_SORT_KEY);
    return isSkillSort(saved) ? saved : "smart";
  } catch {
    return "smart";
  }
}
import { MCP_NODE_REQUIREMENT, mcpNodeNote } from "../../shared/mcpNode.ts";
import { AGENT_PROFILES_SETTING, parseAgentProfiles, type AgentProfile } from "../ai/agentProfiles.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { createIcon, ICON, iconButton } from "../workbench/icons.ts";
import { BUILT_IN_TOOLS_INFO, type BuiltInToolGroup } from "./builtInTools.ts";
import { explainMcpError, freeServerId, matchesQuery, mcpUrlProblem, serverIdFromName, serverSummary, toolUsers } from "./toolsModel.ts";
import { indexForStagger, markFor } from "../motionFlip.ts";
import { isWebSurface } from "../surface.ts";

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
  /** Open Add connector, on the import step. */
  addServer(): void;
}

const TABS: readonly { readonly id: ToolsTab; readonly label: string }[] = [
  { id: "built-in", label: "Built-in" },
  { id: "servers", label: "Connectors" },
  { id: "skills", label: "Skills" },
  { id: "memory", label: "Memory" },
];

/** How each kind of connector is named on its badge. */
const KIND_LABEL: Readonly<Record<AssistantConnectorKind, string>> = { mcp: "MCP", openapi: "Actions", extension: "Extension", plugin: "Plugin" };

/** Where the OpenAPI description alone could not say how to sign in. */
const TOKEN_KEY = "token";

const GROUPS: readonly { readonly id: BuiltInToolGroup; readonly note: string }[] = [
  { id: "Read", note: "Look at the project without changing it." },
  { id: "Write", note: "Change files. Edits land or wait for review by your AI edit approval setting." },
  { id: "Run", note: "Run commands in the project folder, or keep a dev server running." },
  { id: "Preview", note: "See the app you are building, as a visitor would. Used by the chat." },
  { id: "Quality", note: "Check code, accessible controls, responsive layouts and reduced motion before handing over a product." },
  { id: "Plan", note: "Show the steps of a bigger task as they get done. Used by the chat." },
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

/** A badge naming what a connector is: MCP, Extension, Plugin, or Actions. */
function kindBadge(kind: AssistantConnectorKind): HTMLElement {
  const badge = el("span", "tools-kind", KIND_LABEL[kind]);
  badge.dataset["kind"] = kind;
  return badge;
}

/** Where this connector came from, in the fewest honest words. */
function originText(server: AssistantServerView): string {
  const version = server.version !== null ? ` · v${server.version}` : "";
  if (server.kind === "extension") return `Claude Desktop extension${version}`;
  if (server.kind === "plugin") return `Claude Code plugin${version}`;
  if (server.kind === "openapi") return server.source !== "" ? server.source : "OpenAPI actions";
  return server.source !== "" ? server.source : "Added by hand";
}

function addressOf(server: AssistantServerView): string {
  if (server.kind === "plugin" || server.kind === "extension") return server.endpoint;
  if (server.transport === "stdio") return [server.endpoint, ...server.args].join(" ");
  return server.endpoint;
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
  search.placeholder = "Search tools, connectors, skills and memory";
  search.setAttribute("aria-label", "Search tools, connectors, skills and memory");
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
  let memoryCommand: McpConnectionInfo | null = null;
  let bridge: ToolBridgeView | null = null;
  let bridgeEnabled = true;
  let skillScope: "all" | "workspace" | "system" = "all";
  let skillSort: SkillSort = storedSkillSort();
  /** One source ("Claude", "Plugin: x") to narrow the Skills tab to, or "" for all. */
  let skillSource = "";
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
    return (await perform(action, success)) === null;
  }

  /** Same as `act`, but hands the failure message back for a dialog to show in place. */
  async function perform(action: AssistantControlAction, success?: string): Promise<string | null> {
    try {
      controls = await window.adcode.ai.control(action);
      render();
      if (controls.notice !== null) say(controls.notice);
      if (success !== undefined) say(success);
      return null;
    } catch (error) {
      const message = errorText(error, "That did not work. Try again.");
      say(message);
      return message;
    }
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */
  function render(): void {
    const query = search.value;
    renderBuiltIn(query);
    renderConnectors(query);
    renderSkills(query);
    renderMemory(query);
    for (const panel of panels.values()) for (const grid of panel.querySelectorAll<HTMLElement>("ul, ol")) indexForStagger(grid);
    const serverCount = controls?.servers.length ?? 0;
    const skillCount = controls?.skills.length ?? 0;
    const draftCount = controls?.drafts.length ?? 0;
    counts.get("built-in")!.textContent = String(BUILT_IN_TOOLS_INFO.length);
    counts.get("servers")!.textContent = String(serverCount + draftCount);
    counts.get("skills")!.textContent = String(skillCount);
    counts.get("memory")!.textContent = String(memories.length);
    summary.textContent = `${BUILT_IN_TOOLS_INFO.length} built-in · ${serverCount} connector${serverCount === 1 ? "" : "s"}${draftCount > 0 ? ` + ${draftCount.toString()} to add` : ""} · ${skillCount} skill${skillCount === 1 ? "" : "s"} · ${memories.length} memor${memories.length === 1 ? "y" : "ies"}`;
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

  /* ── Connectors ────────────────────────────────────────────────────────── */

  function renderConnectors(query: string): void {
    const panel = panels.get("servers")!;
    const bar = el("div", "tools-bar");
    bar.append(el("p", "tools-panel-intro", "Connectors give the assistant extra tools: MCP servers, Claude Desktop extensions, Claude Code plugins, and OpenAI-style actions. The chat can use them; each call asks you first."));
    const custom = button("Add custom connector", "agents-secondary", () => openAddConnector("custom"));
    custom.prepend(createIcon(ICON.plus));
    const add = button("Add connector", "agents-primary", () => openAddConnector("import"));
    add.prepend(createIcon(ICON.plus));
    bar.append(custom, add);
    panel.replaceChildren(bar);

    const drafts = (controls?.drafts ?? []).filter((draft) => matchesQuery(query, [draft.name, draft.purpose, draft.source, draft.kind, ...draft.skills, ...draft.servers.map((item) => item.name)]));
    if (drafts.length > 0) panel.append(draftSection(drafts));

    const servers = (controls?.servers ?? []).filter((server) => matchesQuery(query, [server.name, server.id, server.endpoint, server.source, KIND_LABEL[server.kind], ...server.tools.map((tool) => tool.name)]));
    if (servers.length === 0) {
      panel.append(emptyNote(query.trim() ? "No connectors or tools match that search." : "No connectors yet. Add a custom connector, import what Claude, Cursor or VS Code already have, add a file, or pick one from the catalogue."));
      return;
    }
    const grid = el("ul", "tools-grid");
    grid.setAttribute("role", "list");
    for (const server of servers) grid.append(connectorCard(server));
    panel.append(grid);
  }

  /** The things found but not yet added. Dashed borders: nothing here is installed yet. */
  function draftSection(drafts: readonly ConnectorDraftView[]): HTMLElement {
    const section = el("section", "tools-group tools-drafts");
    const head = el("div", "tools-group-head");
    head.append(el("h2", "tools-group-title", "Waiting to be added"), el("span", "tools-group-note", `${drafts.length.toString()} found · nothing is installed until you press Add`));
    const grid = el("ul", "tools-grid");
    grid.setAttribute("role", "list");
    for (const draft of drafts) grid.append(draftCard(draft));
    section.append(head, grid);
    return section;
  }

  function draftCard(draft: ConnectorDraftView): HTMLLIElement {
    const card = el("li", "tool-card tools-draft-card");
    card.setAttribute("role", "listitem");
    card.dataset["kind"] = draft.kind;
    const head = el("div", "tool-card-head");
    head.append(el("strong", "tool-card-name", draft.name), kindBadge(draft.kind));
    card.append(head, el("p", "tool-card-users", draft.source));
    card.append(el("p", "tool-card-text", draft.purpose));
    const facts: string[] = [];
    if (draft.skills.length > 0) facts.push(`${draft.skills.length.toString()} skill${draft.skills.length === 1 ? "" : "s"}`);
    if (draft.servers.length > 0) facts.push(`${draft.servers.length.toString()} MCP server${draft.servers.length === 1 ? "" : "s"}`);
    if (draft.operations > 0) facts.push(`${draft.operations.toString()} operation${draft.operations === 1 ? "" : "s"}`);
    if (draft.values.length > 0) facts.push(`asks for ${draft.values.length.toString()} value${draft.values.length === 1 ? "" : "s"}`);
    if (facts.length > 0) card.append(el("p", "tool-card-users", facts.join(" · ")));
    if (draft.endpoint !== "" && draft.kind !== "plugin") card.append(el("code", "tool-card-id", draft.endpoint));
    for (const warning of draft.warnings.slice(0, 3)) {
      const problem = el("p", "tool-card-problem", warning);
      card.append(problem);
    }
    if (draft.warnings.length > 3) card.append(el("p", "tool-card-users", `and ${(draft.warnings.length - 3).toString()} more note${draft.warnings.length - 3 === 1 ? "" : "s"}`));
    if (draft.problem !== null) {
      const problem = el("p", "tool-card-problem", draft.problem);
      problem.setAttribute("role", "alert");
      card.append(problem);
    }
    const actions = el("div", "tool-card-actions");
    const add = button("Add", "agent-box-action agent-box-action-primary", () => openDraftValues(draft));
    add.disabled = !draft.installable;
    add.setAttribute("aria-label", `Add ${draft.name}`);
    const discard = button("Discard", "agent-box-action", () => void act({ kind: "discard-draft", handle: draft.handle }, `${draft.name} discarded.`));
    discard.setAttribute("aria-label", `Discard ${draft.name}`);
    actions.append(add, discard);
    card.append(actions);
    return card;
  }

  function connectorCard(server: AssistantServerView): HTMLLIElement {
    const card = el("li", "tool-card tool-server");
    card.setAttribute("role", "listitem");
    card.dataset["status"] = server.status;
    card.dataset["kind"] = server.kind;
    const head = el("div", "tool-card-head");
    const light = el("span", "tools-health");
    light.dataset["status"] = server.status;
    light.setAttribute("aria-hidden", "true");
    head.append(light, el("strong", "tool-card-name", server.name), kindBadge(server.kind), el("span", "tools-health-label", HEALTH[server.status]));
    card.append(head);
    const meta = [originText(server), server.purpose].filter((part) => part.trim() !== "").join(" · ");
    if (meta !== "") card.append(el("p", "tool-card-users", meta));
    card.append(el("code", "tool-card-id", addressOf(server)));
    if (server.kind !== "plugin") card.append(el("p", "tool-card-text", serverSummary(server.tools)));
    if (server.kind === "plugin") card.append(el("p", "tool-card-text", `Installed in ${server.root ?? server.endpoint}. Its skills appear on the Skills tab; its own servers are connectors of their own.`));
    if (server.valueKeys.length > 0) card.append(valuesRow(server));
    const problem = explainMcpError(server.error);
    if (problem !== null) {
      const warning = el("p", "tool-card-problem", problem);
      warning.setAttribute("role", "alert");
      card.append(warning);
    }
    if (server.kind !== "plugin") card.append(el("p", "tool-card-users", "Used by: Chat"));
    const actions = el("div", "tool-card-actions");
    if (server.kind !== "plugin") {
      if (server.status === "connected") {
        actions.append(button("Tools", "agent-box-action agent-box-action-primary", () => openServerTools(server.id)));
        actions.append(button("Disconnect", "agent-box-action", () => void act({ kind: "disconnect", id: server.id }, `${server.name} disconnected.`)));
      } else if (server.oauth === "required") {
        // The server named an OAuth sign-in: the browser does it, then the card connects.
        const signIn = button("Sign in", "agent-box-action agent-box-action-primary", () => void (async () => {
          signIn.disabled = true;
          signIn.textContent = "Finish in your browser…";
          say(`Sign in to ${server.name} in your browser. ADCode connects when you are done.`);
          if (!await act({ kind: "sign-in", id: server.id }, `${server.name} signed in.`)) { signIn.disabled = false; signIn.textContent = "Sign in"; }
        })());
        signIn.dataset["action"] = "sign-in";
        actions.append(signIn);
      } else {
        const label = server.status === "error" ? "Retry" : server.status === "connecting" ? "Connecting…" : "Connect";
        const connect = button(label, "agent-box-action agent-box-action-primary", () => void act({ kind: "connect", id: server.id }));
        connect.disabled = server.status === "connecting";
        actions.append(connect);
      }
      if (server.oauth === "signed-in") {
        actions.append(button("Sign out", "agent-box-action", () => void act({ kind: "sign-out", id: server.id }, `${server.name} signed out.`)));
      }
      if (missingToken(server)) actions.append(button("Add token", "agent-box-action", () => openValues(server, [TOKEN_KEY])));
    }
    const remove = button("Remove", "agent-box-action", () => void (async () => {
      const destroys = server.kind === "extension" || server.kind === "plugin";
      if (!await askThemed({
        title: `Remove ${server.name}?`,
        body: destroys ? "The assistant stops using its tools, and the files ADCode installed for it are deleted." : "The assistant stops using its tools. You can add it again later.",
        confirmLabel: "Remove",
        danger: true,
      })) return;
      await act({ kind: "remove-server", id: server.id }, `${server.name} removed.`);
    })());
    actions.append(remove);
    for (const control of actions.querySelectorAll("button")) {
      const text = control.textContent ?? "";
      control.setAttribute("aria-label", `${text} ${server.name}`);
    }
    card.append(actions);
    return card;
  }

  /** Which stored values a connector has, with a way to forget them all. */
  function valuesRow(server: AssistantServerView): HTMLElement {
    const row = el("p", "tool-card-values");
    const lock = el("span", "tools-lock");
    lock.append(createIcon(ICON.lock));
    lock.setAttribute("aria-hidden", "true");
    row.append(lock, document.createTextNode(`${server.valueKeys.join(", ")} · kept in the OS-encrypted store`));
    const forget = button("Forget", "tools-inline-action", () => void (async () => {
      if (!await askThemed({ title: `Forget stored values for ${server.name}?`, body: "The connector keeps working only if its values are not needed - most need them, and will ask again.", confirmLabel: "Forget", danger: true })) return;
      await act({ kind: "forget-values", id: server.id }, `Stored values for ${server.name} forgotten.`);
    })());
    forget.setAttribute("aria-label", `Forget stored values for ${server.name}`);
    row.append(forget);
    return row;
  }

  function missingToken(server: AssistantServerView): boolean {
    return server.kind === "openapi" && server.auth !== null && server.auth.needsToken && !server.valueKeys.includes(TOKEN_KEY);
  }

  /* ── Skills ────────────────────────────────────────────────────────────── */

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
    const order = el("select", "form-select tools-scope");
    order.setAttribute("aria-label", "Sort skills");
    for (const sort of SKILL_SORTS) {
      const option = el("option", "", `Sort: ${sort.label}`);
      option.value = sort.id;
      order.append(option);
    }
    order.value = skillSort;
    order.addEventListener("change", () => {
      if (!isSkillSort(order.value)) return;
      skillSort = order.value;
      try { localStorage.setItem(SKILL_SORT_KEY, skillSort); } catch { /* The choice lasts for this session. */ }
      render();
    });
    const add = button("New skill", "agents-primary", () => openNewSkill());
    add.prepend(createIcon(ICON.plus));
    bar.append(scope, order, add);
    panel.replaceChildren(bar);
    const everySkill = controls?.skills ?? [];
    // Where they came from, as chips: one press narrows the list, and a whole tool's skills go on or off at once.
    const sources = skillSources(everySkill);
    if (sources.length > 1) {
      const chips = el("div", "tools-skill-sources");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "Where skills came from");
      for (const item of [{ source: "", count: everySkill.length, enabled: everySkill.filter((skill) => skill.enabled).length }, ...sources]) {
        const chip = button(`${item.source === "" ? "All" : item.source} · ${item.enabled.toString()}/${item.count.toString()}`, "tools-skill-source", () => { skillSource = item.source; render(); });
        chip.setAttribute("aria-pressed", String(skillSource === item.source));
        chips.append(chip);
      }
      panel.append(chips);
    }
    if (skillSource !== "" && !sources.some((item) => item.source === skillSource)) skillSource = "";
    const skills = sortSkills(everySkill.filter((skill) => (skillScope === "all" || skill.scope === skillScope) && (skillSource === "" || skill.source === skillSource) && matchesQuery(query, [skill.name, skill.description, skill.source])), skillSort);
    if (skills.length > 1) {
      const bulk = el("div", "tools-skill-bulk");
      const usable = skills.filter((skill) => skill.error === null);
      const on = usable.filter((skill) => skill.enabled).length;
      const pinned = everySkill.filter((skill) => skill.rank === "pinned").length;
      bulk.append(el("span", "", `${skills.length.toString()} shown · ${on.toString()} on${pinned > 0 ? ` · ${pinned.toString()} pinned` : ""}`));
      const allOn = button("Turn these on", "agent-box-action", () => void act({ kind: "set-skills", ids: usable.map((skill) => skill.id), enabled: true }, "Skills turned on."));
      allOn.disabled = on === usable.length;
      const allOff = button("Turn these off", "agent-box-action", () => void act({ kind: "set-skills", ids: skills.map((skill) => skill.id), enabled: false }, "Skills turned off."));
      allOff.disabled = skills.every((skill) => !skill.enabled);
      bulk.append(allOn, allOff);
      panel.append(bulk);
    }
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
    card.dataset["rank"] = skill.rank;
    card.append(head, el("p", "tool-card-text", skill.description));
    card.append(el("p", "tool-card-users", `${skill.source} · about ${skill.estimatedTokens.toLocaleString()} tokens when used${skill.rank === "pinned" ? " · pinned: offered first" : skill.rank === "low" ? " · last resort: only when nothing else fits" : ""}`));
    if (skill.error !== null) {
      const warning = el("p", "tool-card-problem", skill.error);
      warning.setAttribute("role", "alert");
      card.append(warning);
    }
    const actions = el("div", "tool-card-actions");
    const preview = button("Preview", "agent-box-action", () => void openSkillPreview(skill));
    preview.setAttribute("aria-label", `Preview ${skill.name}`);
    const pin = button(skill.rank === "pinned" ? "Unpin" : "Pin", "agent-box-action", () => void act({ kind: "rank-skill", id: skill.id, rank: skill.rank === "pinned" ? "normal" : "pinned" }));
    pin.setAttribute("aria-label", `${skill.rank === "pinned" ? "Unpin" : "Pin"} ${skill.name}`);
    pin.setAttribute("aria-pressed", String(skill.rank === "pinned"));
    pin.title = "Pinned skills are listed first and offered to the assistant ahead of the rest";
    const low = button(skill.rank === "low" ? "Normal priority" : "Last resort", "agent-box-action", () => void act({ kind: "rank-skill", id: skill.id, rank: skill.rank === "low" ? "normal" : "low" }));
    low.setAttribute("aria-label", `${skill.rank === "low" ? "Give normal priority to" : "Make a last resort of"} ${skill.name}`);
    low.setAttribute("aria-pressed", String(skill.rank === "low"));
    low.title = "A last-resort skill stays on, but the assistant is only offered it when nothing else matches";
    actions.append(preview, pin, low);
    card.append(actions);
    return card;
  }

  /* ── Memory ────────────────────────────────────────────────────────────── */

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
    // With no command to give, `command` holds the reason - a sentence, which belongs in the
    // note below rather than in a one-line command box beside a Copy button that cannot work.
    if (memoryCommand === null || memoryCommand.available) share.append(commandRow);
    share.append(el("p", "tool-card-text", MCP_NODE_REQUIREMENT));
    const problem = memoryCommand === null ? null : memoryCommand.available ? mcpNodeNote(memoryCommand.node) : memoryCommand.command;
    if (problem !== null) {
      const warning = el("p", "tool-card-problem", problem);
      warning.setAttribute("role", "status");
      share.append(warning);
    }
    panel.append(share);
    // The bridge lives in the desktop's main process; the web version has nothing to offer.
    if (!isWebSurface()) panel.append(bridgeCard());

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

  /**
   * The tool bridge: ADCode's own tools for Claude Code, Codex, Cursor and the rest. The
   * switch is the setting itself, so this card and Settings can never disagree.
   */
  function bridgeCard(): HTMLElement {
    const card = el("section", "tool-card tools-share");
    const head = el("div", "tool-card-head");
    const state = bridge?.running === true ? "On" : bridgeEnabled ? (bridge === null ? "Loading" : "Not running") : "Off";
    head.append(
      el("strong", "tool-card-name", "Let other AI tools use ADCode"),
      el("span", "tools-badge", state),
      toggle("Let other AI tools use ADCode", bridgeEnabled, (enabled) => void (async () => {
        try {
          await window.adcode.settings.write("adcode.ai.toolBridge", enabled);
          bridgeEnabled = enabled;
          await loadBridge();
          say(enabled ? "Other AI tools can use ADCode." : "Other AI tools can no longer use ADCode.");
        } catch (error) {
          say(errorText(error, "Could not change that."));
        }
      })()),
    );
    card.append(head, el("p", "tool-card-text", "Claude Code, Codex, Cursor and other coding agents on this computer can use ADCode's own tools: its features, settings, connectors and Browser panel. Add ADCode to them once with one of these:"));
    if (bridge !== null && bridge.running && bridge.url !== null) {
      const url = el("code", "tools-share-command", bridge.url);
      const urlRow = el("div", "tools-share-row");
      urlRow.append(url);
      card.append(urlRow);
      for (const config of bridge.configs) {
        card.append(el("p", "tool-card-users", config.client));
        const multiLine = config.text.includes("\n");
        const text = el(multiLine ? "pre" : "code", multiLine ? "agents-attachment-text" : "tools-share-command", config.text);
        const copy = button("Copy", "agent-box-action", () => void (async () => {
          await deps.copy(config.text);
          say(`${config.client} config copied. It contains your key - paste it only into your own tools.`);
        })());
        copy.setAttribute("aria-label", `Copy the ${config.client} config`);
        const row = el("div", "tools-share-row");
        row.append(text, copy);
        card.append(row);
      }
      card.append(el("p", "tool-card-text", "Only programs on this computer that have the key get in, and anything ADCode would ask you about still asks here first."));
      const actions = el("div", "tool-card-actions");
      const regenerate = button("Regenerate key", "agent-box-action", () => void (async () => {
        if (!await askThemed({ title: "Make a new key?", body: "Every AI tool you added ADCode to stops reaching it until you copy a config from here again.", confirmLabel: "Make a new key", danger: true })) return;
        try {
          bridge = await window.adcode.ai.regenerateToolBridgeToken();
          render();
          say("New key made. Copy the config again into each tool.");
        } catch (error) {
          say(errorText(error, "Could not make a new key."));
        }
      })());
      actions.append(regenerate);
      card.append(actions);
    } else if (bridge?.problem) {
      const warning = el("p", "tool-card-problem", bridge.problem);
      warning.setAttribute("role", "status");
      card.append(warning);
    } else if (!bridgeEnabled) {
      card.append(el("p", "tool-card-text", "Off: no other program can reach ADCode's tools. Switch it on to see the configs."));
    }
    return card;
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

  /* ── Connector dialogs ─────────────────────────────────────────────────── */

  /** The four ways in: the catalogue, this computer, a file or link, or by hand. */
  function openAddConnector(start: "catalogue" | "import" | "file" | "custom"): void {
    const web = isWebSurface();
    const { dialog, card, title, finish } = openFormModal("tools-add-connector", start === "custom" ? "Add custom connector" : "Add a connector", () => undefined);
    // The title, its close button, and one honest line: what this is, and when anything happens.
    const head = el("div", "tools-dialog-head");
    const headRow = el("div", "tools-dialog-head-row");
    const close = iconButton("Close", ICON.close, "icon-button tools-dialog-close");
    close.addEventListener("click", finish);
    headRow.append(title, close);
    const externalLink = (label: string, href: string): HTMLAnchorElement => {
      const link = el("a", "tools-dialog-link", label);
      link.href = href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      return link;
    };
    const sub = el("p", "tools-dialog-sub");
    if (start === "custom") {
      const prebuilt = button("get started with pre-built ones", "tools-dialog-inline-link", () => {
        switcher.hidden = false;
        pick("catalogue");
      });
      sub.append(
        "Connect ADCode to your data and tools. ",
        externalLink("Learn more about connectors", "https://adcode.bluethenics.com/docs/connectors"),
        " or ",
        prebuilt,
        ".",
      );
    } else {
      sub.textContent = "Catalogue, import, a file or link, or a custom connector - nothing is added until you continue.";
    }
    head.append(headRow, sub);
    card.prepend(head);
    const switcher = el("div", "tools-tabs tools-dialog-tabs");
    switcher.setAttribute("role", "tablist");
    if (start === "custom") switcher.hidden = true;
    const steps = [
      { id: "catalogue" as const, label: "Catalogue" },
      { id: "import" as const, label: "Import" },
      { id: "file" as const, label: web ? "Link or text" : "From a file" },
      { id: "custom" as const, label: "Custom connector" },
    ];
    const stepButtons = new Map<string, HTMLButtonElement>();
    for (const step of steps) {
      const control = button(step.label, "tools-tab", () => pick(step.id));
      control.setAttribute("role", "tab");
      stepButtons.set(step.id, control);
      switcher.append(control);
    }

    const status = el("p", "tools-dialog-status");
    status.setAttribute("role", "status");
    status.hidden = true;
    function report(text: string | null): void {
      status.textContent = text ?? "";
      status.hidden = text === null;
    }
    /** Run an action from inside the dialog and keep its answer here, where the focus is. */
    async function run(action: AssistantControlAction, success?: string): Promise<boolean> {
      const failure = await perform(action, success);
      report(failure ?? success ?? null);
      renderDrafts();
      return failure === null;
    }

    /* Catalogue: one-click additions that need no values. */
    const catalogue = el("ul", "tools-catalogue");
    catalogue.setAttribute("role", "list");
    const existing = new Set((controls?.servers ?? []).map((server) => server.id));
    // On the web, servers start in the Linux cloud workspace, whatever the browser runs on.
    const platform = web ? "linux" : navigator.userAgent.includes("Mac") ? "darwin" : navigator.userAgent.includes("Windows") ? "win32" : "linux";
    for (const entry of mcpCatalogueFor(platform)) {
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

    /* Import: whatever other AI tools on this computer already have. */
    const importStep = el("div", "tools-dialog-step");
    importStep.append(el("p", "result-summary", web
      ? "ADCode scans connector files in your private cloud workspace. It cannot read apps or files on your computer. Use Link or text to paste a config, read a link, or enter a path in the cloud workspace. Nothing is added or started until you press Add on a card."
      : "ADCode reads the connectors already set up in Claude Desktop, Claude Code, Cursor, Windsurf and VS Code. Nothing is added or started until you press Add on a card."));
    const scan = button(web ? "Scan cloud workspace" : "Scan this computer", "agents-primary", () => void run({ kind: "scan-imports" }, "Scan finished. Review what was found below."));
    scan.prepend(createIcon(ICON.search));
    const scanRow = el("div", "tools-dialog-row");
    scanRow.append(scan);
    importStep.append(scanRow, el("p", "tools-dialog-note", web
      ? "Tokens, environment values and headers are kept encrypted in your private cloud workspace when you add them."
      : "Values found in those files - tokens, environment values, headers - go to the OS-encrypted store when you add them, never into ADCode's settings."));

    /* From a file: an OS picker, a link, or pasted text. */
    const fileStep = el("div", "tools-dialog-step");
    fileStep.append(el("p", "result-summary", web
      ? "Paste a connector config or API description, read a link, or enter the path of a file or plugin folder already in your cloud workspace. Files on your computer are not opened by this dialog."
      : "Choose a config file, an OpenAPI description, a chat plugin manifest, a .mcpb extension, a plugin folder - or paste a link or the document itself."));
    /** One field, one full-width block: the label and control, with the button that reads it right under, at the right edge. */
    const readField = (labelText: string, control: HTMLElement, action: HTMLButtonElement): HTMLElement => {
      const block = el("div", "tools-dialog-fieldset");
      const row = el("div", "tools-dialog-row tools-dialog-row-end");
      row.append(action);
      block.append(field(labelText, control), row);
      return block;
    };
    if (web) {
      const path = el("input", "form-input");
      path.placeholder = "/workspace/project/.mcp.json";
      path.setAttribute("aria-label", "Path in cloud workspace");
      const readPath = button("Read workspace path", "agent-box-action", () => void (async () => {
        if (path.value.trim() === "") { report("Enter a path in your cloud workspace first."); return; }
        await run({ kind: "import-path", from: path.value.trim() }, "Reading that workspace path…");
      })());
      fileStep.append(readField("In your cloud workspace", path, readPath));
    } else {
      const choose = button("Choose a file or folder…", "agents-primary", () => void (async () => {
        try {
          const path = await window.adcode.ai.pickConnectorFile();
          if (path === null) return;
          await run({ kind: "import-path", from: path }, "Reading what you chose…");
        } catch (error) {
          report(errorText(error, "The file picker could not be opened."));
        }
      })());
      const chooseRow = el("div", "tools-dialog-row");
      chooseRow.append(choose);
      fileStep.append(chooseRow);
    }
    const link = el("input", "form-input");
    link.type = "url";
    link.placeholder = "https://example.com/.well-known/ai-plugin.json";
    link.setAttribute("aria-label", "Address of a connector file or API description");
    const readLink = button("Read link", "agent-box-action", () => void (async () => {
      if (link.value.trim() === "") { report("Paste an address first."); return; }
      await run({ kind: "import-url", from: link.value.trim() }, "Reading that link…");
    })());
    const pasted = el("textarea", "form-input");
    pasted.rows = 5;
    pasted.placeholder = '{"mcpServers": {"…": {"command": "npx", "args": ["…"]}}}';
    pasted.setAttribute("aria-label", "Pasted connector document");
    const readText = button("Read pasted text", "agent-box-action", () => void (async () => {
      if (pasted.value.trim() === "") { report("Paste the document first."); return; }
      await run({ kind: "import-text", text: pasted.value, fileName: null }, "Reading the pasted document…");
    })());
    fileStep.append(readField("From a link", link, readLink), readField("Paste a document", pasted, readText));

    /* Custom: a name and an MCP server URL, with the technical fields folded away. */
    const form = el("form", "form-dialog-form");
    const name = el("input", "form-input");
    name.required = true;
    name.maxLength = 100;
    name.placeholder = "e.g. Project search";
    name.autocomplete = "off";
    name.setAttribute("aria-label", "Connector name");
    const id = el("input", "form-input");
    id.maxLength = 48;
    id.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
    id.placeholder = "project-search";
    id.autocomplete = "off";
    id.spellcheck = false;
    id.setAttribute("aria-label", "Connector ID");
    const transport = el("select", "form-select");
    for (const [value, label] of [["http", "Remote URL (HTTP)"], ["sse", "Remote URL (SSE)"], ["stdio", "Local command (stdio)"]] as const) {
      const option = el("option", "", label);
      option.value = value;
      transport.append(option);
    }
    transport.setAttribute("aria-label", "Connection type");
    const endpoint = el("input", "form-input");
    endpoint.required = true;
    endpoint.maxLength = 2048;
    endpoint.type = "url";
    endpoint.placeholder = "https://mcp.example.com/mcp";
    endpoint.autocomplete = "off";
    endpoint.spellcheck = false;
    endpoint.setAttribute("aria-label", "MCP server URL");
    const endpointField = field("MCP server URL", endpoint, "The HTTPS address where the server accepts MCP requests, for example https://mcp.example.com/mcp.");
    const args = el("input", "form-input");
    args.value = "[]";
    args.placeholder = '["-y", "your-mcp-server"]';
    args.setAttribute("aria-label", "Arguments");
    const argsField = field("Arguments (a JSON list)", args, "Only for a local command.");
    const values = el("textarea", "form-input");
    values.rows = 3;
    values.placeholder = "Authorization=Bearer … (one Header=value per line)";
    values.setAttribute("aria-label", "Headers or environment values");
    const advancedBody = el("div", "tools-dialog-advanced-body");
    advancedBody.append(
      field("Connector ID (optional)", id, "Lowercase words joined by hyphens. Left blank, it comes from the name."),
      field("Connection type", transport),
      argsField,
      field("Headers or environment values", values, web ? "Values go to the encrypted store in your private cloud workspace." : "Values go to the OS-encrypted store, never into ADCode's settings."),
    );
    const advanced = el("details", "tools-dialog-advanced");
    advanced.append(el("summary", "", "Advanced"), advancedBody);
    const fineprint = el("div", "tools-dialog-fineprint");
    const building = el("p", "tools-dialog-note");
    building.append("Building an MCP server? ", externalLink("See the documentation", "https://modelcontextprotocol.io"));
    fineprint.append(
      el("p", "tools-dialog-note", "Only use connectors from developers you trust. ADCode does not control which tools a developer makes available and cannot verify that they will work as intended or that they won't change."),
      building,
    );
    const problem = el("p", "form-notice");
    problem.setAttribute("role", "alert");
    problem.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Continue");
    save.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(
      field("Name", name, "Shown in the connector list."),
      endpointField,
      advanced,
      fineprint,
      problem,
      buttons,
    );

    let busy = false;
    const endpointLabel = endpointField.querySelector(".form-field-label");
    const endpointHint = endpointField.querySelector(".form-field-hint");
    function syncCustomForm(): void {
      const local = transport.value === "stdio";
      endpoint.type = local ? "text" : "url";
      endpoint.placeholder = local ? "e.g. npx" : "https://mcp.example.com/mcp";
      endpoint.setAttribute("aria-label", local ? "Command" : "MCP server URL");
      if (endpointLabel !== null) endpointLabel.textContent = local ? "Command" : "MCP server URL";
      if (endpointHint !== null) endpointHint.textContent = local
        ? (web ? "The program ADCode starts inside your private cloud workspace, for example npx." : "The program ADCode starts, for example npx.")
        : "The HTTPS address where the server accepts MCP requests, for example https://mcp.example.com/mcp.";
      values.placeholder = local ? "API_KEY=… (one Environment=value per line)" : "Authorization=Bearer … (one Header=value per line)";
      argsField.hidden = !local;
      args.disabled = !local;
      save.disabled = busy || name.value.trim() === "" || endpoint.value.trim() === "";
    }
    name.addEventListener("input", syncCustomForm);
    endpoint.addEventListener("input", syncCustomForm);
    transport.addEventListener("change", syncCustomForm);
    syncCustomForm();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (busy) return;
      problem.hidden = true;
      const nameText = name.value.trim();
      const endpointText = endpoint.value.trim();
      if (nameText === "") {
        problem.hidden = false;
        problem.textContent = "Give the connector a name.";
        name.focus();
        return;
      }
      let argsList: string[] = [];
      if (transport.value === "stdio") {
        let parsed: unknown;
        try { parsed = JSON.parse(args.value || "[]"); } catch { parsed = null; }
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
          problem.hidden = false;
          problem.textContent = 'Arguments must be a JSON list of strings, like ["-y", "server-name"].';
          return;
        }
        argsList = parsed;
      } else {
        const urlProblem = mcpUrlProblem(endpointText);
        if (urlProblem !== null) {
          problem.hidden = false;
          problem.textContent = urlProblem;
          endpoint.focus();
          return;
        }
      }
      const typedId = id.value.trim();
      if (typedId !== "" && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(typedId)) {
        problem.hidden = false;
        problem.textContent = "The connector ID must be lowercase letters and digits, joined by hyphens.";
        return;
      }
      const taken = new Set((controls?.servers ?? []).map((server) => server.id));
      if (typedId !== "" && taken.has(typedId)) {
        problem.hidden = false;
        problem.textContent = "That connector ID is already in use. Choose another one or leave it blank.";
        return;
      }
      const entered: Record<string, string> = {};
      for (const line of values.value.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const at = trimmed.indexOf("=");
        if (at <= 0) {
          problem.hidden = false;
          problem.textContent = `"${trimmed}" is not a NAME=value line.`;
          return;
        }
        entered[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
      }
      const serverId = typedId !== "" ? typedId : freeServerId(serverIdFromName(nameText), taken);
      busy = true;
      save.disabled = true;
      save.textContent = "Saving…";
      void (async () => {
        const failure = await perform({
          kind: "save-server",
          server: { id: serverId, name: nameText, transport: transport.value as "stdio" | "http" | "sse", endpoint: endpointText, args: argsList },
          values: entered,
        });
        if (failure !== null) {
          busy = false;
          save.textContent = "Continue";
          syncCustomForm();
          problem.hidden = false;
          problem.textContent = failure;
          return;
        }
        busy = false;
        finish();
        showTab("servers");
        const connectFailure = await perform({ kind: "connect", id: serverId });
        const saved = controls?.servers.find((server) => server.id === serverId);
        if (connectFailure !== null) say(`${nameText} saved, but it could not connect. ${connectFailure}`);
        else if (saved?.status === "error") say(`${nameText} saved, but it could not connect. ${explainMcpError(saved.error) ?? saved.error ?? "Check the address and try again."}`);
        else if (saved?.status === "connected") say(`${nameText} connected. Open Tools on its card to turn on what the assistant may use.`);
        else if (saved?.status === "connecting") say(`${nameText} saved. Connecting…`);
        else say(`${nameText} saved. Connect it from its card.`);
      })();
    });

    /* The drafts, whatever step they came from. */
    const draftsRegion = el("section", "tools-dialog-drafts");
    function renderDrafts(): void {
      const drafts = controls?.drafts ?? [];
      draftsRegion.replaceChildren();
      draftsRegion.hidden = drafts.length === 0;
      if (drafts.length === 0) return;
      draftsRegion.append(el("h3", "tools-dialog-subtitle", `Waiting to be added (${drafts.length.toString()})`));
      const list = el("ul", "tools-catalogue tools-draft-list");
      list.setAttribute("role", "list");
      for (const draft of drafts) list.append(draftListItem(draft));
      draftsRegion.append(list);
      markFor(draftsRegion, "stagger", "true", 900);
      indexForStagger(list);
    }

    function draftListItem(draft: ConnectorDraftView): HTMLLIElement {
      const item = el("li", "tools-catalogue-item");
      item.dataset["kind"] = draft.kind;
      const text = el("div", "tools-catalogue-text");
      const nameRow = el("div", "tools-dialog-name");
      nameRow.append(el("strong", "", draft.name), kindBadge(draft.kind));
      text.append(nameRow, el("p", "", draft.purpose), el("small", "", draft.source));
      if (draft.problem !== null) text.append(el("small", "tool-card-problem", draft.problem));
      const add = button("Add", draft.installable ? "agent-box-action agent-box-action-primary" : "agent-box-action", () => openDraftValues(draft, run));
      add.disabled = !draft.installable;
      add.setAttribute("aria-label", `Add ${draft.name}`);
      const discard = button("Discard", "agent-box-action", () => void run({ kind: "discard-draft", handle: draft.handle }, `${draft.name} discarded.`));
      discard.setAttribute("aria-label", `Discard ${draft.name}`);
      const actions = el("div", "tools-dialog-row tools-dialog-row-end");
      actions.append(add, discard);
      item.append(text, actions);
      return item;
    }

    /** Every step, so `pick` can hide all but one and let the one it shows rise in. */
    const stepViews: Record<"catalogue" | "import" | "file" | "custom", HTMLElement> = { catalogue, import: importStep, file: fileStep, custom: form };
    let pickedOnce = false;
    function pick(which: "catalogue" | "import" | "file" | "custom"): void {
      title.textContent = which === "custom" ? "Add custom connector" : "Add a connector";
      for (const [id_, control] of stepButtons) control.setAttribute("aria-selected", String(id_ === which));
      for (const [id_, view] of Object.entries(stepViews)) view.hidden = id_ !== which;
      // The first step arrives with the dialog itself; a later pick rises in on its own.
      if (pickedOnce) markFor(stepViews[which], "enter", "step", 500);
      pickedOnce = true;
    }
    const closeRow = el("div", "confirm-buttons");
    closeRow.append(button("Close", "confirm-cancel", finish));
    card.append(switcher, catalogue, importStep, fileStep, form, status, draftsRegion, closeRow);
    pick(start);
    renderDrafts();
    dialog.showModal();
    (start === "custom" ? name : stepButtons.get(start)!).focus();
  }

  /** The questions a draft asks, then the add itself. */
  function openDraftValues(draft: ConnectorDraftView, nested?: (action: AssistantControlAction, success?: string) => Promise<boolean>): void {
    const { dialog, card, finish } = openFormModal("tools-draft-values", `Add ${draft.name}`, () => undefined);
    const intro = el("p", "result-summary", draft.purpose);
    card.append(intro);
    const context = el("p", "tool-card-users", [draft.source, draft.servers.length > 0 ? `brings ${draft.servers.length.toString()} MCP server${draft.servers.length === 1 ? "" : "s"}: ${draft.servers.map((server) => server.name).join(", ")}` : "", draft.skills.length > 0 ? `${draft.skills.length.toString()} skill${draft.skills.length === 1 ? "" : "s"}` : ""].filter((part) => part !== "").join(" · "));
    card.append(context);
    if (draft.warnings.length > 0) {
      const details = el("details", "tools-draft-notes");
      details.append(el("summary", "", `${draft.warnings.length.toString()} note${draft.warnings.length === 1 ? "" : "s"} about this connector`));
      for (const warning of draft.warnings) details.append(el("p", "tool-card-problem", warning));
      card.append(details);
    }
    const form = el("form", "form-dialog-form");
    const inputs = new Map<string, HTMLInputElement>();
    for (const ask of draft.values) {
      const input = el("input", "form-input");
      input.type = ask.secret ? "password" : "text";
      input.required = ask.required;
      input.maxLength = 4096;
      input.autocomplete = "off";
      if (ask.preset !== null) input.value = ask.preset;
      if (ask.key === "__base_url") input.placeholder = "https://api.example.com";
      inputs.set(ask.key, input);
      form.append(field(ask.label, input, ask.hint ?? undefined));
    }
    const note = el("p", "tools-dialog-note", draft.kind === "extension" || draft.kind === "plugin"
      ? "The files are copied into ADCode's own folder when you press Add. Values are kept in the OS-encrypted store. Hooks are copied but never run."
      : "Values are kept in the OS-encrypted store, never in ADCode's settings file. Each tool call still asks you first.");
    const problem = el("p", "form-notice");
    problem.setAttribute("role", "alert");
    problem.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const submit = el("button", "result-close", "Add");
    submit.type = "submit";
    if (nested === undefined) buttons.append(button("Cancel", "confirm-cancel", finish));
    else buttons.append(button("Close", "confirm-cancel", finish));
    buttons.append(submit);
    form.append(note, problem, buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const answers: Record<string, string> = {};
      for (const [key, input] of inputs) answers[key] = input.value.trim();
      void (async () => {
        const action: AssistantControlAction = { kind: "add-draft", handle: draft.handle, values: answers };
        if (nested !== undefined) {
          // Adding from inside the import dialog: keep the dialog open so more can be added.
          await nested(action, `${draft.name} added. Connect it from its card.`);
          finish();
          return;
        }
        const ok = await act(action, `${draft.name} added. Connect it from its card.`);
        if (ok) { finish(); showTab("servers"); } else { problem.hidden = false; problem.textContent = "That could not be added. See the note on the page."; }
      })();
    });
    card.append(form);
    dialog.showModal();
    (inputs.values().next().value ?? submit).focus();
  }

  /** Add or replace one of a connector's stored values. */
  function openValues(server: AssistantServerView, keys: readonly string[]): void {
    const { dialog, card, finish } = openFormModal("tools-connector-values", `Values for ${server.name}`, () => undefined);
    const verb = keys.includes(TOKEN_KEY) ? "token" : "value";
    card.append(el("p", "result-summary", `Paste the ${verb} here. It goes straight to the OS-encrypted store.`));
    const form = el("form", "form-dialog-form");
    const input = el("input", "form-input");
    input.type = "password";
    input.required = true;
    input.maxLength = 4096;
    input.autocomplete = "off";
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", "Save");
    save.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(field("Token", input), buttons);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const answers: Record<string, string> = {};
      for (const key of keys) answers[key] = input.value.trim();
      void act({ kind: "save-server", server: { ...server }, values: answers }, `Saved for ${server.name}. Connect it again to use it.`).then((ok) => { if (ok) finish(); });
    });
    card.append(form);
    dialog.showModal();
    input.focus();
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
    if (server.tools.length === 0) list.append(el("li", "tools-empty", "This connector has not offered any tools."));
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
    bridge = await fetchBridge();
    render();
  }

  /** Never throws: a bridge that cannot be read must not take the memory list down with it. */
  async function fetchBridge(): Promise<ToolBridgeView | null> {
    if (isWebSurface()) return null;
    try {
      return await window.adcode.ai.toolBridge();
    } catch {
      return null;
    }
  }

  async function loadBridge(): Promise<void> {
    bridge = await fetchBridge();
    if (visible) render();
  }

  async function refresh(): Promise<void> {
    try {
      const [view, values] = await Promise.all([window.adcode.ai.controls(), window.adcode.settings.read()]);
      controls = view;
      agents = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
      bridgeEnabled = values["adcode.ai.toolBridge"] !== false;
      if (view.notice) say(view.notice);
      await loadMemory();
    } catch (error) {
      say(errorText(error, "Could not load tools."));
    }
  }

  search.addEventListener("input", () => render());
  window.adcode.ai.onControlsChanged(() => { if (visible) void window.adcode.ai.controls().then((view) => { controls = view; render(); }).catch(() => undefined); });
  window.adcode.settings.onChanged((values) => {
    agents = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    // Switched in Settings while this page is open: the bridge has started or stopped by now.
    const enabled = values["adcode.ai.toolBridge"] !== false;
    if (enabled !== bridgeEnabled) { bridgeEnabled = enabled; if (visible) void loadBridge(); }
    if (visible) render();
  });
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
    addServer: () => openAddConnector("import"),
  };
}
