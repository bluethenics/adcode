/**
 * Shared types for live collaboration. No logic.
 *
 * A session is one host sharing one open folder with any number of guests, all connected in
 * a star through the host. The host's disk is the only copy of the project: guests never
 * clone it and hold nothing when they disconnect. That is what makes the model tractable -
 * there is one working tree, one git state, and one place where a permission check can live.
 */

/**
 * What a participant may do.
 *
 * Three roles rather than a capability set per person, because a permission model a user
 * cannot hold in their head is one they will get wrong - and getting it wrong here means
 * handing a stranger write access to their files.
 */
export type Role = "host" | "editor" | "viewer";

/** Opaque. Assigned by the host on join; never derived from anything about the machine. */
export type ParticipantId = string;

export interface Participant {
  readonly id: ParticipantId;
  /** Display name, as the guest offered it. Untrusted: see `sanitiseName` in `session.ts`. */
  readonly name: string;
  readonly role: Role;
  /** A CSS colour, assigned deterministically so every machine agrees. See `colours.ts`. */
  readonly colour: string;
  /**
   * Whether this participant may type into the host's terminal.
   *
   * Separate from `role` on purpose, and false for everyone until the host says otherwise.
   * A writable terminal is arbitrary code execution on the host's machine - it is not a
   * degree more access than editing, it is a different kind - so it cannot be something a
   * role quietly implies.
   */
  readonly terminalWrite: boolean;
}

/** Where someone's caret is, one-based, matching Monaco and the LSP conversion in `packages/lsp`. */
export interface CursorPosition {
  readonly line: number;
  readonly column: number;
}

/** A selection, or `null` when the caret is just a caret. */
export interface Selection {
  readonly start: CursorPosition;
  readonly end: CursorPosition;
}

/** One participant's live position, as the editor draws it. */
export interface Presence {
  readonly participantId: ParticipantId;
  /** Workspace-relative path, or `null` when they have nothing open. */
  readonly path: string | null;
  readonly cursor: CursorPosition;
  readonly selection: Selection | null;
}

/**
 * The wire protocol version.
 *
 * Checked on `hello`, and a mismatch is refused with a message that says so. Two builds of
 * ADCode with different message shapes must not half-work: a guest silently dropping the
 * fields it does not understand would corrupt the host's files rather than fail.
 */
export const PROTOCOL_VERSION = 1;
