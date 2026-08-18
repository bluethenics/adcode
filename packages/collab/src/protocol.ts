/**
 * The wire protocol, and the parser that is this feature's front door.
 *
 * **Everything this file parses came from another computer.** Not from the renderer, which
 * §1 already treats as hostile, but from a machine on the network that ADCode does not
 * administer and whose operator it cannot identify beyond "they had the invite code". A
 * message is a sequence of bytes that arrived on a socket; that it resembles something this
 * program sent is a hope, not a property.
 *
 * So `parse` returns `Message | null` and nothing else. `null` for a malformed envelope, an
 * unknown type, a field of the wrong type, a missing field, a number that is not finite, a
 * string past its cap - the same single failure mode `resolveRequestPath` uses in
 * `liveServer.ts`, and for the same reason: a caller that cannot tell *why* a message was
 * refused cannot accidentally act on a partially-trusted one. There is no "best effort"
 * branch, no coercion, and no default filled in for an absent field, because every one of
 * those is a way for an attacker's message to become a valid instruction.
 *
 * Note what this file does **not** do: it does not decide whether the sender is *allowed* to
 * do what the message asks. A well-formed `doc-update` from a viewer parses perfectly and
 * must still be refused. Shape and permission are different questions with different answers
 * and they are checked in different places - `permissions.ts` is the other one.
 *
 * Yjs updates travel as base64 in JSON rather than as binary frames. They are tens of bytes
 * per keystroke, so the ~33% overhead is irrelevant next to having one framing to get right
 * and one thing to validate.
 */
import { PROTOCOL_VERSION, type CursorPosition, type Participant, type Role, type Selection } from "./types.ts";

/**
 * Caps, applied before anything is interpreted.
 *
 * Each is a memory-exhaustion bound as much as a validation rule: a peer that sends a
 * 200MB "name" should be disconnected, not accommodated. The document cap is generous
 * because a first `doc-state` for a large file legitimately is large.
 */
export const LIMITS = {
  name: 64,
  token: 128,
  path: 1024,
  message: 2048,
  update: 8 * 1024 * 1024,
  /** The whole JSON envelope. Bounds the parse itself, before any field is read. */
  frame: 12 * 1024 * 1024,
} as const;

export type Message =
  /* ── Handshake ────────────────────────────────────────────────────────────── */
  | { readonly type: "hello"; readonly protocol: number; readonly token: string; readonly name: string }
  | { readonly type: "welcome"; readonly protocol: number; readonly you: string; readonly participants: readonly Participant[] }
  /** Refusal with a reason the guest can show. Sent, then the socket closes. */
  | { readonly type: "refused"; readonly reason: string }

  /* ── Roster ───────────────────────────────────────────────────────────────── */
  | { readonly type: "roster"; readonly participants: readonly Participant[] }
  | { readonly type: "set-role"; readonly participantId: string; readonly role: Role }
  | { readonly type: "set-terminal-write"; readonly participantId: string; readonly allowed: boolean }

  /* ── Documents ────────────────────────────────────────────────────────────── */
  /** "Send me this file." The host answers with `doc-state`. */
  | { readonly type: "doc-open"; readonly path: string }
  /** A whole Yjs document, base64. The reply to `doc-open`. */
  | { readonly type: "doc-state"; readonly path: string; readonly update: string }
  /** An incremental Yjs update, base64. Order-independent and idempotent by construction. */
  | { readonly type: "doc-update"; readonly path: string; readonly update: string }
  | { readonly type: "doc-save"; readonly path: string }
  /** The host confirming what it wrote, so a guest's dirty marker can clear honestly. */
  | { readonly type: "doc-saved"; readonly path: string }

  /* ── Presence ─────────────────────────────────────────────────────────────── */
  | {
      readonly type: "presence";
      /**
       * Whose cursor this is.
       *
       * `null` on the way *up*: a guest does not name itself, because a peer that could put
       * someone else's id here could move their cursor. The host knows who sent it from the
       * link it arrived on, and stamps the real id when it relays the message down - so the
       * field is only ever populated by the one participant entitled to populate it.
       */
      readonly participantId: string | null;
      readonly path: string | null;
      readonly cursor: CursorPosition;
      readonly selection: Selection | null;
    }
  /** Follow someone's viewport, or stop. `null` stops. */
  | { readonly type: "follow"; readonly participantId: string | null }

  /* ── Git ──────────────────────────────────────────────────────────────────── */
  | { readonly type: "commit-request"; readonly message: string }
  | { readonly type: "commit-decision"; readonly approved: boolean; readonly detail: string }

  /* ── Terminal ─────────────────────────────────────────────────────────────── */
  /** Host to guests: output. Always allowed. */
  | { readonly type: "terminal-output"; readonly data: string }
  /** Guest to host: keystrokes. Allowed only with an explicit grant - see `permissions.ts`. */
  | { readonly type: "terminal-input"; readonly data: string }

  /* ── Diagnostics ──────────────────────────────────────────────────────────── */
  | { readonly type: "error"; readonly detail: string };

