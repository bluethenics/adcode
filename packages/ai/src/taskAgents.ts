/**
 * Task agents: helpers that run on a model of their own.
 *
 * The chat leads on the model the person picked. When it splits work with `delegate_task`,
 * each helper used to run on that same model - so a person who leads with an expensive
 * thinking model paid its price for every file a helper typed. A saved agent (the Agents
 * board's named agents, setting `adcode.ai.agentProfiles`) can now take helper work:
 *
 * - `delegate_task` may name an agent per task, and that helper runs on the agent's own
 *   provider and model, with its standing instructions and tool access;
 * - an agent marked as the helper for coding (`build`) or research (`explore`) takes those
 *   tasks when the call names nobody - "DeepSeek writes the code, the lead model thinks";
 * - the chat can make such an agent itself with `create_agent` ("use deepseek for all coding
 *   work"), which the person confirms before it is saved.
 *
 * Tokens follow the work: each helper's usage is counted against the model that ran it.
 * Pure; no I/O.
 */
import { parseToolAccess, type ToolAccess } from "./toolAccess.ts";
import type { ToolDefinition } from "./types.ts";

/** The kinds of helper work an agent can take by default. The chat itself leads. */
export type HelperDuty = "build" | "explore";
export const HELPER_DUTIES: readonly HelperDuty[] = ["build", "explore"];
export const HELPER_DUTY_LABELS: Readonly<Record<HelperDuty, string>> = { build: "coding", explore: "research" };

/** The helper work a saved value names, deduplicated; absent when it names none. */
export function parseHelperFor(value: unknown): readonly HelperDuty[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const duties = HELPER_DUTIES.filter((duty) => value.includes(duty));
  return duties.length === 0 ? undefined : duties;
}

/** What routing needs from a saved agent. */
export interface TaskAgent {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly provider: string;
  readonly model: string;
  /** Runs on whatever the chat runs on: a role, not a model choice. */
  readonly useCurrentModel: boolean;
  readonly toolAccess?: ToolAccess;
  readonly helperFor: readonly HelperDuty[];
}

const AGENT_ID = /^[a-z][a-z0-9-]{2,47}$/;
const str = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !value.includes("\u0000") ? value.trim() : null;

/**
 * The saved agents, read leniently: one unreadable entry is skipped, not the list. An agent
 * whose tool access this build cannot read is skipped too - access only ever narrows.
 */
