/**
 * `manage_agent_flow`: the chat builds and changes agent flows, the person confirms.
 *
 * Asked for 20 November 2026: everything the Flow page does, by asking the chat - "make a flow
 * where Fable plans, DeepSeek codes and a read-only reviewer checks, and turn it on for this
 * chat". The flows are the same setting the page draws (`adcode.ai.agentFlows`), read and
 * checked by the same rules (`agentFlow.ts`), so a flow made here opens on the page as if it
 * had been drawn there, and one drawn there can be changed here.
 *
 * This file only plans: it turns a tool call into the flows that would be saved, the words the
 * person reads before they are, and what the chat is told after. The main process shows the
 * dialog and writes the setting. Models resolve the way `create_agent` resolves them - a loose
 * name, an exact id, or a list back to choose from when a name is ambiguous.
 *
 * Pure: no I/O, no clock, no DOM.
 */
import {
  decodeFlowLink, encodeFlowLink, flowIdFor, parseFlow, FLOW_LINK_KINDS, FLOW_LINK_LABELS, FLOW_ROLES, MAX_FLOW_AGENTS,
  MAX_FLOW_LINKS, MAX_FLOWS, ROLE_PRESETS, TASK_KINDS, TASK_KIND_LABELS,
  type AgentFlow, type FlowAgent, type FlowLink, type FlowLinkKind, type FlowModel, type FlowRole, type FlowScope, type TaskKind,
} from "./agentFlow.ts";
import { resolveModel, type ModelCandidate } from "./taskAgents.ts";
import type { ToolDefinition } from "./types.ts";

export const MANAGE_AGENT_FLOW_NAME = "manage_agent_flow";
export const FLOW_ACTIONS = ["list", "create", "edit", "delete", "on", "off", "share", "import"] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

export const MANAGE_AGENT_FLOW: ToolDefinition = {
  name: MANAGE_AGENT_FLOW_NAME,
  description: [
    "Create, edit, turn on or off, delete and share agent flows (the Flow page): a team of agents, each with a role, model and instructions, linked so work passes from one to the next.",
    "list first to see the flows. create: name, agents, links. edit (also renames): flow plus only what changes - agents are matched by name (add new ones, change fields, new_name renames, remove: true deletes), links likewise; name renames the flow.",
    "chats picks where it runs: [\"this\"] for this chat, chat ids or titles, or [\"all\"]; on/off with chats adds or removes those chats.",
    "The first agent (or entry) is the chat itself and runs on the chat's model. model takes a loose name like 'deepseek' or 'current'; an ambiguous name returns the choices.",
    "share returns a link; import takes one. The user confirms every change in a dialog before it is saved.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...FLOW_ACTIONS] },
      flow: { type: "string", description: "An existing flow's name or id (edit, delete, on, off, share)" },
      name: { type: "string", description: "create: the flow's name. edit: its new name" },
      agents: {
        type: "array",
        maxItems: MAX_FLOW_AGENTS,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            new_name: { type: "string", description: "edit: rename this agent" },
            role: { type: "string", enum: [...FLOW_ROLES] },
            model: { type: "string", description: "Loose name or exact id; 'current' = the chat's model" },
            provider: { type: "string", description: "Only when the model is offered by several connections" },
            instructions: { type: "string" },
            read_only: { type: "boolean" },
            handles: { type: "array", items: { type: "string", enum: [...TASK_KINDS] }, description: "Work it takes over; defaults from role" },
            remove: { type: "boolean" },
          },
          required: ["name"],
        },
      },
      links: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            kind: { type: "string", enum: [...FLOW_LINK_KINDS], description: "handoff (default), review, consult" },
            remove: { type: "boolean" },
          },
          required: ["from", "to"],
        },
      },
      entry: { type: "string", description: "The agent every message reaches first" },
      chats: { type: "array", items: { type: "string" } },
      on: { type: "boolean", description: "create/edit/import: whether it runs (create: on)" },
      link: { type: "string", description: "import: a flow link" },
    },
    required: ["action"],
  },
  mutating: true,
};

/** A saved chat the tool can name: "this chat", or its title. */
export interface FlowChat { readonly id: string; readonly title: string }

export interface FlowToolContext {
  readonly flows: readonly AgentFlow[];
  /** Every model an agent could run on, preferred first (see `resolveModel`). */
  readonly candidates: readonly ModelCandidate[];
  /** The chat the tool was called from, for chats: ["this"]. */
  readonly chatId: string | null;
  readonly chats?: readonly FlowChat[];
}

