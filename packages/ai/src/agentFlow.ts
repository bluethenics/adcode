/**
 * Agent flows: a team of agents drawn as a graph, wired to the chat.
 *
 * A flow is up to fifty agents - a Thinker, a Coder, a Reviewer, whatever the person draws - and
 * the links between them. The chat itself is the flow's *entry* agent: it reads every message,
 * decides what kind of work it is, and hands it along the links with `delegate_task`, each
 * agent running on its own model with its own instructions. "Whenever a coding task comes, the
 * Coder takes over": an agent that *handles* code is where a coding task goes, and the links
 * out of it say who checks the work after.
 *
 * A flow applies to every chat or to the chats it names. It travels as a link: the flow,
 * compressed into the fragment of an adcode.bluethenics.com URL, so a setup can be shared
 * without an account or a server holding it.
 *
 * Pure: no I/O, no DOM. The canvas draws it, the main process runs it, and both use this.
 */
import type { TaskAgent } from "./taskAgents.ts";

export const MAX_FLOW_AGENTS = 50;
export const MAX_FLOW_LINKS = 200;
export const MAX_FLOWS = 20;
/** The web page a shared flow opens on; the flow itself is in the fragment, never sent to a server. */
export const FLOW_LINK_BASE = "https://adcode.bluethenics.com/flow#";

export type FlowRole = "thinker" | "planner" | "coder" | "reviewer" | "tester" | "researcher" | "designer" | "writer" | "custom";
export type FlowShape = "circle" | "rounded" | "hexagon" | "diamond" | "pill";
export type FlowColor = "violet" | "blue" | "green" | "amber" | "coral" | "pink" | "teal" | "slate";
/** What kind of work a message is, which decides which agent takes over. */
export type TaskKind = "code" | "debug" | "review" | "test" | "design" | "docs" | "research" | "plan" | "question";
export type FlowLinkKind = "handoff" | "review" | "consult";

export const FLOW_ROLES: readonly FlowRole[] = ["thinker", "planner", "coder", "reviewer", "tester", "researcher", "designer", "writer", "custom"];
export const FLOW_SHAPES: readonly FlowShape[] = ["circle", "rounded", "hexagon", "diamond", "pill"];
export const FLOW_COLORS: readonly FlowColor[] = ["violet", "blue", "green", "amber", "coral", "pink", "teal", "slate"];
export const TASK_KINDS: readonly TaskKind[] = ["code", "debug", "review", "test", "design", "docs", "research", "plan", "question"];
export const FLOW_LINK_KINDS: readonly FlowLinkKind[] = ["handoff", "review", "consult"];

export const TASK_KIND_LABELS: Readonly<Record<TaskKind, string>> = {
  code: "Coding", debug: "Bug fixing", review: "Code review", test: "Testing", design: "UI and design",
  docs: "Docs and writing", research: "Research", plan: "Planning", question: "Questions",
};
export const FLOW_LINK_LABELS: Readonly<Record<FlowLinkKind, string>> = {
  handoff: "hands work to", review: "sends for review to", consult: "can ask",
};

