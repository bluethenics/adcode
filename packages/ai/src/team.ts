/** Pure Team-mode configuration and local suggestion decisions. */

export interface TeamRoleInput {
  readonly id: string;
  readonly label: string;
  readonly objective: string;
}

export interface TeamPlanNodeInput {
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly roleId: string;
  readonly dependsOn: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly fileHints: readonly string[];
}

export interface TeamPlanInput {
  readonly id: string;
  readonly prompt: string;
  readonly acceptanceCriteria: readonly string[];
  readonly roles: readonly TeamRoleInput[];
  readonly nodes: readonly TeamPlanNodeInput[];
  readonly concurrency?: number;
}

export interface TeamRole extends TeamRoleInput {}
export interface TeamPlanNode extends TeamPlanNodeInput {}

export interface TeamPlan {
  readonly id: string;
  readonly prompt: string;
  readonly acceptanceCriteria: readonly string[];
  readonly roles: readonly TeamRole[];
  readonly nodes: readonly TeamPlanNode[];
  readonly concurrency: number;
}

const ID = /^[a-z][a-z0-9-]{2,47}$/;

function boundedText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length === 0 || text.length > max || text.includes("\u0000")) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function boundedTexts(
  values: readonly string[],
  label: string,
  minimum: number,
  maximum: number,
  textMaximum = 1_000,
): string[] {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    throw new Error(`${label} must contain ${minimum}-${maximum} entries`);
  }
  return values.map((value) => boundedText(value, label, textMaximum));
}

function uniqueIds<T extends { readonly id: string }>(values: readonly T[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!ID.test(value.id) || seen.has(value.id)) throw new Error(`Invalid or duplicate ${label} id`);
    seen.add(value.id);
  }
}

export function createTeamPlan(input: TeamPlanInput): TeamPlan {
  if (!ID.test(input.id)) throw new Error("Invalid team id");
  const prompt = boundedText(input.prompt, "Team prompt", 20_000);
  const acceptanceCriteria = boundedTexts(
    input.acceptanceCriteria,
    "Acceptance criteria",
    1,
    20,
  );
  if (!Array.isArray(input.roles) || input.roles.length < 2 || input.roles.length > 4) {
    throw new Error("A team needs at least two roles and at most four roles");
  }
  if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > 16) {
    throw new Error("A team needs between two and sixteen task nodes");
  }
  uniqueIds(input.roles, "role");
  uniqueIds(input.nodes, "node");

  const roles: TeamRole[] = input.roles.map((role) => ({
    id: role.id,
    label: boundedText(role.label, "Role label", 80),
    objective: boundedText(role.objective, "Role objective", 2_000),
  }));
  const roleIds = new Set(roles.map((role) => role.id));
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const nodes: TeamPlanNode[] = input.nodes.map((node) => {
    if (!roleIds.has(node.roleId)) throw new Error(`Node ${node.id} has no assigned role`);
    const dependencies = boundedTexts(node.dependsOn, "Dependencies", 0, 15, 48);
    if (dependencies.some((dependency) => !nodeIds.has(dependency) || dependency === node.id)) {
      throw new Error(`Node ${node.id} has an invalid dependency`);
    }
    if (new Set(dependencies).size !== dependencies.length) {
      throw new Error(`Node ${node.id} has duplicate dependencies`);
    }
    return {
      id: node.id,
      title: boundedText(node.title, "Node title", 120),
      objective: boundedText(node.objective, "Node objective", 4_000),
      roleId: node.roleId,
      dependsOn: dependencies,
      acceptanceCriteria: boundedTexts(
        node.acceptanceCriteria,
        "Node acceptance criteria",
        1,
        20,
      ),
      fileHints: boundedTexts(node.fileHints, "File hints", 0, 50, 4_096),
    };
  });

  const concurrency = input.concurrency ?? Math.min(2, roles.length);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4 || concurrency > roles.length) {
    throw new Error("Team concurrency must be between one and four and no greater than its roles");
  }

  return { id: input.id, prompt, acceptanceCriteria, roles, nodes, concurrency };
}

export interface TeamSuggestionInput {
  readonly workspaceId: string;
  readonly prompt: string;
  readonly contextTokens: number;
  readonly fileHints: readonly string[];
}

export interface EstimateRange {
  readonly min: number;
  readonly max: number;
}

export interface SuggestedTeamRole {
  readonly id: string;
  readonly label: string;
  readonly objective: string;
  readonly fileHints: readonly string[];
}

export interface TeamSuggestion {
  readonly dismissalKey: string;
  readonly reasons: readonly string[];
  readonly roles: readonly SuggestedTeamRole[];
  readonly estimatedSequentialMinutes: EstimateRange;
  readonly estimatedParallelMinutes: EstimateRange;
  readonly estimatedTokens: EstimateRange;
}

