import type { AiProviderInfo, AiTeamConfigureInputView } from "../../shared/api.ts";
import { AGENT_PROFILES_SETTING, buildNamedAgentTeam, parseAgentProfiles, removeAgentProfile, saveAgentProfile, type AgentProfile } from "./agentProfiles.ts";

export function createAgentLibrary(deps: {
  readonly prompt: () => string;
  readonly configure: (input: AiTeamConfigureInputView) => Promise<void>;
  readonly openConnect: () => void;
}): { readonly element: HTMLElement; refresh(): Promise<void> } {
  const element = document.createElement("section");
  element.className = "ai-agent-library";
  element.setAttribute("aria-label", "Named agents");
  const heading = document.createElement("h3");
  heading.textContent = "Your agents";
  const intro = document.createElement("p");
  intro.textContent = "Save specialists, then choose two to four for a Team. Write the shared task in the message box.";
  const list = document.createElement("div");
  list.className = "ai-agent-list";
  const notice = document.createElement("p");
  notice.className = "ai-agent-notice";
  notice.setAttribute("role", "status");
  let profiles: AgentProfile[] = [];
  let providers: readonly AiProviderInfo[] = [];
  let editing: string | null = null;
  let busy = false;
  function setBusy(value: boolean): void {
    busy = value;
    element.setAttribute("aria-busy", String(value));
    for (const control of element.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea")) {
      control.disabled = value;
    }
  }
  const selected = new Set<string>();
  const form = document.createElement("form");
  form.className = "ai-agent-form";
  form.hidden = true;
  const name = document.createElement("input");
  name.maxLength = 80;
  name.required = true;
  const instructions = document.createElement("textarea");
  instructions.rows = 4;
  instructions.maxLength = 2_000;
  instructions.required = true;
  instructions.placeholder = "What should this agent own, check, and hand off?";
  const provider = document.createElement("select");
  provider.required = true;
  const model = document.createElement("input");
  model.maxLength = 256;
  model.required = true;
  const modelOptions = document.createElement("datalist");
  modelOptions.id = "ai-agent-model-options";
  model.setAttribute("list", modelOptions.id);
  const runAfterTeammates = document.createElement("input");
  runAfterTeammates.type = "checkbox";
  for (const [labelText, control] of [["Name", name], ["Instructions", instructions], ["Connection", provider], ["Model ID", model]] as const) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(text, control);
    form.append(label);
  }
  const executionLabel = document.createElement("label");
  executionLabel.className = "ai-agent-order";
  executionLabel.append(runAfterTeammates, document.createTextNode("Run after teammates (receive their handoffs)"));
  form.append(executionLabel);
  const actions = document.createElement("div");
  actions.className = "ai-agent-actions";
  const button = (text: string, handler: () => void): HTMLButtonElement => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "ghost-button";
    node.textContent = text;
    node.addEventListener("click", handler);
    return node;
  };
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "chat-send";
  save.textContent = "Save agent";
  form.append(modelOptions, save, button("Cancel edit", () => { form.hidden = true; }));
  const add = button("New agent", () => { void openEditor(null); });
  const setup = button("Set up selected Team", () => {
    if (busy) return;
    try {
      const input = buildNamedAgentTeam(deps.prompt(), profiles.filter(agent => selected.has(agent.id)));
      setBusy(true);
      notice.textContent = "Saving Team plan…";
      void deps.configure(input).then(() => { notice.textContent = "Plan ready. Review the agents below, then choose Start Team."; })
        .catch(report).finally(() => { setBusy(false); });
    } catch (error) { report(error); }
  });
  actions.append(add, setup, button("Connections", deps.openConnect));
  element.append(heading, intro, list, actions, form, notice);

  function report(error: unknown): void {
    notice.textContent = error instanceof Error ? error.message : "Could not save agents.";
  }
  function updateModels(): void {
    modelOptions.replaceChildren();
    for (const entry of providers.find(item => item.id === provider.value)?.models ?? []) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.label = entry.name;
      modelOptions.append(option);
    }
  }
  provider.addEventListener("change", () => {
    model.value = providers.find(item => item.id === provider.value)?.models[0]?.id ?? "";
    updateModels();
  });
  async function openEditor(agent: AgentProfile | null): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // Connect can be opened as a child dialog while Chat stays mounted.
      // Its newly saved providers must be available without reopening Chat.
      providers = (await window.adcode.ai.status()).providers;
      edit(agent);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
      if (!form.hidden) name.focus();
    }
  }
  function edit(agent: AgentProfile | null): void {
    editing = agent?.id ?? null;
    form.hidden = false;
    name.value = agent?.name ?? "";
    instructions.value = agent?.instructions ?? "";
    runAfterTeammates.checked = agent?.runAfterTeammates ?? false;
    provider.replaceChildren();
    for (const entry of providers.filter(item => item.transport !== "unsupported")) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.displayName}${entry.needsKey && !entry.hasKey ? " · needs key" : ""}`;
      provider.append(option);
    }
    if (agent && !providers.some(item => item.id === agent.provider)) {
      const missing = document.createElement("option");
      missing.value = agent.provider;
      missing.textContent = `${agent.provider} · unavailable`;
      provider.append(missing);
    }
    if (agent) provider.value = agent.provider;
    model.value = agent?.model ?? providers.find(item => item.id === provider.value)?.models[0]?.id ?? "";
    updateModels();
    name.focus();
  }
  async function persist(next: AgentProfile[]): Promise<void> {
    if (busy) throw new Error("Wait for the current agent change to finish.");
    setBusy(true);
    try {
      const values = await window.adcode.settings.write(AGENT_PROFILES_SETTING, JSON.stringify(next));
      profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
      render();
    } finally {
      setBusy(false);
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    try {
      const next = saveAgentProfile(profiles, {
        id: editing ?? `agent-${crypto.randomUUID()}`,
        name: name.value,
        instructions: instructions.value,
        provider: provider.value,
        model: model.value,
        runAfterTeammates: runAfterTeammates.checked,
      });
      save.disabled = true;
      void persist(next).then(() => { form.hidden = true; notice.textContent = "Agent saved."; })
        .catch(report).finally(() => { save.disabled = false; });
    } catch (error) { report(error); }
  });
  function render(): void {
    list.replaceChildren();
    for (const id of selected) if (!profiles.some(agent => agent.id === id)) selected.delete(id);
    if (profiles.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No saved agents yet. Create your first specialist.";
      list.append(empty);
    }
    for (const agent of profiles) {
      const row = document.createElement("article");
      row.className = "ai-agent-profile";
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(agent.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && selected.size >= 4) {
          checkbox.checked = false;
          notice.textContent = "A running Team supports up to four agents.";
          return;
        }
        if (checkbox.checked) selected.add(agent.id); else selected.delete(agent.id);
        notice.textContent = `${selected.size} agents selected.`;
      });
      const title = document.createElement("strong");
      title.textContent = agent.name;
      label.append(checkbox, title);
      const route = document.createElement("p");
      route.textContent = `${providers.find(item => item.id === agent.provider)?.displayName ?? agent.provider} · ${agent.model}`;
      const detail = document.createElement("p");
      detail.textContent = agent.instructions;
      if (agent.runAfterTeammates) detail.textContent += " · Runs after teammates.";
      const rowActions = document.createElement("div");
      rowActions.className = "ai-agent-actions";
      rowActions.append(button("Edit", () => { void openEditor(agent); }), button("Delete", () => {
        void persist(removeAgentProfile(profiles, agent.id)).catch(report);
      }));
      row.append(label, route, detail, rowActions);
      list.append(row);
    }
    // Settings notifications can repaint rows while a write is still pending.
    setBusy(busy);
  }
  async function refresh(): Promise<void> {
    try {
      const [values, status] = await Promise.all([window.adcode.settings.read(), window.adcode.ai.status()]);
      profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
      providers = status.providers;
      render();
    } catch (error) { report(error); }
  }
  window.adcode.settings.onChanged(values => {
    profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    render();
  });
  render();
  return { element, refresh };
}