/** Each role's sensible defaults: what it handles, how it looks, how it works. */
export const ROLE_PRESETS: Readonly<Record<FlowRole, { readonly name: string; readonly handles: readonly TaskKind[]; readonly shape: FlowShape; readonly color: FlowColor; readonly instructions: string; readonly readOnly: boolean }>> = {
  thinker: { name: "Thinker", handles: ["plan", "question"], shape: "circle", color: "violet", readOnly: true, instructions: "Understand what is really being asked. Break it into steps, name the risks and the files involved, and decide who should do each step. Do not edit files." },
  planner: { name: "Planner", handles: ["plan"], shape: "rounded", color: "blue", readOnly: true, instructions: "Turn the request into a short ordered plan with acceptance checks for each step. Do not edit files." },
  coder: { name: "Coder", handles: ["code", "debug"], shape: "hexagon", color: "green", readOnly: false, instructions: "Implement the change: read the code involved first, make the smallest correct edit, keep the project's style, and run the build or tests that cover it." },
  reviewer: { name: "Reviewer", handles: ["review"], shape: "diamond", color: "amber", readOnly: true, instructions: "Review the change for bugs, missed cases, risky edits and unclear names, most serious first, with file and line. Say plainly when it is good to go. Do not edit files." },
  tester: { name: "Tester", handles: ["test"], shape: "pill", color: "teal", readOnly: false, instructions: "Write or extend tests for the change in the project's framework, run them, and report what passes, what fails and why." },
  researcher: { name: "Researcher", handles: ["research", "question"], shape: "circle", color: "slate", readOnly: true, instructions: "Find the facts: search the project and its docs, read what matters, and report back with sources. Do not edit files." },
  designer: { name: "Designer", handles: ["design"], shape: "rounded", color: "pink", readOnly: false, instructions: "Own the look and feel: layout, spacing, type, colour, states and small screens. Keep the existing design language." },
  writer: { name: "Writer", handles: ["docs"], shape: "pill", color: "coral", readOnly: false, instructions: "Write or update docs, READMEs and comments in plain words with real examples." },
  custom: { name: "Agent", handles: [], shape: "rounded", color: "slate", readOnly: false, instructions: "Help with the task you are given and report back what you did." },
};

export interface FlowModel { readonly provider: string; readonly model: string }

export interface FlowAgent {
  readonly id: string;
  readonly name: string;
  readonly role: FlowRole;
  readonly instructions: string;
  /** The kinds of work this agent takes over when they come in. */
  readonly handles: readonly TaskKind[];
  readonly shape: FlowShape;
  readonly color: FlowColor;
  readonly x: number;
  readonly y: number;
  /** Null: runs on whatever model the chat runs on. */
  readonly model: FlowModel | null;
  readonly readOnly: boolean;
}

export interface FlowLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: FlowLinkKind;
}

export type FlowScope = { readonly kind: "all" } | { readonly kind: "chats"; readonly chatIds: readonly string[] };

export interface AgentFlow {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** The agent the chat itself plays: every message arrives here first. */
  readonly entry: string;
  readonly scope: FlowScope;
  readonly agents: readonly FlowAgent[];
  readonly links: readonly FlowLink[];
}

const ID = /^[a-z][a-z0-9-]{1,47}$/;
const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\u0000/g, "").trim();
  return text.length === 0 ? null : text.slice(0, max);
};
const finite = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? Math.max(-20_000, Math.min(20_000, Math.round(value))) : fallback;
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;

