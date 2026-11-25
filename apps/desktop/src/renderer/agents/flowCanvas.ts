/**
 * The Flow page: a team of agents drawn as a graph.
 *
 * Agents are nodes on a dot-grid canvas; drag one to move it, drag from its right-hand port to
 * another agent to connect them, click a node or a link to edit it in the inspector. The chat
 * itself plays the entry agent (the one with the lightning mark): every message reaches it
 * first, and the links say who takes which work over - "whenever a coding task comes, the Coder
 * takes over". Up to fifty agents per flow.
 *
 * A flow runs on every chat or only on chats you pick, and shares as a link. The rules live in
 * `@adcode/ai/agentFlow` (pure, tested); this file is only the drawing and the gestures. Saved
 * to the setting `adcode.ai.agentFlows`, which the main process reads on each turn.
 */
import {
  addAgent, classifyTask, connect, decodeFlowLink, defaultFlow, disconnect, encodeFlowLink, flowIdFor, moveAgent, pipelineFor,
  readFlows, removeAgent, routeTask, updateAgent, FLOW_COLORS, FLOW_LINK_KINDS, FLOW_LINK_LABELS, FLOW_ROLES, FLOW_SHAPES,
  MAX_FLOW_AGENTS, MAX_FLOWS, ROLE_PRESETS, TASK_KINDS, TASK_KIND_LABELS,
  type AgentFlow, type FlowAgent, type FlowEdit, type FlowLink, type FlowLinkKind, type FlowRole, type FlowShape, type TaskKind,
} from "@adcode/ai/agentFlow";
import { Bot, Brain, Code, Copy, FlaskConical, Link2, ListChecks, Maximize2, Palette, PenLine, Play, Plus, Search, ShieldCheck, Trash2, Zap } from "lucide";
import { createIcon } from "../workbench/icons.ts";
import { enhanceSelect } from "../workbench/selectMenu.ts";
import type { AiProviderInfo, ChatSessionView } from "../../shared/api.ts";
import { chatSessions } from "../ai/sessionList.ts";

export const FLOWS_SETTING = "adcode.ai.agentFlows";

export interface FlowCanvasDeps {
  readonly prompt: (title: string, body: string, value: string) => Promise<string | null>;
  readonly confirm: (title: string, body: string, confirmLabel: string) => Promise<boolean>;
  readonly showChat: () => void;
}

export interface FlowCanvas {
  readonly element: HTMLElement;
  shown(): void;
  hidden(): void;
}

const ROLE_ICON: Readonly<Record<FlowRole, Parameters<typeof createIcon>[0]>> = {
  thinker: Brain, planner: ListChecks, coder: Code, reviewer: ShieldCheck, tester: FlaskConical,
  researcher: Search, designer: Palette, writer: PenLine, custom: Bot,
};
const ROLE_LABEL: Readonly<Record<FlowRole, string>> = {
  thinker: "Thinker", planner: "Planner", coder: "Coder", reviewer: "Reviewer", tester: "Tester",
  researcher: "Researcher", designer: "Designer", writer: "Writer", custom: "Custom",
};
const SHAPE_LABEL: Readonly<Record<FlowShape, string>> = { circle: "Circle", rounded: "Card", hexagon: "Hexagon", diamond: "Diamond", pill: "Pill" };

/** The node's body size on the canvas, in world pixels; ports sit at its vertical middle. */
/**
 * Every agent is a card of one size (after React Flow's card nodes): an icon tile in the agent's
 * shape and colour, its name, and what it takes over - readable at a glance, ports at its middle.
 * The shape lives on the tile, so a hexagon and a pill line up on the same grid.
 */
export function nodeSize(_shape: FlowShape): { readonly width: number; readonly height: number } {
  return { width: 196, height: 64 };
}

/** A smooth left-to-right curve between two ports, as n8n and most flow editors draw them. */
export function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(48, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

const SVG = "http://www.w3.org/2000/svg";
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function iconButton(label: string, icon: Parameters<typeof createIcon>[0], className = "flow-button"): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createIcon(icon));
  return button;
}
function textButton(label: string, icon: Parameters<typeof createIcon>[0] | null, className = "flow-button"): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  if (icon !== null) button.append(createIcon(icon));
  button.append(el("span", "", label));
  return button;
}

type Selection = { readonly kind: "agent"; readonly id: string } | { readonly kind: "link"; readonly id: string } | null;