export function readTaskAgents(value: unknown): TaskAgent[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try { raw = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  const agents: TaskAgent[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const id = str(item["id"], 48);
    const name = str(item["name"], 80);
    const instructions = str(item["instructions"], 2_000);
    if (id === null || !AGENT_ID.test(id) || name === null || instructions === null) continue;
    const useCurrentModel = item["useCurrentModel"] === true;
    const provider = str(item["provider"], 128) ?? "";
    const model = str(item["model"], 256) ?? "";
    if (!useCurrentModel && (provider === "" || model === "")) continue;
    const toolAccess = item["toolAccess"] === undefined ? undefined : parseToolAccess(item["toolAccess"]);
    if (toolAccess === null) continue;
    if (agents.some((agent) => agent.id === id)) continue;
    agents.push({
      id, name, instructions, provider, model, useCurrentModel,
      ...(toolAccess === undefined ? {} : { toolAccess }),
      helperFor: parseHelperFor(item["helperFor"]) ?? [],
    });
  }
  return agents;
}

/** Where one helper runs: on the chat's own model, on a saved agent, or nowhere (and why). */
export type HelperRoute =
  | { readonly kind: "same" }
  | { readonly kind: "agent"; readonly agent: TaskAgent; readonly chosen: "named" | "default" }
  | { readonly kind: "error"; readonly message: string };

/** The agent a task names (by id or name), else the agent set to take its kind of work, else the chat's model. */
export function routeHelper(task: { readonly mode: HelperDuty; readonly agent?: string }, agents: readonly TaskAgent[]): HelperRoute {
  if (task.agent !== undefined) {
    const wanted = task.agent.trim().toLowerCase();
    if (wanted === SELF_AGENT) return { kind: "same" };
    const agent = agents.find((item) => item.id === wanted) ?? agents.find((item) => item.name.toLowerCase() === wanted);
    if (agent === undefined) {
      return {
        kind: "error",
        message: agents.length === 0
          ? `No saved agent called ${task.agent}. There are none yet: leave agent out to use your own model, or make one with create_agent.`
          : `No saved agent called ${task.agent}. Saved agents: ${agents.map((item) => item.id).join(", ")}.`,
      };
    }
    return { kind: "agent", agent, chosen: "named" };
  }
  const fallback = agents.find((item) => item.helperFor.includes(task.mode));
  return fallback === undefined ? { kind: "same" } : { kind: "agent", agent: fallback, chosen: "default" };
}

/** "DeepSeek V3 (deepseek)", or "your model" for an agent that follows the chat. */
export function agentModelLabel(agent: TaskAgent): string {
  return agent.useCurrentModel ? "the chat's model" : `${agent.model} (${agent.provider})`;
}

/**
 * What the chat is told about its agents, or null when there are none - no agents, no
 * extra prompt on every request.
 */
export function rosterContext(agents: readonly TaskAgent[], lead: { readonly provider: string; readonly model: string }): string | null {
  if (agents.length === 0) return null;
  const lines = agents.slice(0, 12).map((agent) => {
    const duties = agent.helperFor.length === 0 ? "" : ` Default helper for ${agent.helperFor.map((duty) => HELPER_DUTY_LABELS[duty]).join(" and ")} tasks.`;
    const access = agent.toolAccess === "read-only" ? " Read-only." : "";
    return `- ${agent.id}: ${agent.name}, on ${agentModelLabel(agent)}.${duties}${access} ${agent.instructions.replace(/\s+/g, " ").slice(0, 160)}`;
  });
  const defaults = HELPER_DUTIES.map((duty) => {
    const agent = agents.find((item) => item.helperFor.includes(duty));
    return agent === undefined ? null : `${duty} tasks go to ${agent.id} unless you name another agent`;
  }).filter((line): line is string => line !== null);
  return [
    `Task agents: you lead on ${lead.model} (${lead.provider}). delegate_task can hand a task to one of these saved agents with agent: <id>; that helper runs on the agent's own model and its tokens are counted there.`,
    ...lines,
    defaults.length === 0 ? "With no agent named, a helper runs on your model." : `${defaults.join("; ")}. Name agent: "self" to keep a task on your own model.`,
    "Keep planning, judgement and the final check yourself; hand the heavy typing and searching to the cheaper agents.",
  ].join("\n");
}

/** The id that keeps a task on the chat's own model even when a default agent exists. */
export const SELF_AGENT = "self";

// ---------------------------------------------------------------------------------------
// create_agent: the chat makes a task agent, the person confirms it.

export const CREATE_AGENT_NAME = "create_agent";

export const CREATE_AGENT: ToolDefinition = {
  name: CREATE_AGENT_NAME,
  description: [
    "Save a task agent: a named helper with its own AI model, instructions and tool access, which delegate_task can hand work to.",
    "Use it when the user wants different models for different work - e.g. 'use deepseek for all coding and keep this model to plan' becomes an agent on a DeepSeek model with helper_for: [\"build\"].",
    "model can be a loose name ('deepseek', 'qwen coder') or an exact id; if it matches several connected models you get the list back to choose from.",
    "Saving an agent with the same name as an existing one updates it. helper_for makes it the default for that kind of delegated task (build = coding, explore = research), taking that role over from any other agent.",
    "The user confirms before it is saved. It also appears on the Agents board.",
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "A short name, e.g. 'DeepSeek coder'" },
      instructions: { type: "string", description: "Its standing instructions: what it owns, how it works, what it reports back" },
      model: { type: "string", description: "The model: a loose name like 'deepseek' or an exact model id" },
      provider: { type: "string", description: "Optional: the connection to use, when the same model is offered by several" },
      helper_for: { type: "array", items: { type: "string", enum: ["build", "explore"] }, description: "Optional: make it the default helper for coding (build) and/or research (explore) tasks" },
      access: { type: "string", enum: ["all", "read-only"], description: "Optional: read-only agents can only read and search. Default all." },
    },
    required: ["name", "instructions", "model"],
  },
  mutating: true,
};

/** One model the person could run an agent on. */
export interface ModelCandidate {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly modelName: string;
  /** Connected: a key where one is needed. */
  readonly usable: boolean;
}

export type ModelMatch =
  | { readonly ok: true; readonly candidate: ModelCandidate }
  | { readonly ok: false; readonly message: string };

const words = (text: string): string[] => text.toLowerCase().split(/[\s/:_.,()-]+/).filter((word) => word.length > 0);

