/** Hostile-renderer validation for Team configuration and commands. */
import {
  createFileClaim,
  createTeamBudget,
  createTeamGraph,
  createTeamPlan,
  type FileClaim,
  type TeamBudgetLedger,
  type TeamPlan,
  type TeamPlanInput,
} from "@adcode/ai";
import type {
  AiTeamConfigureInputView,
  AiTeamSuggestionInputView,
} from "../shared/api.ts";

const TEAM_ID = /^[a-z][a-z0-9-]{2,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function portablePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) return false;
  if (value.includes("\u0000") || value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return value
    .replaceAll("\\", "/")
    .split("/")
    .every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function validAiTeamId(value: unknown): value is string {
  return typeof value === "string" && TEAM_ID.test(value);
}

export interface ParsedAiTeamConfigure {
  readonly plan: TeamPlan;
  readonly claims: readonly FileClaim[];
  readonly budget: TeamBudgetLedger;
}

export function parseAiTeamConfigure(value: unknown, id: string): ParsedAiTeamConfigure | null {
  if (!validAiTeamId(id) || !isRecord(value)) return null;
  const raw = value as unknown as AiTeamConfigureInputView;
  if (
    !Array.isArray(raw.nodes) ||
    !raw.nodes.every(
      (node) =>
        isRecord(node) &&
        Array.isArray(node["fileHints"]) &&
        node["fileHints"].every(portablePath),
    ) ||
    !Array.isArray(raw.claims) ||
    raw.claims.length > 200 ||
    !Number.isSafeInteger(raw.tokenLimit) ||
    raw.tokenLimit < 1_000 ||
    raw.tokenLimit > 2_000_000 ||
    !Number.isSafeInteger(raw.costMicrosLimit) ||
    raw.costMicrosLimit < 1 ||
    raw.costMicrosLimit > 1_000_000_000_000
  ) {
    return null;
  }
  try {
    const plan = createTeamPlan({
      id,
      prompt: raw.prompt,
      acceptanceCriteria: raw.acceptanceCriteria,
      roles: raw.roles,
      nodes: raw.nodes,
      concurrency: raw.concurrency,
    } as TeamPlanInput);
    createTeamGraph(plan);
    const nodeIds = new Set(plan.nodes.map((node) => node.id));
    const claims = raw.claims.map((claim) => {
      if (!isRecord(claim)) throw new Error("Invalid Team claim");
      const nodeId = claim["nodeId"];
      const path = claim["path"];
      const scope = claim["scope"];
      const exclusive = claim["exclusive"];
      if (
        typeof nodeId !== "string" ||
        !nodeIds.has(nodeId) ||
        !portablePath(path) ||
        (scope !== "file" && scope !== "directory") ||
        (exclusive !== undefined && typeof exclusive !== "boolean")
      ) {
        throw new Error("Invalid Team claim");
      }
      return createFileClaim({
        nodeId,
        path,
        scope,
        ...(exclusive === undefined ? {} : { exclusive }),
      });
    });
    return {
      plan,
      claims,
      budget: createTeamBudget({
        tokenLimit: raw.tokenLimit,
        costMicrosLimit: raw.costMicrosLimit,
        agentTokenLimits: Object.fromEntries(plan.nodes.map((node) => [node.id, raw.tokenLimit])),
      }),
    };
  } catch {
    return null;
  }
}

export function parseAiTeamSuggestion(value: unknown): AiTeamSuggestionInputView | null {
  if (!isRecord(value)) return null;
  const prompt = value["prompt"];
  const contextTokens = value["contextTokens"];
  const fileHints = value["fileHints"];
  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > 20_000 ||
    prompt.includes("\u0000") ||
    !Number.isSafeInteger(contextTokens) ||
    (contextTokens as number) < 0 ||
    (contextTokens as number) > 10_000_000 ||
    !Array.isArray(fileHints) ||
    fileHints.length > 200 ||
    !fileHints.every(portablePath)
  ) {
    return null;
  }
  return {
    prompt: prompt.trim(),
    contextTokens: contextTokens as number,
    fileHints: fileHints.map((path) => path.replaceAll("\\", "/")),
  };
}
