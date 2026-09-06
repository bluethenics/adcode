/**
 * Driving a Team plan across real terminal panes.
 *
 * The decisions live in `@adcode/ai/terminalTeam`, which is pure. This is the part that has
 * to touch the world: open a pane, start somebody's CLI in it, type a brief, and watch the
 * output until that CLI says it is done. All of that reaches the panel through the port
 * below rather than through xterm directly, so the interesting behaviour - what happens
 * when two nodes are ready and one pane is free, when a CLI goes quiet, when the user stops
 * a team half way - is testable without starting a pty.
 */
import { agentCommand, type AgentId } from "@adcode/ai/agents";
import {
  TERMINAL_TEAM_QUIET_MS,
  completeTerminalTeamNode,
  createTerminalTeam,
  createTerminalTeamWatcher,
  abandonTerminalTeamNode,
  failTerminalTeamNode,
  nextTerminalTeamDispatch,
  startTerminalTeamNode,
  terminalTeamNodeContext,
  terminalTeamNodeIsQuiet,
  terminalTeamPrompt,
  terminalTeamState,
  type TeamPlan,
  type TerminalTeam,
  type TerminalTeamAssignment,
  type TerminalTeamWatcher,
} from "@adcode/ai/terminalTeam";

export interface TerminalTeamPort {
  /** Open a pane for a role and return its id. Rejects if no pane can be opened. */
  openPane(roleLabel: string): Promise<number>;
  /** Type a line into a pane and press return. */
  send(paneId: number, text: string): void;
  /** Give a pane a name the user can read in the tab strip. */
  label(paneId: number, title: string): void;
  notify(message: string): void;
  now(): number;
}

/** One row of the status the panel shows while a team runs. */
export interface TerminalTeamNodeStatus {
  readonly nodeId: string;
  readonly title: string;
  readonly roleLabel: string;
  readonly agentId: AgentId;
  readonly state: string;
  readonly paneId: number | null;
}

export interface TerminalTeamStatus {
  readonly id: string;
  readonly prompt: string;
  readonly state: "active" | "completed" | "failed";
  readonly nodes: readonly TerminalTeamNodeStatus[];
}

export interface TerminalTeamRunner {
  start(plan: TeamPlan, assignments: readonly TerminalTeamAssignment[]): Promise<void>;
  /** Feed one pane's pty output in. This is what advances the team. */
  observe(paneId: number, data: string): void;
  /** A pane's pty ended. Whatever it was working on did not finish. */
  paneClosed(paneId: number): void;
  /** Called on a timer, to catch a CLI that finished without printing the marker. */
  sweep(): void;
  stop(): void;
  status(): TerminalTeamStatus | null;
  isRunning(): boolean;
  onChanged(listener: () => void): () => void;
}

/** Per-pane bookkeeping the pure engine deliberately knows nothing about. */
interface PaneWatch {
  readonly watcher: TerminalTeamWatcher;
  lastOutputAt: number | null;
  tail: string;
}

