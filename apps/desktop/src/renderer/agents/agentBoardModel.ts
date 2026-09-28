/**
 * The Agents board as data: which column each run sits in, what its box says, which buttons
 * it offers. Pure - no DOM, no IPC - so every state a run can reach is tested without a window.
 *
 * A run is a Team plan, solo or not (see `packages/ai/src/team.ts`). Its box state comes from
 * the run's own state plus, once it has produced one, the combined change it offers for review:
 * the run says "review", and the change says whether that review was applied, undone or thrown
 * away.
 */
import type { AiTeamView, AiWorkspaceTaskView } from "../../shared/api.ts";
import type { RiskFlag, RiskKind, RunCheck } from "../../shared/runEvidence.ts";

export type BoxStatus =
  | "queued"
  | "running"
  | "merging"
  | "configured"
  | "ready"
  | "applied"
  | "conflict"
  | "failed"
  | "budget"
  | "paused"
  | "cancelled"
  | "completed"
  | "discarded"
  | "rolled-back";

export type BoxColumn = "working" | "needs-you" | "ready" | "finished";

export type BoxAction =
  | "stop"
  | "start"
  | "review"
  | "apply"
  | "apply-continue"
  | "discard"
  | "undo"
  | "continue"
  | "resolve"
  | "retry"
  | "open-chat"
  | "raise-cap"
  | "resume"
  | "connect"
  | "rethink"
  | "compare";

export interface BoxModel {
  /** The run's id, or "main-chat" for the conversation's own turn. */
  readonly id: string;
  readonly kind: "solo" | "team" | "chat";
  readonly title: string;
  readonly agentLabel: string;
  readonly modelLabel: string;
  readonly status: BoxStatus;
  readonly column: BoxColumn;
  /** One line: what it is doing now, or why it stopped. */
  readonly statusText: string;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly files: number;
  readonly usage: string;
  /** Null when the price is unknown - never a made-up $0.00. */
  readonly cost: string | null;
  readonly costMicros: number;
  readonly actions: readonly BoxAction[];
  /** Agent profile ids, for mascots. */
  readonly roleIds: readonly string[];
  readonly combinedTaskId: string | null;
  /** The race this run is a lane of, and its place in it ("Race · 2 of 3"). */
  readonly group: string | null;
  readonly raceLabel: string | null;
  /** Things to know before acting, such as another live run editing the same file. */
  readonly warnings: readonly string[];
}

export type Board = Readonly<Record<BoxColumn, readonly BoxModel[]>>;

const COLUMN: Readonly<Record<BoxStatus, BoxColumn>> = {
  queued: "working",
  running: "working",
  merging: "working",
  configured: "needs-you",
  conflict: "needs-you",
  failed: "needs-you",
  budget: "needs-you",
  paused: "needs-you",
  ready: "ready",
  applied: "finished",
  completed: "finished",
  cancelled: "finished",
  discarded: "finished",
  "rolled-back": "finished",
};

export function columnFor(status: BoxStatus): BoxColumn {
  return COLUMN[status];
}

function budgetSpent(team: AiTeamView): boolean {
  const { usedTokens, reservedTokens, tokenLimit, usedCostMicros, reservedCostMicros, costMicrosLimit } = team.budget;
  return usedTokens + reservedTokens >= tokenLimit || (costMicrosLimit > 0 && usedCostMicros + reservedCostMicros >= costMicrosLimit);
}

