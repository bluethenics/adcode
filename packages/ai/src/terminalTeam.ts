/**
 * Running one Team plan across several terminal panes, each holding a different agent CLI.
 *
 * The Assistant's Team mode drives sandboxed workspaces through a provider stream, so it
 * can count tokens, reserve budget and merge a diff at the end. None of that is available
 * here: an external CLI bills against its own subscription, writes straight into the real
 * working tree, and reports progress as characters on a pty. Bolting those panes into the
 * budgeted coordinator would mean lying about every number it prints.
 *
 * So this is a second, smaller engine that shares the part worth sharing - the plan and its
 * dependency graph, from `teamGraph.ts` - and answers only the three questions a terminal
 * team actually has:
 *
 *   1. which nodes may start right now, and in which pane
 *   2. what text to type into that pane
 *   3. when the agent in that pane has finished
 *
 * Pure, so all three are tested against strings and structures rather than by starting
 * eight copies of somebody's CLI.
 */
import { type AgentId } from "./agents.ts";
import { createTeamPlan, type TeamPlan } from "./team.ts";

import {
  completeTeamNode,
  createTeamGraph,
  failTeamNode,
  readyTeamNodes,
  startTeamNode,
  teamGraphState,
  teamNodeContext,
  type TeamGraph,
  type TeamHandoff,
  type TeamNodeContext,
} from "./teamGraph.ts";

/** Re-exported so the renderer needs one import from this package, not three. */
export type { TeamPlan, TeamPlanNode, TeamRole } from "./team.ts";
export type { TeamGraphNode, TeamNodeContext, TeamNodeState } from "./teamGraph.ts";

/** Which CLI takes a role. One agent per role, because a role is one lane of work. */
export interface TerminalTeamAssignment {
  readonly roleId: string;
  readonly agentId: AgentId;
}

/** A node that has been handed to a pane and not yet finished. */
export interface TerminalTeamRun {
  readonly nodeId: string;
  readonly roleId: string;
  readonly agentId: AgentId;
  readonly paneId: number;
  readonly startedAt: number;
}

export interface TerminalTeam {
  readonly id: string;
  readonly plan: TeamPlan;
  readonly graph: TeamGraph;
  readonly assignments: readonly TerminalTeamAssignment[];
  readonly running: readonly TerminalTeamRun[];
  /**
   * What each finished node reported, so the next node can be told about it.
   *
   * An external CLI does not produce the structured handoff the Assistant's Team engine
   * gets from its own agents - all that arrives is text on a pty. So a terminal handoff
   * carries the one honest field: whatever the CLI said last. Everything else stays empty
   * rather than being invented, because a fabricated "tests: passed" is worse than none.
   */
  readonly handoffs: readonly TeamHandoff[];
  readonly updatedAt: number;
}

/** One node the caller should now start, with the agent that should receive it. */
export interface TerminalTeamDispatch {
  readonly nodeId: string;
  readonly roleId: string;
  readonly agentId: AgentId;
}

const TEAM_ID = /^[a-z][a-z0-9-]{2,63}$/;

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

/**
 * Bind a plan to a set of CLIs.
 *
 * Every role must be assigned. A half-assigned team would run until it reached the first
 * unassigned role and then stall with no way to say why, which is worse than refusing now.
 */
export function createTerminalTeam(
  id: string,
  plan: TeamPlan,
  assignments: readonly TerminalTeamAssignment[],
  now: number,
): TerminalTeam {
  if (!TEAM_ID.test(id)) throw new Error("Invalid terminal team id");
  timestamp(now, "terminal team timestamp");

  const byRole = new Map<string, AgentId>();
  for (const assignment of assignments) {
    if (!plan.roles.some((role) => role.id === assignment.roleId)) {
      throw new Error(`Terminal team has no role ${assignment.roleId}`);
    }
    if (byRole.has(assignment.roleId)) throw new Error("Terminal team role is assigned twice");
    byRole.set(assignment.roleId, assignment.agentId);
  }
  for (const role of plan.roles) {
    if (!byRole.has(role.id)) throw new Error(`Terminal team role ${role.id} has no agent`);
  }

  return {
    id,
    plan,
    graph: createTeamGraph(plan, now),
    assignments: [...assignments],
    running: [],
    handoffs: [],
    updatedAt: now,
  };
}