const TAIL_LIMIT = 2_000;
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function createTerminalTeamRunner(port: TerminalTeamPort): TerminalTeamRunner {
  let team: TerminalTeam | null = null;
  const watches = new Map<number, PaneWatch>();
  const listeners = new Set<() => void>();
  let counter = 0;

  const changed = (): void => {
    for (const listener of listeners) listener();
  };

  /**
   * Hand every node that can start to a pane.
   *
   * Panes are opened one at a time and awaited: opening two at once races the panel's own
   * active-pane bookkeeping, and a team that starts by stealing focus twice looks broken
   * even when it is not.
   */
  async function pump(): Promise<void> {
    if (team === null) return;

    for (const dispatch of nextTerminalTeamDispatch(team)) {
      const role = team.plan.roles.find((candidate) => candidate.id === dispatch.roleId);
      const node = team.plan.nodes.find((candidate) => candidate.id === dispatch.nodeId);
      if (role === undefined || node === undefined) continue;

      let paneId: number;
      try {
        paneId = await port.openPane(role.label);
      } catch (error) {
        // No pane means this node cannot run at all. Failing it is what lets the rest of
        // the graph carry on rather than the whole team hanging on a pane that never came.
        team = abandonTerminalTeamNode(
          team,
          dispatch.nodeId,
          error instanceof Error ? error.message : "No terminal was available",
          port.now(),
        );
        changed();
        continue;
      }

      // The team may have been stopped while the pane was opening.
      if (team === null) return;

      const brief = terminalTeamPrompt(terminalTeamNodeContext(team, dispatch.nodeId));
      team = startTerminalTeamNode(team, dispatch.nodeId, paneId, port.now());
      watches.set(paneId, { watcher: createTerminalTeamWatcher(), lastOutputAt: null, tail: "" });

      port.label(paneId, `${role.label} · ${node.title}`);
      port.send(paneId, agentCommand(dispatch.agentId));
      port.send(paneId, brief);
      changed();
    }

    const state = terminalTeamState(team);
    if (state !== "active" && team.running.length === 0) {
      port.notify(
        state === "completed"
          ? "Every Team task finished."
          : "The Team stopped with tasks that could not be finished.",
      );
      changed();
    }
  }

  function finish(paneId: number, nodeId: string, summary: string): void {
    if (team === null) return;
    team = completeTerminalTeamNode(team, nodeId, summary, port.now());
    watches.delete(paneId);
    changed();
    void pump();
  }

  return {
    async start(plan, assignments) {
      if (team !== null) throw new Error("A Team is already running in the terminal");
      counter += 1;
      team = createTerminalTeam(`terminal-team-${counter}`, plan, assignments, port.now());
      changed();
      await pump();
    },

    observe(paneId, data) {
      const watch = watches.get(paneId);
      if (watch === undefined || team === null) return;

      watch.lastOutputAt = port.now();
      watch.tail = `${watch.tail}${data.replace(ANSI, "")}`.slice(-TAIL_LIMIT);

      const finished = watch.watcher.push(data);
      if (finished === null) return;

      // Only the node this pane was actually given. An agent that prints somebody else's
      // marker - by reading it out of a shared file, say - must not complete their work.
      const run = team.running.find((candidate) => candidate.paneId === paneId);
      if (run === undefined || run.nodeId !== finished) return;

      finish(paneId, finished, watch.tail);
    },

    paneClosed(paneId) {
      if (team === null) return;
      const run = team.running.find((candidate) => candidate.paneId === paneId);
      watches.delete(paneId);
      if (run === undefined) return;

      team = failTerminalTeamNode(team, run.nodeId, "The terminal was closed", port.now());
      port.notify(`${run.nodeId} stopped because its terminal was closed.`);
      changed();
      void pump();
    },

    /**
     * Catch a CLI that did the work and never printed the marker.
     *
     * Treated as finished rather than failed: the pane is still on screen with its output
     * in it, so the user can see what happened and the honest reading of "produced plenty,
     * then nothing for five minutes" is that it stopped. The notification says it was an
     * assumption so nobody mistakes it for the agent reporting success.
     */
    sweep() {
      if (team === null) return;
      const now = port.now();
      for (const run of [...team.running]) {
        const watch = watches.get(run.paneId);
        if (watch === undefined) continue;
        if (!terminalTeamNodeIsQuiet(watch.lastOutputAt, now, TERMINAL_TEAM_QUIET_MS)) continue;

        port.notify(`${run.nodeId} went quiet, so ADCode is treating it as finished.`);
        finish(run.paneId, run.nodeId, watch.tail);
      }
    },

    stop() {
      if (team === null) return;
      team = null;
      watches.clear();
      port.notify("The Team was stopped. Its terminals are still open.");
      changed();
    },

    status() {
      if (team === null) return null;
      const running = new Map(team.running.map((run) => [run.nodeId, run.paneId]));
      return {
        id: team.id,
        prompt: team.plan.prompt,
        state: terminalTeamState(team),
        nodes: team.graph.nodes.map((node) => ({
          nodeId: node.id,
          title: node.title,
          roleLabel:
            team!.plan.roles.find((role) => role.id === node.roleId)?.label ?? node.roleId,
          agentId:
            team!.assignments.find((assignment) => assignment.roleId === node.roleId)?.agentId ??
            ("claude" as AgentId),
          state: node.state,
          paneId: running.get(node.id) ?? null,
        })),
      };
    },

    isRunning: () => team !== null,

    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