/** An id from a name, unique among `taken`: "Code reviewer" -> "code-reviewer", then "-2". */
export function flowIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `a-${base}`.replace(/-+$/, "");
  if (base.length < 2) base = "agent";
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${String(n)}`;
  return id;
}

/** A new agent of `role`, placed at (x, y), with an id no other agent in `flow` has. */
export function newFlowAgent(flow: Pick<AgentFlow, "agents">, role: FlowRole, x: number, y: number, name?: string): FlowAgent {
  const preset = ROLE_PRESETS[role];
  const label = name ?? preset.name;
  return {
    id: flowIdFor(label, flow.agents.map((agent) => agent.id)),
    name: label, role, instructions: preset.instructions, handles: [...preset.handles],
    shape: preset.shape, color: preset.color, x: Math.round(x), y: Math.round(y), model: null, readOnly: preset.readOnly,
  };
}

/**
 * The flow a new chat gets: the chat thinks, the Coder takes coding over, the Reviewer and the
 * Tester check its work, and the Researcher can be asked anything along the way.
 */
export function defaultFlow(id = "default-flow"): AgentFlow {
  const at = (role: FlowRole, x: number, y: number): FlowAgent => ({ ...newFlowAgent({ agents: [] }, role, x, y), id: role });
  const agents = [at("thinker", 80, 200), at("coder", 360, 200), at("reviewer", 640, 110), at("tester", 640, 290), at("researcher", 220, 380)];
  const links: FlowLink[] = [
    { id: "thinker-coder", from: "thinker", to: "coder", kind: "handoff" },
    { id: "coder-reviewer", from: "coder", to: "reviewer", kind: "review" },
    { id: "coder-tester", from: "coder", to: "tester", kind: "review" },
    { id: "thinker-researcher", from: "thinker", to: "researcher", kind: "consult" },
  ];
  return { version: 1, id, name: "Think, code, check", enabled: true, entry: "thinker", scope: { kind: "all" }, agents, links };
}

/**
 * A flow from anything - a saved setting, a pasted link - or null when it is not one. Lenient
 * the way a file from another version has to be: a bad agent or link is dropped, not the flow,
 * and every limit (fifty agents, text lengths, canvas bounds) is enforced here.
 */
export function parseFlow(raw: unknown): AgentFlow | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = clean(item["id"], 48);
  const name = clean(item["name"], 80);
  if (id === null || !ID.test(id) || name === null || !Array.isArray(item["agents"])) return null;
  const agents: FlowAgent[] = [];
  for (const entry of item["agents"].slice(0, MAX_FLOW_AGENTS * 2)) {
    if (agents.length >= MAX_FLOW_AGENTS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as Record<string, unknown>;
    const agentId = clean(a["id"], 48);
    const agentName = clean(a["name"], 60);
    if (agentId === null || !ID.test(agentId) || agentName === null || agents.some((one) => one.id === agentId)) continue;
    const role = pick(a["role"], FLOW_ROLES, "custom");
    const model = typeof a["model"] === "object" && a["model"] !== null ? a["model"] as Record<string, unknown> : null;
    const provider = clean(model?.["provider"], 128);
    const modelId = clean(model?.["model"], 256);
    agents.push({
      id: agentId, name: agentName, role,
      instructions: clean(a["instructions"], 2_000) ?? ROLE_PRESETS[role].instructions,
      handles: Array.isArray(a["handles"]) ? TASK_KINDS.filter((kind) => (a["handles"] as unknown[]).includes(kind)) : [...ROLE_PRESETS[role].handles],
      shape: pick(a["shape"], FLOW_SHAPES, ROLE_PRESETS[role].shape),
      color: pick(a["color"], FLOW_COLORS, ROLE_PRESETS[role].color),
      x: finite(a["x"], 80 + agents.length * 40), y: finite(a["y"], 120 + agents.length * 30),
      model: provider !== null && modelId !== null ? { provider, model: modelId } : null,
      readOnly: typeof a["readOnly"] === "boolean" ? a["readOnly"] : ROLE_PRESETS[role].readOnly,
    });
  }
  if (agents.length === 0) return null;
  const ids = new Set(agents.map((agent) => agent.id));
  const links: FlowLink[] = [];
  for (const entry of Array.isArray(item["links"]) ? item["links"].slice(0, MAX_FLOW_LINKS * 2) : []) {
    if (links.length >= MAX_FLOW_LINKS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const l = entry as Record<string, unknown>;
    const from = clean(l["from"], 48), to = clean(l["to"], 48);
    if (from === null || to === null || from === to || !ids.has(from) || !ids.has(to)) continue;
    if (links.some((link) => link.from === from && link.to === to)) continue;
    links.push({ id: `${from}-${to}`, from, to, kind: pick(l["kind"], FLOW_LINK_KINDS, "handoff") });
  }
  const scopeRaw = typeof item["scope"] === "object" && item["scope"] !== null ? item["scope"] as Record<string, unknown> : {};
  const chatIds = Array.isArray(scopeRaw["chatIds"]) ? [...new Set(scopeRaw["chatIds"].filter((one): one is string => typeof one === "string" && CHAT_ID.test(one)))].slice(0, 500) : [];
  const entryId = clean(item["entry"], 48);
  return {
    version: 1, id, name,
    enabled: item["enabled"] !== false,
    entry: entryId !== null && ids.has(entryId) ? entryId : agents[0]!.id,
    scope: scopeRaw["kind"] === "chats" ? { kind: "chats", chatIds } : { kind: "all" },
    agents, links,
  };
}

/** The saved flows, read leniently: the setting is a JSON list. */
export function readFlows(value: unknown): AgentFlow[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const flows: AgentFlow[] = [];
  for (const entry of raw.slice(0, MAX_FLOWS)) {
    const flow = parseFlow(entry);
    if (flow !== null && !flows.some((one) => one.id === flow.id)) flows.push(flow);
  }
  return flows;
}

// ---------------------------------------------------------------------------------------
// Editing. Each returns a new flow or a reason it cannot; the canvas shows the reason.

export type FlowEdit = { readonly ok: true; readonly flow: AgentFlow } | { readonly ok: false; readonly message: string };

export function addAgent(flow: AgentFlow, role: FlowRole, x: number, y: number): FlowEdit {
  if (flow.agents.length >= MAX_FLOW_AGENTS) return { ok: false, message: `A flow holds up to ${String(MAX_FLOW_AGENTS)} agents. Remove one to add another.` };
  return { ok: true, flow: { ...flow, agents: [...flow.agents, newFlowAgent(flow, role, x, y)] } };
}

export function removeAgent(flow: AgentFlow, id: string): FlowEdit {
  if (flow.agents.length <= 1) return { ok: false, message: "A flow needs at least one agent." };
  const agents = flow.agents.filter((agent) => agent.id !== id);
  if (agents.length === flow.agents.length) return { ok: false, message: "That agent is not in this flow." };
  return { ok: true, flow: { ...flow, agents, links: flow.links.filter((link) => link.from !== id && link.to !== id), entry: flow.entry === id ? agents[0]!.id : flow.entry } };
}

export function updateAgent(flow: AgentFlow, id: string, patch: Partial<Omit<FlowAgent, "id">>): FlowEdit {
  if (!flow.agents.some((agent) => agent.id === id)) return { ok: false, message: "That agent is not in this flow." };
  const next = parseFlow({ ...flow, agents: flow.agents.map((agent) => agent.id === id ? { ...agent, ...patch, id } : agent) });
  return next === null ? { ok: false, message: "That change would leave the flow unreadable." } : { ok: true, flow: next };
}

export function moveAgent(flow: AgentFlow, id: string, x: number, y: number): AgentFlow {
  return { ...flow, agents: flow.agents.map((agent) => agent.id === id ? { ...agent, x: finite(x, agent.x), y: finite(y, agent.y) } : agent) };
}

export function connect(flow: AgentFlow, from: string, to: string, kind: FlowLinkKind = "handoff"): FlowEdit {
  if (from === to) return { ok: false, message: "An agent cannot hand work to itself." };
  const ids = new Set(flow.agents.map((agent) => agent.id));
  if (!ids.has(from) || !ids.has(to)) return { ok: false, message: "Both ends must be agents in this flow." };
  if (flow.links.some((link) => link.from === from && link.to === to)) return { ok: false, message: "Those two are already connected." };
  if (flow.links.length >= MAX_FLOW_LINKS) return { ok: false, message: `A flow holds up to ${String(MAX_FLOW_LINKS)} links.` };
  return { ok: true, flow: { ...flow, links: [...flow.links, { id: `${from}-${to}`, from, to, kind }] } };
}

export function disconnect(flow: AgentFlow, linkId: string): AgentFlow {
  return { ...flow, links: flow.links.filter((link) => link.id !== linkId) };
}

// ---------------------------------------------------------------------------------------
// Running.

/** Whether this flow runs in the chat `chatId`. */
export function flowAppliesTo(flow: AgentFlow, chatId: string): boolean {
  return flow.enabled && (flow.scope.kind === "all" || flow.scope.chatIds.includes(chatId));
}

/** The flow for a chat: one that names the chat wins over one for all chats. */
export function activeFlowFor(flows: readonly AgentFlow[], chatId: string): AgentFlow | null {
  return flows.find((flow) => flow.enabled && flow.scope.kind === "chats" && flow.scope.chatIds.includes(chatId))
    ?? flows.find((flow) => flow.enabled && flow.scope.kind === "all")
    ?? null;
}

const KIND_PATTERNS: readonly (readonly [TaskKind, RegExp])[] = [
  ["debug", /\b(bug|crash(es|ed)?|error|exception|stack ?trace|broken|fails?|failing|doesn'?t work|not working|fix(es|ed)?|regression|undefined is not|traceback)\b/i],
  ["test", /\b(tests?|unit test|e2e|coverage|spec|vitest|jest|pytest|assert)\b/i],
  ["review", /\b(review|audit|look over|check (my|this|the) (code|pr|diff|change))\b/i],
  ["design", /\b(ui|ux|css|layout|style|styling|design|colou?r|font|spacing|responsive|animation|tailwind)\b/i],
  ["docs", /\b(docs?|documentation|readme|comment|changelog|write[- ]?up|explain in writing)\b/i],
  ["code", /\b(implement|build|create|add|refactor|function|class|component|endpoint|api|script|code|module|migrate|rename)\b|```|\.(ts|tsx|js|jsx|py|rs|go|java|cs|cpp|rb|php|swift|kt)\b/i],
  ["research", /\b(research|compare|find out|look up|which (library|framework)|best way|alternatives?)\b/i],
  ["plan", /\b(plan|roadmap|architecture|approach|strategy|design doc|break (it|this) down)\b/i],
];

