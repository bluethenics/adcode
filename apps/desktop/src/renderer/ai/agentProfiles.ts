/** Nonsecret reusable profiles and their mapping to the existing isolated Team runner. */
import type { AiTeamConfigureInputView } from "../../shared/api.ts";

export const AGENT_PROFILES_SETTING = "adcode.ai.agentProfiles";
export interface AgentProfile {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly provider: string;
  readonly model: string;
  readonly runAfterTeammates?: boolean;
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
  return {
    id,
    name: field("name", 80),
    instructions: field("instructions", 2_000),
    provider: field("provider", 128),
    model: field("model", 256),
    ...(raw["runAfterTeammates"] === true ? { runAfterTeammates: true } : {}),
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
      route: { provider: agent.provider, model: agent.model },
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
