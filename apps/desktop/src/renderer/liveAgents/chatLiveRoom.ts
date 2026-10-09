/**
 * Everything the chat needs to show agents at work, wired once.
 *
 * - the room, fed by background agents (`ai:live`), by Team records (members waiting their
 *   turn, handoffs, a finished team), and by Team in the terminal (through `liveHub.ts`);
 * - the assistant's own inline window;
 * - the setting that turns both off, and the agent profiles that give each mascot its look.
 *
 * The chat widget mounts `element` above its transcript and hands every assistant event to
 * `chatWindow`; nothing else in the widget changes.
 */
import { AGENT_PROFILES_SETTING, parseAgentProfiles, type AgentProfile } from "../ai/agentProfiles.ts";
import { chatAppearanceFrom, type ChatAppearance } from "../ai/chatAppearance.ts";
import { defaultMascotFor, type MascotLook } from "../agents/mascotStyle.ts";
import { askThemed } from "../dialogs/confirmDialog.ts";
import { attachContextMenuDismissal, createContextMenu, type ContextMenuNode } from "../workbench/contextMenu.ts";
import type { AiTeamView } from "../../shared/api.ts";
import type { LiveSourceView } from "../../shared/liveAgents.ts";
import { createChatLiveWindow, type ChatLiveWindow } from "./chatLiveWindow.ts";
import { subscribeLive } from "./liveHub.ts";
import { createLiveRoom, type LiveRoomHandle } from "./liveRoom.ts";
import type { LiveAgent, LiveAgentIdentity } from "./liveRoomModel.ts";

export const LIVE_AGENT_VIEW_SETTING = "adcode.ai.liveAgentView";

export interface ChatLiveRoom {
  readonly element: HTMLElement;
  readonly room: LiveRoomHandle;
  readonly chatWindow: ChatLiveWindow;
}

export interface ChatLiveRoomDeps {
  /** Stop the chat's own turn - the same as its stop button. */
  readonly stopChat?: () => void;
  /** Run a workbench command, such as opening the Agents board. */
  readonly runCommand?: (command: string, arg?: string) => void;
}

/** What kind of run a room group is: a Team's members stop together, a solo run alone. */
export type LiveGroupKind = "team" | "solo" | "terminal" | "chat";

/** How the room can stop an agent of this kind, or null when it cannot. Pure, for the tests. */
export function stopLabelFor(kind: LiveGroupKind): string | null {
  if (kind === "solo" || kind === "chat") return "Stop";
  if (kind === "team") return "Stop team";
  // Team in the terminal runs in terminal panes the user drives; they are stopped there.
  return null;
}

/** A Team or solo agent's identity in the room. */
export function identityForSource(source: LiveSourceView): LiveAgentIdentity {
  return { id: `${source.teamId}/${source.nodeId}`, label: source.label, role: source.roleId, model: source.model, lookKey: source.roleId, group: source.teamId };
}

// No member starts after these: a held, conflicted or merging team has run everything it will.
const FINISHED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "review", "conflict", "merging"]);

