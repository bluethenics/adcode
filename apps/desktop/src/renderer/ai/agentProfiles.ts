/** Nonsecret reusable profiles and their mapping to the existing isolated Team runner. */
import type { AiTeamConfigureInputView } from "../../shared/api.ts";
import { parseToolAccess, type ToolAccess } from "@adcode/ai/toolAccess";
import { parseHelperFor, type HelperDuty } from "@adcode/ai/taskAgents";
import { parseMascot, type MascotLook } from "../agents/mascotStyle.ts";

export const AGENT_PROFILES_SETTING = "adcode.ai.agentProfiles";
export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly provider: string;
  readonly model: string;
  /** Follow the current chat connection rather than pinning a provider and model. */
  readonly useCurrentModel?: boolean;
  readonly runAfterTeammates?: boolean;
  /** Its look on the Agents board. Absent: a stable default from its id. */
  readonly mascot?: MascotLook;
  /** Which tools it may use, enforced in the main process. Absent: all of them. */
  readonly toolAccess?: ToolAccess;
  /** The cost cap New task suggests for this agent, in US dollars. Absent: no cap. */
  readonly capDollars?: number;
  /** The chat's delegated work it takes by default: coding (build), research (explore). Absent: only when named. */
  readonly helperFor?: readonly HelperDuty[];
}

function profile(value: unknown): AgentProfile {
  if (typeof value !== "object" || value === null) throw new Error("Invalid agent profile.");
  const raw = value as Record<string, unknown>;
  const field = (key: string, max: number): string => {
    const text = raw[key];
    if (typeof text !== "string" || !text.trim() || text.trim().length > max || text.includes("\u0000")) {
      throw new Error(`Agent ${key} is required (maximum ${max} characters).`);
    }
    return text.trim();
  };
  const id = field("id", 48);
  if (!/^[a-z][a-z0-9-]{2,47}$/.test(id)) throw new Error("Invalid agent id.");
  if (raw["runAfterTeammates"] !== undefined && typeof raw["runAfterTeammates"] !== "boolean") {
    throw new Error("Invalid agent execution order.");
  }
  if (raw["useCurrentModel"] !== undefined && typeof raw["useCurrentModel"] !== "boolean") throw new Error("Invalid agent model selection.");
  const useCurrentModel = raw["useCurrentModel"] === true;
  const routeField = (key: string, max: number): string => {
    if (!useCurrentModel) return field(key, max);
    const text = raw[key];
    if (typeof text !== "string" || text.trim().length > max || text.includes("\u0000")) throw new Error("Invalid agent model route.");
    return text.trim();
  };
  // Tool access is a safety boundary, so a value this build cannot read rejects the agent
  // rather than quietly widening it to every tool. A look is cosmetic: an unknown one falls
  // back to the default.
  const toolAccess = raw["toolAccess"] === undefined ? undefined : parseToolAccess(raw["toolAccess"]);
  if (toolAccess === null) throw new Error("Invalid agent tool access.");
  const mascot = raw["mascot"] === undefined ? null : parseMascot(raw["mascot"]);
  // A suggestion, not a boundary: an unreadable cap is dropped rather than the agent.
  const cap = raw["capDollars"];
  const capDollars = typeof cap === "number" && Number.isFinite(cap) && cap >= 0.05 && cap <= 1_000 ? cap : undefined;
  // Routing, not a boundary: an unreadable value is dropped, and a read-only agent never codes.
  const duties = parseHelperFor(raw["helperFor"]);
  const helperFor = toolAccess === "read-only" ? duties?.filter(duty => duty !== "build") : duties;
  return {
    id,
    name: field("name", 80),
    instructions: field("instructions", 2_000),
    provider: routeField("provider", 128),
    model: routeField("model", 256),
    ...(useCurrentModel ? { useCurrentModel: true } : {}),
    ...(raw["runAfterTeammates"] === true ? { runAfterTeammates: true } : {}),
    ...(mascot === null ? {} : { mascot }),
    ...(toolAccess === undefined ? {} : { toolAccess }),
    ...(capDollars === undefined ? {} : { capDollars }),
    ...(helperFor === undefined || helperFor.length === 0 ? {} : { helperFor }),
  };
}

export function parseAgentProfiles(value: unknown): AgentProfile[] {
  try {
    const raw: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(raw)) return [];
    const result: AgentProfile[] = [];
    for (const entry of raw) {
      try {
        const agent = profile(entry);
        if (!result.some(existing => existing.id === agent.id)) result.push(agent);
      } catch { /* Preserve other valid saved profiles. */ }
    }
    return result;
  } catch { return []; }
}

export function saveAgentProfile(profiles: readonly AgentProfile[], value: AgentProfile): AgentProfile[] {
  const agent = profile(value);
  return profiles.some(item => item.id === agent.id)
    ? profiles.map(item => item.id === agent.id ? agent : item)
    : [...profiles, agent];
}

/**
 * Save an agent that takes the chat's coding or research work: whichever agent took that work
 * before gives it up, so exactly one agent is the default for each.
 */