/**
 * The shape a terminal team takes: build it, then check it, document it, and review it.
 *
 * The Assistant's Team mode asks a model to propose roles. That is the right answer there,
 * where a model is already in the loop and paid for. Here the whole point is that the
 * models are in the terminal and have not been started yet - asking one to plan the work
 * would mean picking a favourite CLI to be the planner, and making the feature useless to
 * anyone whose key is only for the others.
 *
 * So the division is fixed and declared, which is also the division that actually holds up:
 * one agent writes it, a second checks it against tests it did not write, a third documents
 * it, and a fourth reviews the lot. Every role after the first waits for the build, because
 * there is nothing to test, document, or review until it exists.
 */
const TERMINAL_TEAM_ROLES = [
  {
    id: "build",
    label: "Build",
    objective: "Make the change itself.",
    title: "Make the change",
    dependsOn: [] as string[],
    criterion: "The change is complete and the project still builds.",
  },
  {
    id: "check",
    label: "Tests",
    objective: "Prove the change works, with tests you write yourself.",
    title: "Test the change",
    dependsOn: ["build"],
    criterion: "There are tests covering the change, and they pass.",
  },
  {
    id: "document",
    label: "Docs",
    objective: "Write down what changed, for the people who will use it.",
    title: "Document the change",
    dependsOn: ["build"],
    criterion: "The documentation describes the change as a user would meet it.",
  },
  {
    id: "review",
    label: "Review",
    objective: "Read the finished work and report what is wrong with it.",
    title: "Review the change",
    dependsOn: ["build", "check"],
    criterion: "Every problem found is either fixed or written down.",
  },
] as const;

/** The most CLIs one terminal team can use, fixed by `createTeamPlan`'s four-role limit. */
export const MAX_TERMINAL_TEAM_AGENTS = TERMINAL_TEAM_ROLES.length;

export interface TerminalTeamPlanDraft {
  readonly plan: TeamPlan;
  readonly assignments: readonly TerminalTeamAssignment[];
}

/**
 * Turn "what do you want done" plus "which CLIs" into a plan ready to run.
 *
 * Agents are taken in the order given, so the first one picked writes the code. Duplicates
 * are rejected rather than quietly merged: two roles pointing at one CLI would have that
 * CLI briefed twice in two panes on overlapping work, which is the one thing this whole
 * feature exists to avoid.
 */
export function buildTerminalTeamPlan(
  id: string,
  prompt: string,
  agents: readonly AgentId[],
): TerminalTeamPlanDraft {
  const task = prompt.trim();
  if (task.length === 0) throw new Error("A terminal team needs a task");
  if (agents.length < 2) throw new Error("A terminal team needs at least two agent CLIs");
  if (agents.length > MAX_TERMINAL_TEAM_AGENTS) {
    throw new Error(`A terminal team can use at most ${MAX_TERMINAL_TEAM_AGENTS} agent CLIs`);
  }
  if (new Set(agents).size !== agents.length) {
    throw new Error("Each agent CLI can take only one role");
  }

  const used = TERMINAL_TEAM_ROLES.slice(0, agents.length);
  const present = new Set<string>(used.map((role) => role.id));

  return {
    plan: createTeamPlan({
      id,
      prompt: task,
      acceptanceCriteria: [`The task is done: ${task}`],
      roles: used.map((role) => ({ id: role.id, label: role.label, objective: role.objective })),
      nodes: used.map((role) => ({
        id: role.id,
        title: role.title,
        objective: `${role.objective} The task is: ${task}`,
        roleId: role.id,
        // A three-agent team has no `check` node, so `review` cannot wait for one.
        dependsOn: role.dependsOn.filter((dependency) => present.has(dependency)),
        acceptanceCriteria: [role.criterion],
        fileHints: [],
      })),
      concurrency: Math.min(agents.length, 4),
    }),
    assignments: used.map((role, index) => ({ roleId: role.id, agentId: agents[index]! })),
  };
}

export function terminalTeamAgent(team: TerminalTeam, roleId: string): AgentId {
  const assignment = team.assignments.find((candidate) => candidate.roleId === roleId);
  if (assignment === undefined) throw new Error(`Terminal team role ${roleId} has no agent`);
  return assignment.agentId;
}

/**
 * The nodes that may start now, newest dependencies satisfied and concurrency respected.
 *
 * Concurrency counts panes in flight, not nodes in the plan: two ready nodes on a plan with
 * `concurrency: 1` means one starts and the other waits, which is the whole point of the
 * setting. A node already running is never offered twice.
 */
