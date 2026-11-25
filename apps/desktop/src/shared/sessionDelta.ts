/**
 * Sending the conversation list to the window without sending it again and again.
 *
 * The History panel asks for every conversation after every turn. With one chat open all day
 * (13 MB) and 199 older ones, that was 36 MB through IPC per reply, decoded on the window's
 * main thread just as the reply finished - and the conversation on screen went a second time
 * for the memory strip, and a third in the "changed" broadcast.
 *
 * Now the window keeps what it has and says so in a few numbers per conversation. Each answer
 * is "same" (keep yours), "tail" (yours plus these new messages at the end - the usual case
 * for the chat in use), or "full" (anything else changed: a rename, a compaction, a team
 * merge, or the window's copy is not a prefix of the real one). A copy that cannot be proven
 * a prefix is always replaced whole, so the window can never show a history that is not real.
 *
 * Plain functions, shared by both sides and tested without either.
 */

interface MessageLike {
  readonly at: number;
  readonly role?: string;
  readonly text?: string;
}

interface SessionLike<M extends MessageLike> {
  readonly id: string;
  readonly updatedAt: number;
  readonly messages: readonly M[];
}

/** What the window says it already holds for one conversation. */
export interface KnownSession {
  readonly id: string;
  readonly updatedAt: number;
  readonly count: number;
  /** A hash over every message held - time, role and length - so a change anywhere shows. */
  readonly prefix: number;
  /** A hash of everything but the messages: title, summary, fork and team fields. */
  readonly meta: number;
}

export type SessionDeltaEntry<S, M> =
  | { readonly kind: "same"; readonly id: string }
  | { readonly kind: "tail"; readonly id: string; readonly base: number; readonly meta: Omit<S, "messages">; readonly tail: readonly M[] }
  | { readonly kind: "full"; readonly session: S };

export interface SessionsDelta<S, M> {
  /** In the list's own order (newest first). */
  readonly entries: readonly SessionDeltaEntry<S, M>[];
}

/** How many known entries a window may send; more than any history keeps. */
const MAX_KNOWN = 2_000;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Everything but the messages. */
export function metaOf<S extends SessionLike<MessageLike>>(session: S): Omit<S, "messages"> {
  const { messages: _messages, ...meta } = session;
  void _messages;
  return meta;
}

/** Key order does not change through IPC, so both sides hash the same text. */
export function metaHash(meta: object): number {
  return fnv1a(JSON.stringify(meta));
}

/** A hash of the first `count` messages: when each was written, by whom, and how long it is. */
export function prefixHash(messages: readonly MessageLike[], count: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < count && index < messages.length; index += 1) {
    const message = messages[index]!;
    const part = `${String(message.at)}:${message.role ?? ""}:${String(message.text?.length ?? -1)};`;
    for (let char = 0; char < part.length; char += 1) {
      hash ^= part.charCodeAt(char);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

/** Copies never change, so what one says it holds is worked out once. */
const knownCache = new WeakMap<object, KnownSession>();

export function knownOf<M extends MessageLike>(session: SessionLike<M>): KnownSession {
  const held = knownCache.get(session);
  if (held !== undefined) return held;
  const known: KnownSession = {
    id: session.id,
    updatedAt: session.updatedAt,
    count: session.messages.length,
    prefix: prefixHash(session.messages, session.messages.length),
    meta: metaHash(metaOf(session)),
  };
  knownCache.set(session, known);
  return known;
}

/** The window's list of what it holds, as it arrives: untrusted, so read field by field. */
function readKnown(input: unknown): Map<string, KnownSession> {
  const out = new Map<string, KnownSession>();
  if (!Array.isArray(input)) return out;
  for (const raw of input.slice(0, MAX_KNOWN)) {
    const item = raw as Partial<KnownSession> | null;
    if (item === null || typeof item !== "object") continue;
    const { id, updatedAt, count, prefix, meta } = item;
    if (typeof id !== "string" || typeof updatedAt !== "number" || typeof count !== "number" || !Number.isInteger(count) || count < 0 || typeof prefix !== "number" || typeof meta !== "number") continue;
    out.set(id, { id, updatedAt, count, prefix, meta });
  }
  return out;
}

/** The answer for `sessions`, given what the window says it holds. */
export function sessionsDelta<M extends MessageLike, S extends SessionLike<M>>(sessions: readonly S[], known: unknown): SessionsDelta<S, M> {
  const held = readKnown(known);
  const entries = sessions.map((session): SessionDeltaEntry<S, M> => {
    const mine = held.get(session.id);
    if (mine === undefined) return { kind: "full", session };
    const messages = session.messages;
    const meta = metaOf(session);
    // The store hands out the same objects until a chat changes, so these hashes are remembered.
    const real = knownOf(session);
    const sameMeta = mine.meta === real.meta;
    // The window's copy must be a prefix of the real one, message for message.
    const prefix = messages.length >= mine.count && (mine.count === messages.length ? real.prefix : prefixHash(messages, mine.count)) === mine.prefix;
    if (!prefix) return { kind: "full", session };
    if (messages.length === mine.count && sameMeta && mine.updatedAt === session.updatedAt) return { kind: "same", id: session.id };
    return { kind: "tail", id: session.id, base: mine.count, meta, tail: messages.slice(mine.count) };
  });
  return { entries };
}

/**
 * The window's side: rebuild the full list from its copies and the answer. Null when the
 * answer refers to a copy the window no longer has - the caller then asks for everything.
 */
export function applySessionsDelta<M extends MessageLike, S extends SessionLike<M>>(cache: Map<string, S>, delta: SessionsDelta<S, M>): S[] | null {
  const next: S[] = [];
  for (const entry of delta.entries) {
    if (entry.kind === "full") {
      next.push(entry.session);
      continue;
    }
    const mine = cache.get(entry.id);
    if (mine === undefined) return null;
    if (entry.kind === "same") {
      next.push(mine);
      continue;
    }
    if (mine.messages.length < entry.base) return null;
    next.push({ ...entry.meta, messages: [...mine.messages.slice(0, entry.base), ...entry.tail] } as unknown as S);
  }
  cache.clear();
  for (const session of next) cache.set(session.id, session);
  return next;
}

/** How many messages a light view keeps: enough for "the latest", never the whole day. */
export const LIGHT_MESSAGES = 2;

/**
 * The conversation on screen, for listeners that need its title, summary and size but not its
 * history: the latest messages, and `messageCount` for how many there are in all.
 */
export function lightSession<M extends MessageLike, S extends SessionLike<M>>(session: S): S & { readonly messageCount: number } {
  return { ...session, messages: session.messages.slice(-LIGHT_MESSAGES), messageCount: session.messages.length };
}