/** What kind of work a message is, from its words. Anything unrecognised is a question. */
export function classifyTask(message: string): TaskKind {
  const text = message.slice(0, 4_000);
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(text)) return kind;
  return "question";
}

/** Coding work falls back to an agent for code or bugs, and the other way round. */
const NEIGHBOURS: Readonly<Partial<Record<TaskKind, readonly TaskKind[]>>> = {
  debug: ["code"], code: ["debug"], test: ["code"], review: [], design: ["code"], docs: [], research: ["question"], plan: ["question"], question: ["research", "plan"],
};

/**
 * The agent that takes over `kind` of work: the nearest one to the entry (along the links) that
 * handles it, else one that handles a neighbouring kind, else the entry agent itself.
 */
export function routeTask(flow: AgentFlow, kind: TaskKind): FlowAgent {
  const order = reachOrder(flow, flow.entry);
  const byId = new Map(flow.agents.map((agent) => [agent.id, agent] as const));
  const ranked = [...order, ...flow.agents.map((agent) => agent.id).filter((id) => !order.includes(id))].map((id) => byId.get(id)!);
  return ranked.find((agent) => agent.handles.includes(kind))
    ?? ranked.find((agent) => (NEIGHBOURS[kind] ?? []).some((near) => agent.handles.includes(near)))
    ?? byId.get(flow.entry) ?? flow.agents[0]!;
}