function optionsLine(candidates: readonly ModelCandidate[]): string {
  const shown = candidates.slice(0, 10).map((item) => `${item.providerId}:${item.modelId}${item.modelName !== item.modelId ? ` (${item.modelName})` : ""}`);
  return `${shown.join(", ")}${candidates.length > shown.length ? `, and ${String(candidates.length - shown.length)} more` : ""}`;
}

/**
 * The model a loose name means. Candidates come in preference order (the chat's own
 * connection first); an exact id wins, then a name every word of the query appears in.
 * Several equally good matches are handed back to choose from rather than guessed.
 */
export function resolveModel(query: string, provider: string | undefined, candidates: readonly ModelCandidate[]): ModelMatch {
  const wanted = query.trim();
  if (wanted === "") return { ok: false, message: "Name the model, e.g. deepseek." };
  let pool = candidates;
  const wantedProvider = provider?.trim().toLowerCase();
  let id = wanted.toLowerCase();
  // "openrouter:deepseek/deepseek-chat" names its connection too.
  const colon = id.indexOf(":");
  if ((wantedProvider === undefined || wantedProvider === "") && colon > 0 && candidates.some((item) => item.providerId.toLowerCase() === id.slice(0, colon))) {
    pool = candidates.filter((item) => item.providerId.toLowerCase() === id.slice(0, colon));
    id = id.slice(colon + 1);
  } else if (wantedProvider !== undefined && wantedProvider !== "") {
    pool = candidates.filter((item) => item.providerId.toLowerCase() === wantedProvider || item.providerName.toLowerCase() === wantedProvider);
    if (pool.length === 0) return { ok: false, message: `No connection called ${provider ?? ""}. Connections: ${[...new Set(candidates.map((item) => item.providerId))].join(", ")}.` };
  }
  const exact = pool.filter((item) => item.modelId.toLowerCase() === id);
  const exactUsable = exact.find((item) => item.usable);
  if (exactUsable !== undefined) return { ok: true, candidate: exactUsable };

  const query_ = words(id);
  const matching = exact.length > 0 ? exact : pool.filter((item) => {
    const haystack = words(`${item.providerId} ${item.providerName} ${item.modelId} ${item.modelName}`).join(" ");
    return query_.every((word) => haystack.includes(word));
  });
  const usable = matching.filter((item) => item.usable);
  if (usable.length === 1) return { ok: true, candidate: usable[0]! };
  if (usable.length > 1) {
    // One model offered by several connections is one choice: take the preferred connection.
    const models = new Set(usable.map((item) => item.modelId.toLowerCase()));
    if (models.size === 1) return { ok: true, candidate: usable[0]! };
    return { ok: false, message: `${wanted} matches several connected models: ${optionsLine(usable)}. Call again with the exact model id (and provider if needed).` };
  }
  if (matching.length > 0) {
    const providers = [...new Set(matching.map((item) => item.providerName))].slice(0, 4).join(", ");
    return { ok: false, message: `${wanted} is offered by ${providers}, but that connection has no API key yet. The user can add one in Connect a model, then try again.` };
  }
  return { ok: false, message: `No model matches ${wanted}. Connected models include: ${optionsLine(candidates.filter((item) => item.usable))}.` };
}

/** A saved agent as the setting stores it. */
export interface TaskAgentDraft {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly provider: string;
  readonly model: string;
  readonly toolAccess?: "read-only";
  readonly helperFor?: readonly HelperDuty[];
}

export type CreateAgentPlan =
  | { readonly ok: true; readonly draft: TaskAgentDraft; readonly replaces: string | null; readonly candidate: ModelCandidate }
  | { readonly ok: false; readonly message: string };