export function nextTerminalTeamDispatch(team: TerminalTeam): TerminalTeamDispatch[] {
  const free = team.plan.concurrency - team.running.length;
  if (free <= 0) return [];
  const busy = new Set(team.running.map((run) => run.nodeId));
  return readyTeamNodes(team.graph)
    .filter((node) => !busy.has(node.id))
    .slice(0, free)
    .map((node) => ({
      nodeId: node.id,
      roleId: node.roleId,
      agentId: terminalTeamAgent(team, node.roleId),
    }));
}

/** Record that a pane has been given a node. */
export function startTerminalTeamNode(
  team: TerminalTeam,
  nodeId: string,
  paneId: number,
  now: number,
): TerminalTeam {
  timestamp(now, "terminal team start time");
  if (!Number.isSafeInteger(paneId) || paneId < 0) throw new Error("Invalid terminal team pane");
  if (team.running.some((run) => run.nodeId === nodeId)) {
    throw new Error("Terminal team node is already running");
  }
  if (team.running.some((run) => run.paneId === paneId)) {
    throw new Error("Terminal team pane is already busy");
  }
  const node = team.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) throw new Error("Terminal team node was not found");

  return {
    ...team,
    graph: startTeamNode(team.graph, nodeId, now),
    running: [
      ...team.running,
      { nodeId, roleId: node.roleId, agentId: terminalTeamAgent(team, node.roleId), paneId, startedAt: now },
    ],
    updatedAt: now,
  };
}

/**
 * Finish a node, recording what its CLI said last as the handoff for whatever depends on it.
 *
 * `summary` is the tail of that pane's output. It is trimmed to something a prompt can carry
 * and never parsed - the next agent is a language model, and the last thing its predecessor
 * printed is genuinely the most useful sentence available.
 */
export function completeTerminalTeamNode(
  team: TerminalTeam,
  nodeId: string,
  summary: string,
  now: number,
): TerminalTeam {
  timestamp(now, "terminal team completion time");
  const said = summary.trim().slice(0, 2_000);
  return {
    ...team,
    graph: completeTeamNode(team.graph, nodeId, now),
    running: team.running.filter((run) => run.nodeId !== nodeId),
    handoffs: [
      ...team.handoffs.filter((handoff) => handoff.nodeId !== nodeId),
      {
        nodeId,
        summary: said.length > 0 ? said : "Finished without saying anything further.",
        findings: [],
        decisions: [],
        changedPaths: [],
        tests: [],
        blockers: [],
        deadEnds: [],
        completedAt: now,
      },
    ],
    updatedAt: now,
  };
}

/**
 * The full brief for one node, including what its dependencies reported.
 *
 * Here rather than left to the caller so the renderer needs exactly one import from this
 * package - it must not reach for the barrel, which drags every provider SDK into a
 * browser bundle that cannot use them.
 */
export function terminalTeamNodeContext(team: TerminalTeam, nodeId: string): TeamNodeContext {
  return teamNodeContext(team.plan, nodeId, team.handoffs, []);
}

export function failTerminalTeamNode(
  team: TerminalTeam,
  nodeId: string,
  failure: string,
  now: number,
): TerminalTeam {
  timestamp(now, "terminal team failure time");
  return {
    ...team,
    graph: failTeamNode(team.graph, nodeId, failure, now),
    running: team.running.filter((run) => run.nodeId !== nodeId),
    updatedAt: now,
  };
}

/**
 * Fail a node that never got as far as a pane.
 *
 * The graph only lets a *running* node fail, which is the right rule for the Assistant's
 * Team engine - there, a node that has not started cannot have gone wrong. A terminal team
 * has one way to fall at that first hurdle: the panel refuses to open another pane. Leaving
 * such a node pending would stall the whole team on a pane that is never coming, so it is
 * moved through running and straight into failed, carrying the reason.
 */
export function abandonTerminalTeamNode(
  team: TerminalTeam,
  nodeId: string,
  failure: string,
  now: number,
): TerminalTeam {
  timestamp(now, "terminal team abandon time");
  const node = team.graph.nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) throw new Error("Terminal team node was not found");
  if (node.state === "running") return failTerminalTeamNode(team, nodeId, failure, now);

  return {
    ...team,
    graph: failTeamNode(startTeamNode(team.graph, nodeId, now), nodeId, failure, now),
    running: team.running.filter((run) => run.nodeId !== nodeId),
    updatedAt: now,
  };
}

export function terminalTeamState(team: TerminalTeam): "active" | "completed" | "failed" {
  return teamGraphState(team.graph);
}

/* ── What to type into the pane ──────────────────────────────────────────── */

