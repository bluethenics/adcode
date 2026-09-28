/**
 * The Agents page's dialogs: New task, the agent editor, and a run's details.
 *
 * Native modal <dialog>s, like the rest of ADCode's forms: top layer, Escape closes, a click on
 * the backdrop dismisses (never a text-selection drag that ends outside), and every way out
 * resolves the caller's promise so nothing is left hanging.
 */
import type { AiProviderInfo, AiTeamTraceView } from "../../shared/api.ts";
import type { ToolAccess } from "@adcode/ai/toolAccess";
import type { AgentProfile } from "../ai/agentProfiles.ts";
import { button, el, field, openFormModal } from "../dialogs/formDialog.ts";
import { AGENT_PICKABLE_TOOLS } from "../tools/builtInTools.ts";
import { createAgentMascot } from "./agentMascot.ts";
import { MASCOT_COLORS, MASCOT_SHAPES, defaultMascotFor, type MascotLook } from "./mascotStyle.ts";
import type { BoxModel, EvidenceChip } from "./agentBoardModel.ts";
import type { RiskFlag, RunCheck } from "../../shared/runEvidence.ts";

/* ── New task ──────────────────────────────────────────────────────────────── */

export interface NewTaskRequest {
  readonly prompt: string;
  /** Null: the default agent. */
  readonly agentId: string | null;
  readonly capDollars?: number;
  /** Race mode: the same task for each of these agents (null is the default agent). */
  readonly raceAgentIds?: readonly (string | null)[];
}

