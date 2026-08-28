/** Durable parent records and lane traces for confirmed or configured AI Teams. */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createFileClaim,
  createTeamGraph,
  createTeamHandoff,
  createTeamPlan,
  pauseRunningTeamNodes,
  validateFileClaims,
  validateTeamBudgetLedger,
  type FileClaim,
  type TeamBudgetLedger,
  type TeamGraph,
  type TeamGraphNode,
  type TeamHandoff,
  type TeamPlan,
  type TeamNodeState,
} from "@adcode/ai";
import type { AiSandboxBaseRecord } from "./aiSandbox.ts";

export type AiTeamState =
  | "configured"
  | "preparing"
  | "running"
  | "paused"
  | "merging"
  | "review"
  | "conflict"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiTeamRouteRecord {
  readonly providerId: string;
  readonly modelId: string;
  readonly reason: string;
  readonly priceKnown: boolean;
  readonly blendedCostMicrosPerMillion: number | null;
}

export interface AiTeamMergeRecord {
  readonly state: "idle" | "queued" | "merging" | "review" | "conflict" | "completed";
  readonly combinedTaskId: string | null;
  readonly conflicts: readonly string[];
}

export interface AiTeamRecord {
  readonly id: string;
  readonly workspaceId: string;
  /** Main-process-only authority metadata. */
  readonly workspaceRoot: string;
  readonly state: AiTeamState;
  readonly plan: TeamPlan;
  readonly graph: TeamGraph;
  readonly claims: readonly FileClaim[];
  readonly handoffs: readonly TeamHandoff[];
  readonly budget: TeamBudgetLedger;
  readonly childTaskIds: Readonly<Record<string, string>>;
  readonly routes: Readonly<Record<string, AiTeamRouteRecord>>;
  readonly merge: AiTeamMergeRecord;
  readonly base: AiSandboxBaseRecord | null;
  readonly confirmedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateAiTeamRecordInput {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly plan: TeamPlan;
  readonly claims: readonly FileClaim[];
  readonly budget: TeamBudgetLedger;
  readonly now: number;
}

const TEAM_ID = /^[a-z][a-z0-9-]{2,63}$/;
const TASK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const NODE_ID = /^[a-z][a-z0-9-]{2,47}$/;
const TEAM_STATES = new Set<AiTeamState>([
  "configured",
  "preparing",
  "running",
  "paused",
  "merging",
  "review",
  "conflict",
  "completed",
  "failed",
  "cancelled",
]);
const NODE_STATES = new Set<TeamNodeState>([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "blocked",
]);

const workspaceIdentity = (root: string): string =>
  `ws-${createHash("sha256").update(root).digest("hex").slice(0, 32)}`;

function validTime(value: number, minimum = 0): number {
  if (!Number.isFinite(value) || value < minimum) throw new Error("Invalid AI Team timestamp");
  return value;
}

function validRoot(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\u0000")) {
    throw new Error("Invalid AI Team workspace root");
  }
  return value;
}