/** What a call would do: answer (list, share), or change the flows once the person agrees. */
export type FlowPlan =
  | { readonly ok: true; readonly kind: "answer"; readonly content: string }
  | {
      readonly ok: true;
      readonly kind: "change";
      readonly action: FlowAction;
      /** Every flow as it would be saved, the order kept. */
      readonly flows: readonly AgentFlow[];
      /** The flow changed or made; null when it was deleted. */
      readonly flow: AgentFlow | null;
      readonly title: string;
      readonly detail: string;
      readonly confirmLabel: string;
      /** What the chat is told once it is saved. */
      readonly done: string;
      /** One line for the debug log. */
      readonly log: string;
    }
  | { readonly ok: false; readonly message: string };

const fail = (message: string): FlowPlan => ({ ok: false, message });
const fields = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\u0000/g, "").trim();
  return text === "" ? null : text.slice(0, max);
};
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
/** The model words that mean "run on whatever the chat runs on". */
const CHAT_MODEL = new Set(["current", "chat", "same", "default", "inherit", "the chat's model", "chat model", "current model"]);

/** A flow by its name or id. */
export function findFlow(flows: readonly AgentFlow[], ref: unknown): AgentFlow | null {
  const wanted = typeof ref === "string" ? ref.trim() : "";
  if (wanted === "") return flows.length === 1 ? flows[0]! : null;
  return flows.find((flow) => flow.id === wanted) ?? flows.find((flow) => same(flow.name, wanted)) ?? null;
}

function agentRef(flow: Pick<AgentFlow, "agents">, ref: string): FlowAgent | undefined {
  return flow.agents.find((agent) => agent.id === ref) ?? flow.agents.find((agent) => same(agent.name, ref));
}

/** A role from the words in a name when none is given: "Code reviewer" is a reviewer. */
export function guessRole(name: string): FlowRole {
  const text = name.toLowerCase();
  const order: readonly [FlowRole, RegExp][] = [
    ["reviewer", /review|check|audit|critic/], ["tester", /test|qa\b/], ["planner", /plan|architect|lead/],
    ["thinker", /think|router|triage/], ["researcher", /research|search|explor|scout/], ["designer", /design|ui\b|ux\b|style/],
    ["writer", /writ|doc|copy/], ["coder", /cod|build|dev|engineer|implement|program|fix/],
  ];
  return order.find(([, pattern]) => pattern.test(text))?.[0] ?? "custom";
}

function modelLabel(model: FlowModel | null, candidates: readonly ModelCandidate[]): string {
  if (model === null) return "the chat's model";
  const known = candidates.find((one) => one.providerId === model.provider && one.modelId === model.model);
  return known === undefined ? `${model.model} (${model.provider})` : `${known.modelName} on ${known.providerName}`;
}

/** The chats a list of names means, or why one cannot be found. "all" comes back as null. */
function resolveChats(raw: unknown, ctx: FlowToolContext): { readonly ok: true; readonly ids: readonly string[] | null } | { readonly ok: false; readonly message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "chats is a list: [\"this\"], [\"all\"], or chat ids or titles." };
  const ids: string[] = [];
  for (const entry of raw) {
    const word = typeof entry === "string" ? entry.trim() : "";
    if (word === "") continue;
    const lower = word.toLowerCase();
    if (lower === "all" || lower === "every chat" || lower === "all chats") return { ok: true, ids: null };
    if (lower === "this" || lower === "this chat" || lower === "current") {
      if (ctx.chatId === null) return { ok: false, message: "This conversation has no saved id yet. Send a message first, or name the chats." };
      ids.push(ctx.chatId);
      continue;
    }
    const byId = ctx.chats?.find((chat) => chat.id === word);
    const byTitle = ctx.chats?.filter((chat) => same(chat.title, word)) ?? [];
    if (byId !== undefined) ids.push(byId.id);
    else if (byTitle.length === 1) ids.push(byTitle[0]!.id);
    else if (byTitle.length > 1) return { ok: false, message: `Several chats are called "${word}": ${byTitle.map((chat) => chat.id).join(", ")}. Name it by id.` };
    else if (/^[A-Za-z0-9_-]{1,80}$/.test(word) && ctx.chats === undefined) ids.push(word);
    else return { ok: false, message: `No chat called "${word}". Use "this", "all", or a chat id or title from adcode_chats.` };
  }
  if (ids.length === 0) return { ok: false, message: "Name at least one chat, or use [\"all\"]." };
  return { ok: true, ids: [...new Set(ids)] };
}