export function saveAgentProfileWithDuties(profiles: readonly AgentProfile[], value: AgentProfile): AgentProfile[] {
  const taken = new Set(value.helperFor ?? []);
  const others = taken.size === 0 ? profiles : profiles.map(item => {
    if (item.id === value.id || item.helperFor === undefined || !item.helperFor.some(duty => taken.has(duty))) return item;
    const left = item.helperFor.filter(duty => !taken.has(duty));
    const { helperFor: _dropped, ...rest } = item;
    return left.length === 0 ? rest : { ...rest, helperFor: left };
  });
  return saveAgentProfile(others, value);
}

export function removeAgentProfile(profiles: readonly AgentProfile[], id: string): AgentProfile[] {
  return profiles.filter(item => item.id !== id);
}

export function buildNamedAgentTeam(prompt: string, profiles: readonly AgentProfile[]): AiTeamConfigureInputView {
  if (profiles.length < 2 || profiles.length > 4) throw new Error("Choose two to four agents for this Team.");
  const agents = profiles.map(profile);
  if (new Set(agents.map(agent => agent.id)).size !== agents.length) throw new Error("Duplicate agents cannot join one Team.");
  const starters = agents.filter(agent => !agent.runAfterTeammates).map(agent => agent.id);
  if (starters.length === 0) throw new Error("Choose at least one agent that can start before teammates.");
  const task = prompt.trim();
  if (!task || task.length > 20_000) throw new Error("Describe a task of up to 20,000 characters.");
  return {
    prompt: task,
    acceptanceCriteria: ["Complete the requested task and leave file changes for human review."],
    roles: agents.map(agent => ({
      id: agent.id,
      label: agent.name,
      objective: agent.instructions,
      ...(agent.useCurrentModel ? {} : { route: { provider: agent.provider, model: agent.model } }),
    })),
    nodes: agents.map(agent => ({
      id: agent.id,
      roleId: agent.id,
      title: agent.name,
      objective: `Contribute to the Team task: ${task.slice(0, 3_900)}`,
      dependsOn: agent.runAfterTeammates ? starters : [],
      acceptanceCriteria: ["Fulfil the assigned role instructions and publish a concise handoff."],
      fileHints: [],
    })),
    concurrency: Math.min(2, agents.length),
    claims: [],
    tokenLimit: 60_000,
    costMicrosLimit: 20_000_000,
  };
}

/** The largest budget main accepts: a board run is limited by its dollar cap, not by tokens. */
const RUN_TOKEN_LIMIT = 2_000_000;
const NO_COST_CAP_MICROS = 1_000_000_000_000;

/**
 * One agent on one task: an Agents board box.
 *
 * `null` is the default agent - the connected model with no standing instructions and every
 * tool. A dollar cap becomes a hard cost limit, checked before each request can spend the key.
 */
export function buildSoloRun(
  prompt: string,
  agent: AgentProfile | null,
  options: { readonly capDollars?: number; readonly group?: string } = {},
): AiTeamConfigureInputView {
  const task = prompt.trim();
  if (!task || task.length > 20_000) throw new Error("Describe the task first (up to 20,000 characters).");
  const profiled = agent === null ? null : profile(agent);
  const title = (task.split(/\r?\n/)[0] ?? task).trim().slice(0, 120) || "Task";
  const roleId = profiled?.id ?? "default-agent";
  const cap = options.capDollars;
  return {
    kind: "solo",
    ...(options.group === undefined ? {} : { group: options.group }),
    prompt: task,
    acceptanceCriteria: ["Complete the requested task and summarise what changed."],
    roles: [{
      id: roleId,
      label: profiled?.name ?? "Default agent",
      objective: profiled?.instructions ?? "Complete the task carefully and verify your work where you can.",
      ...(profiled === null || profiled.useCurrentModel ? {} : { route: { provider: profiled.provider, model: profiled.model } }),
      ...(profiled?.toolAccess === undefined ? {} : { toolAccess: profiled.toolAccess }),
    }],
    nodes: [{
      id: "task",
      roleId,
      title,
      objective: task.slice(0, 4_000),
      dependsOn: [],
      acceptanceCriteria: ["The task is done and the summary says what changed."],
      fileHints: [],
    }],
    concurrency: 1,
    claims: [],
    tokenLimit: RUN_TOKEN_LIMIT,
    costMicrosLimit: cap !== undefined && Number.isFinite(cap) && cap > 0 ? Math.round(cap * 1_000_000) : NO_COST_CAP_MICROS,
  };
}

/** A follow-up: the new instruction first, then what the previous run did, so the agent can pick up. */
export function continuationPrompt(
  previous: { readonly prompt: string; readonly summary: string; readonly changedPaths: readonly string[] },
  next: string,
): string {
  const files = previous.changedPaths.length === 0 ? "none" : previous.changedPaths.slice(0, 40).join(", ");
  return [
    next.trim(),
    "",
    "Context from the previous run on this project:",
    `- It was asked: ${previous.prompt.trim().slice(0, 1_000)}`,
    `- It reported: ${previous.summary.trim().slice(0, 2_000)}`,
    `- Files it changed: ${files}`,
  ].join("\n");
}