export function openNewTaskDialog(options: {
  readonly agents: readonly AgentProfile[];
  readonly agentId: string | null;
  readonly defaultModel: string;
  /** Follow-up mode: the heading and a line saying what is being continued. */
  readonly followUp?: { readonly title: string };
  /** Team mode: the chosen agents share this one task, so there is no agent or cap to pick. */
  readonly team?: { readonly names: readonly string[] };
  /** Open with Race switched on. */
  readonly race?: boolean;
  /**
   * Something the task is about, shown read-only and sent after what the user types - such
   * as the element picked in Preview. The user only has to say what should change.
   */
  readonly attachment?: { readonly label: string; readonly text: string };
  readonly prefill?: string;
}): Promise<NewTaskRequest | null> {
  return new Promise((resolve) => {
    let result: NewTaskRequest | null = null;
    const heading = options.team ? "Team task" : options.followUp ? "Follow up" : "New task";
    const { dialog, card, finish } = openFormModal("agents-new-task", heading, () => resolve(result));
    if (options.followUp) card.append(el("p", "result-summary", `Continuing: ${options.followUp.title}`));
    if (options.team) card.append(el("p", "result-summary", `${options.team.names.join(", ")} will split this task and hand their work back for one review.`));
    const form = el("form", "form-dialog-form");
    const prompt = el("textarea", "form-input agents-task-input");
    prompt.rows = 5;
    prompt.maxLength = 18_000;
    prompt.required = true;
    prompt.placeholder = options.attachment
      ? "What should change? e.g. Make this button bigger and green"
      : options.followUp ? "What should it do next?" : "What should the agent do? e.g. Add a dark mode toggle to the settings page";
    prompt.value = options.prefill ?? "";
    const agent = el("select", "form-select");
    const fallback = el("option", "", `Default agent · ${options.defaultModel || "your connected model"}`);
    fallback.value = "";
    agent.append(fallback);
    for (const profile of options.agents) {
      const option = el("option", "", `${profile.name} · ${profile.model}${profile.toolAccess === "read-only" ? " · read-only" : ""}`);
      option.value = profile.id;
      agent.append(option);
    }
    agent.value = options.agentId ?? "";
    const cap = el("input", "form-input agents-cap");
    cap.type = "number";
    cap.min = "0.05";
    cap.step = "0.05";
    cap.inputMode = "decimal";
    cap.placeholder = "No cap";
    // The chosen agent's own cap is the starting point; typing one overrides it.
    const suggestCap = (): void => {
      const chosen = options.agents.find((profile) => profile.id === agent.value);
      cap.value = chosen?.capDollars === undefined ? "" : String(chosen.capDollars);
    };
    suggestCap();
    agent.addEventListener("change", suggestCap);

    // Race: the same task, two or three agents at once, compared when all have finished.
    const raceToggle = el("input", "");
    raceToggle.type = "checkbox";
    raceToggle.checked = options.race === true;
    const raceLabel = el("label", "agents-check agents-race-toggle");
    raceLabel.append(raceToggle, document.createTextNode("Race: give this task to 2 or 3 agents at once, then keep the best"));
    const raceChoices = el("fieldset", "agents-race-choices");
    raceChoices.append(el("legend", "form-field-label", "Agents in the race"));
    const racers: { value: string; box: HTMLInputElement }[] = [];
    for (const [value, labelText] of [["", `Default agent · ${options.defaultModel || "your connected model"}`], ...options.agents.map((profile) => [profile.id, `${profile.name} · ${profile.model}`] as const)] as const) {
      const box = el("input", "");
      box.type = "checkbox";
      box.value = value;
      const label = el("label", "agents-check");
      label.append(box, document.createTextNode(labelText));
      raceChoices.append(label);
      racers.push({ value, box });
    }
    const syncRace = (): void => {
      raceChoices.hidden = !raceToggle.checked;
      agentField.hidden = raceToggle.checked;
    };
    raceToggle.addEventListener("change", syncRace);

    const notice = el("p", "form-notice");
    notice.setAttribute("role", "alert");
    notice.hidden = true;
    const row = el("div", "form-row");
    const agentField = field("Agent", agent);
    row.append(agentField, field("Cost cap (USD)", cap, "Stops each agent before it spends more."));
    row.hidden = options.team !== undefined;
    const buttons = el("div", "confirm-buttons");
    const start = el("button", "result-close", "Start");
    start.type = "submit";
    buttons.append(button("Cancel", "confirm-cancel", finish), start);
    form.append(field(options.followUp ? "Next step" : options.attachment ? "What should change" : "Task", prompt, "Enter starts it; Shift+Enter adds a line."));
    if (options.attachment) {
      const attached = el("div", "agents-attachment");
      attached.append(el("span", "form-field-label", options.attachment.label), el("pre", "agents-attachment-text", options.attachment.text));
      form.append(attached);
    }
    form.append(row);
    if (options.team === undefined && options.followUp === undefined) form.append(raceLabel, raceChoices);
    form.append(notice, buttons);
    card.append(form);
    syncRace();
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    const fail = (text: string, focus: HTMLElement): void => {
      notice.hidden = false;
      notice.textContent = text;
      focus.focus();
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const typed = prompt.value.trim();
      if (!typed) return fail("Describe the task first.", prompt);
      const dollars = cap.value.trim() === "" ? undefined : Number(cap.value);
      if (dollars !== undefined && !(Number.isFinite(dollars) && dollars > 0)) return fail("A cost cap is an amount above zero, like 0.50 - or leave it empty.", cap);
      const text = options.attachment ? `${typed}\n\n${options.attachment.label}:\n${options.attachment.text}` : typed;
      const racing = raceToggle.checked && options.team === undefined && options.followUp === undefined;
      const chosen = racers.filter((racer) => racer.box.checked).map((racer) => racer.value || null);
      if (racing && (chosen.length < 2 || chosen.length > 3)) return fail("Pick two or three agents for the race.", raceChoices);
      result = {
        prompt: text,
        agentId: agent.value || null,
        ...(dollars === undefined ? {} : { capDollars: dollars }),
        ...(racing ? { raceAgentIds: chosen } : {}),
      };
      finish();
    });
    dialog.showModal();
    prompt.focus();
  });
}

/* ── Agent editor ─────────────────────────────────────────────────────────── */

export interface AgentEditorResult {
  readonly kind: "save" | "delete";
  readonly agent: AgentProfile;
}