function scopeText(scope: FlowScope, enabled: boolean, ctx: FlowToolContext): string {
  if (!enabled) return "off";
  if (scope.kind === "all") return "on in every chat";
  if (scope.chatIds.length === 0) return "on, but in no chat yet";
  const names = scope.chatIds.slice(0, 6).map((id) => id === ctx.chatId ? "this chat" : `"${ctx.chats?.find((chat) => chat.id === id)?.title ?? id}"`);
  return `on in ${names.join(", ")}${scope.chatIds.length > names.length ? ` and ${String(scope.chatIds.length - names.length)} more` : ""}`;
}

function agentLine(flow: AgentFlow, agent: FlowAgent, candidates: readonly ModelCandidate[]): string {
  const work = agent.handles.length === 0 ? "anything it is given" : agent.handles.map((kind) => TASK_KIND_LABELS[kind].toLowerCase()).join(", ");
  const lead = agent.id === flow.entry ? "first stop - the chat itself plays it, on the chat's model" : modelLabel(agent.model, candidates);
  return `${agent.name} (${agent.role}${agent.readOnly ? ", read-only" : ""}): ${lead}; takes ${work}`;
}

function linkLine(flow: AgentFlow, link: FlowLink): string {
  const name = (id: string): string => flow.agents.find((agent) => agent.id === id)?.name ?? id;
  return `${name(link.from)} ${FLOW_LINK_LABELS[link.kind]} ${name(link.to)}`;
}

/** A flow in a few lines: who is in it, how work moves, where it runs. */
export function describeFlow(flow: AgentFlow, ctx: FlowToolContext): string[] {
  return [
    `Runs: ${scopeText(flow.scope, flow.enabled, ctx)}.`,
    "Agents:",
    ...flow.agents.map((agent) => `• ${agentLine(flow, agent, ctx.candidates)}`),
    ...(flow.links.length === 0 ? ["Links: none - each agent is reached only by the work it takes."] : ["Links:", ...flow.links.map((link) => `• ${linkLine(flow, link)}`)]),
  ];
}

/** The flows as the chat reads them for action list. */
export function describeFlows(ctx: FlowToolContext): string {
  if (ctx.flows.length === 0) return "No agent flows yet. Make one with action create.";
  return ctx.flows.map((flow) => {
    const agents = flow.agents.map((agent) => `${agent.name}${agent.id === flow.entry ? " [entry]" : ""} (${agent.role}, ${agent.id === flow.entry ? "chat's model" : agent.model === null ? "chat's model" : `${agent.model.provider}:${agent.model.model}`}${agent.readOnly ? ", read-only" : ""}, takes ${agent.handles.join("/") || "anything"})`);
    const links = flow.links.map((link) => linkLine(flow, link));
    return `- "${flow.name}" (id ${flow.id}), ${scopeText(flow.scope, flow.enabled, ctx)}. Agents: ${agents.join("; ")}. Links: ${links.join("; ") || "none"}.`;
  }).join("\n");
}

/** Columns by distance from the entry along the links; each column stacked. */
function layout(agents: FlowAgent[], links: readonly FlowLink[], entry: string, fixed: ReadonlySet<string>): FlowAgent[] {
  const depth = new Map<string, number>([[entry, 0]]);
  const queue = [entry];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of links) {
      if (link.from !== id || depth.has(link.to)) continue;
      depth.set(link.to, depth.get(id)! + 1);
      queue.push(link.to);
    }
  }
  // Agents added to a drawn flow go in a column of their own to the right, so nothing the
  // person placed moves; a new flow is laid out left to right from its entry.
  const placed = agents.filter((agent) => fixed.has(agent.id));
  const addedColumnX = placed.length === 0 ? null : Math.max(...placed.map((agent) => agent.x)) + 280;
  const rows = new Map<number, number>();
  let loose = Math.max(0, ...[...depth.values()]) + 1;
  let added = 0;
  return agents.map((agent) => {
    if (fixed.has(agent.id)) return agent;
    if (addedColumnX !== null) return { ...agent, x: addedColumnX, y: 120 + (added++) * 170 };
    const column = depth.get(agent.id) ?? loose++;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { ...agent, x: 80 + column * 280, y: 140 + row * 170 };
  });
}