export function createAiTeamRecord(input: CreateAiTeamRecordInput): AiTeamRecord {
  if (!TEAM_ID.test(input.id) || input.plan.id !== input.id) throw new Error("Invalid AI Team id");
  const root = validRoot(input.workspaceRoot);
  const now = validTime(input.now);
  return {
    id: input.id,
    workspaceId: workspaceIdentity(root),
    workspaceRoot: root,
    state: "configured",
    plan: createTeamPlan(input.plan),
    graph: createTeamGraph(input.plan, now),
    claims: validateFileClaims(input.claims),
    handoffs: [],
    budget: validateTeamBudgetLedger(input.budget),
    childTaskIds: {},
    routes: {},
    merge: { state: "idle", combinedTaskId: null, conflicts: [] },
    base: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

const TRANSITIONS: Readonly<Record<AiTeamState, readonly AiTeamState[]>> = {
  configured: ["preparing", "cancelled"],
  preparing: ["running", "paused", "failed", "cancelled"],
  running: ["paused", "merging", "failed", "cancelled"],
  paused: ["preparing", "running", "failed", "cancelled"],
  merging: ["review", "conflict", "paused", "failed", "cancelled"],
  review: ["completed", "conflict", "cancelled"],
  conflict: ["merging", "review", "cancelled"],
  completed: [],
  failed: ["paused", "cancelled"],
  cancelled: [],
};

export function transitionAiTeamRecord(
  record: AiTeamRecord,
  state: AiTeamState,
  now: number,
): AiTeamRecord {
  if (!TRANSITIONS[record.state].includes(state)) {
    throw new Error(`Invalid AI Team transition: ${record.state} -> ${state}`);
  }
  return { ...record, state, updatedAt: validTime(now, record.updatedAt) };
}

export function confirmAiTeamRecord(record: AiTeamRecord, now: number): AiTeamRecord {
  if (record.state !== "configured" || record.confirmedAt !== null) {
    throw new Error("AI Team is already confirmed or cannot start");
  }
  const confirmedAt = validTime(now, record.updatedAt);
  return { ...transitionAiTeamRecord(record, "preparing", confirmedAt), confirmedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGraph(raw: unknown, plan: TeamPlan): TeamGraph {
  if (!isRecord(raw) || !Array.isArray(raw["nodes"])) throw new Error("Invalid Team graph");
  const updatedAt = validTime(raw["updatedAt"] as number);
  const planById = new Map(plan.nodes.map((node) => [node.id, node]));
  if (raw["nodes"].length !== plan.nodes.length) throw new Error("Invalid Team graph nodes");
  const seen = new Set<string>();
  const nodes: TeamGraphNode[] = raw["nodes"].map((candidate) => {
    if (!isRecord(candidate) || typeof candidate["id"] !== "string") throw new Error("Invalid Team graph node");
    const planned = planById.get(candidate["id"]);
    if (planned === undefined || seen.has(planned.id)) throw new Error("Invalid Team graph node id");
    seen.add(planned.id);
    const state = candidate["state"] as TeamNodeState;
    if (!NODE_STATES.has(state)) throw new Error("Invalid Team graph node state");
    const failure = candidate["failure"];
    if (failure !== null && typeof failure !== "string") throw new Error("Invalid Team graph failure");
    return {
      ...planned,
      state,
      failure,
      updatedAt: validTime(candidate["updatedAt"] as number),
    };
  });
  return { nodes, updatedAt };
}

function parseStringMap(raw: unknown, valuePattern: RegExp): Record<string, string> {
  if (!isRecord(raw)) throw new Error("Invalid AI Team map");
  const result: Record<string, string> = {};
  for (const [nodeId, value] of Object.entries(raw)) {
    if (!NODE_ID.test(nodeId) || typeof value !== "string" || !valuePattern.test(value)) {
      throw new Error("Invalid AI Team map entry");
    }
    result[nodeId] = value;
  }
  return result;
}

function parseRoutes(raw: unknown): Record<string, AiTeamRouteRecord> {
  if (!isRecord(raw)) throw new Error("Invalid AI Team routes");
  const result: Record<string, AiTeamRouteRecord> = {};
  for (const [nodeId, candidate] of Object.entries(raw)) {
    if (!NODE_ID.test(nodeId) || !isRecord(candidate)) throw new Error("Invalid AI Team route");
    const cost = candidate["blendedCostMicrosPerMillion"];
    if (
      typeof candidate["providerId"] !== "string" ||
      typeof candidate["modelId"] !== "string" ||
      typeof candidate["reason"] !== "string" ||
      typeof candidate["priceKnown"] !== "boolean" ||
      (cost !== null && (!Number.isSafeInteger(cost) || (cost as number) < 0))
    ) {
      throw new Error("Invalid AI Team route fields");
    }
    result[nodeId] = candidate as unknown as AiTeamRouteRecord;
  }
  return result;
}

function parseMerge(raw: unknown, nodeId: string): AiTeamMergeRecord {
  if (!isRecord(raw) || !Array.isArray(raw["conflicts"])) throw new Error("Invalid AI Team merge");
  const states = ["idle", "queued", "merging", "review", "conflict", "completed"];
  if (!states.includes(raw["state"] as string)) throw new Error("Invalid AI Team merge state");
  const combined = raw["combinedTaskId"];
  if (combined !== null && (typeof combined !== "string" || !TASK_ID.test(combined))) {
    throw new Error("Invalid combined task id");
  }
  const conflicts = raw["conflicts"].map((path) =>
    createFileClaim({ nodeId, path: path as string, scope: "file" }).path,
  );
  return { state: raw["state"] as AiTeamMergeRecord["state"], combinedTaskId: combined, conflicts };
}

function parseBase(raw: unknown): AiSandboxBaseRecord | null {
  if (raw === null) return null;
  if (!isRecord(raw)) throw new Error("Invalid AI Team base");
  const sizeBytes = raw["sizeBytes"];
  if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) < 0) {
    throw new Error("Invalid AI Team base size");
  }
  if (raw["kind"] === "shadow-base") return { kind: "shadow-base", sizeBytes: sizeBytes as number };
  if (
    raw["kind"] === "git-revision" &&
    typeof raw["revision"] === "string" &&
    /^[a-f0-9]{40,64}$/i.test(raw["revision"])
  ) {
    if (sizeBytes !== 0) throw new Error("Git Team bases do not reserve copied storage");
    return { kind: "git-revision", revision: raw["revision"], sizeBytes: 0 };
  }
  throw new Error("Invalid AI Team base");
}

function parseTeam(raw: unknown): AiTeamRecord | null {
  try {
    if (!isRecord(raw) || typeof raw["id"] !== "string" || !TEAM_ID.test(raw["id"])) return null;
    if (typeof raw["workspaceId"] !== "string" || typeof raw["workspaceRoot"] !== "string") return null;
    const plan = createTeamPlan(raw["plan"] as unknown as TeamPlan);
    if (plan.id !== raw["id"] || raw["workspaceId"] !== workspaceIdentity(raw["workspaceRoot"])) return null;
    const state = raw["state"] as AiTeamState;
    if (!TEAM_STATES.has(state)) return null;
    const confirmedAt = raw["confirmedAt"];
    if (confirmedAt !== null && typeof confirmedAt !== "number") return null;
    if (state !== "configured" && state !== "cancelled" && confirmedAt === null) return null;
    const nodeForPaths = plan.nodes[0]?.id;
    if (nodeForPaths === undefined) return null;
    const nodeIds = new Set(plan.nodes.map((node) => node.id));
    const roleIds = new Set(plan.roles.map((role) => role.id));
    const createdAt = validTime(raw["createdAt"] as number);
    const updatedAt = validTime(raw["updatedAt"] as number, createdAt);
    const claims = validateFileClaims(raw["claims"] as FileClaim[]);
    const handoffs = (raw["handoffs"] as TeamHandoff[]).map(createTeamHandoff);
    const childTaskIds = parseStringMap(raw["childTaskIds"], TASK_ID);
    const routes = parseRoutes(raw["routes"]);
    const budget = validateTeamBudgetLedger(raw["budget"]);
    const base = parseBase(raw["base"]);
    if (
      claims.some((claim) => !nodeIds.has(claim.nodeId)) ||
      handoffs.some((handoff) => !nodeIds.has(handoff.nodeId)) ||
      new Set(handoffs.map((handoff) => handoff.nodeId)).size !== handoffs.length ||
      Object.keys(childTaskIds).some((roleId) => !roleIds.has(roleId)) ||
      Object.keys(routes).some((nodeId) => !nodeIds.has(nodeId)) ||
      Object.keys(budget.agentTokenLimits).some((nodeId) => !nodeIds.has(nodeId)) ||
      (state === "configured" && (confirmedAt !== null || base !== null))
    ) {
      return null;
    }
    return {
      id: raw["id"],
      workspaceId: raw["workspaceId"],
      workspaceRoot: validRoot(raw["workspaceRoot"]),
      state,
      plan,
      graph: parseGraph(raw["graph"], plan),
      claims,
      handoffs,
      budget,
      childTaskIds,
      routes,
      merge: parseMerge(raw["merge"], nodeForPaths),
      base,
      confirmedAt: confirmedAt === null ? null : validTime(confirmedAt as number, createdAt),
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export type AiTeamTraceKind = "state" | "agent" | "budget" | "claim" | "handoff" | "route" | "merge" | "error";

export interface AiTeamTrace {
  readonly id: string;
  readonly teamId: string;
  readonly nodeId: string | null;
  readonly at: number;
  readonly kind: AiTeamTraceKind;
  readonly summary: string;
  readonly detail: string;
  readonly outcome: "pending" | "ok" | "blocked" | "failed";
}

const TRACE_KINDS = new Set<AiTeamTraceKind>([
  "state",
  "agent",
  "budget",
  "claim",
  "handoff",
  "route",
  "merge",
  "error",
]);
const TRACE_OUTCOMES = new Set(["pending", "ok", "blocked", "failed"]);

function redact(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 8_000);
}

function parseTrace(raw: unknown): AiTeamTrace | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw["id"] !== "string" ||
    raw["id"].length === 0 ||
    typeof raw["teamId"] !== "string" ||
    !TEAM_ID.test(raw["teamId"]) ||
    (raw["nodeId"] !== null && (typeof raw["nodeId"] !== "string" || !NODE_ID.test(raw["nodeId"]))) ||
    !TRACE_KINDS.has(raw["kind"] as AiTeamTraceKind) ||
    !TRACE_OUTCOMES.has(raw["outcome"] as string) ||
    typeof raw["summary"] !== "string" ||
    raw["summary"].trim().length === 0 ||
    typeof raw["detail"] !== "string" ||
    typeof raw["at"] !== "number" ||
    !Number.isFinite(raw["at"])
  ) {
    return null;
  }
  return {
    id: raw["id"].slice(0, 160),
    teamId: raw["teamId"],
    nodeId: raw["nodeId"] as string | null,
    at: raw["at"],
    kind: raw["kind"] as AiTeamTraceKind,
    summary: redact(raw["summary"].trim()).slice(0, 500),
    detail: redact(raw["detail"]),
    outcome: raw["outcome"] as AiTeamTrace["outcome"],
  };
}

export interface AiTeamStore {
  save(record: AiTeamRecord): Promise<void>;
  read(id: string): Promise<AiTeamRecord | null>;
  list(workspaceId: string): Promise<AiTeamRecord[]>;
  listAll(): Promise<AiTeamRecord[]>;
  recoverActive(now: number): Promise<AiTeamRecord[]>;
  appendTrace(trace: AiTeamTrace): Promise<void>;
  traces(teamId: string): Promise<AiTeamTrace[]>;
}

export function createAiTeamStore(userDataDirectory: string): AiTeamStore {
  const root = join(userDataDirectory, "ai-teams");
  const folder = (id: string): string => join(root, id);
  const file = (id: string): string => join(folder(id), "team.json");

  async function read(id: string): Promise<AiTeamRecord | null> {
    if (!TEAM_ID.test(id)) return null;
    try {
      return parseTeam(JSON.parse(await readFile(file(id), "utf8")));
    } catch {
      return null;
    }
  }

  async function all(): Promise<AiTeamRecord[]> {
    try {
      const names = await readdir(root);
      const records = await Promise.all(names.filter((name) => TEAM_ID.test(name)).map(read));
      return records.filter((record): record is AiTeamRecord => record !== null);
    } catch {
      return [];
    }
  }

  return {
    async save(record): Promise<void> {
      const validated = parseTeam(record);
      if (validated === null || validated.id !== record.id) throw new Error("Invalid AI Team record");
      const targetFolder = folder(record.id);
      const target = file(record.id);
      const temporary = `${target}.tmp`;
      await mkdir(targetFolder, { recursive: true });
      await writeFile(temporary, JSON.stringify(validated, null, 2), "utf8");
      await rename(temporary, target);
    },
    read,
    async list(workspaceId): Promise<AiTeamRecord[]> {
      return (await all())
        .filter((record) => record.workspaceId === workspaceId)
        .sort((first, second) => second.updatedAt - first.updatedAt || second.createdAt - first.createdAt);
    },
    async listAll(): Promise<AiTeamRecord[]> {
      return (await all()).sort(
        (first, second) => second.updatedAt - first.updatedAt || second.createdAt - first.createdAt,
      );
    },
    async recoverActive(now): Promise<AiTeamRecord[]> {
      const recovered: AiTeamRecord[] = [];
      for (const record of await all()) {
        if (!["preparing", "running", "merging"].includes(record.state)) continue;
        const recoveredAt = Math.max(now, record.updatedAt, record.graph.updatedAt);
        const paused = {
          ...record,
          state: "paused" as const,
          graph: pauseRunningTeamNodes(record.graph, recoveredAt),
          updatedAt: recoveredAt,
        };
        await this.save(paused);
        recovered.push(paused);
      }
      return recovered;
    },
    async appendTrace(trace): Promise<void> {
      const validated = parseTrace(trace);
      if (validated === null) throw new Error("Invalid AI Team trace");
      const team = await read(validated.teamId);
      if (
        team === null ||
        (validated.nodeId !== null && !team.plan.nodes.some((node) => node.id === validated.nodeId))
      ) {
        throw new Error("AI Team trace lane was not found");
      }
      const target = folder(trace.teamId);
      await mkdir(target, { recursive: true });
      await appendFile(join(target, "trace.jsonl"), `${JSON.stringify(validated)}\n`, "utf8");
    },
    async traces(teamId): Promise<AiTeamTrace[]> {
      if (!TEAM_ID.test(teamId)) return [];
      try {
        const events: AiTeamTrace[] = [];
        for (const line of (await readFile(join(folder(teamId), "trace.jsonl"), "utf8")).split("\n")) {
          if (line.trim().length === 0) continue;
          try {
            const event = parseTrace(JSON.parse(line));
            if (event !== null && event.teamId === teamId) events.push(event);
          } catch {
            // A crash can leave only the final append incomplete.
          }
        }
        return events;
      } catch {
        return [];
      }
    },
  };
}