export type MessageType = Message["type"];

/* ── Field validators ───────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length > max) return null;
  return value;
}

/** A non-empty string. Distinct from `str`: a blank token is not a token. */
function filled(value: unknown, max: number): string | null {
  const text = str(value, max);
  return text === null || text.length === 0 ? null : text;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * A one-based line or column.
 *
 * Integers only, and bounded. `Number.isInteger` rejects `NaN`, `Infinity` and `1.5` in one
 * check - and `NaN` is the one that matters, because it survives a naive `typeof === "number"`
 * and then makes every comparison downstream false, which reads as "the cursor is nowhere"
 * rather than as an error.
 */
function coordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > 2_000_000_000) return null;
  return value;
}

function position(value: unknown): CursorPosition | null {
  if (!isRecord(value)) return null;

  const line = coordinate(value["line"]);
  const column = coordinate(value["column"]);
  if (line === null || column === null) return null;

  return { line, column };
}

function selection(value: unknown): Selection | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "invalid";

  const start = position(value["start"]);
  const end = position(value["end"]);
  if (start === null || end === null) return "invalid";

  return { start, end };
}

function role(value: unknown): Role | null {
  // `host` is deliberately absent: a session has exactly one host and no message may confer
  // it. A peer claiming `set-role: host` is refused at the shape level, before any
  // permission check has to have an opinion about it.
  return value === "editor" || value === "viewer" ? value : null;
}

/**
 * A base64 payload.
 *
 * Validated as base64 here rather than decoded, because decoding is the caller's job and a
 * decoder handed non-base64 either throws or silently produces garbage bytes - which for a
 * Yjs update means a corrupt document rather than a rejected message.
 */