interface AgentInput {
  readonly name: string;
  readonly newName: string | null;
  readonly role: FlowRole | null;
  readonly model: string | null;
  readonly provider: string | null;
  readonly instructions: string | null;
  readonly readOnly: boolean | null;
  readonly handles: readonly TaskKind[] | null;
  readonly remove: boolean;
}

function readAgentInputs(raw: unknown): { readonly ok: true; readonly agents: readonly AgentInput[] } | { readonly ok: false; readonly message: string } {
  if (raw === undefined) return { ok: true, agents: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "agents is a list of objects with at least a name." };
  if (raw.length > MAX_FLOW_AGENTS) return { ok: false, message: `A flow holds up to ${String(MAX_FLOW_AGENTS)} agents.` };
  const agents: AgentInput[] = [];
  for (const [index, entry] of raw.entries()) {
    const item = fields(entry);
    const name = str(item["name"], 60);
    if (name === null) return { ok: false, message: `Agent ${String(index + 1)} needs a name (up to 60 characters).` };
    const role = item["role"];
    if (role !== undefined && !FLOW_ROLES.includes(role as FlowRole)) return { ok: false, message: `${name}: role is one of ${FLOW_ROLES.join(", ")}.` };
    const handles = item["handles"];
    if (handles !== undefined && (!Array.isArray(handles) || handles.some((kind) => !TASK_KINDS.includes(kind as TaskKind)))) {
      return { ok: false, message: `${name}: handles is a list of ${TASK_KINDS.join(", ")}.` };
    }
    const readOnly = item["read_only"];
    if (readOnly !== undefined && typeof readOnly !== "boolean") return { ok: false, message: `${name}: read_only is true or false.` };
    const instructions = item["instructions"];
    if (typeof instructions === "string" && instructions.trim().length > 2_000) return { ok: false, message: `${name}: instructions are up to 2,000 characters.` };
    agents.push({
      name,
      newName: str(item["new_name"], 60),
      role: role === undefined ? null : role as FlowRole,
      model: typeof item["model"] === "string" ? item["model"].trim() : null,
      provider: str(item["provider"], 128),
      instructions: str(instructions, 2_000),
      readOnly: readOnly === undefined ? null : readOnly,
      handles: handles === undefined ? null : TASK_KINDS.filter((kind) => (handles as unknown[]).includes(kind)),
      remove: item["remove"] === true,
    });
  }
  return { ok: true, agents };
}

/** The model an agent input asks for: unchanged (undefined), the chat's (null), or a resolved one. */
function modelFor(input: AgentInput, ctx: FlowToolContext): { readonly ok: true; readonly model: FlowModel | null | undefined } | { readonly ok: false; readonly message: string } {
  if (input.model === null) return { ok: true, model: undefined };
  if (input.model === "" || CHAT_MODEL.has(input.model.toLowerCase())) return { ok: true, model: null };
  const match = resolveModel(input.model, input.provider ?? undefined, ctx.candidates);
  if (!match.ok) return { ok: false, message: `${input.name}: ${match.message}` };
  return { ok: true, model: { provider: match.candidate.providerId, model: match.candidate.modelId } };
}

/** An agent made from an input, or an existing agent with the input's changes. */
function applyAgent(base: FlowAgent | null, input: AgentInput, model: FlowModel | null | undefined, taken: readonly string[]): FlowAgent {
  const role = input.role ?? base?.role ?? guessRole(input.name);
  const preset = ROLE_PRESETS[role];
  const roleChanged = base !== null && input.role !== null && input.role !== base.role;
  const keptInstructions = base !== null && !(roleChanged && base.instructions === ROLE_PRESETS[base.role].instructions) ? base.instructions : null;
  const name = input.newName ?? base?.name ?? input.name;
  return {
    id: base?.id ?? flowIdFor(name, taken),
    name,
    role,
    instructions: input.instructions ?? keptInstructions ?? preset.instructions,
    handles: input.handles !== null ? [...input.handles] : base !== null && !roleChanged ? base.handles : [...preset.handles],
    shape: base !== null && !roleChanged ? base.shape : preset.shape,
    color: base !== null && !roleChanged ? base.color : preset.color,
    x: base?.x ?? 0,
    y: base?.y ?? 0,
    model: model === undefined ? base?.model ?? null : model,
    readOnly: input.readOnly ?? (base !== null && !roleChanged ? base.readOnly : preset.readOnly),
  };
}

