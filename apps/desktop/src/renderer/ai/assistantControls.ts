import type { AssistantControlAction, AssistantControlsView, AssistantServerInput } from "../../shared/assistantControls.ts";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** The UI renders main-process state; there is no separate optimistic permission cache. */
export function createAssistantControls() {
  const element = el("section", "assistant-controls");
  element.setAttribute("aria-label", "MCP and skill controls");
  const heading = el("h3", "assistant-controls-title", "Tools & skills");
  heading.tabIndex = -1;
  const refreshButton = button("Refresh", () => refresh());
  const top = el("div", "assistant-controls-top");
  top.append(heading, refreshButton);
  const summary = el("p", "assistant-controls-summary", "Connect tools. Add expertise.");
  const notice = el("p", "assistant-controls-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const tabs = el("div", "assistant-controls-tabs");
  const serversTab = button("MCP servers", () => selectTab("servers"));
  const skillsTab = button("Skills", () => selectTab("skills"));
  tabs.append(serversTab, skillsTab);
  const search = el("input", "assistant-controls-search");
  search.type = "search";
  search.placeholder = "Filter tools and skills…";
  search.setAttribute("aria-label", "Filter tools and skills");
  const scope = el("select", "assistant-controls-search");
  scope.setAttribute("aria-label", "Skill location");
  for (const [value, label] of [["all", "All skill locations"], ["workspace", "This project"], ["system", "Installed on this computer"]]) {
    const option = el("option", "", label);
    option.value = value!;
    scope.append(option);
  }
  const content = el("div", "assistant-controls-content");
  const editor = el("form", "assistant-server-form");
  editor.hidden = true;
  const formHeading = el("h4", "assistant-controls-title", "Add an MCP server");
  const name = field("Display name", "e.g. Project search");
  const id = field("Server ID", "project-search");
  id.input.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
  id.input.maxLength = 48;
  name.input.maxLength = 100;
  const transportLabel = el("label", "assistant-control-field", "Connection type");
  const transport = el("select", "");
  for (const [value, label] of [["stdio", "Local command (stdio)"], ["http", "Remote URL (HTTP)"]]) {
    const option = el("option", "", label);
    option.value = value!;
    transport.append(option);
  }
  transportLabel.append(transport);
  const endpoint = field("Executable", "e.g. npx");
  const args = field("Arguments (JSON array)", '["-y", "your-mcp-server"]');
  args.input.required = false;
  args.input.value = "[]";
  const help = el("p", "assistant-controls-hint", "Save first, then connect to inspect available tools. Local commands run with your account’s permissions. Keep credentials out of these fields; use the server’s own configuration.");
  const save = el("button", "assistant-control-button assistant-control-primary", "Save server");
  save.type = "submit";
  const cancel = button("Cancel", () => { editor.hidden = true; });
  const formActions = el("div", "assistant-controls-actions");
  formActions.append(save, cancel);
  editor.append(formHeading, name.label, id.label, transportLabel, endpoint.label, args.label, help, formActions);
  const add = button("+ Add MCP server", () => editServer());
  const skillEditor = el("form", "assistant-server-form");
  skillEditor.hidden = true;
  const skillName = field("Skill name", "review-code");
  skillName.input.maxLength = 64;
  skillName.input.pattern = "[a-z0-9]+(-[a-z0-9]+)*";
  const skillDescription = field("When to use it", "Review code changes for bugs and missing tests");
  skillDescription.input.maxLength = 1024;
  const instructionsLabel = el("label", "assistant-control-field", "Instructions");
  const instructions = el("textarea", "assistant-skill-instructions");
  instructions.rows = 8;
  instructions.required = true;
  instructions.maxLength = 55_000;
  instructions.placeholder = "Describe the steps, checks, and expected outcome…";
  instructionsLabel.append(instructions);
  const createSkill = el("button", "assistant-control-button assistant-control-primary", "Create skill");
  createSkill.type = "submit";
  skillEditor.append(el("h4", "assistant-controls-title", "Create a workspace skill"), skillName.label, skillDescription.label, instructionsLabel, el("p", "assistant-controls-hint", "Saves SKILL.md in .adcode/skills in this project. Preview and enable it when ready."), createSkill, button("Cancel", () => { skillEditor.hidden = true; }));
  const addSkill = button("+ Create skill", () => { skillEditor.hidden = false; skillName.input.focus(); });
  const preview = el("section", "assistant-skill-preview");
  preview.hidden = true;
  const previewTitle = el("h4", "assistant-controls-title");
  const previewText = el("pre", "assistant-skill-source");
  previewText.tabIndex = 0;
  preview.append(previewTitle, button("Close preview", () => { preview.hidden = true; }), previewText);
  element.append(top, summary, notice, tabs, search, scope, add, addSkill, editor, skillEditor, content, preview);
  let state: AssistantControlsView | null = null;
  let tab: "servers" | "skills" = "servers";
  let busy = false;
  let revision = 0;
  let active = false;
  const expanded = new Set<string>();

  function button(label: string, action: () => void | Promise<void>): HTMLButtonElement {
    const node = el("button", "assistant-control-button", label);
    node.type = "button";
    node.addEventListener("click", () => { void Promise.resolve().then(action).catch(showError); });
    return node;
  }
  function field(labelText: string, placeholder: string) {
    const label = el("label", "assistant-control-field", labelText);
    const input = el("input", "");
    input.placeholder = placeholder;
    input.required = true;
    label.append(input);
    return { label, input };
  }
  function showError(error: unknown): void {
    notice.textContent = error instanceof Error ? error.message : String(error);
    notice.hidden = false;
  }
  function setBusy(value: boolean): void {
    busy = value;
    element.setAttribute("aria-busy", String(value));
    for (const node of element.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea")) node.disabled = value;
    if (!value) id.input.disabled = formHeading.textContent === "Edit MCP server";
  }
  async function change(action: AssistantControlAction): Promise<void> {
    if (busy) return;
    ++revision;
    setBusy(true);
    notice.hidden = true;
    try {
      state = await window.adcode.ai.control(action);
      if (action.kind === "save-server") editor.hidden = true;
      if (action.kind === "create-skill") { skillEditor.hidden = true; skillEditor.reset(); }
      paint();
    } catch (error) { paint(); showError(error); }
    finally { setBusy(false); }
  }
  async function refresh(): Promise<void> {
    if (busy) return;
    const version = ++revision;
    try {
      const next = await window.adcode.ai.controls();
      if (version !== revision) return;
      if (state?.workspace !== next.workspace) preview.hidden = true;
      state = next;
      paint();
    } catch (error) { showError(error); }
  }
  function selectTab(next: typeof tab): void {
    tab = next;
    preview.hidden = true;
    editor.hidden = true;
    skillEditor.hidden = true;
    paint();
  }
  function updateTransport(): void {
    endpoint.label.firstChild!.textContent = transport.value === "http" ? "Server URL" : "Executable";
    endpoint.input.placeholder = transport.value === "http" ? "https://example.com/mcp" : "e.g. npx";
    args.label.hidden = transport.value === "http";
  }
  function editServer(server?: AssistantServerInput): void {
    formHeading.textContent = server ? "Edit MCP server" : "Add an MCP server";
    name.input.value = server?.name ?? "";
    id.input.value = server?.id ?? "";
    id.input.disabled = Boolean(server);
    transport.value = server?.transport ?? "stdio";
    endpoint.input.value = server?.endpoint ?? "";
    args.input.value = JSON.stringify(server?.args ?? []);
    updateTransport();
    editor.hidden = false;
    name.input.focus();
  }
  function toggle(label: string, checked: boolean, action: (value: boolean) => Promise<void>, key: string): HTMLElement {
    const row = el("label", "assistant-control-toggle");
    const input = el("input", "");
    input.type = "checkbox";
    input.checked = checked;
    input.disabled = busy;
    input.dataset["controlKey"] = key;
    input.setAttribute("role", "switch");
    input.addEventListener("change", () => { void action(input.checked); });
    row.append(input, el("span", "", label));
    return row;
  }
  function paint(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset["controlKey"];
    serversTab.setAttribute("aria-pressed", String(tab === "servers"));
    skillsTab.setAttribute("aria-pressed", String(tab === "skills"));
    add.hidden = tab !== "servers";
    addSkill.hidden = tab !== "skills";
    scope.hidden = tab !== "skills";
    content.replaceChildren();
    if (!state) return;
    const connected = state.servers.filter(server => server.status === "connected");
    const tools = connected.reduce((sum, server) => sum + server.tools.filter(tool => tool.enabled).length, 0);
    const skills = state.skills.filter(skill => skill.enabled).length;
    summary.textContent = `${connected.length} connected · ${tools} tools enabled · ${skills} skills active`;
    if (state.notice) showError(state.notice);
    const query = search.value.trim().toLowerCase();
    const matches = (text: string) => text.toLowerCase().includes(query);
    if (tab === "servers") {
      content.append(el("p", "assistant-controls-hint", "Choose which tools the assistant can discover. Each external call shows its arguments for approval. Connections start only when you click Connect."));
      let count = 0;
      for (const server of state.servers) {
        const wholeServer = matches(`${server.name} ${server.endpoint}`);
        const visibleTools = server.tools.filter(tool => wholeServer || matches(`${tool.name} ${tool.description}`));
        if (!wholeServer && !visibleTools.length) continue;
        count++;
        const card = el("article", "assistant-capability-card");
        const title = el("div", "assistant-capability-heading");
        const status = el("span", "assistant-server-status", server.status);
        status.dataset["state"] = server.status;
        title.append(el("strong", "", server.name), status);
        const address = el("p", "assistant-controls-hint", `${server.transport === "stdio" ? "Local" : "Remote"} · ${server.endpoint}`);
        const actions = el("div", "assistant-controls-actions");
        actions.append(button(server.status === "connected" ? "Disconnect" : "Connect", () => change({ kind: server.status === "connected" ? "disconnect" : "connect", id: server.id })), button("Edit", () => editServer(server)), button("Remove", () => change({ kind: "remove-server", id: server.id })));
        card.append(title, address, actions);
        if (server.error) card.append(el("p", "assistant-controls-error", server.error));
        if (server.status === "connected") {
          const details = el("details", "assistant-tool-list");
          details.open = expanded.has(server.id) || Boolean(query);
          details.addEventListener("toggle", () => { if (details.open) expanded.add(server.id); else expanded.delete(server.id); });
          details.append(el("summary", "", `${server.tools.filter(tool => tool.enabled).length} / ${server.tools.length} tools enabled`));
          if (!server.tools.length) details.append(el("p", "assistant-controls-hint", "Connected successfully. This server exposes no tools."));
          for (const tool of visibleTools) {
            const row = el("div", "assistant-tool-row");
            row.append(toggle(tool.name, tool.enabled, enabled => change({ kind: "set-tool", id: server.id, tool: tool.name, enabled }), `${server.id}:${tool.name}`), el("p", "assistant-controls-hint", tool.description));
            if (tool.calls) row.append(el("p", "assistant-controls-hint", `${tool.calls} calls · last ${tool.lastDurationMs} ms`));
            if (tool.lastError) row.append(el("p", "assistant-controls-error", tool.lastError));
            details.append(row);
          }
          card.append(details);
        }
        content.append(card);
      }
      if (!count) content.append(el("p", "assistant-controls-empty", query ? "No matching servers or tools." : "Give the assistant access to your own services. Add a local command or an MCP server URL to get started."));
    } else {
      content.append(el("p", "assistant-controls-hint", "Discover skills from this project and your Adcode, Claude, Codex, and shared user skill folders. System skills work across projects; enable only the ones you want to use."));
      let count = 0;
      for (const skill of state.skills) {
        if (scope.value !== "all" && skill.scope !== scope.value) continue;
        if (!matches(`${skill.name} ${skill.description} ${skill.path} ${skill.source}`)) continue;
        count++;
        const card = el("article", "assistant-capability-card");
        card.append(
          toggle(skill.name, skill.enabled, enabled => change({ kind: "set-skill", id: skill.id, enabled }), skill.id),
          el("span", "assistant-skill-source-badge", skill.scope === "system" ? `${skill.source} · System` : "This project"),
          el("p", "assistant-controls-hint", skill.description),
          el("p", "assistant-skill-path", skill.path),
          el("p", "assistant-controls-hint", `~${skill.estimatedTokens.toLocaleString()} tokens when loaded`),
        );
        if (skill.error) card.append(el("p", "assistant-controls-error", skill.error));
        card.append(button("Preview instructions", async () => {
          const root = state?.workspace;
          const text = await window.adcode.ai.previewSkill(skill.id);
          if (state?.workspace !== root) return;
          previewTitle.textContent = skill.name;
          previewText.textContent = text;
          preview.hidden = false;
          previewText.focus();
        }));
        content.append(card);
      }
      if (!count) content.append(el("p", "assistant-controls-empty", query || scope.value !== "all" ? "No skills match this search and location." : "No installed skills found. Create a project skill or add SKILL.md folders to your user .agents/skills, .adcode/skills, .claude/skills, or .codex/skills folder, then Refresh."));
    }
    if (focusKey) for (const node of content.querySelectorAll<HTMLElement>("[data-control-key]")) if (node.dataset["controlKey"] === focusKey) node.focus();
  }
  transport.addEventListener("change", updateTransport);
  search.addEventListener("input", paint);
  scope.addEventListener("change", paint);
  name.input.addEventListener("input", () => {
    if (!id.input.disabled && !id.input.value) id.input.value = name.input.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  });
  editor.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const parsed: unknown = transport.value === "stdio" ? JSON.parse(args.input.value || "[]") : [];
      if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "string")) throw new Error('Arguments must be an array of strings, such as ["-y", "server-package"].');
      void change({ kind: "save-server", server: { id: id.input.value, name: name.input.value, transport: transport.value === "http" ? "http" : "stdio", endpoint: endpoint.input.value, args: parsed as string[] } });
    } catch (error) { showError(error); }
  });
  skillEditor.addEventListener("submit", event => {
    event.preventDefault();
    void change({ kind: "create-skill", name: skillName.input.value, description: skillDescription.input.value, instructions: instructions.value });
  });
  window.adcode.ai.onControlsChanged(() => { if (active) void refresh(); });
  paint();
  return {
    element,
    show(focus = true): void { active = true; void refresh(); if (focus) heading.focus(); },
    hide(): void { active = false; },
  };
}
