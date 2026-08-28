/** Pure three-way planning for proposals produced from one immutable Team base. */
import { applyHunks, computeHunks, type Hunk } from "./diff.ts";
import { createFileChange, type AiFileChange } from "./workspaces.ts";
import type { TeamPlan } from "./team.ts";

export interface TeamNodeContribution {
  readonly nodeId: string;
  readonly changes: readonly AiFileChange[];
}

export type TeamMergeConflictReason = "different-base" | "overlapping-hunks";

export interface TeamMergeConflict {
  readonly path: string;
  readonly nodeIds: readonly string[];
  readonly reason: TeamMergeConflictReason;
  readonly original: string | null;
  readonly proposals: readonly string[];
}

export interface TeamMergePlan {
  readonly nodeOrder: readonly string[];
  readonly changes: readonly AiFileChange[];
  readonly conflicts: readonly TeamMergeConflict[];
}

function dependencyOrder(plan: TeamPlan): string[] {
  const remaining = new Map(plan.nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => node.dependsOn.every((dependency) => completed.has(dependency)))
      .sort((first, second) => first.id.localeCompare(second.id));
    if (ready.length === 0) throw new Error("Team plan dependency cycle prevents merge ordering");
    for (const node of ready) {
      remaining.delete(node.id);
      completed.add(node.id);
      order.push(node.id);
    }
  }
  return order;
}

function hunkOverlap(first: Hunk, second: Hunk): boolean {
  if (
    first.startLine === second.startLine &&
    first.original.join("\u0000") === second.original.join("\u0000") &&
    first.replacement.join("\u0000") === second.replacement.join("\u0000")
  ) {
    return false;
  }
  const firstEnd = first.startLine + first.original.length;
  const secondEnd = second.startLine + second.original.length;
  if (first.original.length === 0 && second.original.length === 0) {
    return first.startLine === second.startLine;
  }
  if (first.original.length === 0) {
    return first.startLine >= second.startLine && first.startLine <= secondEnd;
  }
  if (second.original.length === 0) {
    return second.startLine >= first.startLine && second.startLine <= firstEnd;
  }
  return first.startLine < secondEnd && second.startLine < firstEnd;
}

function mergeOnePath(
  path: string,
  entries: readonly { readonly nodeId: string; readonly change: AiFileChange }[],
): { change: AiFileChange | null; conflict: TeamMergeConflict | null } {
  const original = entries[0]!.change.original;
  const nodeIds = entries.map((entry) => entry.nodeId);
  const proposals = entries.map((entry) => entry.change.proposed);
  if (entries.some((entry) => entry.change.original !== original)) {
    return {
      change: null,
      conflict: { path, nodeIds, reason: "different-base", original, proposals },
    };
  }
  if (new Set(proposals).size === 1) {
    return { change: createFileChange(path, original, proposals[0]!), conflict: null };
  }

  const base = original ?? "";
  const hunks = entries.map((entry) => ({
    nodeId: entry.nodeId,
    hunks: computeHunks(base, entry.change.proposed),
  }));
  for (let firstEntry = 0; firstEntry < hunks.length; firstEntry += 1) {
    for (let secondEntry = firstEntry + 1; secondEntry < hunks.length; secondEntry += 1) {
      for (const first of hunks[firstEntry]!.hunks) {
        for (const second of hunks[secondEntry]!.hunks) {
          if (hunkOverlap(first, second)) {
            return {
              change: null,
              conflict: { path, nodeIds, reason: "overlapping-hunks", original, proposals },
            };
          }
        }
      }
    }
  }

  const unique = new Map<string, Hunk>();
  for (const entry of hunks) {
    for (const hunk of entry.hunks) {
      const key = JSON.stringify([hunk.startLine, hunk.original, hunk.replacement]);
      if (!unique.has(key)) {
        unique.set(key, { ...hunk, id: `m${String(unique.size)}` });
      }
    }
  }
  const mergedHunks = [...unique.values()];
  return {
    change: createFileChange(
      path,
      original,
      applyHunks(base, mergedHunks, mergedHunks.map((hunk) => hunk.id)),
    ),
    conflict: null,
  };
}

export function planTeamMerge(
  plan: TeamPlan,
  contributions: readonly TeamNodeContribution[],
): TeamMergePlan {
  const planNodes = new Set(plan.nodes.map((node) => node.id));
  const byNode = new Map<string, TeamNodeContribution>();
  for (const contribution of contributions) {
    if (!planNodes.has(contribution.nodeId)) throw new Error("Team merge contribution node is invalid");
    if (byNode.has(contribution.nodeId)) throw new Error("Duplicate Team merge contribution");
    const paths = new Set<string>();
    const changes = contribution.changes.map((change) => {
      const validated = createFileChange(change.path, change.original, change.proposed);
      if (paths.has(validated.path)) throw new Error("Duplicate output path in Team contribution");
      paths.add(validated.path);
      return validated;
    });
    byNode.set(contribution.nodeId, { nodeId: contribution.nodeId, changes });
  }

  const nodeOrder = dependencyOrder(plan).filter((nodeId) => byNode.has(nodeId));
  const byPath = new Map<string, Array<{ nodeId: string; change: AiFileChange }>>();
  for (const nodeId of nodeOrder) {
    for (const change of byNode.get(nodeId)!.changes) {
      const entries = byPath.get(change.path) ?? [];
      entries.push({ nodeId, change });
      byPath.set(change.path, entries);
    }
  }

  const changes: AiFileChange[] = [];
  const conflicts: TeamMergeConflict[] = [];
  for (const path of [...byPath.keys()].sort((first, second) => first.localeCompare(second))) {
    const merged = mergeOnePath(path, byPath.get(path)!);
    if (merged.change !== null) changes.push(merged.change);
    if (merged.conflict !== null) conflicts.push(merged.conflict);
  }
  return { nodeOrder, changes, conflicts };
}