/** Agents and links changed by the inputs, on top of `start` (empty for a new flow). */
function buildAgentsAndLinks(start: AgentFlow | null, rawAgents: unknown, rawLinks: unknown, rawEntry: unknown, ctx: FlowToolContext):
  { readonly ok: true; readonly agents: FlowAgent[]; readonly links: FlowLink[]; readonly entry: string } | { readonly ok: false; readonly message: string } {
  const read = readAgentInputs(rawAgents);
  if (!read.ok) return read;
  const names = read.agents.map((agent) => agent.name.toLowerCase());
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) return { ok: false, message: `Two agents are called "${duplicate}". Give each a different name.` };

  let agents: FlowAgent[] = start === null ? [] : [...start.agents];
  let links: FlowLink[] = start === null ? [] : [...start.links];
  const fixed = new Set(agents.map((agent) => agent.id));
  for (const input of read.agents) {
    const existing = start === null ? undefined : agentRef({ agents }, input.name);
    if (input.remove) {
      if (existing === undefined) return { ok: false, message: `There is no agent called "${input.name}" to remove.` };
      agents = agents.filter((agent) => agent.id !== existing.id);
      links = links.filter((link) => link.from !== existing.id && link.to !== existing.id);
      continue;
    }
    const model = modelFor(input, ctx);
    if (!model.ok) return model;
    if (input.newName !== null && agents.some((agent) => agent.id !== existing?.id && same(agent.name, input.newName!))) {
      return { ok: false, message: `Another agent is already called "${input.newName}".` };
    }
    if (existing === undefined) {
      if (agents.length >= MAX_FLOW_AGENTS) return { ok: false, message: `A flow holds up to ${String(MAX_FLOW_AGENTS)} agents.` };
      agents.push(applyAgent(null, input, model.model, agents.map((agent) => agent.id)));
    } else {
      agents = agents.map((agent) => agent.id === existing.id ? applyAgent(existing, input, model.model, []) : agent);
    }
  }
  if (agents.length === 0) return { ok: false, message: "A flow needs at least one agent." };

  if (rawLinks !== undefined && !Array.isArray(rawLinks)) return { ok: false, message: "links is a list of { from, to, kind }." };
  for (const entry of Array.isArray(rawLinks) ? rawLinks : []) {
    const item = fields(entry);
    const fromName = str(item["from"], 60), toName = str(item["to"], 60);
    if (fromName === null || toName === null) return { ok: false, message: "Each link names an agent in from and in to." };
    const from = agentRef({ agents }, fromName), to = agentRef({ agents }, toName);
    if (from === undefined || to === undefined) return { ok: false, message: `The link ${fromName} -> ${toName} names an agent that is not in the flow. Agents: ${agents.map((agent) => agent.name).join(", ")}.` };
    if (from.id === to.id) return { ok: false, message: `${from.name} cannot hand work to itself.` };
    const kind = item["kind"] ?? "handoff";
    if (!FLOW_LINK_KINDS.includes(kind as FlowLinkKind)) return { ok: false, message: `A link's kind is one of ${FLOW_LINK_KINDS.join(", ")}.` };
    const at = links.findIndex((link) => link.from === from.id && link.to === to.id);
    if (item["remove"] === true) {
      if (at < 0) return { ok: false, message: `${from.name} and ${to.name} are not linked.` };
      links.splice(at, 1);
      continue;
    }
    const link: FlowLink = { id: `${from.id}-${to.id}`, from: from.id, to: to.id, kind: kind as FlowLinkKind };
    if (at >= 0) links[at] = link;
    else {
      if (links.length >= MAX_FLOW_LINKS) return { ok: false, message: `A flow holds up to ${String(MAX_FLOW_LINKS)} links.` };
      links.push(link);
    }
  }

  let entry = start !== null && agents.some((agent) => agent.id === start.entry) ? start.entry : agents[0]!.id;
  if (rawEntry !== undefined) {
    const name = str(rawEntry, 60);
    const found = name === null ? undefined : agentRef({ agents }, name);
    if (found === undefined) return { ok: false, message: `entry names an agent that is not in the flow. Agents: ${agents.map((agent) => agent.name).join(", ")}.` };
    entry = found.id;
  }
  return { ok: true, agents: layout(agents, links, entry, start === null ? new Set() : fixed), links, entry };
}

/**
 * Where a flow runs once it is switched on: one flow per chat and one for every chat, so
 * turning one on takes the same place off any other - said in the dialog, not done quietly.
 */