export function openAgentEditorDialog(options: {
  readonly agent: AgentProfile | null;
  readonly providers: readonly AiProviderInfo[];
  readonly activeProvider: string;
  readonly activeModel: string;
  readonly validate: (agent: AgentProfile) => string | null;
}): Promise<AgentEditorResult | null> {
  return new Promise((resolve) => {
    let result: AgentEditorResult | null = null;
    const existing = options.agent;
    const id = existing?.id ?? `agent-${crypto.randomUUID()}`;
    const { dialog, card, finish } = openFormModal("agents-editor", existing ? `Edit ${existing.name}` : "New agent", () => resolve(result));
    const form = el("form", "form-dialog-form");

    // Look: a live mascot beside the shape and colour pickers.
    let look: MascotLook = existing?.mascot ?? defaultMascotFor(id);
    const preview = createAgentMascot({ look, mood: "happy", size: 64 });
    const shapes = el("div", "agents-swatches agents-shapes");
    shapes.setAttribute("role", "radiogroup");
    shapes.setAttribute("aria-label", "Shape");
    const colors = el("div", "agents-swatches agents-colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", "Colour");
    const paintLook = (): void => {
      preview.setLook(look);
      for (const item of shapes.querySelectorAll<HTMLButtonElement>("button")) item.setAttribute("aria-checked", String(item.dataset["value"] === look.shape));
      for (const item of colors.querySelectorAll<HTMLButtonElement>("button")) item.setAttribute("aria-checked", String(item.dataset["value"] === look.color));
    };
    for (const shape of MASCOT_SHAPES) {
      const choice = button("", "agents-swatch", () => { look = { ...look, shape }; paintLook(); });
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-label", shape);
      choice.title = shape;
      choice.dataset["value"] = shape;
      choice.append(createAgentMascot({ look: { shape, color: "slate" }, mood: "sleepy", size: 22 }).element);
      shapes.append(choice);
    }
    for (const color of MASCOT_COLORS) {
      const choice = button("", "agents-swatch agents-color-swatch", () => { look = { ...look, color }; paintLook(); });
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-label", color);
      choice.title = color;
      choice.dataset["value"] = color;
      choice.style.setProperty("--swatch", `var(--mascot-${color})`);
      colors.append(choice);
    }
    const lookRow = el("div", "agents-look");
    const pickers = el("div", "agents-look-pickers");
    pickers.append(shapes, colors);
    lookRow.append(preview.element, pickers);

    const name = el("input", "form-input");
    name.maxLength = 80;
    name.required = true;
    name.value = existing?.name ?? "";
    name.placeholder = "e.g. Reviewer";
    const instructions = el("textarea", "form-input");
    instructions.rows = 5;
    instructions.maxLength = 2_000;
    instructions.required = true;
    instructions.value = existing?.instructions ?? "";
    instructions.placeholder = "What should this agent own, check, and hand back?";

    const provider = el("select", "form-select");
    const model = el("input", "form-input");
    model.maxLength = 256;
    model.required = true;
    const models = el("datalist", "");
    models.id = `agents-models-${id}`;
    model.setAttribute("list", models.id);
    const usable = options.providers.filter((item) => item.transport !== "unsupported");
    for (const entry of usable) {
      const option = el("option", "", `${entry.displayName}${entry.needsKey && !entry.hasKey ? " · needs key" : ""}`);
      option.value = entry.id;
      provider.append(option);
    }
    if (existing && !usable.some((item) => item.id === existing.provider)) {
      const missing = el("option", "", `${existing.provider} · not connected`);
      missing.value = existing.provider;
      provider.append(missing);
    }
    provider.value = existing?.provider ?? options.activeProvider;
    const fillModels = (): void => {
      models.replaceChildren(...(usable.find((item) => item.id === provider.value)?.models ?? []).map((entry) => {
        const option = el("option", "");
        option.value = entry.id;
        option.label = entry.name;
        return option;
      }));
    };
    model.value = existing?.model ?? (provider.value === options.activeProvider ? options.activeModel : usable.find((item) => item.id === provider.value)?.models[0]?.id ?? "");
    fillModels();
    provider.addEventListener("change", () => {
      model.value = usable.find((item) => item.id === provider.value)?.models[0]?.id ?? "";
      fillModels();
    });
    const route = el("div", "form-row");
    route.append(field("Connection", provider), field("Model", model));

    // Tool access, enforced in the main process when the agent runs.
    const access = el("fieldset", "agents-access");
    access.append(el("legend", "form-field-label", "Tools it may use"));
    const accessChoices = el("div", "agents-access-choices");
    const accessName = `agents-access-${id}`;
    const radio = (value: "all" | "read-only" | "pick", labelText: string, hint: string): HTMLInputElement => {
      const input = el("input", "");
      input.type = "radio";
      input.name = accessName;
      input.value = value;
      const label = el("label", "agents-access-choice");
      const text = el("span", "");
      text.append(el("strong", "", labelText), el("small", "", hint));
      label.append(input, text);
      accessChoices.append(label);
      return input;
    };
    const all = radio("all", "All tools", "Read, edit, run commands and fetch pages.");
    const readOnly = radio("read-only", "Read-only", "Looks and reports; never changes a file.");
    const pick = radio("pick", "Pick tools", "Only the tools you tick.");
    const picks = el("div", "agents-tool-picks");
    const chosen = new Set(Array.isArray(existing?.toolAccess) ? existing.toolAccess : []);
    for (const tool of AGENT_PICKABLE_TOOLS) {
      const label = el("label", "agents-tool-pick");
      const box = el("input", "");
      box.type = "checkbox";
      box.value = tool.name;
      box.checked = chosen.has(tool.name);
      const text = el("span", "");
      text.append(el("strong", "", tool.label), el("small", "", tool.description));
      label.append(box, text);
      picks.append(label);
    }
    const current = existing?.toolAccess ?? "all";
    (current === "all" ? all : current === "read-only" ? readOnly : pick).checked = true;
    const syncPicks = (): void => { picks.hidden = !pick.checked; };
    for (const input of [all, readOnly, pick]) input.addEventListener("change", syncPicks);
    syncPicks();
    access.append(accessChoices, picks);

    const after = el("input", "");
    after.type = "checkbox";
    after.checked = existing?.runAfterTeammates ?? false;
    const capInput = el("input", "form-input");
    capInput.type = "number";
    capInput.min = "0.05";
    capInput.max = "1000";
    capInput.step = "0.05";
    capInput.inputMode = "decimal";
    capInput.placeholder = "No cap";
    capInput.value = existing?.capDollars === undefined ? "" : String(existing.capDollars);
    const capField = field("Usual cost cap (USD)", capInput, "Suggested on every task you give this agent; you can change it per task.");
    const afterLabel = el("label", "agents-check");
    afterLabel.append(after, document.createTextNode("In a Team, run after teammates (receive their handoffs)"));

    const notice = el("p", "form-notice");
    notice.setAttribute("role", "alert");
    notice.hidden = true;
    const buttons = el("div", "confirm-buttons");
    const save = el("button", "result-close", existing ? "Save" : "Create agent");
    save.type = "submit";
    if (existing) {
      buttons.append(button("Delete", "confirm-cancel agents-danger", () => {
        result = { kind: "delete", agent: existing };
        finish();
      }));
    }
    buttons.append(button("Cancel", "confirm-cancel", finish), save);
    form.append(lookRow, field("Name", name), field("Instructions", instructions), route, access, capField, afterLabel, models, notice, buttons);
    card.append(form);
    paintLook();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const toolAccess: ToolAccess = all.checked
        ? "all"
        : readOnly.checked
          ? "read-only"
          : [...picks.querySelectorAll<HTMLInputElement>("input:checked")].map((box) => box.value);
      const agent: AgentProfile = {
        id,
        name: name.value,
        instructions: instructions.value,
        provider: provider.value,
        model: model.value,
        ...(after.checked ? { runAfterTeammates: true } : {}),
        mascot: look,
        ...(toolAccess === "all" ? {} : { toolAccess }),
        ...(capInput.value.trim() === "" ? {} : { capDollars: Number(capInput.value) }),
      };
      if (capInput.value.trim() !== "" && !(Number(capInput.value) >= 0.05 && Number(capInput.value) <= 1_000)) {
        notice.hidden = false;
        notice.textContent = "A usual cost cap is between 0.05 and 1000 dollars - or leave it empty.";
        return;
      }
      const problem = options.validate(agent);
      if (problem !== null) {
        notice.hidden = false;
        notice.textContent = problem;
        return;
      }
      result = { kind: "save", agent };
      finish();
    });
    dialog.showModal();
    name.focus();
  });
}