function base64(value: unknown, max: number): string | null {
  const text = str(value, max);
  if (text === null) return null;
  if (text.length === 0) return text;
  if (text.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;

  return text;
}

/**
 * A workspace-relative path.
 *
 * This is the guard on the one field that becomes a filesystem operation on someone else's
 * machine. Everything suspicious is refused here, and the host *also* runs the resolved path
 * through `isInsideWorkspace` before opening anything - two checks, because this one knows
 * nothing about where the workspace actually is and that one knows nothing about what a
 * well-formed request looks like.
 *
 * Refused: absolute paths, Windows drive letters, UNC prefixes, any `..` segment, backslashes
 * (so a single normalisation on the host cannot be sidestepped by choosing the other
 * separator), and NUL - which can truncate a path inside a native syscall, so that
 * `ok.txt\0.png` passes a check on the whole string and opens `ok.txt`.
 */
function relativePath(value: unknown): string | null {
  const text = filled(value, LIMITS.path);
  if (text === null) return null;

  if (text.includes("\0")) return null;
  if (text.includes("\\")) return null;
  if (text.startsWith("/")) return null;
  if (/^[a-z]:/i.test(text)) return null;

  const segments = text.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return null;

  return text;
}

function participant(value: unknown): Participant | null {
  if (!isRecord(value)) return null;

  const id = filled(value["id"], LIMITS.token);
  const name = str(value["name"], LIMITS.name);
  const colour = filled(value["colour"], 32);
  const terminalWrite = bool(value["terminalWrite"]);

  const raw = value["role"];
  const resolved: Role | null = raw === "host" ? "host" : role(raw);

  if (id === null || name === null || colour === null || resolved === null || terminalWrite === null) {
    return null;
  }

  return { id, name, role: resolved, colour, terminalWrite };
}

function participants(value: unknown): readonly Participant[] | null {
  if (!Array.isArray(value)) return null;
  // A roster is a small list. A peer claiming ten thousand participants is not a roster.
  if (value.length > 64) return null;

  const out: Participant[] = [];
  for (const entry of value) {
    const parsed = participant(entry);
    if (parsed === null) return null;
    out.push(parsed);
  }

  return out;
}

/* ── The parser ─────────────────────────────────────────────────────────────── */

/**
 * Turn a received frame into a `Message`, or `null`.
 *
 * Takes the raw string rather than a parsed object so that the `JSON.parse` - which throws on
 * malformed input - cannot happen anywhere except behind this boundary.
 */
export function parse(raw: string): Message | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > LIMITS.frame) return null;

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(envelope)) return null;

  const type = envelope["type"];
  if (typeof type !== "string") return null;

  switch (type) {
    case "hello": {
      const token = filled(envelope["token"], LIMITS.token);
      const name = str(envelope["name"], LIMITS.name);
      const protocol = envelope["protocol"];

      if (token === null || name === null || typeof protocol !== "number" || !Number.isInteger(protocol)) {
        return null;
      }

      return { type, protocol, token, name };
    }

    case "welcome": {
      const you = filled(envelope["you"], LIMITS.token);
      const roster = participants(envelope["participants"]);
      const protocol = envelope["protocol"];

      if (you === null || roster === null || typeof protocol !== "number" || !Number.isInteger(protocol)) {
        return null;
      }

      return { type, protocol, you, participants: roster };
    }

    case "refused": {
      const reason = str(envelope["reason"], LIMITS.message);
      return reason === null ? null : { type, reason };
    }

    case "roster": {
      const roster = participants(envelope["participants"]);
      return roster === null ? null : { type, participants: roster };
    }

    case "set-role": {
      const participantId = filled(envelope["participantId"], LIMITS.token);
      const next = role(envelope["role"]);
      return participantId === null || next === null ? null : { type, participantId, role: next };
    }

    case "set-terminal-write": {
      const participantId = filled(envelope["participantId"], LIMITS.token);
      const allowed = bool(envelope["allowed"]);
      return participantId === null || allowed === null ? null : { type, participantId, allowed };
    }

    case "doc-open":
    case "doc-save":
    case "doc-saved": {
      const path = relativePath(envelope["path"]);
      return path === null ? null : { type, path };
    }

    case "doc-state":
    case "doc-update": {
      const path = relativePath(envelope["path"]);
      const update = base64(envelope["update"], LIMITS.update);
      return path === null || update === null ? null : { type, path, update };
    }

    case "presence": {
      const rawPath = envelope["path"];
      // `null` is a real value here - it means "nothing open" - so it cannot be conflated
      // with a missing or malformed path.
      const path = rawPath === null ? null : relativePath(rawPath);
      if (rawPath !== null && path === null) return null;

      const cursor = position(envelope["cursor"]);
      if (cursor === null) return null;

      const range = selection(envelope["selection"]);
      if (range === "invalid") return null;

      // Same shape as `path`: `null` is meaningful and a malformed value is not tolerated.
      const rawId = envelope["participantId"];
      const participantId = rawId === null || rawId === undefined ? null : filled(rawId, LIMITS.token);
      if (rawId !== null && rawId !== undefined && participantId === null) return null;

      return { type, participantId, path, cursor, selection: range };
    }

    case "follow": {
      const rawId = envelope["participantId"];
      if (rawId === null) return { type, participantId: null };

      const participantId = filled(rawId, LIMITS.token);
      return participantId === null ? null : { type, participantId };
    }

    case "commit-request": {
      const message = filled(envelope["message"], LIMITS.message);
      return message === null ? null : { type, message };
    }

    case "commit-decision": {
      const approved = bool(envelope["approved"]);
      const detail = str(envelope["detail"], LIMITS.message);
      return approved === null || detail === null ? null : { type, approved, detail };
    }

    case "terminal-output":
    case "terminal-input": {
      const data = str(envelope["data"], LIMITS.update);
      return data === null ? null : { type, data };
    }

    case "error": {
      const detail = str(envelope["detail"], LIMITS.message);
      return detail === null ? null : { type, detail };
    }

    default:
      // An unknown type is refused, never ignored. A peer speaking a dialect this build does
      // not know must fail loudly rather than have half its intent applied.
      return null;
  }
}

/** Serialise for the wire. The inverse of `parse` for every message this build can produce. */
export function serialise(message: Message): string {
  return JSON.stringify(message);
}

/** Whether a `hello` can be spoken to at all. */
export function isSupportedProtocol(protocol: number): boolean {
  return protocol === PROTOCOL_VERSION;
}