function resolveConflicts(flows: readonly AgentFlow[], changed: AgentFlow, ctx: FlowToolContext): { readonly flows: AgentFlow[]; readonly notes: string[] } {
  const notes: string[] = [];
  const next = flows.map((flow) => {
    if (flow.id === changed.id || !flow.enabled || !changed.enabled) return flow;
    if (changed.scope.kind === "all" && flow.scope.kind === "all") {
      notes.push(`"${flow.name}" ran in every chat; it is switched off, since one flow runs in every chat at a time.`);
      return { ...flow, enabled: false };
    }
    if (changed.scope.kind === "chats" && flow.scope.kind === "chats") {
      const taken = new Set(changed.scope.chatIds);
      const left = flow.scope.chatIds.filter((id) => !taken.has(id));
      if (left.length === flow.scope.chatIds.length) return flow;
      const moved = flow.scope.chatIds.filter((id) => taken.has(id)).map((id) => id === ctx.chatId ? "this chat" : `"${ctx.chats?.find((chat) => chat.id === id)?.title ?? id}"`);
      notes.push(`"${flow.name}" stops running in ${moved.join(", ")}.`);
      return { ...flow, scope: { kind: "chats" as const, chatIds: left }, ...(left.length === 0 ? { enabled: false } : {}) };
    }
    return flow;
  });
  return { flows: next, notes };
}

/** The notes worth reading before a flow is saved: a lead whose model will not be used, a read-only coder. */
function cautions(flow: AgentFlow, ctx: FlowToolContext): string[] {
  const notes: string[] = [];
  const entry = flow.agents.find((agent) => agent.id === flow.entry);
  if (entry?.model != null) notes.push(`${entry.name} is the chat itself, so it runs on the chat's model, not ${modelLabel(entry.model, ctx.candidates)}. Switch the chat to that model to have it lead.`);
  for (const agent of flow.agents) {
    if (agent.readOnly && (agent.handles.includes("code") || agent.handles.includes("debug"))) notes.push(`${agent.name} is read-only but takes coding work: it can read and advise, not edit.`);
  }
  return notes;
}

function changePlan(action: FlowAction, flows: readonly AgentFlow[], flow: AgentFlow | null, title: string, body: readonly string[], confirmLabel: string, done: string, log: string): FlowPlan {
  return {
    ok: true, kind: "change", action, flows, flow, title, confirmLabel, done, log,
    detail: [...body, "", "Nothing is saved until you confirm. You can change it any time on the Flow page or by asking the chat."].join("\n"),
  };
}

/** The flow, checked by the same parser the Flow page and the main process read it with. */
function checked(flow: AgentFlow): AgentFlow | null {
  const parsed = parseFlow(flow);
  return parsed !== null && parsed.agents.length === flow.agents.length ? parsed : null;
}