export function runStatus(team: AiTeamView, combined: AiWorkspaceTaskView | null): BoxStatus {
  switch (team.state) {
    case "configured":
      return "configured";
    case "preparing":
      return "running";
    case "running":
      // Nothing of its own running yet: it is waiting for a free slot.
      return team.nodes.some((node) => node.state === "running") ? "running" : "queued";
    case "merging":
      return "merging";
    case "paused":
      return budgetSpent(team) ? "budget" : "paused";
    case "review":
      if (combined?.state === "applied") return "applied";
      if (combined?.state === "conflict") return "conflict";
      if (combined?.state === "discarded") return "discarded";
      if (combined?.state === "rolled-back") return "rolled-back";
      return "ready";
    case "conflict":
      return "conflict";
    case "completed":
      if (combined?.state === "rolled-back") return "rolled-back";
      if (combined?.state === "applied") return "applied";
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function agentBoxActions(status: BoxStatus, kind: "solo" | "team"): readonly BoxAction[] {
  const solo = kind === "solo";
  switch (status) {
    case "queued":
    case "running":
    case "merging":
      return ["stop"];
    case "configured":
      return ["start", "stop"];
    case "ready":
      return solo ? ["review", "apply", "apply-continue", "discard"] : ["review", "apply", "discard"];
    case "applied":
      return solo ? ["continue", "undo"] : ["undo"];
    case "conflict":
      return ["resolve"];
    case "failed":
      return solo ? ["retry", "open-chat"] : ["open-chat"];
    case "budget":
      return ["raise-cap", "stop"];
    case "paused":
      return ["resume", "stop"];
    case "completed":
      return solo ? ["continue", "open-chat"] : ["open-chat"];
    case "cancelled":
    case "discarded":
    case "rolled-back":
      return solo ? ["retry"] : [];
  }
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return String(value);
}

export function formatCost(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "").trim();
}

function statusText(team: AiTeamView, status: BoxStatus, files: number): string {
  const latest = Object.values(team.activity).sort((a, b) => b.at - a.at)[0]?.text;
  const summary = firstLine(team.handoffs[team.handoffs.length - 1]?.summary ?? "");
  const plural = `${files} file${files === 1 ? "" : "s"}`;
  switch (status) {
    case "queued": return "Waiting for a free slot";
    case "running": return team.state === "preparing" ? "Preparing an isolated copy of the project" : (latest ?? "Starting");
    case "merging": return "Putting the changes together";
    case "configured": return "Ready to start - check the plan";
    case "ready": return files > 0 ? `${plural} changed - ready to review` : summary || "Ready to review";
    case "applied": return files > 0 ? `Applied ${plural} - Undo puts them back` : "Applied";
    case "conflict": return "Clashes with other changes - needs you";
    case "failed": return team.nodes.find((node) => node.failure !== null)?.failure ?? "Stopped with an error";
    case "budget": return "Stopped at your cost cap";
    case "paused": return "Paused when ADCode closed - resume when ready";
    case "completed": return summary || "Finished with no file changes";
    case "cancelled": return "Stopped";
    case "discarded": return "Discarded - your project was not changed";
    case "rolled-back": return "Undone - your project is back as it was";
  }
}

/** A run with no cost cap carries the largest limit main accepts. */
const NO_CAP_MICROS = 1_000_000_000_000;

/** The stuck guard stopped this run: trying the same way again would get stuck again. */
function stuckFailure(team: AiTeamView): boolean {
  return team.nodes.some((node) => node.failure?.startsWith("Stuck:") === true);
}

/** A failure whose fix is connecting a model, not trying the same thing again. */
const NEEDS_CONNECTION = /no connection for|no api key|^connect [^ ]+ before starting/i;

function needsConnection(team: AiTeamView): boolean {
  return team.nodes.some((node) => node.failure !== null && NEEDS_CONNECTION.test(node.failure));
}

function boxFor(team: AiTeamView, tasks: ReadonlyMap<string, AiWorkspaceTaskView>): BoxModel {
  const combined = team.merge.combinedTaskId === null ? null : (tasks.get(team.merge.combinedTaskId) ?? null);
  const status = runStatus(team, combined);
  const files = combined !== null
    ? combined.changedPaths.length
    : new Set(team.handoffs.flatMap((handoff) => handoff.changedPaths)).size;
  const solo = team.kind === "solo";
  const firstNode = team.nodes[0];
  const role = team.roles.find((candidate) => candidate.id === firstNode?.roleId) ?? team.roles[0];
  const route = firstNode === undefined ? undefined : team.routes[firstNode.id];
  const costMicros = team.budget.usedCostMicros;
  return {
    id: team.id,
    kind: solo ? "solo" : "team",
    title: solo ? (firstNode?.title ?? firstLine(team.prompt)) : firstLine(team.prompt),
    agentLabel: solo ? (role?.label ?? "Agent") : `Team of ${team.roles.length}`,
    modelLabel: route?.modelId ?? role?.route?.model ?? "",
    status,
    column: columnFor(status),
    statusText: status === "failed" && needsConnection(team)
      ? "Connect a model to run this, then press Run again"
      : status === "ready" && team.hold !== null
        ? `Held for your review: ${team.hold}`
        : statusText(team, status, files),
    startedAt: team.confirmedAt ?? team.createdAt,
    updatedAt: team.updatedAt,
    files,
    // Nothing spent yet is not worth a line; the first request fills it in.
    usage: team.budget.usedTokens > 0 ? `${compact(team.budget.usedTokens)} tokens` : "",
    cost: costMicros <= 0 ? null : team.budget.costMicrosLimit < NO_CAP_MICROS ? `${formatCost(costMicros)} of ${formatCost(team.budget.costMicrosLimit)}` : formatCost(costMicros),
    costMicros,
    actions: status === "failed" && needsConnection(team)
      ? ["connect", ...agentBoxActions(status, solo ? "solo" : "team")]
      : status === "failed" && stuckFailure(team)
        ? ["rethink", "open-chat"]
        : agentBoxActions(status, solo ? "solo" : "team"),
    roleIds: team.roles.map((candidate) => candidate.id),
    combinedTaskId: team.merge.combinedTaskId,
    group: team.group,
    raceLabel: null,
    warnings: [],
  };
}

/**
 * Race lanes: label each lane by its place, and offer Compare on the ready lanes only once no
 * lane is still working - comparing two finished lanes while a third races on would pick a
 * winner early. A lane is never applied on its own; Keep this one in Compare does that.
 */
function withRaces(boxes: readonly BoxModel[]): BoxModel[] {
  const groups = new Map<string, BoxModel[]>();
  for (const box of boxes) if (box.group !== null) groups.set(box.group, [...(groups.get(box.group) ?? []), box]);
  const updated = new Map<string, BoxModel>();
  for (const lanes of groups.values()) {
    const ordered = [...lanes].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
    const allDone = ordered.every((lane) => lane.column !== "working" && lane.status !== "configured");
    ordered.forEach((lane, index) => {
      updated.set(lane.id, {
        ...lane,
        raceLabel: `Race · ${index + 1} of ${ordered.length}`,
        actions: lane.status === "ready" ? (allDone ? ["compare", "review", "discard"] : ["review", "discard"]) : lane.actions,
      });
    });
  }
  return boxes.map((box) => updated.get(box.id) ?? box);
}

/** Two live runs editing the same file: each box says so before their work collides. */
function withCollisions(boxes: readonly BoxModel[], teams: readonly AiTeamView[]): BoxModel[] {
  const touched = new Map(teams.map((team) => [team.id, team.touchedPaths]));
  const live = boxes.filter((box) => box.kind !== "chat" && (box.column === "working" || box.column === "ready"));
  const byPath = new Map<string, BoxModel[]>();
  for (const box of live) for (const path of touched.get(box.id) ?? []) byPath.set(path, [...(byPath.get(path) ?? []), box]);
  const warnings = new Map<string, string[]>();
  for (const [path, owners] of byPath) {
    if (owners.length < 2) continue;
    for (const box of owners) {
      for (const other of owners) {
        if (other.id === box.id) continue;
        const list = warnings.get(box.id) ?? [];
        if (list.length < 3) list.push(`Also edited by ${other.agentLabel} (${other.title}): ${path}`);
        warnings.set(box.id, list);
      }
    }
  }
  return boxes.map((box) => (warnings.has(box.id) ? { ...box, warnings: warnings.get(box.id)! } : box));
}

export interface EvidenceChip {
  readonly tone: "ok" | "fail" | "warn" | "more";
  readonly text: string;
  readonly title: string;
}

const RISK_SHORT: Readonly<Record<RiskKind, string>> = {
  secret: "Possible secret",
  "tests-removed": "Tests removed",
  sensitive: "Sign-in or payment code",
  dependencies: "Dependencies changed",
  large: "Large change",
};

/**
 * Proof of work as a handful of chips: failures first, then the serious risks, then what
 * passed, then the minor notes. Four fit on a box; the rest fold into "+N".
 */
export function evidenceChips(checks: readonly RunCheck[], risks: readonly RiskFlag[]): EvidenceChip[] {
  const risk = (kinds: readonly RiskKind[]): EvidenceChip[] => kinds.flatMap((kind) => risks.filter((flag) => flag.kind === kind).map((flag) => ({ tone: "warn" as const, text: RISK_SHORT[kind], title: flag.text })));
  const all: EvidenceChip[] = [
    ...checks.filter((check) => !check.ok).map((check) => ({ tone: "fail" as const, text: `${check.command} failed`, title: `${check.command} failed` })),
    ...risk(["secret", "tests-removed", "sensitive"]),
    ...checks.filter((check) => check.ok).map((check) => ({ tone: "ok" as const, text: check.command, title: `${check.command} passed` })),
    ...risk(["dependencies", "large"]),
  ];
  if (all.length <= 4) return all;
  const rest = all.slice(4);
  return [...all.slice(0, 4), { tone: "more", text: `+${rest.length}`, title: rest.map((chip) => chip.title).join("\n") }];
}

function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

export function buildBoard(input: {
  readonly teams: readonly AiTeamView[];
  readonly tasks: readonly AiWorkspaceTaskView[];
  readonly chat: { readonly streaming: boolean; readonly title: string };
  readonly now: number;
}): Board {
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  const today = startOfDay(input.now);
  const board: Record<BoxColumn, BoxModel[]> = { working: [], "needs-you": [], ready: [], finished: [] };
  const boxes = withCollisions(withRaces(input.teams.map((team) => boxFor(team, tasks))), input.teams);
  for (const box of boxes) {
    if (box.column === "finished" && box.updatedAt < today) continue;
    board[box.column].push(box);
  }
  // Working reads as a queue, oldest first; everything else as news, newest first.
  board.working.sort((a, b) => a.startedAt - b.startedAt);
  for (const column of ["needs-you", "ready", "finished"] as const) board[column].sort((a, b) => b.updatedAt - a.updatedAt);
  if (input.chat.streaming) {
    board.working.unshift({
      id: "main-chat",
      kind: "chat",
      title: input.chat.title.trim() || "Main chat",
      agentLabel: "Main chat",
      modelLabel: "",
      status: "running",
      column: "working",
      statusText: "Replying",
      startedAt: input.now,
      updatedAt: input.now,
      files: 0,
      usage: "",
      cost: null,
      costMicros: 0,
      actions: ["open-chat"],
      roleIds: [],
      combinedTaskId: null,
      group: null,
      raceLabel: null,
      warnings: [],
    });
  }
  return board;
}

export function boardSummary(board: Board): string {
  const working = board.working.length;
  const needs = board["needs-you"].length;
  const micros = [...board.working, ...board["needs-you"], ...board.ready, ...board.finished].reduce((sum, box) => sum + box.costMicros, 0);
  const parts: string[] = [];
  if (working > 0) parts.push(`${working} working`);
  if (needs > 0) parts.push(`${needs} need${needs === 1 ? "s" : ""} you`);
  if (micros > 0) parts.push(`${formatCost(micros)} today`);
  return parts.length === 0 ? "Nothing running" : parts.join(" · ");
}