export function createChatLiveRoom(deps: ChatLiveRoomDeps = {}): ChatLiveRoom {
  let enabled = true;
  let profiles: AgentProfile[] = [];
  let model = "";
  let appearance: ChatAppearance = chatAppearanceFrom({});
  /** Team or solo, per room group, from the events and records that named it. */
  const kinds = new Map<string, LiveGroupKind>();

  const lookFor = (identity: LiveAgentIdentity): MascotLook => {
    if (identity.lookKey === "chat") return appearance.look;
    return profiles.find((profile) => profile.id === identity.lookKey)?.mascot ?? defaultMascotFor(identity.lookKey);
  };

  const kindOf = (agent: LiveAgentIdentity): LiveGroupKind => {
    if (agent.group === "chat") return "chat";
    if (agent.group.startsWith("terminal")) return "terminal";
    return kinds.get(agent.group) ?? "solo";
  };

  const stopping = new Set<string>();
  /** Stop an agent's run. False when nothing was stopped - the user kept it going. */
  async function stopGroup(agent: LiveAgentIdentity, confirmTeam: boolean): Promise<boolean> {
    const kind = kindOf(agent);
    if (kind === "chat") {
      deps.stopChat?.();
      return true;
    }
    if (stopLabelFor(kind) === null || stopping.has(agent.group)) return false;
    if (kind === "team" && confirmTeam) {
      const sure = await askThemed({
        title: "Stop this Team?",
        body: "Every member stops, and work not yet merged is not applied. The Team stays on the Agents board.",
        confirmLabel: "Stop team",
        cancelLabel: "Keep going",
        danger: true,
      });
      if (!sure) return false;
    }
    stopping.add(agent.group);
    try {
      await window.adcode.aiTeam.cancel(agent.group);
    } catch {
      // Already finished, or gone: the room settles from the record either way.
    } finally {
      stopping.delete(agent.group);
    }
    return true;
  }

  const menu = createContextMenu(document.body);
  let menuAnchor: HTMLElement | null = null;
  attachContextMenuDismissal(menu, () => menuAnchor?.focus());

  function openAgentMenu(agent: LiveAgent, anchor: HTMLElement): void {
    menuAnchor = anchor;
    anchor.setAttribute("aria-expanded", "true");
    const kind = kindOf(agent);
    const live = agent.status === "working" || agent.status === "waiting";
    const stopLabel = stopLabelFor(kind);
    const profile = profiles.find((candidate) => candidate.id === agent.role);
    const nodes: ContextMenuNode[] = [
      { kind: "heading", label: agent.model.length > 0 ? `${agent.label} · ${agent.model}` : agent.label },
      ...(live && stopLabel !== null ? [{ label: stopLabel, danger: true, run: () => void stopGroup(agent, true) }] : []),
      ...(kind === "team" || kind === "solo"
        ? [{ label: "Open on the Agents board", run: () => deps.runCommand?.("agents.open") }]
        : []),
      ...(profile !== undefined ? [{ label: `Edit ${profile.name}…`, run: () => deps.runCommand?.("agents.editAgent", profile.id) }] : []),
      ...(kind === "chat" ? [{ label: "Customise how it looks…", run: () => deps.runCommand?.("ai.customizeChat") }] : []),
      { kind: "separator" },
      { label: "Hide windows", run: () => room.collapse(true) },
    ];
    const rect = anchor.getBoundingClientRect();
    menu.open(rect.right - 4, rect.bottom + 4, nodes, () => anchor.setAttribute("aria-expanded", "false"));
  }

  const room = createLiveRoom({
    lookFor,
    stopFor: (agent) => {
      const label = stopLabelFor(kindOf(agent));
      return label === null ? null : { label, run: () => stopGroup(agent, true) };
    },
    stopAll: (agents) => {
      const groups = new Map<string, LiveAgent>();
      for (const agent of agents) if (!groups.has(agent.group)) groups.set(agent.group, agent);
      // One question for all of them, not one per Team.
      void askThemed({
        title: `Stop ${groups.size === 1 ? "this run" : `all ${String(groups.size)} runs`}?`,
        body: "Every agent working here stops. Runs stay on the Agents board, and work not yet applied is not applied.",
        confirmLabel: "Stop all",
        cancelLabel: "Keep going",
        danger: true,
      }).then((sure) => {
        if (!sure) return;
        for (const agent of groups.values()) void stopGroup(agent, false);
      });
    },
    onAgentMenu: openAgentMenu,
  });
  const chatWindow = createChatLiveWindow({
    look: () => appearance.look,
    label: () => appearance.name,
    model: () => model,
    enabled: () => enabled,
    stop: () => deps.stopChat?.(),
    onMenu: openAgentMenu,
  });

  function adopt(values: Readonly<Record<string, unknown>>): void {
    enabled = values[LIVE_AGENT_VIEW_SETTING] !== false;
    profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    model = typeof values["adcode.ai.model"] === "string" ? values["adcode.ai.model"] : "";
    appearance = chatAppearanceFrom(values);
    room.setEnabled(enabled);
  }
  void window.adcode.settings.read().then(adopt, () => undefined);
  window.adcode.settings.onChanged(adopt);

  window.adcode.aiLive.onEvent(({ source, event }) => {
    kinds.set(source.teamId, source.kind);
    room.apply(identityForSource(source), event);
  });

  /*
   * Team records: members not started yet join the strip as waiting, a new handoff is
   * animated from the node that finished to the nodes that waited for it, and a finished
   * team's never-started members leave. Handoffs a team already had when first seen are not
   * replayed - they happened before this window was watching.
   */
  const seenHandoffs = new Map<string, Set<string>>();
  window.adcode.aiTeam.onChanged((team: AiTeamView) => {
    kinds.set(team.id, team.kind === "solo" ? "solo" : "team");
    let seen = seenHandoffs.get(team.id);
    const firstLook = seen === undefined;
    if (seen === undefined) {
      seen = new Set();
      seenHandoffs.set(team.id, seen);
    }
    const roleLabel = (roleId: string): string => team.roles.find((role) => role.id === roleId)?.label ?? roleId;
    const nodeIdentity = (nodeId: string): LiveAgentIdentity | null => {
      const node = team.nodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) return null;
      return {
        id: `${team.id}/${node.id}`,
        label: roleLabel(node.roleId),
        role: node.roleId,
        model: team.routes[node.roleId]?.modelId ?? "",
        lookKey: node.roleId,
        group: team.id,
      };
    };

    if (team.kind === "team" && (team.state === "running" || team.state === "preparing")) {
      for (const node of team.nodes) {
        if (node.state !== "pending") continue;
        const identity = nodeIdentity(node.id);
        const after = node.dependsOn.map((id) => roleLabel(team.nodes.find((candidate) => candidate.id === id)?.roleId ?? id));
        if (identity !== null) room.waiting(identity, after.length > 0 ? `Waiting for ${after.join(" and ")}` : "Waiting for its turn");
      }
    }

    for (const handoff of team.handoffs) {
      if (seen.has(handoff.nodeId)) continue;
      seen.add(handoff.nodeId);
      if (firstLook) continue;
      const waiting = team.nodes.filter((node) => node.dependsOn.includes(handoff.nodeId)).map((node) => `${team.id}/${node.id}`);
      if (waiting.length > 0) room.signal({ kind: "handoff", from: `${team.id}/${handoff.nodeId}`, to: waiting, text: handoff.summary, at: Date.now() });
    }

    if (FINISHED.has(team.state)) {
      room.settle(team.id);
      seenHandoffs.delete(team.id);
    }
  });

  subscribeLive((message) => {
    if (message.kind === "event") room.apply(message.identity, message.event);
    else if (message.kind === "waiting") room.waiting(message.identity, message.step);
    else if (message.kind === "settle") room.settle(message.group);
    else room.signal(message.signal);
  });

  return { element: room.element, room, chatWindow };
}