/** What a manage_agent_flow call would do, or why it cannot. */
export function planFlowChange(input: unknown, ctx: FlowToolContext): FlowPlan {
  const item = fields(input);
  if (!FLOW_ACTIONS.includes(item["action"] as FlowAction)) return fail(`action is one of ${FLOW_ACTIONS.join(", ")}.`);
  const action = item["action"] as FlowAction;

  if (action === "list") return { ok: true, kind: "answer", content: describeFlows(ctx) };

  if (action === "create" || action === "import") {
    if (ctx.flows.length >= MAX_FLOWS) return fail(`ADCode keeps up to ${String(MAX_FLOWS)} flows. Delete one first.`);
    let draft: AgentFlow;
    if (action === "import") {
      const decoded = decodeFlowLink(typeof item["link"] === "string" ? item["link"] : "");
      if (!decoded.ok) return fail(decoded.message);
      draft = { ...decoded.flow, id: flowIdFor(decoded.flow.id, ctx.flows.map((flow) => flow.id)), enabled: item["on"] === true, scope: { kind: "all" } };
    } else {
      const name = str(item["name"], 80);
      if (name === null) return fail("Give the flow a name (up to 80 characters).");
      if (ctx.flows.some((flow) => same(flow.name, name))) return fail(`A flow called "${name}" already exists. Use action edit to change it, or pick another name.`);
      if (!Array.isArray(item["agents"]) || item["agents"].length === 0) return fail("List the flow's agents: each with a name, and a role, model and instructions where they matter.");
      const built = buildAgentsAndLinks(null, item["agents"], item["links"], item["entry"], ctx);
      if (!built.ok) return built;
      draft = { version: 1, id: flowIdFor(name, ctx.flows.map((flow) => flow.id)), name, enabled: item["on"] !== false, entry: built.entry, scope: { kind: "all" }, agents: built.agents, links: built.links };
    }
    if (item["chats"] !== undefined) {
      const chats = resolveChats(item["chats"], ctx);
      if (!chats.ok) return chats;
      draft = { ...draft, scope: chats.ids === null ? { kind: "all" } : { kind: "chats", chatIds: chats.ids } };
    }
    const flow = checked(draft);
    if (flow === null) return fail("That flow would not be readable. Check the agents' names and the links.");
    const others = resolveConflicts(ctx.flows, flow, ctx);
    const verb = action === "import" ? "Import" : "Create";
    return changePlan(action, [...others.flows, flow], flow, `${verb} the flow "${flow.name}"?`,
      [...describeFlow(flow, ctx), ...cautions(flow, ctx), ...others.notes],
      action === "import" ? "Import flow" : "Create flow",
      `Saved the flow "${flow.name}" (id ${flow.id}), ${scopeText(flow.scope, flow.enabled, ctx)}, with ${String(flow.agents.length)} agents. It is on the Flow page now.${cautions(flow, ctx).map((note) => ` ${note}`).join("")}`,
      `${action === "import" ? "Imported" : "Created"} agent flow ${flow.id} (${String(flow.agents.length)} agents, ${scopeText(flow.scope, flow.enabled, ctx)})`);
  }

  const target = findFlow(ctx.flows, item["flow"]);
  if (target === null) {
    return fail(ctx.flows.length === 0 ? "There are no flows yet. Make one with action create." : `Name the flow. Flows: ${ctx.flows.map((flow) => `"${flow.name}" (${flow.id})`).join(", ")}.`);
  }

  if (action === "share") {
    return { ok: true, kind: "answer", content: `Share link for "${target.name}": ${encodeFlowLink(target)}\nAnyone with ADCode can import it (Flow page > Import, or ask the chat). Which chats it runs in stays on this computer.` };
  }

  if (action === "delete") {
    const flows = ctx.flows.filter((flow) => flow.id !== target.id);
    return changePlan("delete", flows, null, `Delete the flow "${target.name}"?`,
      [`It has ${String(target.agents.length)} agents and is ${scopeText(target.scope, target.enabled, ctx)}. Chats it ran in go back to working on their own.`, "Copy its share link first if you may want it back."],
      "Delete flow", `Deleted the flow "${target.name}".`, `Deleted agent flow ${target.id}`);
  }

  let next: AgentFlow = target;
  const title = (verb: string): string => `${verb} the flow "${target.name}"?`;
  if (action === "on" || action === "off") {
    if (item["chats"] === undefined) {
      next = { ...target, enabled: action === "on", ...(action === "on" && target.scope.kind === "chats" && target.scope.chatIds.length === 0 ? { scope: { kind: "all" as const } } : {}) };
    } else {
      const chats = resolveChats(item["chats"], ctx);
      if (!chats.ok) return chats;
      if (action === "on") {
        const scope: FlowScope = chats.ids === null ? { kind: "all" }
          : { kind: "chats", chatIds: [...new Set([...(target.enabled && target.scope.kind === "chats" ? target.scope.chatIds : []), ...chats.ids])] };
        next = { ...target, enabled: true, scope };
      } else if (chats.ids === null) {
        next = { ...target, enabled: false };
      } else if (target.scope.kind === "all") {
        return fail(`"${target.name}" runs in every chat. To leave some chats out, turn it on for the chats it should run in (action on with those chats), or off for all.`);
      } else {
        const removed = new Set(chats.ids);
        const left = target.scope.chatIds.filter((id) => !removed.has(id));
        next = { ...target, scope: { kind: "chats", chatIds: left }, enabled: target.enabled && left.length > 0 };
      }
    }
  } else {
    // edit
    const built = item["agents"] === undefined && item["links"] === undefined && item["entry"] === undefined
      ? { ok: true as const, agents: [...target.agents], links: [...target.links], entry: target.entry }
      : buildAgentsAndLinks(target, item["agents"], item["links"], item["entry"], ctx);
    if (!built.ok) return built;
    const name = item["name"] === undefined ? target.name : str(item["name"], 80);
    if (name === null) return fail("A flow's name is 1 to 80 characters.");
    if (!same(name, target.name) && ctx.flows.some((flow) => flow.id !== target.id && same(flow.name, name))) return fail(`Another flow is already called "${name}".`);
    next = { ...target, name, agents: built.agents, links: built.links, entry: built.entry, ...(typeof item["on"] === "boolean" ? { enabled: item["on"] } : {}) };
    if (item["chats"] !== undefined) {
      const chats = resolveChats(item["chats"], ctx);
      if (!chats.ok) return chats;
      next = { ...next, scope: chats.ids === null ? { kind: "all" } : { kind: "chats", chatIds: chats.ids } };
    }
  }

  const flow = checked(next);
  if (flow === null) return fail("That change would leave the flow unreadable. Check the agents' names and the links.");
  const changes = diffFlows(target, flow, ctx);
  if (changes.length === 0) return { ok: true, kind: "answer", content: `Nothing to change: "${target.name}" is already like that (${scopeText(target.scope, target.enabled, ctx)}).` };
  const others = resolveConflicts(ctx.flows, flow, ctx);
  const flows = others.flows.map((one) => one.id === flow.id ? flow : one);
  const verb = action === "on" ? "Turn on" : action === "off" ? "Turn off" : "Change";
  return changePlan(action, flows, flow, title(verb),
    ["Changes:", ...changes.map((line) => `• ${line}`), ...(action === "edit" ? ["", ...describeFlow(flow, ctx)] : []), ...cautions(flow, ctx).filter(() => action === "edit"), ...others.notes],
    action === "on" ? "Turn on" : action === "off" ? "Turn off" : "Save changes",
    `Saved "${flow.name}": ${changes.join("; ")}. It is ${scopeText(flow.scope, flow.enabled, ctx)}.`,
    `Changed agent flow ${flow.id}: ${changes.join("; ")}`);
}

