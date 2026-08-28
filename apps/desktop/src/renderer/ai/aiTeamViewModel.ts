import type {
  AiTeamConfigureInputView,
  AiTeamStateView,
  AiTeamSuggestionView,
  AiTeamView,
} from "../../shared/api.ts";

const LABELS: Readonly<Record<AiTeamStateView, string>> = {
  configured: "Ready for confirmation",
  preparing: "Preparing isolated roles",
  running: "Team working",
  paused: "Team paused safely",
  merging: "Combining proposals",
  review: "Combined review ready",
  conflict: "Merge conflict needs review",
  completed: "Team completed",
  failed: "Team needs attention",
  cancelled: "Team cancelled",
};

export function aiTeamStateLabel(state: AiTeamStateView): string {
  return LABELS[state];
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return String(value);
}

export function formatAiTeamUsage(team: AiTeamView): string {
  const committed = team.budget.usedTokens + team.budget.reservedTokens;
  return `${compact(committed)} / ${compact(team.budget.tokenLimit)} tokens`;
}

export function aiTeamActions(team: AiTeamView): {
  readonly start: boolean;
  readonly cancel: boolean;
  readonly trace: boolean;
  readonly review: boolean;
  readonly conflict: boolean;
} {
  return {
    start: team.state === "configured",
    cancel: ["configured", "preparing", "running", "paused", "merging", "review", "conflict", "failed"].includes(
      team.state,
    ),
    trace: team.confirmedAt !== null,
    review: team.state === "review" && team.merge.combinedTaskId !== null,
    conflict: team.state === "conflict" && team.merge.conflicts.length > 0,
  };
}

export function extractTeamFileHints(prompt: string): string[] {
  const hits = prompt.match(/(?:apps|packages|services|src)\/[A-Za-z0-9._/-]+/g) ?? [];
  return [...new Set(hits.map((hit) => hit.replace(/[),.;:]+$/, "")))].slice(0, 50);
}

export function manualTeamSuggestion(prompt: string): AiTeamSuggestionView {
  const verification = /\b(test|review|verify|audit)\b/i.test(prompt);
  return {
    dismissalKey: "manual-team",
    reasons: ["You chose focused roles for this task."],
    roles: [
      {
        id: "implementer",
        label: "Implementation agent",
        objective: "Implement the requested change in an isolated workspace.",
        fileHints: extractTeamFileHints(prompt),
      },
      {
        id: verification ? "reviewer" : "investigator",
        label: verification ? "Review agent" : "Investigation agent",
        objective: verification
          ? "Review the implementation and verify the acceptance criteria."
          : "Investigate the relevant code and publish a compact handoff.",
        fileHints: [],
      },
    ],
    estimatedSequentialMinutes: { min: 28, max: 50 },
    estimatedParallelMinutes: { min: 18, max: 36 },
    estimatedTokens: { min: 20_000, max: 60_000 },
  };
}

function looksLikeReviewer(id: string, label: string): boolean {
  return /review|test|verify|audit/i.test(`${id} ${label}`);
}

export function buildAiTeamConfigureInput(
  prompt: string,
  suggestion: AiTeamSuggestionView,
): AiTeamConfigureInputView {
  const roles = suggestion.roles.slice(0, 4).map(({ id, label, objective }) => ({ id, label, objective }));
  const implementerIds = roles
    .filter((role) => !looksLikeReviewer(role.id, role.label))
    .map((role) => role.id);
  const hintsByRole = new Map(suggestion.roles.map((role) => [role.id, role.fileHints]));
  const nodes = roles.map((role) => ({
    id: role.id,
    title: role.label,
    objective: role.objective,
    roleId: role.id,
    dependsOn: looksLikeReviewer(role.id, role.label) ? implementerIds.filter((id) => id !== role.id) : [],
    acceptanceCriteria: [role.objective],
    fileHints: [...(hintsByRole.get(role.id) ?? [])],
  }));
  const claims = nodes.flatMap((node) =>
    node.fileHints.map((path) => ({
      nodeId: node.id,
      path,
      scope: /\.[A-Za-z0-9]{1,10}$/.test(path) ? ("file" as const) : ("directory" as const),
    })),
  );
  const estimated = suggestion.estimatedTokens.max;
  const tokenLimit = Math.min(250_000, Math.max(25_000, Math.ceil(estimated / 5_000) * 5_000));
  return {
    prompt: prompt.trim(),
    acceptanceCriteria: ["Complete the requested task and leave all file changes for human review."],
    roles,
    nodes,
    concurrency: Math.min(2, roles.length),
    claims,
    tokenLimit,
    costMicrosLimit: 20_000_000,
  };
}