/** Agents reachable from `start`, breadth first along the links; each once, so cycles end. */
export function reachOrder(flow: AgentFlow, start: string): string[] {
  const seen: string[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.includes(id) || !flow.agents.some((agent) => agent.id === id)) continue;
    seen.push(id);
    for (const link of flow.links) if (link.from === id && link.kind !== "consult") queue.push(link.to);
  }
  return seen;
}

/** The work's path: the agent that takes over, then whoever its links hand or send it to. */
export function pipelineFor(flow: AgentFlow, kind: TaskKind): FlowAgent[] {
  const lead = routeTask(flow, kind);
  const byId = new Map(flow.agents.map((agent) => [agent.id, agent] as const));
  return reachOrder(flow, lead.id).map((id) => byId.get(id)!);
}

/** The flow's agents as task agents, so `delegate_task` can hand them work by id. */
export function flowTaskAgents(flow: AgentFlow): TaskAgent[] {
  return flow.agents.filter((agent) => agent.id !== flow.entry).map((agent) => ({
    id: agent.id.length >= 3 ? agent.id : `${agent.id}-agent`,
    name: agent.name,
    instructions: agent.instructions,
    provider: agent.model?.provider ?? "",
    model: agent.model?.model ?? "",
    useCurrentModel: agent.model === null,
    ...(agent.readOnly ? { toolAccess: "read-only" as const } : {}),
    helperFor: [
      ...(agent.handles.includes("code") || agent.handles.includes("debug") ? ["build" as const] : []),
      ...(agent.handles.includes("research") ? ["explore" as const] : []),
    ],
  }));
}

