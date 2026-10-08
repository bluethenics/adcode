/**
 * Team in the terminal, as the live room sees it.
 *
 * Turns the terminal runner's updates into room messages: each pane's CLI is an agent whose
 * window shows its terminal output, and a finished node's handoff is a signal to the nodes
 * that waited for it. A handoff is held until those nodes have started - their panes open a
 * moment after the handoff - so the bubble has somebody to fly to; after a few seconds it is
 * sent anyway, and the log still records it.
 */
import { knownAgents, type AgentId } from "@adcode/ai/agents";
import type { TerminalTeamLiveUpdate } from "../terminal/terminalTeamRunner.ts";
import { publishLive, type LiveHubMessage } from "./liveHub.ts";
import type { LiveAgentIdentity } from "./liveRoomModel.ts";

const HOLD_HANDOFF_MS = 5_000;

export function cliName(agentId: AgentId): string {
  return knownAgents().find((agent) => agent.id === agentId)?.name ?? agentId;
}

export interface TerminalLiveBridgeDeps {
  readonly publish?: (message: LiveHubMessage) => void;
  readonly later?: (callback: () => void, ms: number) => void;
}

export function createTerminalLiveBridge(deps: TerminalLiveBridgeDeps = {}): (update: TerminalTeamLiveUpdate) => void {
  const publish = deps.publish ?? publishLive;
  const later = deps.later ?? ((callback, ms) => void window.setTimeout(callback, ms));
  const identities = new Map<string, LiveAgentIdentity>();
  const started = new Set<string>();
  let pending: { id: number; message: LiveHubMessage & { kind: "signal" }; waitingFor: string[] }[] = [];
  let counter = 0;

  const key = (teamId: string, nodeId: string): string => `terminal/${teamId}/${nodeId}`;

  function release(): void {
    const ready = pending.filter((item) => item.waitingFor.every((id) => started.has(id)));
    if (ready.length === 0) return;
    pending = pending.filter((item) => !ready.includes(item));
    for (const item of ready) publish(item.message);
  }

  return (update) => {
    if (update.kind === "start") {
      const id = key(update.teamId, update.nodeId);
      const identity: LiveAgentIdentity = {
        id,
        label: update.roleLabel,
        role: update.roleId,
        model: cliName(update.agentId),
        lookKey: `cli-${update.agentId}`,
        group: update.teamId,
      };
      identities.set(id, identity);
      started.add(id);
      publish({ kind: "event", identity, event: { kind: "start" } });
      release();
      return;
    }
    if (update.kind === "handoff") {
      const to = update.to.map((nodeId) => key(update.teamId, nodeId));
      counter += 1;
      const id = counter;
      pending.push({ id, message: { kind: "signal", signal: { kind: "handoff", from: key(update.teamId, update.from), to, text: update.summary, at: Date.now() } }, waitingFor: to });
      release();
      later(() => {
        const item = pending.find((candidate) => candidate.id === id);
        if (item === undefined) return;
        pending = pending.filter((candidate) => candidate.id !== id);
        publish(item.message);
      }, HOLD_HANDOFF_MS);
      return;
    }
    const identity = identities.get(key(update.teamId, update.nodeId));
    if (identity === undefined) return;
    if (update.kind === "output") publish({ kind: "event", identity, event: { kind: "output", command: identity.model, text: update.text } });
    else publish({ kind: "event", identity, event: { kind: "end", ok: update.ok } });
  };
}