/**
 * The marker an agent is asked to print when it has finished a node.
 *
 * Waiting for a quiet pty is the only completion signal available without cooperation, and
 * on its own it is a poor one: an agent that pauses to think looks exactly like an agent
 * that has stopped. Asking for one line of output costs nothing, works on every CLI that
 * can follow an instruction, and turns the quiet period from the primary signal into the
 * fallback for agents that ignore it.
 */
export const TERMINAL_TEAM_DONE = "ADCODE-TEAM-DONE";

/**
 * The marker counts only when it is the whole line.
 *
 * The brief itself contains the marker, in the sentence asking for it, and a pty echoes
 * back what was typed into it. Matching the marker anywhere in a line would therefore
 * complete every node the instant it was dispatched. Requiring the line to be nothing but
 * the marker and its node id is what separates the agent doing as it was asked from the
 * terminal repeating the request - and it is exactly what the brief asks for, so an agent
 * that follows the instruction is never missed.
 */
const DONE_LINE = new RegExp(`^\\s*${TERMINAL_TEAM_DONE}\\s+([a-z][a-z0-9-]{2,47})\\s*$`);

/**
 * The prompt for one node.
 *
 * Written as instructions to a person rather than as JSON: these go to eight different
 * CLIs, and the only interface all of them genuinely share is English on stdin.
 */
export function terminalTeamPrompt(context: TeamNodeContext): string {
  const lines = [
    `You are the ${context.role.label} on a team working on one task.`,
    "",
    `Overall task: ${context.taskPrompt}`,
    `Your role: ${context.role.objective}`,
    "",
    `Your piece of it (${context.node.id}): ${context.node.title}`,
    context.node.objective,
  ];

  if (context.node.acceptanceCriteria.length > 0) {
    lines.push("", "Done means all of:");
    for (const criterion of context.node.acceptanceCriteria) lines.push(`- ${criterion}`);
  }

  if (context.node.fileHints.length > 0) {
    lines.push("", `Start by looking at: ${context.node.fileHints.join(", ")}`);
  }

  if (context.claims.length > 0) {
    lines.push(
      "",
      `Only you are editing these paths, so do not wait for anyone: ${context.claims.map((claim) => claim.path).join(", ")}`,
    );
  }

  if (context.dependencies.length > 0) {
    lines.push("", "Work already finished by your teammates:");
    for (const handoff of context.dependencies) {
      lines.push(`- ${handoff.nodeId}: ${handoff.summary}`);
      for (const path of handoff.changedPaths) lines.push(`    changed ${path}`);
    }
  }

  lines.push(
    "",
    "Do not work on anything outside your piece - a teammate is doing the rest right now.",
    `When you are completely finished, print exactly this line and nothing after it: ${TERMINAL_TEAM_DONE} ${context.node.id}`,
  );

  return lines.join("\n");
}

/* ── Knowing when the pane is finished ───────────────────────────────────── */

export interface TerminalTeamWatcher {
  /** Feed raw pty output. Returns the node id an agent has just declared finished. */
  push(data: string): string | null;
  reset(): void;
}

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/**
 * Watch one pane for the completion marker.
 *
 * Line-buffered for the same reason the usage-limit reader is: a pty delivers whatever
 * fits in a read, and a marker split across two of them would otherwise never match.
 *
 * The echo of the prompt itself contains the marker, so the first occurrence is skipped.
 * Without that, every node would complete the instant it was dispatched.
 */
export function createTerminalTeamWatcher(): TerminalTeamWatcher {
  let partial = "";

  return {
    push(data) {
      const pieces = `${partial}${data.replace(ANSI, "")}`.replaceAll("\r", "\n").split("\n");
      partial = (pieces.pop() ?? "").slice(-1_000);
      for (const line of pieces) {
        const match = DONE_LINE.exec(line);
        if (match !== null) return match[1] ?? null;
      }
      return null;
    },
    reset() {
      partial = "";
    },
  };
}

/**
 * The fallback: an agent that never printed the marker but has gone quiet.
 *
 * Deliberately long, and deliberately requires the agent to have produced something first.
 * A CLI that takes ninety seconds to think is common; a CLI that has printed nothing for
 * five minutes after printing plenty has stopped.
 */
export const TERMINAL_TEAM_QUIET_MS = 5 * 60_000;

export function terminalTeamNodeIsQuiet(
  lastOutputAt: number | null,
  now: number,
  quietMs = TERMINAL_TEAM_QUIET_MS,
): boolean {
  if (lastOutputAt === null) return false;
  return now - lastOutputAt >= quietMs;
}