/** An id from a name: "DeepSeek coder" -> "deepseek-coder", unique among the saved ones. */
export function agentIdFor(name: string, taken: readonly string[]): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!/^[a-z]/.test(base)) base = `agent-${base}`.replace(/-+$/, "");
  if (base.length < 3) base = `${base}-agent`;
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${String(n)}`;
  return id;
}

/** What a create_agent call would save, or why it cannot. */
export function planCreateAgent(input: unknown, candidates: readonly ModelCandidate[], saved: readonly TaskAgent[]): CreateAgentPlan {
  const fields = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const name = str(fields["name"], 80);
  const instructions = str(fields["instructions"], 2_000);
  const model = typeof fields["model"] === "string" ? fields["model"] : "";
  if (name === null) return { ok: false, message: "Give the agent a name (up to 80 characters)." };
  if (name.toLowerCase() === SELF_AGENT) return { ok: false, message: "\"self\" is reserved for the chat's own model. Pick another name." };
  if (instructions === null) return { ok: false, message: "Give the agent instructions (up to 2,000 characters): what it owns and what it reports back." };
  const access = fields["access"];
  if (access !== undefined && access !== "all" && access !== "read-only") return { ok: false, message: "access is all or read-only." };
  const rawDuties = fields["helper_for"];
  if (rawDuties !== undefined && (!Array.isArray(rawDuties) || rawDuties.some((duty) => duty !== "build" && duty !== "explore"))) {
    return { ok: false, message: "helper_for is a list of build and/or explore." };
  }
  const helperFor = parseHelperFor(rawDuties);
  if (access === "read-only" && helperFor?.includes("build")) return { ok: false, message: "A read-only agent cannot be the coding (build) helper: it could not edit anything." };
  const match = resolveModel(model, typeof fields["provider"] === "string" ? fields["provider"] : undefined, candidates);
  if (!match.ok) return match;
  const existing = saved.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
  const id = existing?.id ?? agentIdFor(name, saved.map((agent) => agent.id));
  return {
    ok: true,
    replaces: existing?.id ?? null,
    candidate: match.candidate,
    draft: {
      id, name, instructions,
      provider: match.candidate.providerId,
      model: match.candidate.modelId,
      ...(access === "read-only" ? { toolAccess: "read-only" as const } : {}),
      ...(helperFor === undefined ? {} : { helperFor }),
    },
  };
}

/** The confirmation the person reads before the agent is saved. */
export function describeCreateAgent(plan: Extract<CreateAgentPlan, { ok: true }>): { title: string; detail: string } {
  const { draft, candidate } = plan;
  const duties = draft.helperFor === undefined ? null : draft.helperFor.map((duty) => HELPER_DUTY_LABELS[duty]).join(" and ");
  return {
    title: plan.replaces === null ? `Create the agent "${draft.name}"?` : `Update the agent "${draft.name}"?`,
    detail: [
      `Model: ${candidate.modelName} on ${candidate.providerName}. Its requests are charged to that connection.`,
      duties === null ? "The chat can hand it tasks by name." : `The chat will send ${duties} tasks to it by default, instead of running them on the chat's own model.`,
      draft.toolAccess === "read-only" ? "Tool access: read-only." : "Tool access: all tools (read, edit, run commands).",
      `Instructions: ${draft.instructions.slice(0, 400)}${draft.instructions.length > 400 ? "..." : ""}`,
      "You can change or delete it on the Agents board.",
    ].join("\n"),
  };
}

/**
 * The setting with the agent saved: other entries kept exactly as they were (fields this
 * module does not know included), an agent of the same id updated in place keeping its look
 * and cap, and the helper work it takes removed from whichever agent had it.
 */
export function withTaskAgent(settingValue: unknown, draft: TaskAgentDraft): string {
  let raw: unknown = settingValue;
  if (typeof settingValue === "string") {
    try { raw = JSON.parse(settingValue); } catch { raw = []; }
  }
  const list: unknown[] = Array.isArray(raw) ? [...raw] : [];
  const taken = new Set(draft.helperFor ?? []);
  const next = list.map((entry): unknown => {
    if (typeof entry !== "object" || entry === null) return entry;
    const item = entry as Record<string, unknown>;
    if (item["id"] === draft.id) return null;
    if (taken.size === 0) return entry;
    const duties = parseHelperFor(item["helperFor"]);
    if (duties === undefined || !duties.some((duty) => taken.has(duty))) return entry;
    const left = duties.filter((duty) => !taken.has(duty));
    const { helperFor: _dropped, ...rest } = item;
    return left.length === 0 ? rest : { ...rest, helperFor: left };
  });
  const index = next.indexOf(null);
  const previous = list.find((entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>)["id"] === draft.id) as Record<string, unknown> | undefined;
  const kept = previous === undefined ? {} : Object.fromEntries(["mascot", "capDollars", "runAfterTeammates"].filter((key) => previous[key] !== undefined).map((key) => [key, previous[key]]));
  const saved = { ...kept, ...draft };
  if (index >= 0) next[index] = saved;
  else next.push(saved);
  return JSON.stringify(next);
}
