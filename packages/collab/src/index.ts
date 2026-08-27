/**
 * `@adcode/collab` - the pure half of live collaboration.
 *
 * Plain TypeScript. No Electron, no DOM, no Monaco, no sockets, no Yjs. What lives here is
 * the material that actually breaks: validating messages that arrived from another computer,
 * deciding who may do what, encoding an invite, and keeping a roster consistent as people
 * join and leave. All of it is testable without a window, a network, or a second machine,
 * which is the only reason any of it is tested at all.
 *
 * The transport, the Yjs documents, and the editor decorations live in `apps/desktop`,
 * because each of them needs something this package deliberately cannot import.
 */
export { CURSOR_COLOURS, colourForIndex, labelInkFor, selectionTintFor } from "./colours.ts";
export {
  ASSIGNABLE_ROLES,
  canAdminister,
  canCommitDirectly,
  canEdit,
  canRead,
  canReadTerminal,
  canRequestCommit,
  canSave,
  canWriteTerminal,
  capabilitiesOf,
  isAssignableRole,
  type Capabilities,
} from "./permissions.ts";
export {
  abbreviateInvite,
  decodeInvite,
  encodeInvite,
  newToken,
  type Invite,
} from "./invite.ts";
export {
  LIMITS,
  isSupportedProtocol,
  parse,
  serialise,
  type Message,
  type MessageType,
} from "./protocol.ts";
export {
  DEFAULT_GUEST_ROLE,
  findParticipant,
  hostOf,
  join,
  leave,
  rename,
  sanitiseName,
  setRole,
  setTerminalWrite,
  startSession,
  summarise,
  type JoinResult,
  type SessionState,
} from "./session.ts";
export {
  PROTOCOL_VERSION,
  type CursorPosition,
  type Participant,
  type ParticipantId,
  type Presence,
  type Role,
  type Selection,
} from "./types.ts";
