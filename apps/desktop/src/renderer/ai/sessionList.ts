/**
 * The conversation list, kept in the window and refreshed as changes (`shared/sessionDelta.ts`).
 *
 * The History panel, the agents' flow canvas and the usage page all ask for the list, the
 * panel after every turn. Asking the main process for every conversation each time sent a
 * day-long chat across IPC after every reply; this keeps the copies here and asks only for
 * what changed. One request at a time, so an answer always applies to the copies it was
 * computed against.
 */
import type { ChatMessageView, ChatSessionView } from "../../shared/api.ts";
import { applySessionsDelta, knownOf, type SessionsDelta } from "../../shared/sessionDelta.ts";

const cache = new Map<string, ChatSessionView>();
let queue: Promise<unknown> = Promise.resolve();

async function fetchList(): Promise<readonly ChatSessionView[]> {
  const chat = window.adcode.chat;
  if (typeof chat.sessionsDelta !== "function") return chat.sessions();
  const known = [...cache.values()].map((session) => knownOf(session));
  const delta: unknown = await chat.sessionsDelta(known).catch(() => null);
  // An answer that is not a delta - an older main process, a host that lacks the channel -
  // means asking for the whole list, never showing an empty one.
  const valid = typeof delta === "object" && delta !== null && Array.isArray((delta as { entries?: unknown }).entries);
  const list = valid ? applySessionsDelta<ChatMessageView, ChatSessionView>(cache, delta as SessionsDelta<ChatSessionView, ChatMessageView>) : null;
  if (list !== null) return list;
  // A copy the answer relied on is gone: start again from the whole list.
  cache.clear();
  const full = await chat.sessions();
  for (const session of full) cache.set(session.id, session);
  return full;
}

/** Every conversation in this project, newest first. Only what changed crosses IPC. */
export function chatSessions(): Promise<readonly ChatSessionView[]> {
  const run = queue.then(fetchList, fetchList);
  queue = run.catch(() => undefined);
  return run;
}

/** How many messages a conversation has, whether it arrived whole or as a light view. */
export function messageCount(session: Pick<ChatSessionView, "messages" | "messageCount"> | null | undefined): number {
  return session?.messageCount ?? session?.messages.length ?? 0;
}