/** What changed between two versions of a flow, one line each, in words. */
export function diffFlows(before: AgentFlow, after: AgentFlow, ctx: FlowToolContext): string[] {
  const lines: string[] = [];
  if (before.name !== after.name) lines.push(`renamed from "${before.name}" to "${after.name}"`);
  const wasRunning = scopeText(before.scope, before.enabled, ctx), running = scopeText(after.scope, after.enabled, ctx);
  if (wasRunning !== running) lines.push(`runs: ${running} (was ${wasRunning})`);
  const name = (flow: AgentFlow, id: string): string => flow.agents.find((agent) => agent.id === id)?.name ?? id;
  for (const agent of after.agents) {
    const old = before.agents.find((one) => one.id === agent.id);
    if (old === undefined) { lines.push(`adds ${agentLine(after, agent, ctx.candidates)}`); continue; }
    const changed: string[] = [];
    if (old.name !== agent.name) changed.push(`renamed to ${agent.name}`);
    if (old.role !== agent.role) changed.push(`role ${agent.role}`);
    if (JSON.stringify(old.model) !== JSON.stringify(agent.model)) changed.push(`model ${modelLabel(agent.model, ctx.candidates)}`);
    if (old.instructions !== agent.instructions) changed.push("new instructions");
    if (old.readOnly !== agent.readOnly) changed.push(agent.readOnly ? "read-only" : "can edit");
    if (old.handles.join() !== agent.handles.join()) changed.push(`takes ${agent.handles.map((kind) => TASK_KIND_LABELS[kind].toLowerCase()).join(", ") || "anything it is given"}`);
    if (changed.length > 0) lines.push(`${old.name}: ${changed.join(", ")}`);
  }
  for (const agent of before.agents) if (!after.agents.some((one) => one.id === agent.id)) lines.push(`removes ${agent.name}`);
  for (const link of after.links) {
    const old = before.links.find((one) => one.from === link.from && one.to === link.to);
    if (old === undefined) lines.push(`links ${linkLine(after, link)}`);
    else if (old.kind !== link.kind) lines.push(`now ${linkLine(after, link)}`);
  }
  for (const link of before.links) if (!after.links.some((one) => one.from === link.from && one.to === link.to)) lines.push(`unlinks ${name(before, link.from)} from ${name(before, link.to)}`);
  if (before.entry !== after.entry) lines.push(`${name(after, after.entry)} is now the first stop`);
  return lines;
}

/** The setting's value for these flows: the same JSON list the Flow page writes. */
export function flowsSettingValue(flows: readonly AgentFlow[]): string {
  return JSON.stringify(flows);
}