function opaqueHash(value: string): string {
  // Two small deterministic FNV-1a passes keep prompt text out of persisted dismissal keys.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(36)}${second.toString(36)}`;
}

export function teamSuggestionDismissalKey(workspaceId: string, prompt: string): string {
  const workspace = boundedText(workspaceId, "Workspace identity", 256);
  const task = boundedText(prompt, "Team prompt", 20_000);
  return `team-suggestion-${opaqueHash(`${workspace}\u0000${task}`)}`;
}

function subsystemFor(path: string): string | null {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (["apps", "packages", "services"].includes(parts[0]!) && parts.length > 1) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] ?? null;
}

function labelForSubsystem(subsystem: string): string {
  const name = subsystem.split("/").at(-1) ?? subsystem;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function idForSubsystem(subsystem: string, used: Set<string>): string {
  const base = (subsystem.split("/").at(-1) ?? "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  let candidate = ID.test(base) ? base : `agent-${opaqueHash(subsystem).slice(0, 8)}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 32)}-${String(suffix)}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

export function suggestTeam(input: TeamSuggestionInput): TeamSuggestion | null {
  boundedText(input.workspaceId, "Workspace identity", 256);
  const prompt = boundedText(input.prompt, "Team prompt", 20_000);
  if (!Number.isSafeInteger(input.contextTokens) || input.contextTokens < 0) {
    throw new Error("Context token estimate is invalid");
  }
  const fileHints = boundedTexts(input.fileHints, "File hints", 0, 200, 4_096);
  const bySubsystem = new Map<string, string[]>();
  for (const hint of fileHints) {
    const subsystem = subsystemFor(hint);
    if (subsystem === null) continue;
    const hints = bySubsystem.get(subsystem) ?? [];
    hints.push(hint);
    bySubsystem.set(subsystem, hints);
  }

  const explicit = /\b(parallel|multiple agents?|multi-agent|team mode)\b/i.test(prompt);
  const independentLanguage = /\b(and also|also|as well as|both)\b/i.test(prompt);
  const verification = /\b(test|tests|review|audit|verify|verification)\b/i.test(prompt);
  let score = 0;
  const reasons: string[] = [];
  if (explicit) {
    score += 4;
    reasons.push("You explicitly asked for parallel agent work.");
  }
  if (bySubsystem.size >= 2) {
    score += 3;
    reasons.push(`The task spans ${String(bySubsystem.size)} independent project subsystems.`);
  }
  if (input.contextTokens >= 60_000) {
    score += 3;
    reasons.push("The estimated context is large enough that focused agents can avoid repeated reading.");
  }
  if (independentLanguage) score += 1;
  if (verification) score += 1;
  if (score < 3) return null;

  const used = new Set<string>();
  const roles: SuggestedTeamRole[] = [...bySubsystem.entries()].slice(0, 3).map(([subsystem, hints]) => {
    const label = labelForSubsystem(subsystem);
    return {
      id: idForSubsystem(subsystem, used),
      label: `${label} agent`,
      objective: `Own the ${label} portion of the task and publish a compact handoff.`,
      fileHints: hints,
    };
  });
  if (roles.length < 2) {
    roles.length = 0;
    used.clear();
    roles.push({
      id: "implementer",
      label: "Implementation agent",
      objective: "Implement the requested change in an isolated workspace.",
      fileHints,
    });
    roles.push({
      id: verification ? "reviewer" : "investigator",
      label: verification ? "Review and test agent" : "Investigation agent",
      objective: verification
        ? "Independently review the change and verify the acceptance criteria."
        : "Investigate the relevant code and hand off focused findings before implementation.",
      fileHints: [],
    });
  } else if (verification && roles.length < 4) {
    roles.push({
      id: "reviewer",
      label: "Review and test agent",
      objective: "Independently review the combined result and verify the acceptance criteria.",
      fileHints: [],
    });
  }

  const sequentialMin = Math.max(24, roles.length * 14 + Math.ceil(input.contextTokens / 8_000));
  const sequentialMax = Math.ceil(sequentialMin * 1.75);
  const parallelMin = Math.max(14, Math.ceil((sequentialMin / Math.min(roles.length, 2)) * 1.15));
  const parallelMax = Math.max(parallelMin + 5, Math.ceil(sequentialMax * 0.72));
  const tokenMin = Math.max(8_000, Math.ceil(input.contextTokens * 0.35 + roles.length * 6_000));
  const tokenMax = Math.ceil(tokenMin * 1.8);

  return {
    dismissalKey: teamSuggestionDismissalKey(input.workspaceId, prompt),
    reasons,
    roles,
    estimatedSequentialMinutes: { min: sequentialMin, max: sequentialMax },
    estimatedParallelMinutes: { min: parallelMin, max: parallelMax },
    estimatedTokens: { min: tokenMin, max: tokenMax },
  };
}
