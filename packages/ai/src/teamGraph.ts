import type { TeamPlan, TeamPlanNode, TeamRole } from "./team.ts";

export type TeamNodeState = "pending" | "running" | "completed" | "failed" | "blocked";

export interface TeamGraphNode extends TeamPlanNode {
  readonly state: TeamNodeState;
  readonly failure: string | null;
  readonly updatedAt: number;
}

export interface TeamGraph {
  readonly nodes: readonly TeamGraphNode[];
  readonly updatedAt: number;
}

function timestamp(value: number, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum) throw new Error("Invalid Team graph timestamp");
  return value;
}

function assertAcyclic(nodes: readonly TeamPlanNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("Team task graph contains a dependency cycle");
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (node === undefined) throw new Error(`Team task graph has a missing dependency: ${id}`);
    visiting.add(id);
    for (const dependency of node.dependsOn) {
      if (!byId.has(dependency)) throw new Error(`Team task graph has a missing dependency: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const node of nodes) visit(node.id);
}

export function createTeamGraph(plan: TeamPlan, now = 0): TeamGraph {
  timestamp(now);
  assertAcyclic(plan.nodes);
  return {
    nodes: plan.nodes.map((node) => ({ ...node, state: "pending", failure: null, updatedAt: now })),
    updatedAt: now,
  };
}

export function readyTeamNodes(graph: TeamGraph): TeamGraphNode[] {
  const states = new Map(graph.nodes.map((node) => [node.id, node.state]));
  return graph.nodes
    .filter(
      (node) =>
        node.state === "pending" &&
        node.dependsOn.every((dependency) => states.get(dependency) === "completed"),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function updateNode(
  graph: TeamGraph,
  nodeId: string,
  now: number,
  update: (node: TeamGraphNode) => TeamGraphNode,
): TeamGraph {
  timestamp(now, graph.updatedAt);
  let found = false;
  const nodes = graph.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    found = true;
    return update(node);
  });
  if (!found) throw new Error("Team graph node was not found");
  return { nodes, updatedAt: now };
}

export function startTeamNode(graph: TeamGraph, nodeId: string, now: number): TeamGraph {
  const ready = new Set(readyTeamNodes(graph).map((node) => node.id));
  if (!ready.has(nodeId)) throw new Error("Team graph node is not ready");
  return updateNode(graph, nodeId, now, (node) => ({ ...node, state: "running", updatedAt: now }));
}

export function completeTeamNode(graph: TeamGraph, nodeId: string, now: number): TeamGraph {
  return updateNode(graph, nodeId, now, (node) => {
    if (node.state !== "running") throw new Error("Only a running Team node can complete");
    return { ...node, state: "completed", failure: null, updatedAt: now };
  });
}

function blockFailedDependants(nodes: readonly TeamGraphNode[], now: number): TeamGraphNode[] {
  let result = [...nodes];
  let changed = true;
  while (changed) {
    changed = false;
    const states = new Map(result.map((node) => [node.id, node.state]));
    result = result.map((node) => {
      if (
        node.state === "pending" &&
        node.dependsOn.some((dependency) => {
          const state = states.get(dependency);
          return state === "failed" || state === "blocked";
        })
      ) {
        changed = true;
        return { ...node, state: "blocked", failure: "A dependency did not complete", updatedAt: now };
      }
      return node;
    });
  }
  return result;
}

export function failTeamNode(
  graph: TeamGraph,
  nodeId: string,
  reason: string,
  now: number,
): TeamGraph {
  const failure = boundedText(reason, "Failure reason", 2_000);
  const failed = updateNode(graph, nodeId, now, (node) => {
    if (node.state !== "running") throw new Error("Only a running Team node can fail");
    return { ...node, state: "failed", failure, updatedAt: now };
  });
  return { ...failed, nodes: blockFailedDependants(failed.nodes, now) };
}

export function teamGraphState(graph: TeamGraph): "active" | "completed" | "failed" {
  if (graph.nodes.every((node) => node.state === "completed")) return "completed";
  if (readyTeamNodes(graph).length > 0 || graph.nodes.some((node) => node.state === "running")) {
    return "active";
  }
  return "failed";
}

export type FileClaimScope = "file" | "directory";

export interface FileClaimInput {
  readonly nodeId: string;
  readonly path: string;
  readonly scope: FileClaimScope;
  readonly exclusive?: boolean;
}

export interface FileClaim {
  readonly nodeId: string;
  readonly path: string;
  readonly scope: FileClaimScope;
  readonly exclusive: boolean;
}

const NODE_ID = /^[a-z][a-z0-9-]{2,47}$/;

function boundedText(value: string, label: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const text = value.trim();
  if (text.length === 0 || text.length > maximum || text.includes("\u0000")) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function boundedArray(
  values: readonly string[],
  label: string,
  maximumCount: number,
  maximumText = 1_000,
): string[] {
  if (!Array.isArray(values) || values.length > maximumCount) throw new Error(`${label} is too large`);
  return values.map((value) => boundedText(value, label, maximumText));
}

function portableClaimPath(value: string): string {
  const raw = boundedText(value, "File claim path", 4_096);
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) throw new Error("File claim path is invalid");
  const portable = raw.replaceAll("\\", "/");
  const parts = portable.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error("File claim path is invalid");
  }
  return portable;
}

export function createFileClaim(input: FileClaimInput): FileClaim {
  if (!NODE_ID.test(input.nodeId)) throw new Error("File claim node id is invalid");
  if (input.scope !== "file" && input.scope !== "directory") throw new Error("File claim scope is invalid");
  return {
    nodeId: input.nodeId,
    path: portableClaimPath(input.path),
    scope: input.scope,
    exclusive: input.exclusive === true,
  };
}

function claimsOverlap(first: FileClaim, second: FileClaim): boolean {
  if (first.path === second.path) return true;
  if (first.scope === "directory" && second.path.startsWith(`${first.path}/`)) return true;
  if (second.scope === "directory" && first.path.startsWith(`${second.path}/`)) return true;
  return false;
}

export interface FileClaimConflict {
  readonly firstNodeId: string;
  readonly secondNodeId: string;
  readonly firstPath: string;
  readonly secondPath: string;
}

export function reportFileClaimConflicts(claims: readonly FileClaim[]): FileClaimConflict[] {
  const conflicts: FileClaimConflict[] = [];
  for (let firstIndex = 0; firstIndex < claims.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < claims.length; secondIndex += 1) {
      const first = claims[firstIndex]!;
      const second = claims[secondIndex]!;
      if (first.nodeId === second.nodeId || !claimsOverlap(first, second)) continue;
      conflicts.push({
        firstNodeId: first.nodeId,
        secondNodeId: second.nodeId,
        firstPath: first.path,
        secondPath: second.path,
      });
    }
  }
  return conflicts.sort((a, b) =>
    `${a.firstNodeId}\u0000${a.secondNodeId}\u0000${a.firstPath}\u0000${a.secondPath}`.localeCompare(
      `${b.firstNodeId}\u0000${b.secondNodeId}\u0000${b.firstPath}\u0000${b.secondPath}`,
    ),
  );
}

export function validateFileClaims(claims: readonly FileClaim[]): FileClaim[] {
  if (!Array.isArray(claims) || claims.length > 200) throw new Error("Too many file claims");
  const validated = claims.map(createFileClaim);
  const keys = new Set<string>();
  for (const claim of validated) {
    const key = `${claim.nodeId}\u0000${claim.scope}\u0000${claim.path}`;
    if (keys.has(key)) throw new Error("Duplicate file claim");
    keys.add(key);
  }
  for (let first = 0; first < validated.length; first += 1) {
    for (let second = first + 1; second < validated.length; second += 1) {
      const a = validated[first]!;
      const b = validated[second]!;
      if (a.nodeId !== b.nodeId && a.exclusive && b.exclusive && claimsOverlap(a, b)) {
        throw new Error("Exclusive claims overlap");
      }
    }
  }
  return validated;
}

export type TeamTestOutcome = "passed" | "failed" | "not-run";

export interface TeamTestHandoff {
  readonly command: string;
  readonly outcome: TeamTestOutcome;
  readonly summary: string;
}

export interface TeamHandoffInput {
  readonly nodeId: string;
  readonly summary: string;
  readonly findings: readonly string[];
  readonly decisions: readonly string[];
  readonly changedPaths: readonly string[];
  readonly tests: readonly TeamTestHandoff[];
  readonly blockers: readonly string[];
  readonly deadEnds: readonly string[];
  readonly completedAt: number;
}

export interface TeamHandoff extends TeamHandoffInput {}

export function createTeamHandoff(input: TeamHandoffInput): TeamHandoff {
  if (!NODE_ID.test(input.nodeId)) throw new Error("Handoff node id is invalid");
  if (!Number.isFinite(input.completedAt) || input.completedAt < 0) {
    throw new Error("Handoff completion time is invalid");
  }
  if (!Array.isArray(input.tests) || input.tests.length > 20) throw new Error("Handoff tests are too large");
  return {
    nodeId: input.nodeId,
    summary: boundedText(input.summary, "Handoff summary", 2_000),
    findings: boundedArray(input.findings, "Handoff findings", 20),
    decisions: boundedArray(input.decisions, "Handoff decisions", 20),
    changedPaths: boundedArray(input.changedPaths, "Handoff changed paths", 100, 4_096).map(
      portableClaimPath,
    ),
    tests: input.tests.map((test) => {
      if (!["passed", "failed", "not-run"].includes(test.outcome)) {
        throw new Error("Handoff test outcome is invalid");
      }
      return {
        command: boundedText(test.command, "Handoff test command", 500),
        outcome: test.outcome,
        summary: boundedText(test.summary, "Handoff test summary", 1_000),
      };
    }),
    blockers: boundedArray(input.blockers, "Handoff blockers", 20),
    deadEnds: boundedArray(input.deadEnds, "Handoff dead ends", 20),
    completedAt: input.completedAt,
  };
}

export interface TeamNodeContext {
  readonly taskPrompt: string;
  readonly taskAcceptanceCriteria: readonly string[];
  readonly role: TeamRole;
  readonly node: TeamPlanNode;
  readonly dependencies: readonly TeamHandoff[];
  readonly claims: readonly FileClaim[];
}

export function teamNodeContext(
  plan: TeamPlan,
  nodeId: string,
  handoffs: readonly TeamHandoff[],
  claims: readonly FileClaim[],
): TeamNodeContext {
  const node = plan.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) throw new Error("Team plan node was not found");
  const role = plan.roles.find((candidate) => candidate.id === node.roleId);
  if (role === undefined) throw new Error("Team plan role was not found");
  const byNode = new Map(handoffs.map((handoff) => [handoff.nodeId, createTeamHandoff(handoff)]));
  const dependencies = node.dependsOn
    .map((dependency) => byNode.get(dependency))
    .filter((handoff): handoff is TeamHandoff => handoff !== undefined);
  const validatedClaims = validateFileClaims(claims).filter((claim) => claim.nodeId === nodeId);
  return {
    taskPrompt: plan.prompt,
    taskAcceptanceCriteria: [...plan.acceptanceCriteria],
    role: { ...role },
    node: { ...node },
    dependencies,
    claims: validatedClaims,
  };
}