/**
 * What the chat is told for one message: which agent it is, what kind of work this is, who
 * takes it over and who checks it after. Short on purpose - it rides on every request.
 */
export function flowContext(flow: AgentFlow, message: string): string {
  const kind = classifyTask(message);
  const byId = new Map(flow.agents.map((agent) => [agent.id, agent] as const));
  const entry = byId.get(flow.entry) ?? flow.agents[0]!;
  const delegateId = (agent: FlowAgent): string => agent.id.length >= 3 ? agent.id : `${agent.id}-agent`;
  const path = pipelineFor(flow, kind);
  const steps = path.map((agent, index) => {
    if (agent.id === entry.id) return `${String(index + 1)}. you (${entry.name}) do this step yourself`;
    const incoming = path.slice(0, index).map((one) => flow.links.find((link) => link.from === one.id && link.to === agent.id)).find((link) => link !== undefined);
    const why = incoming === undefined ? "takes over" : incoming.kind === "review" ? "checks the result" : "carries it on";
    return `${String(index + 1)}. delegate_task agent: "${delegateId(agent)}" (${agent.name}) ${why}${agent.readOnly ? ", read-only" : ""}`;
  });
  const consults = flow.links.filter((link) => link.kind === "consult").map((link) => `${byId.get(link.from)?.name ?? link.from} can ask ${byId.get(link.to)?.name ?? link.to}`);
  const roster = flow.agents.filter((agent) => agent.id !== entry.id).slice(0, MAX_FLOW_AGENTS).map((agent) =>
    `- ${delegateId(agent)}: ${agent.name}, handles ${agent.handles.length === 0 ? "anything it is given" : agent.handles.map((one) => TASK_KIND_LABELS[one].toLowerCase()).join(", ")}.`);
  return [
    `Agent flow "${flow.name}": you are ${entry.name}, the agent every message reaches first. ${entry.instructions.replace(/\s+/g, " ").slice(0, 240)}`,
    `This message looks like ${TASK_KIND_LABELS[kind].toLowerCase()} work. Path for it:`,
    ...steps,
    ...(consults.length === 0 ? [] : [`Also: ${consults.join("; ")}.`]),
    "Give each agent a complete, self-contained task with the files and the acceptance check; pass each agent's result to the next. Skip the path for a quick answer that needs no work. Finish with one summary for the person.",
    "Agents in this flow:",
    ...roster,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------
// Links. The flow travels in the URL fragment, base64url of its JSON, so no server stores it.

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The longest link accepted when importing: fifty agents with full instructions fit easily. */
export const MAX_FLOW_LINK_LENGTH = 400_000;

/** A link to share `flow`. Who it is shared with and which chats it applied to stay here. */
export function encodeFlowLink(flow: AgentFlow): string {
  const shared = { ...flow, scope: { kind: "all" as const }, enabled: true };
  return FLOW_LINK_BASE + "v1." + toBase64Url(new TextEncoder().encode(JSON.stringify(shared)));
}

/** The flow in a pasted link (or bare code), or why it cannot be read. */
export function decodeFlowLink(text: string): { readonly ok: true; readonly flow: AgentFlow } | { readonly ok: false; readonly message: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, message: "Paste a flow link." };
  if (trimmed.length > MAX_FLOW_LINK_LENGTH) return { ok: false, message: "That link is too long to be a flow." };
  const hash = trimmed.includes("#") ? trimmed.slice(trimmed.indexOf("#") + 1) : trimmed;
  const code = hash.startsWith("v1.") ? hash.slice(3) : null;
  if (code === null || !/^[A-Za-z0-9_-]+$/.test(code)) return { ok: false, message: "That is not an ADCode flow link. It should start with " + FLOW_LINK_BASE };
  try {
    const flow = parseFlow(JSON.parse(new TextDecoder().decode(fromBase64Url(code))));
    return flow === null ? { ok: false, message: "That link holds no agents ADCode can read." } : { ok: true, flow };
  } catch {
    return { ok: false, message: "That flow link is incomplete. Copy the whole link and try again." };
  }
}
