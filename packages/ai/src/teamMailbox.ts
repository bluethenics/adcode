/**
 * How the agents on one Team talk to each other while they work.
 *
 * Before this, a Team role heard from its teammates only when one of them finished: the
 * handoff. Two roles working at once could not warn each other ("I renamed User to Account")
 * or ask anything, so they collided at the merge. A mailbox per team fixes that with the
 * least machinery that works: a role posts to a teammate or to everyone, and each role takes
 * what it has not read yet. The host delivers it at the role's next step.
 *
 * Also here: noticing two roles editing the same file, which in isolated copies means a merge
 * conflict later - cheaper to say now.
 *
 * Pure: in-memory state only, no I/O and no clock of its own.
 */

export interface TeamMessage {
  readonly id: number;
  /** The sender's role id. */
  readonly from: string;
  /** A role id, or "all". */
  readonly to: string;
  readonly text: string;
  readonly at: number;
}

export interface TeamMailbox {
  post(teamId: string, from: string, to: string, text: string, now: number): TeamMessage;
  /** Messages for this role it has not taken before, oldest first. */
  take(teamId: string, roleId: string): TeamMessage[];
  clear(teamId: string): void;
}

const MESSAGE_LIMIT = 2_000;

export function createTeamMailbox(): TeamMailbox {
  const teams = new Map<string, { messages: TeamMessage[]; read: Map<string, number> }>();
  let counter = 0;

  function team(teamId: string) {
    let found = teams.get(teamId);
    if (found === undefined) {
      found = { messages: [], read: new Map() };
      teams.set(teamId, found);
    }
    return found;
  }

  return {
    post(teamId, from, to, text, now) {
      counter += 1;
      const message: TeamMessage = { id: counter, from, to, text: text.trim().slice(0, MESSAGE_LIMIT), at: now };
      team(teamId).messages.push(message);
      return message;
    },
    take(teamId, roleId) {
      const found = teams.get(teamId);
      if (found === undefined) return [];
      const after = found.read.get(roleId) ?? 0;
      const unread = found.messages.filter(
        (message) => message.id > after && message.from !== roleId && (message.to === roleId || message.to === "all"),
      );
      const last = found.messages.at(-1);
      if (last !== undefined) found.read.set(roleId, last.id);
      return unread;
    },
    clear(teamId) {
      teams.delete(teamId);
    },
  };
}

/** Why a message cannot go to `to`, or null when it can. */
export function recipientProblem(to: string, from: string, roster: readonly string[]): string | null {
  if (to === "all") return null;
  if (to === from) return "You cannot message yourself - message a teammate, or all.";
  if (roster.includes(to)) return null;
  const others = roster.filter((role) => role !== from);
  return `No teammate called ${JSON.stringify(to)}. Use one of: ${others.join(", ")}, or all.`;
}

/** Unread messages as the text a model reads at the top of its next step. */
export function formatInbox(messages: readonly TeamMessage[], labelFor: (roleId: string) => string): string {
  if (messages.length === 0) return "No new messages from your teammates.";
  return ["Messages from your teammates:", ...messages.map((message) => `- ${labelFor(message.from)}: ${message.text}`)].join("\n");
}

export interface OverlapTracker {
  /** Record that a node edited a path. Returns the other node that edited it first, once per node and path. */
  touch(teamId: string, nodeId: string, path: string): string | null;
  clear(teamId: string): void;
}

export function createOverlapTracker(): OverlapTracker {
  const firstEditor = new Map<string, Map<string, string>>();
  const warned = new Set<string>();
  return {
    touch(teamId, nodeId, path) {
      let paths = firstEditor.get(teamId);
      if (paths === undefined) {
        paths = new Map();
        firstEditor.set(teamId, paths);
      }
      const first = paths.get(path);
      if (first === undefined) {
        paths.set(path, nodeId);
        return null;
      }
      if (first === nodeId) return null;
      const key = `${teamId}\u0000${nodeId}\u0000${path}`;
      if (warned.has(key)) return null;
      warned.add(key);
      return first;
    },
    clear(teamId) {
      firstEditor.delete(teamId);
      for (const key of [...warned]) if (key.startsWith(`${teamId}\u0000`)) warned.delete(key);
    },
  };
}
