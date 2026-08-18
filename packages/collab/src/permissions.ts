/**
 * Who may do what. Pure predicates, and the only place that answers the question.
 *
 * **These run on the host.** That is the entire point of the file. A guest's copy of ADCode
 * runs on a computer the host does not administer, so anything it enforces is a courtesy: a
 * greyed-out button is a hint to a cooperative peer and no obstacle at all to a modified
 * one. The renderer may call these to decide what to draw - it should - but the host calls
 * them again on every message that arrives, before that message is allowed to touch a
 * document, the disk, or git. The brief already assumes the renderer is hostile (§1); a
 * guest's renderer is that same assumption with someone else's hands on it.
 *
 * Every predicate takes the participant rather than the role, so that a capability which is
 * granted per person - the terminal - cannot accidentally be answered from a role alone.
 */
import type { Participant, Role } from "./types.ts";

/** Read the folder, open files, see other people's cursors. Everyone in the session. */
export function canRead(_participant: Participant): boolean {
  return true;
}

/** Change a document's text. */
export function canEdit(participant: Participant): boolean {
  return participant.role === "host" || participant.role === "editor";
}

/**
 * Write a document to the host's disk.
 *
 * Tied to editing rather than held back as a separate grant: a guest who may change the text
 * but never persist it produces a session where the host's files silently diverge from what
 * everyone is looking at, and the first person to reload loses work that appeared saved.
 */
export function canSave(participant: Participant): boolean {
  return canEdit(participant);
}

/**
 * Run a commit directly.
 *
 * The host only. A commit is signed with the host's git identity and rewrites the history of
 * a repository on the host's machine; a guest asks, and `canRequestCommit` is that ask.
 */
export function canCommitDirectly(participant: Participant): boolean {
  return participant.role === "host";
}

/** Ask the host to commit. Anyone who could have made the changes being committed. */
export function canRequestCommit(participant: Participant): boolean {
  return canEdit(participant);
}

/** Watch the host's terminal output. Read-only, and safe: output is not execution. */
export function canReadTerminal(_participant: Participant): boolean {
  return true;
}

/**
 * Type into the host's terminal.
 *
 * Requires the explicit per-participant grant *and* an editing role. Two conditions rather
 * than one because they fail in different directions: the grant can be left set on someone
 * who was later demoted to viewer, and demoting someone is exactly the moment a host means
 * to take this away. Neither condition is redundant, so neither is dropped.
 */
export function canWriteTerminal(participant: Participant): boolean {
  return participant.terminalWrite && canEdit(participant);
}

/** Change another participant's role, or grant the terminal. The host alone. */
export function canAdminister(participant: Participant): boolean {
  return participant.role === "host";
}

/**
 * Every capability at once, for the renderer to draw a roster from.
 *
 * Derived rather than stored: a second copy of these answers is a second thing to keep in
 * step with this file, and the copy is what would go stale.
 */
export interface Capabilities {
  readonly read: boolean;
  readonly edit: boolean;
  readonly save: boolean;
  readonly commitDirectly: boolean;
  readonly requestCommit: boolean;
  readonly readTerminal: boolean;
  readonly writeTerminal: boolean;
  readonly administer: boolean;
}

export function capabilitiesOf(participant: Participant): Capabilities {
  return {
    read: canRead(participant),
    edit: canEdit(participant),
    save: canSave(participant),
    commitDirectly: canCommitDirectly(participant),
    requestCommit: canRequestCommit(participant),
    readTerminal: canReadTerminal(participant),
    writeTerminal: canWriteTerminal(participant),
    administer: canAdminister(participant),
  };
}

/** The roles a host may assign. Never `host`: a session has exactly one, and it is the owner. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["editor", "viewer"];

export function isAssignableRole(value: string): value is Role {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}