export function createFlowCanvas(deps: FlowCanvasDeps): FlowCanvas {
  const element = el("div", "flow-page");
  element.setAttribute("aria-label", "Agent flow");

  /* ── Toolbar ───────────────────────────────────────────────────────── */
  const toolbar = el("header", "flow-toolbar");
  const flowSelect = el("select", "flow-select");
  flowSelect.setAttribute("aria-label", "Flow");
  const newFlow = iconButton("New flow", Plus);
  const renameFlow = textButton("Rename", null);
  const deleteFlow = iconButton("Delete this flow", Trash2);
  const enabledLabel = el("label", "flow-switch");
  const enabled = el("input");
  enabled.type = "checkbox";
  enabled.setAttribute("role", "switch");
  enabledLabel.append(enabled, el("span", "flow-switch-track"), el("span", "flow-switch-text", "Off"));
  enabledLabel.title = "Run this flow in chat";
  const scope = el("select", "flow-select flow-scope");
  scope.setAttribute("aria-label", "Which chats this flow runs in");
  scope.append(new Option("Every chat", "all"), new Option("Chosen chats", "chats"));
  const chooseChats = textButton("Choose chats", null);
  const counter = el("span", "flow-counter");
  const importLink = iconButton("Import a flow from a link", Link2);
  const shareLink = textButton("Copy link", Copy, "flow-button flow-button-primary");
  shareLink.title = "Copy a link anyone can open to get this flow";
  const left = el("div", "flow-toolbar-group");
  left.append(flowSelect, newFlow, renameFlow, deleteFlow);
  const middle = el("div", "flow-toolbar-group");
  middle.append(enabledLabel, scope, chooseChats, counter);
  const right = el("div", "flow-toolbar-group");
  right.append(importLink, shareLink);
  toolbar.append(left, middle, right);
  enhanceSelect(flowSelect, { searchPlaceholder: "Search flows" });
  enhanceSelect(scope, { search: false });

  /* ── Palette ───────────────────────────────────────────────────────── */
  const palette = el("aside", "flow-palette");
  palette.setAttribute("aria-label", "Add an agent");
  palette.append(el("h3", "flow-heading", "Add an agent"), el("p", "flow-muted", "Drag onto the canvas, or click to add."));
  for (const role of FLOW_ROLES) {
    const item = el("button", "flow-palette-item");
    item.type = "button";
    item.draggable = true;
    item.dataset["role"] = role;
    item.dataset["color"] = ROLE_PRESETS[role].color;
    item.title = ROLE_PRESETS[role].instructions;
    item.append(createIcon(ROLE_ICON[role]), el("span", "", ROLE_LABEL[role]));
    item.addEventListener("click", () => {
      const rect = stage.getBoundingClientRect();
      const centre = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      apply(addAgent(current(), role, centre.x - 42 + jitter(), centre.y - 42 + jitter()), true);
    });
    item.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("application/x-adcode-flow-role", role);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    palette.append(item);
  }
  const tryBox = el("form", "flow-try");
  const tryInput = el("input", "flow-input");
  tryInput.placeholder = "Try a message, e.g. fix the login bug";
  tryInput.setAttribute("aria-label", "Try a message to see who takes it over");
  const tryRun = iconButton("Show who takes it over", Play, "flow-button flow-button-primary");
  tryRun.type = "submit";
  const tryResult = el("p", "flow-try-result");
  tryResult.setAttribute("role", "status");
  tryBox.append(el("h3", "flow-heading", "Try it"), el("div", "flow-try-row"), tryResult);
  tryBox.querySelector(".flow-try-row")?.append(tryInput, tryRun);
  palette.append(tryBox);

  /* ── Stage ─────────────────────────────────────────────────────────── */
  const stage = el("div", "flow-stage");
  stage.tabIndex = 0;
  stage.setAttribute("role", "application");
  stage.setAttribute("aria-label", "Flow canvas. Tab to an agent; arrow keys move it; Delete removes it.");
  const world = el("div", "flow-world");
  const links = document.createElementNS(SVG, "svg");
  links.classList.add("flow-links");
  links.setAttribute("aria-hidden", "true");
  const defs = document.createElementNS(SVG, "defs");
  const marker = document.createElementNS(SVG, "marker");
  marker.id = "flow-arrow";
  for (const [key, value] of Object.entries({ viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" })) marker.setAttribute(key, value);
  const arrow = document.createElementNS(SVG, "path");
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  marker.append(arrow);
  defs.append(marker);
  links.append(defs);
  const draft = document.createElementNS(SVG, "path");
  draft.classList.add("flow-link-draft");
  const nodes = el("div", "flow-nodes");
  world.append(links, nodes);
  const zoomBar = el("div", "flow-zoom");
  const zoomIn = iconButton("Zoom in", Plus, "flow-button");
  const zoomOut = el("button", "flow-button", "-");
  zoomOut.type = "button";
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  const fit = iconButton("Fit the flow on screen", Maximize2, "flow-button");
  zoomBar.append(zoomIn, zoomOut, fit);
  const notice = el("p", "flow-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  stage.append(world, zoomBar, notice);

  /* ── Inspector ─────────────────────────────────────────────────────── */
  const inspector = el("aside", "flow-inspector");
  inspector.setAttribute("aria-label", "Selected agent or link");

  const body = el("div", "flow-body");
  body.append(palette, stage, inspector);
  element.append(toolbar, body);

  /* ── State ─────────────────────────────────────────────────────────── */
  let flows: AgentFlow[] = [];
  let currentId = "";
  let selection: Selection = null;
  let view = { x: 40, y: 20, zoom: 1 };
  let providers: readonly AiProviderInfo[] = [];
  let loaded = false;
  let saveTimer: number | undefined;
  let lastSaved = "";
  let noticeTimer: number | undefined;
  /** Agents lit up by Try it, in path order. */
  let lit: string[] = [];
  let litTimers: number[] = [];

  const current = (): AgentFlow => flows.find((flow) => flow.id === currentId) ?? flows[0] ?? defaultFlow();
  const jitter = (): number => Math.round((Math.random() - 0.5) * 60);

  function say(message: string): void {
    window.clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.hidden = message === "";
    if (message !== "") noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 4_000);
  }

  function replace(next: AgentFlow): void {
    flows = flows.map((flow) => flow.id === next.id ? next : flow);
  }

  function apply(edit: FlowEdit, selectNew = false): void {
    if (!edit.ok) { say(edit.message); return; }
    const before = new Set(current().agents.map((agent) => agent.id));
    replace(edit.flow);
    if (selectNew) {
      const added = edit.flow.agents.find((agent) => !before.has(agent.id));
      if (added !== undefined) selection = { kind: "agent", id: added.id };
    }
    render();
    save();
  }

  function save(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const value = JSON.stringify(flows);
      if (value === lastSaved) return;
      lastSaved = value;
      void window.adcode.settings.write(FLOWS_SETTING, value).catch(() => say("Could not save the flow. Your changes are still here; try again."));
    }, 350);
  }

  /* ── Coordinates ───────────────────────────────────────────────────── */
  function toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
  }
  function paintView(): void {
    world.style.transform = `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.zoom)})`;
    stage.style.setProperty("--grid-size", `${String(20 * view.zoom)}px`);
    stage.style.backgroundPosition = `${String(view.x)}px ${String(view.y)}px`;
  }
  function zoomAt(factor: number, clientX: number, clientY: number): void {
    const before = toWorld(clientX, clientY);
    view.zoom = Math.min(2, Math.max(0.3, view.zoom * factor));
    const rect = stage.getBoundingClientRect();
    view.x = clientX - rect.left - before.x * view.zoom;
    view.y = clientY - rect.top - before.y * view.zoom;
    paintView();
  }
  function fitView(): void {
    const flow = current();
    if (flow.agents.length === 0 || stage.clientWidth === 0) return;
    const xs = flow.agents.flatMap((agent) => [agent.x, agent.x + nodeSize(agent.shape).width]);
    const ys = flow.agents.flatMap((agent) => [agent.y - 28, agent.y + nodeSize(agent.shape).height]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // A phone is a few hundred pixels wide: the margin shrinks with the stage, and the zoom may go
    // as far out as the wheel does, so the whole flow shows instead of its middle (22 Nov 2026).
    const margin = Math.min(120, Math.round(stage.clientWidth * 0.12));
    const zoom = Math.min(1.1, Math.max(0.35, Math.min((stage.clientWidth - margin) / Math.max(1, maxX - minX), (stage.clientHeight - margin) / Math.max(1, maxY - minY))));
    view = { zoom, x: (stage.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom, y: (stage.clientHeight - (maxY - minY) * zoom) / 2 - minY * zoom };
    paintView();
  }

  /* ── Drawing ───────────────────────────────────────────────────────── */
  function port(agent: FlowAgent, side: "in" | "out"): { x: number; y: number } {
    const size = nodeSize(agent.shape);
    return { x: side === "out" ? agent.x + size.width : agent.x, y: agent.y + size.height / 2 };
  }

  function renderLinks(): void {
    const flow = current();
    const byId = new Map(flow.agents.map((agent) => [agent.id, agent] as const));
    for (const old of [...links.querySelectorAll("g.flow-link")]) old.remove();
    for (const link of flow.links) {
      const from = byId.get(link.from), to = byId.get(link.to);
      if (from === undefined || to === undefined) continue;
      const a = port(from, "out"), b = port(to, "in");
      const d = linkPath(a.x, a.y, b.x, b.y);
      const group = document.createElementNS(SVG, "g");
      group.classList.add("flow-link");
      group.dataset["kind"] = link.kind;
      group.dataset["id"] = link.id;
      if (selection?.kind === "link" && selection.id === link.id) group.classList.add("is-selected");
      const litFrom = lit.indexOf(link.from), litTo = lit.indexOf(link.to);
      if (litFrom >= 0 && litTo === litFrom + 1) group.classList.add("is-lit");
      const hit = document.createElementNS(SVG, "path");
      hit.classList.add("flow-link-hit");
      hit.setAttribute("d", d);
      const line = document.createElementNS(SVG, "path");
      line.classList.add("flow-link-line");
      line.setAttribute("d", d);
      line.setAttribute("marker-end", "url(#flow-arrow)");
      const pulse = document.createElementNS(SVG, "path");
      pulse.classList.add("flow-link-pulse");
      pulse.setAttribute("d", d);
      const title = document.createElementNS(SVG, "title");
      title.textContent = `${from.name} ${FLOW_LINK_LABELS[link.kind]} ${to.name}`;
      group.append(title, hit, line, pulse);
      if (link.kind !== "handoff") {
        const label = document.createElementNS(SVG, "text");
        label.classList.add("flow-link-label");
        label.setAttribute("x", String((a.x + b.x) / 2));
        label.setAttribute("y", String((a.y + b.y) / 2 - 6));
        label.setAttribute("text-anchor", "middle");
        label.textContent = link.kind === "review" ? "reviews" : "can ask";
        group.append(label);
      }
      group.addEventListener("pointerdown", (event) => { event.stopPropagation(); select({ kind: "link", id: link.id }); });
      links.append(group);
    }
    links.append(draft);
  }

  function renderNodes(): void {
    const flow = current();
    const focusedId = document.activeElement instanceof HTMLElement && nodes.contains(document.activeElement) ? document.activeElement.dataset["id"] : undefined;
    const existing = new Map([...nodes.querySelectorAll<HTMLElement>(".flow-node")].map((node) => [node.dataset["id"] ?? "", node] as const));
    for (const [id, node] of existing) if (!flow.agents.some((agent) => agent.id === id)) node.remove();
    for (const agent of flow.agents) {
      let node = existing.get(agent.id);
      if (node === undefined) {
        node = el("div", "flow-node");
        node.dataset["id"] = agent.id;
        node.tabIndex = 0;
        wireNode(node);
        nodes.append(node);
      }
      const size = nodeSize(agent.shape);
      node.style.left = `${String(agent.x)}px`;
      node.style.top = `${String(agent.y)}px`;
      node.style.setProperty("--node-w", `${String(size.width)}px`);
      node.style.setProperty("--node-h", `${String(size.height)}px`);
      node.dataset["shape"] = agent.shape;
      node.dataset["color"] = agent.color;
      node.classList.toggle("is-entry", agent.id === flow.entry);
      node.classList.toggle("is-selected", selection?.kind === "agent" && selection.id === agent.id);
      node.classList.toggle("is-lit", lit.includes(agent.id));
      const handles = agent.handles.map((kind) => TASK_KIND_LABELS[kind]).join(", ");
      node.setAttribute("aria-label", `${agent.name}, ${ROLE_LABEL[agent.role]}${agent.id === flow.entry ? ", receives every message" : ""}${handles ? `, takes over ${handles}` : ""}`);
      const card = el("div", "flow-node-body");
      const tile = el("span", "flow-node-icon");
      tile.append(createIcon(ROLE_ICON[agent.role]));
      const text = el("span", "flow-node-text");
      // The second line says what the agent does: what it takes over, then its own model and
      // whether it may edit, when those differ from the defaults.
      const takes = agent.handles.length === 0 ? ROLE_LABEL[agent.role] : agent.handles.slice(0, 2).map((kind) => TASK_KIND_LABELS[kind]).join(", ") + (agent.handles.length > 2 ? ` +${String(agent.handles.length - 2)}` : "");
      const detail = [takes, agent.model?.model ?? null, agent.readOnly ? "read-only" : null].filter((part): part is string => part !== null).join(" · ");
      text.append(el("strong", "flow-node-name", agent.name), el("span", "flow-node-detail", detail));
      card.append(tile, text);
      const inPort = el("span", "flow-port flow-port-in");
      const outPort = el("span", "flow-port flow-port-out");
      outPort.title = "Drag to another agent to connect";
      outPort.dataset["port"] = "out";
      const children: HTMLElement[] = [card, inPort, outPort];
      if (agent.id === flow.entry) {
        const trigger = el("span", "flow-node-trigger");
        trigger.title = "Every message reaches this agent first: the chat plays it";
        trigger.append(createIcon(Zap), el("span", "", "Every message starts here"));
        children.unshift(trigger);
      }
      node.replaceChildren(...children);
    }
    if (focusedId !== undefined) nodes.querySelector<HTMLElement>(`.flow-node[data-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  function renderToolbar(): void {
    const flow = current();
    flowSelect.replaceChildren(...flows.map((one) => new Option(one.name, one.id, false, one.id === flow.id)));
    enabled.checked = flow.enabled;
    enabledLabel.classList.toggle("is-on", flow.enabled);
    // The switch says what is true now, not what pressing it would do.
    const switchText = enabledLabel.querySelector(".flow-switch-text");
    if (switchText !== null) switchText.textContent = flow.enabled ? (flow.scope.kind === "all" ? "On · every chat" : "On · chosen chats") : "Off";
    scope.value = flow.scope.kind;
    chooseChats.hidden = flow.scope.kind !== "chats";
    chooseChats.querySelector("span")!.textContent = flow.scope.kind === "chats" ? `Choose chats (${String(flow.scope.chatIds.length)})` : "Choose chats";
    counter.textContent = `${String(flow.agents.length)} / ${String(MAX_FLOW_AGENTS)} agents`;
    counter.classList.toggle("is-full", flow.agents.length >= MAX_FLOW_AGENTS);
    deleteFlow.disabled = flows.length <= 1;
  }

  let modelSelect: HTMLSelectElement | null = null;
  function field(label: string, control: HTMLElement): HTMLElement {
    const wrap = el("label", "flow-field");
    wrap.append(el("span", "flow-field-label", label), control);
    if (control instanceof HTMLSelectElement) enhanceSelect(control, control === modelSelect ? { searchPlaceholder: "Search models", minWidth: 280 } : { search: false });
    return wrap;
  }

  function renderInspector(): void {
    const flow = current();
    inspector.replaceChildren();
    if (selection?.kind === "link") {
      const link = flow.links.find((one) => one.id === selection?.id);
      if (link === undefined) { selection = null; renderInspector(); return; }
      renderLinkInspector(flow, link);
      return;
    }
    const agent = selection?.kind === "agent" ? flow.agents.find((one) => one.id === selection?.id) : undefined;
    if (agent === undefined) {
      inspector.append(el("h3", "flow-heading", "How it works"));
      const steps = el("ol", "flow-steps");
      for (const text of [
        "The agent with the lightning mark is the chat itself: every message reaches it first.",
        "Each agent takes over the kinds of work it handles. A coding task goes to the Coder.",
        "Drag from an agent's right edge to another agent to hand work on. Click a link to make it a review or a question instead.",
        "Turn the flow On, for every chat or the chats you choose. Copy link shares the whole setup.",
      ]) steps.append(el("li", "", text));
      inspector.append(steps, el("p", "flow-muted", `Up to ${String(MAX_FLOW_AGENTS)} agents. Each runs on the chat's model unless you give it its own.`));
      return;
    }
    renderAgentInspector(flow, agent);
  }

  function renderLinkInspector(flow: AgentFlow, link: FlowLink): void {
    const from = flow.agents.find((agent) => agent.id === link.from)?.name ?? link.from;
    const to = flow.agents.find((agent) => agent.id === link.to)?.name ?? link.to;
    inspector.append(el("h3", "flow-heading", "Link"), el("p", "flow-muted", `${from} → ${to}`));
    const kind = el("select", "flow-select");
    for (const option of FLOW_LINK_KINDS) kind.append(new Option(`${from} ${FLOW_LINK_LABELS[option]} ${to}`, option, false, option === link.kind));
    kind.addEventListener("change", () => {
      replace({ ...flow, links: flow.links.map((one) => one.id === link.id ? { ...one, kind: kind.value as FlowLinkKind } : one) });
      render(); save();
    });
    const remove = textButton("Remove link", Trash2, "flow-button flow-button-danger");
    remove.addEventListener("click", () => { replace(disconnect(flow, link.id)); selection = null; render(); save(); });
    inspector.append(field("What it means", kind), remove);
  }

  function renderAgentInspector(flow: AgentFlow, agent: FlowAgent): void {
    const update = (patch: Partial<Omit<FlowAgent, "id">>, redraw = true): void => {
      const edit = updateAgent(current(), agent.id, patch);
      if (!edit.ok) { say(edit.message); return; }
      replace(edit.flow);
      if (redraw) render(); else { renderNodes(); renderLinks(); }
      save();
    };
    const head = el("div", "flow-inspector-head");
    const badge = el("span", "flow-inspector-badge");
    badge.dataset["color"] = agent.color;
    badge.append(createIcon(ROLE_ICON[agent.role]));
    head.append(badge, el("h3", "flow-heading", agent.name));
    inspector.append(head);

    const name = el("input", "flow-input");
    name.value = agent.name;
    name.maxLength = 60;
    name.addEventListener("change", () => { if (name.value.trim()) update({ name: name.value.trim() }); });

    const role = el("select", "flow-select");
    for (const option of FLOW_ROLES) role.append(new Option(ROLE_LABEL[option], option, false, option === agent.role));
    role.addEventListener("change", () => {
      const next = role.value as FlowRole;
      // A new role brings its own work and instructions unless the person wrote their own.
      const preset = ROLE_PRESETS[next];
      const ownWords = agent.instructions !== ROLE_PRESETS[agent.role].instructions;
      update({ role: next, handles: [...preset.handles], readOnly: preset.readOnly, ...(ownWords ? {} : { instructions: preset.instructions }) });
    });

    const shapes = el("div", "flow-shapes");
    shapes.setAttribute("role", "radiogroup");
    shapes.setAttribute("aria-label", "Shape");
    for (const shape of FLOW_SHAPES) {
      const option = el("button", "flow-shape-option");
      option.type = "button";
      option.dataset["shape"] = shape;
      option.title = SHAPE_LABEL[shape];
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(shape === agent.shape));
      option.setAttribute("aria-label", SHAPE_LABEL[shape]);
      option.append(el("span", "flow-shape-swatch"));
      option.addEventListener("click", () => update({ shape }));
      shapes.append(option);
    }

    const colors = el("div", "flow-colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", "Colour");
    for (const color of FLOW_COLORS) {
      const option = el("button", "flow-color-option");
      option.type = "button";
      option.dataset["color"] = color;
      option.title = color;
      option.setAttribute("role", "radio");
      option.setAttribute("aria-checked", String(color === agent.color));
      option.setAttribute("aria-label", color);
      option.addEventListener("click", () => update({ color }));
      colors.append(option);
    }

    const handles = el("div", "flow-handles");
    for (const kind of TASK_KINDS) {
      const wrap = el("label", "flow-chip");
      const box = el("input");
      box.type = "checkbox";
      box.checked = agent.handles.includes(kind);
      box.addEventListener("change", () => {
        const next: TaskKind[] = TASK_KINDS.filter((one) => one === kind ? box.checked : current().agents.find((a) => a.id === agent.id)?.handles.includes(one) ?? false);
        update({ handles: next }, false);
        wrap.classList.toggle("is-on", box.checked);
      });
      wrap.classList.toggle("is-on", box.checked);
      wrap.append(box, el("span", "", TASK_KIND_LABELS[kind]));
      handles.append(wrap);
    }

    const model = el("select", "flow-select");
    modelSelect = model;
    model.append(new Option("The chat's model", ""));
    for (const provider of providers.filter((one) => one.hasKey || !one.needsKey)) {
      const group = document.createElement("optgroup");
      group.label = provider.displayName;
      for (const entry of provider.models.slice(0, 60)) group.append(new Option(entry.name ?? entry.id, `${provider.id}\u0000${entry.id}`));
      model.append(group);
    }
    const chosen = agent.model === null ? "" : `${agent.model.provider}\u0000${agent.model.model}`;
    if (chosen !== "" && ![...model.options].some((option) => option.value === chosen)) model.append(new Option(`${agent.model?.model ?? ""} (not connected)`, chosen));
    model.value = chosen;
    model.addEventListener("change", () => {
      const [provider, id] = model.value.split("\u0000");
      update({ model: provider && id ? { provider, model: id } : null }, false);
    });

    const readOnly = el("label", "flow-check");
    const readBox = el("input");
    readBox.type = "checkbox";
    readBox.checked = agent.readOnly;
    readBox.addEventListener("change", () => update({ readOnly: readBox.checked }, false));
    readOnly.append(readBox, el("span", "", "Read-only (reads and reports, never edits)"));

    const instructions = el("textarea", "flow-input flow-textarea");
    instructions.value = agent.instructions;
    instructions.maxLength = 2_000;
    instructions.rows = 6;
    instructions.addEventListener("change", () => { if (instructions.value.trim()) update({ instructions: instructions.value.trim() }, false); });

    const actions = el("div", "flow-inspector-actions");
    if (agent.id !== flow.entry) {
      const entry = textButton("Receives every message", Zap);
      entry.title = "Make this the agent the chat plays";
      entry.addEventListener("click", () => { replace({ ...current(), entry: agent.id }); render(); save(); });
      actions.append(entry);
    }
    const remove = textButton("Remove agent", Trash2, "flow-button flow-button-danger");
    remove.addEventListener("click", () => { selection = null; apply(removeAgent(current(), agent.id)); });
    actions.append(remove);

    inspector.append(
      field("Name", name), field("Role", role), field("Shape", shapes), field("Colour", colors),
      field("Takes over", handles), field("Model", model), readOnly, field("Instructions", instructions), actions,
    );
  }

  function render(): void {
    if (!flows.some((flow) => flow.id === currentId)) currentId = flows[0]?.id ?? "";
    renderToolbar();
    renderNodes();
    renderLinks();
    renderInspector();
    paintView();
  }

  function select(next: Selection): void {
    selection = next;
    render();
  }

  /* ── Gestures ──────────────────────────────────────────────────────── */
  function wireNode(node: HTMLElement): void {
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const id = node.dataset["id"] ?? "";
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-port='out']")) { startConnect(id, event); return; }
      const agent = current().agents.find((one) => one.id === id);
      if (agent === undefined) return;
      if (!(selection?.kind === "agent" && selection.id === id)) select({ kind: "agent", id });
      const start = toWorld(event.clientX, event.clientY);
      const origin = { x: agent.x, y: agent.y };
      let moved = false;
      node.setPointerCapture(event.pointerId);
      node.classList.add("is-dragging");
      const move = (next: PointerEvent): void => {
        const at = toWorld(next.clientX, next.clientY);
        const x = Math.round(origin.x + at.x - start.x), y = Math.round(origin.y + at.y - start.y);
        if (!moved && Math.hypot(at.x - start.x, at.y - start.y) < 3) return;
        moved = true;
        replace(moveAgent(current(), id, x, y));
        node.style.left = `${String(x)}px`;
        node.style.top = `${String(y)}px`;
        renderLinks();
      };
      const up = (): void => {
        node.classList.remove("is-dragging");
        node.removeEventListener("pointermove", move);
        node.removeEventListener("pointerup", up);
        node.removeEventListener("pointercancel", up);
        if (moved) save();
      };
      node.addEventListener("pointermove", move);
      node.addEventListener("pointerup", up);
      node.addEventListener("pointercancel", up);
    });
    node.addEventListener("focus", () => {
      const id = node.dataset["id"] ?? "";
      if (!(selection?.kind === "agent" && selection.id === id)) { selection = { kind: "agent", id }; renderToolbar(); renderNodes(); renderLinks(); renderInspector(); }
    });
    node.addEventListener("keydown", (event) => {
      const id = node.dataset["id"] ?? "";
      const agent = current().agents.find((one) => one.id === id);
      if (agent === undefined) return;
      const step = event.shiftKey ? 40 : 10;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = delta[event.key];
      if (move !== undefined) {
        event.preventDefault();
        replace(moveAgent(current(), id, agent.x + move[0], agent.y + move[1]));
        renderNodes(); renderLinks(); save();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        selection = null;
        apply(removeAgent(current(), id));
        stage.focus();
      }
    });
  }

  function startConnect(fromId: string, event: PointerEvent): void {
    const from = current().agents.find((agent) => agent.id === fromId);
    if (from === undefined) return;
    const a = port(from, "out");
    stage.classList.add("is-connecting");
    const move = (next: PointerEvent): void => {
      const at = toWorld(next.clientX, next.clientY);
      draft.setAttribute("d", linkPath(a.x, a.y, at.x, at.y));
      for (const node of nodes.querySelectorAll<HTMLElement>(".flow-node")) node.classList.remove("is-target");
      const over = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>(".flow-node");
      if (over && over.dataset["id"] !== fromId) over.classList.add("is-target");
    };
    const up = (next: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      stage.classList.remove("is-connecting");
      draft.setAttribute("d", "");
      for (const node of nodes.querySelectorAll<HTMLElement>(".flow-node")) node.classList.remove("is-target");
      const over = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>(".flow-node");
      const toId = over?.dataset["id"];
      if (toId === undefined || toId === fromId) return;
      const edit = connect(current(), fromId, toId, "handoff");
      if (!edit.ok) { say(edit.message); return; }
      replace(edit.flow);
      selection = { kind: "link", id: `${fromId}-${toId}` };
      render(); save();
    };
    move(event);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.target instanceof Element && event.target.closest(".flow-zoom, .flow-node, .flow-link")) return;
    if (selection !== null) select(null);
    const start = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-panning");
    const move = (next: PointerEvent): void => { view.x = start.vx + next.clientX - start.x; view.y = start.vy + next.clientY - start.y; paintView(); };
    const up = (): void => { stage.classList.remove("is-panning"); stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerup", up); };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
  });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= Math.abs(event.deltaX)) zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    else { view.x -= event.deltaX; paintView(); }
  }, { passive: false });
  stage.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("application/x-adcode-flow-role")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
  });
  stage.addEventListener("drop", (event) => {
    const role = event.dataTransfer?.getData("application/x-adcode-flow-role") as FlowRole | undefined;
    if (role === undefined || !FLOW_ROLES.includes(role)) return;
    event.preventDefault();
    const at = toWorld(event.clientX, event.clientY);
    const size = nodeSize(ROLE_PRESETS[role].shape);
    apply(addAgent(current(), role, at.x - size.width / 2, at.y - size.height / 2), true);
  });
  stage.addEventListener("keydown", (event) => {
    if (event.target !== stage) return;
    if ((event.key === "Delete" || event.key === "Backspace") && selection?.kind === "link") {
      event.preventDefault();
      replace(disconnect(current(), selection.id));
      selection = null; render(); save();
    } else if (event.key === "Escape") select(null);
  });
  zoomIn.addEventListener("click", () => { const r = stage.getBoundingClientRect(); zoomAt(1.2, r.left + r.width / 2, r.top + r.height / 2); });
  zoomOut.addEventListener("click", () => { const r = stage.getBoundingClientRect(); zoomAt(1 / 1.2, r.left + r.width / 2, r.top + r.height / 2); });
  fit.addEventListener("click", () => fitView());

  /* ── Toolbar actions ───────────────────────────────────────────────── */
  flowSelect.addEventListener("change", () => { currentId = flowSelect.value; selection = null; clearLit(); render(); fitView(); });
  newFlow.addEventListener("click", () => {
    if (flows.length >= MAX_FLOWS) { say(`Up to ${String(MAX_FLOWS)} flows. Delete one to make another.`); return; }
    const id = flowIdFor("flow", flows.map((flow) => flow.id));
    const created: AgentFlow = { ...defaultFlow(id), name: `Flow ${String(flows.length + 1)}`, enabled: false };
    flows = [...flows, created];
    currentId = id; selection = null;
    render(); fitView(); save();
  });
  renameFlow.addEventListener("click", () => {
    void deps.prompt("Rename this flow", "A short name you will recognise in the list.", current().name).then((name) => {
      if (name === null || !name.trim()) return;
      replace({ ...current(), name: name.trim().slice(0, 80) }); render(); save();
    });
  });
  deleteFlow.addEventListener("click", () => {
    if (flows.length <= 1) return;
    const flow = current();
    void deps.confirm(`Delete "${flow.name}"?`, "Its agents and links are removed from this machine. Chats it ran in keep their history.", "Delete flow").then((sure) => {
      if (!sure) return;
      flows = flows.filter((one) => one.id !== flow.id);
      currentId = flows[0]?.id ?? ""; selection = null;
      render(); fitView(); save();
    });
  });
  enabled.addEventListener("change", () => {
    const flow = current();
    // Only one flow runs for every chat: turning another on for all chats turns this one's peer off.
    flows = flows.map((one) => one.id === flow.id ? { ...one, enabled: enabled.checked } : enabled.checked && flow.scope.kind === "all" && one.scope.kind === "all" ? { ...one, enabled: false } : one);
    render(); save();
    say(enabled.checked ? (flow.scope.kind === "all" ? "On for every chat. Your next message goes through this flow." : "On for the chats you chose.") : "Off. Chats work on their own again.");
  });
  scope.addEventListener("change", () => {
    const flow = current();
    replace({ ...flow, scope: scope.value === "chats" ? { kind: "chats", chatIds: flow.scope.kind === "chats" ? flow.scope.chatIds : [] } : { kind: "all" } });
    render(); save();
    if (scope.value === "chats") void pickChats();
  });
  chooseChats.addEventListener("click", () => void pickChats());
  shareLink.addEventListener("click", () => {
    const link = encodeFlowLink(current());
    void window.adcode.clipboard.writeText(link).then(() => say("Link copied. Anyone with ADCode can paste it into Import to get this flow."), () => say("Could not copy the link."));
  });
  importLink.addEventListener("click", () => {
    void deps.prompt("Import a flow", "Paste a flow link someone shared with you.", "").then((text) => {
      if (text === null) return;
      const result = decodeFlowLink(text);
      if (!result.ok) { say(result.message); return; }
      if (flows.length >= MAX_FLOWS) { say(`Up to ${String(MAX_FLOWS)} flows. Delete one to import another.`); return; }
      const id = flowIdFor(result.flow.id, flows.map((flow) => flow.id));
      // An imported flow starts off: nobody's chats change until they turn it on.
      flows = [...flows, { ...result.flow, id, enabled: false }];
      currentId = id; selection = null;
      render(); fitView(); save();
      say(`Imported "${result.flow.name}" with ${String(result.flow.agents.length)} agents. Turn it On to use it.`);
    });
  });

  /** A checklist of saved chats; the flow runs only in the ticked ones. */
  async function pickChats(): Promise<void> {
    const sessions: readonly ChatSessionView[] = await chatSessions().catch(() => []);
    const flow = current();
    const chosen = new Set(flow.scope.kind === "chats" ? flow.scope.chatIds : []);
    const sheet = el("div", "flow-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-label", "Choose chats for this flow");
    const list = el("div", "flow-sheet-list");
    if (sessions.length === 0) list.append(el("p", "flow-muted", "No saved chats in this project yet. Start one, then choose it here."));
    for (const session of [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200)) {
      const row = el("label", "flow-check");
      const box = el("input");
      box.type = "checkbox";
      box.checked = chosen.has(session.id);
      box.addEventListener("change", () => { if (box.checked) chosen.add(session.id); else chosen.delete(session.id); });
      row.append(box, el("span", "", session.title));
      list.append(row);
    }
    const done = textButton("Done", null, "flow-button flow-button-primary");
    const close = (): void => {
      replace({ ...current(), scope: { kind: "chats", chatIds: [...chosen] } });
      sheet.remove(); render(); save();
    };
    done.addEventListener("click", close);
    sheet.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    sheet.append(el("h3", "flow-heading", "Run this flow in"), list, done);
    element.querySelector(".flow-sheet")?.remove();
    element.append(sheet);
    sheet.querySelector<HTMLInputElement>("input")?.focus();
  }

  /* ── Try it ────────────────────────────────────────────────────────── */
  function clearLit(): void {
    for (const timer of litTimers) window.clearTimeout(timer);
    litTimers = [];
    lit = [];
  }
  tryBox.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = tryInput.value.trim();
    if (!text) { tryInput.focus(); return; }
    const flow = current();
    const kind = classifyTask(text);
    const lead = routeTask(flow, kind);
    const path = pipelineFor(flow, kind);
    clearLit();
    // Light the path one agent at a time, so the hand-offs read as a sequence.
    path.forEach((agent, index) => {
      litTimers.push(window.setTimeout(() => { lit = path.slice(0, index + 1).map((one) => one.id); renderNodes(); renderLinks(); }, index * 420));
    });
    litTimers.push(window.setTimeout(() => { lit = []; renderNodes(); renderLinks(); }, path.length * 420 + 2_600));
    tryResult.textContent = `${TASK_KIND_LABELS[kind]} work: ${lead.name} takes over${path.length > 1 ? `, then ${path.slice(1).map((agent) => agent.name).join(", ")}` : ""}.${flow.enabled ? "" : " Turn the flow On to use it in chat."}`;
  });

  /* ── Loading ───────────────────────────────────────────────────────── */
  function adopt(raw: unknown): void {
    const next = readFlows(raw);
    // First visit: one flow to start from, off until the person turns it on.
    flows = next.length > 0 ? next : [{ ...defaultFlow(), enabled: false }];
    if (!flows.some((flow) => flow.id === currentId)) currentId = flows[0]!.id;
  }
  async function load(): Promise<void> {
    const [values, status] = await Promise.all([window.adcode.settings.read(), window.adcode.ai.status().catch(() => null)]);
    providers = status?.providers ?? [];
    lastSaved = typeof values[FLOWS_SETTING] === "string" ? values[FLOWS_SETTING] : "";
    adopt(values[FLOWS_SETTING]);
    loaded = true;
    render();
    requestAnimationFrame(() => fitView());
  }
  window.adcode.settings.onChanged((values) => {
    if (!loaded) return;
    const value = values[FLOWS_SETTING];
    if (typeof value !== "string" || value === lastSaved) return;
    lastSaved = value;
    adopt(value);
    render();
  });

  return {
    element,
    shown() {
      document.body.dataset["flowOpen"] = "true";
      if (!loaded) void load().catch(() => say("Could not load your flows."));
      else requestAnimationFrame(() => paintView());
    },
    hidden() {
      delete document.body.dataset["flowOpen"];
      clearLit();
      element.querySelector(".flow-sheet")?.remove();
    },
  };
}
