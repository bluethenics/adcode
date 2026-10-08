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
import { defaultMascotFor, type MascotLook } from "../agents/mascotStyle.ts";
import type { AiTeamView } from "../../shared/api.ts";
import type { LiveSourceView } from "../../shared/liveAgents.ts";
import { createChatLiveWindow, type ChatLiveWindow } from "./chatLiveWindow.ts";
import { subscribeLive } from "./liveHub.ts";
import { createLiveRoom, type LiveRoomHandle } from "./liveRoom.ts";
import type { LiveAgentIdentity } from "./liveRoomModel.ts";

export const LIVE_AGENT_VIEW_SETTING = "adcode.ai.liveAgentView";

/** The chat assistant's mascot, the same one the Agents board gives it. */
const CHAT_LOOK: MascotLook = { shape: "circle", color: "blue" };

export interface ChatLiveRoom {
  readonly element: HTMLElement;
  readonly room: LiveRoomHandle;
  readonly chatWindow: ChatLiveWindow;
}

/** A Team or solo agent's identity in the room. */
export function identityForSource(source: LiveSourceView): LiveAgentIdentity {
  return { id: `${source.teamId}/${source.nodeId}`, label: source.label, role: source.roleId, model: source.model, lookKey: source.roleId, group: source.teamId };
}

const FINISHED: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export function createChatLiveRoom(): ChatLiveRoom {
  let enabled = true;
  let profiles: AgentProfile[] = [];
  let model = "";

  const lookFor = (identity: LiveAgentIdentity): MascotLook => {
    if (identity.lookKey === "chat") return CHAT_LOOK;
    return profiles.find((profile) => profile.id === identity.lookKey)?.mascot ?? defaultMascotFor(identity.lookKey);
  };

  const room = createLiveRoom({ lookFor });
  const chatWindow = createChatLiveWindow({
    look: CHAT_LOOK,
    label: () => "Assistant",
    model: () => model,
    enabled: () => enabled,
  });

  function adopt(values: Readonly<Record<string, unknown>>): void {
    enabled = values[LIVE_AGENT_VIEW_SETTING] !== false;
    profiles = parseAgentProfiles(values[AGENT_PROFILES_SETTING]);
    model = typeof values["adcode.ai.model"] === "string" ? values["adcode.ai.model"] : "";
    room.setEnabled(enabled);
  }
  void window.adcode.settings.read().then(adopt, () => undefined);
  window.adcode.settings.onChanged(adopt);

  window.adcode.aiLive.onEvent(({ source, event }) => room.apply(identityForSource(source), event));

  /*
   * Team records: members not started yet join the strip as waiting, a new handoff is
   * animated from the node that finished to the nodes that waited for it, and a finished
   * team's never-started members leave. Handoffs a team already had when first seen are not
   * replayed - they happened before this window was watching.
   */
  const seenHandoffs = new Map<string, Set<string>>();
  window.adcode.aiTeam.onChanged((team: AiTeamView) => {
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