/* ── Run details ──────────────────────────────────────────────────────────── */

export function openRunDetailDialog(options: {
  readonly box: BoxModel;
  readonly summary: string;
  readonly changedPaths: readonly string[];
  readonly loadTraces: () => Promise<readonly AiTeamTraceView[]>;
  readonly actions: readonly { readonly label: string; readonly primary?: boolean; readonly run: () => void }[];
  readonly mascot: HTMLElement;
  /** What the run proved and what its change puts at risk; null while it is still working. */
  readonly evidence?: { readonly checks: readonly RunCheck[]; readonly risks: readonly RiskFlag[] } | null;
}): void {
  const { dialog, card, title, finish } = openFormModal("agents-run-detail", options.box.title, () => undefined);
  const head = el("div", "agents-detail-head");
  const who = el("div", "agents-detail-who");
  who.append(el("strong", "", options.box.agentLabel), el("span", "", [options.box.modelLabel, options.box.usage, options.box.cost].filter(Boolean).join(" · ")));
  head.append(options.mascot, who);
  card.insertBefore(head, title.nextSibling);
  const status = el("p", "agents-detail-status", options.box.statusText);
  status.setAttribute("role", "status");
  card.append(status);
  for (const warning of options.box.warnings) card.append(el("p", "agents-detail-warning", warning));
  if (options.evidence) {
    const section = el("section", "agents-detail-section");
    const list = el("ul", "agents-detail-proof");
    for (const check of options.evidence.checks) {
      const item = el("li", check.ok ? "agents-proof-ok" : "agents-proof-fail", `${check.ok ? "Passed" : "Failed"}: ${check.command}`);
      list.append(item);
    }
    for (const risk of options.evidence.risks) list.append(el("li", "agents-proof-warn", risk.text));
    if (list.childElementCount === 0) list.append(el("li", "agents-detail-muted", "It ran no tests, type checks or linters, and nothing risky was found in its change."));
    section.append(el("h3", "", "Proof of work"), list);
    card.append(section);
  }
  if (options.summary.trim()) {
    const section = el("section", "agents-detail-section");
    section.append(el("h3", "", "What it reported"), el("p", "agents-detail-summary", options.summary));
    card.append(section);
  }
  if (options.changedPaths.length > 0) {
    const section = el("section", "agents-detail-section");
    const list = el("ul", "agents-detail-files");
    for (const path of options.changedPaths.slice(0, 60)) list.append(el("li", "", path));
    section.append(el("h3", "", `Files changed (${options.changedPaths.length})`), list);
    card.append(section);
  }
  const timeline = el("section", "agents-detail-section");
  const steps = el("ol", "agents-detail-timeline");
  steps.append(el("li", "agents-detail-muted", "Loading what it did…"));
  timeline.append(el("h3", "", "What it did"), steps);
  card.append(timeline);
  const buttons = el("div", "confirm-buttons");
  for (const action of options.actions) {
    buttons.append(button(action.label, action.primary === true ? "result-close" : "confirm-cancel", () => { finish(); action.run(); }));
  }
  buttons.append(button("Close", "confirm-cancel", finish));
  card.append(buttons);
  dialog.showModal();
  void options.loadTraces().then((traces) => {
    steps.replaceChildren();
    const shown = traces.filter((trace) => trace.summary.trim().length > 0).slice(-80);
    if (shown.length === 0) steps.append(el("li", "agents-detail-muted", "Nothing recorded yet."));
    for (const trace of shown) {
      const item = el("li", `agents-detail-step agents-detail-${trace.outcome}`);
      const time = el("time", "", new Date(trace.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      time.dateTime = new Date(trace.at).toISOString();
      item.append(time, el("span", "", [trace.summary, trace.detail].filter(Boolean).join(" - ")));
      steps.append(item);
    }
  }).catch(() => {
    steps.replaceChildren(el("li", "agents-detail-muted", "Could not load its activity."));
  });
}

/* ── Race compare ─────────────────────────────────────────────────────────── */

export interface RaceLane {
  readonly box: BoxModel;
  readonly mascot: HTMLElement;
  readonly summary: string;
  readonly chips: readonly EvidenceChip[];
}

/**
 * Every finished lane of a race side by side - agent, model, result, cost, proof and what it
 * said - with Keep this one on each lane that has work to keep. Keeping one is the only way a
 * race lands in the project; the page discards the others.
 */
export function openRaceCompareDialog(options: { readonly lanes: readonly RaceLane[]; readonly onKeep: (laneId: string) => void }): void {
  const { dialog, card, finish } = openFormModal("agents-race-compare", "Compare the race", () => undefined);
  card.append(el("p", "result-summary", "Same task, different agents. Keep the one you like; the others are discarded and your project only changes once."));
  const grid = el("ul", "agents-race-grid");
  grid.setAttribute("role", "list");
  for (const lane of options.lanes) {
    const item = el("li", "agents-race-lane");
    item.setAttribute("role", "listitem");
    const head = el("div", "agents-detail-head");
    const who = el("div", "agents-detail-who");
    who.append(el("strong", "", lane.box.agentLabel), el("span", "", [lane.box.modelLabel, lane.box.cost, lane.box.files > 0 ? `${lane.box.files} file${lane.box.files === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")));
    head.append(lane.mascot, who);
    const chips = el("div", "agent-box-evidence");
    for (const chip of lane.chips) {
      const node = el("span", "agent-chip", chip.text);
      node.dataset["tone"] = chip.tone;
      node.title = chip.title;
      chips.append(node);
    }
    item.append(head, el("p", "agents-detail-status", lane.box.statusText), chips, el("p", "agents-detail-summary agents-race-summary", lane.summary || "No summary."));
    if (lane.box.status === "ready") {
      const keep = button("Keep this one", "result-close", () => { finish(); options.onKeep(lane.box.id); });
      keep.setAttribute("aria-label", `Keep ${lane.box.agentLabel}'s work`);
      item.append(keep);
    }
    grid.append(item);
  }
  const buttons = el("div", "confirm-buttons");
  buttons.append(button("Close", "confirm-cancel", finish));
  card.append(grid, buttons);
  dialog.showModal();
}
