/**
 * Conversations, kept.
 *
 * The chat had no persistence of any kind: `reset()` emptied an array and closing the
 * window lost everything. That is the single thing that makes an assistant feel disposable
 * - you stop explaining context to something that will forget it in an hour.
 *
 * This is the shape and the rules; reading and writing files belongs to the shell. Pure, so
 * the parts that are easy to get quietly wrong - what a conversation is called, which one
 * is newest, which get dropped when there are too many - are tested rather than observed.
 */

import { compactedHistory } from "./compaction.ts";
import type { Message } from "./types.ts";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly text: string;
  readonly at: number;
}

export interface ChatSession {
  readonly id: string;
  /** Auto-titled from the first thing asked, unless the user renamed it. */
  readonly title: string;
  /** True once renamed, so auto-titling stops overwriting the user's own words. */
  readonly renamed: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ChatMessage[];
  /**
   * What the model wrote when the conversation was last compacted: it stands for the
   * first `coversUntil` messages, which stay on screen but are no longer sent. Absent in
   * conversations saved before compaction existed.
   */
  readonly summary?: ChatSummary | null;
}

export interface ChatSummary {
  readonly text: string;
  /** How many transcript messages, from the start, the summary replaces. */
  readonly coversUntil: number;
  readonly at: number;
}

/** Long enough to tell two conversations apart, short enough for a narrow list. */
const TITLE_LENGTH = 48;

/**
 * What to call a conversation, from the first thing asked in it.
 *
 * The first user message is almost always the subject, which is why it is used rather than
 * asking a model to summarise - a title that costs a request and a second of latency is a
 * title nobody asked for.
 */
export function titleFor(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (first === undefined) return "New conversation";

  const flattened = first.text.replace(/\s+/g, " ").trim();
  if (flattened.length === 0) return "New conversation";

  if (flattened.length <= TITLE_LENGTH) return flattened;

  // Cut at a word rather than mid-syllable, unless the first word is longer than the whole
  // budget - in which case there is no good break and a hard cut is the honest answer.
  const cut = flattened.slice(0, TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > TITLE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut}…`;
}

/** Newest first, which is the order a history list is read in. */
export function sortSessions(sessions: readonly ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Sessions matching a query.
 *
 * Searches the messages, not just the title. Somebody looking for the conversation where
 * they worked out a tricky migration remembers a phrase from inside it, not what the first
 * line happened to be.
 */
export function searchSessions(
  sessions: readonly ChatSession[],
  query: string,
): ChatSession[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return sortSessions(sessions);

  return sortSessions(
    sessions.filter((session) => {
      if (session.title.toLowerCase().includes(needle)) return true;
      return session.messages.some((message) => message.text.toLowerCase().includes(needle));
    }),
  );
}

/**
 * Which sessions to keep when there are too many.
 *
 * Oldest go first, and an empty conversation goes before any conversation with something
 * in it - a session opened and abandoned is not history, it is a stray file.
 */
export function pruneSessions(sessions: readonly ChatSession[], max: number): ChatSession[] {
  const kept = sortSessions(sessions.filter((session) => session.messages.length > 0));
  return kept.slice(0, Math.max(0, max));
}

/**
 * Bring whatever was on disk up to the current shape.
 *
 * A session file is JSON the user could have edited, and a field that is missing or the
 * wrong type must cost that field rather than the whole history.
 */
export function validateSession(raw: unknown): ChatSession | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const id = record["id"];
  if (typeof id !== "string" || id.length === 0) return null;

  const messages: ChatMessage[] = [];
  const rawMessages = record["messages"];

  if (Array.isArray(rawMessages)) {
    for (const entry of rawMessages) {
      if (typeof entry !== "object" || entry === null) continue;
      const message = entry as Record<string, unknown>;

      const role = message["role"];
      const text = message["text"];
      if (role !== "user" && role !== "assistant") continue;
      if (typeof text !== "string") continue;

      const at = message["at"];
      messages.push({ role, text, at: typeof at === "number" ? at : 0 });
    }
  }

  const createdAt = record["createdAt"];
  const updatedAt = record["updatedAt"];
  const title = record["title"];

  return {
    id,
    title: typeof title === "string" && title.length > 0 ? title : titleFor(messages),
    renamed: record["renamed"] === true,
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
    messages,
    summary: validateSummary(record["summary"], messages.length),
  };
}

/** A summary that points past the transcript, or says nothing, is worth less than none. */
function validateSummary(raw: unknown, length: number): ChatSummary | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const text = record["text"];
  const coversUntil = record["coversUntil"];
  const at = record["at"];
  if (typeof text !== "string" || text.trim().length === 0) return null;
  if (typeof coversUntil !== "number" || !Number.isSafeInteger(coversUntil) || coversUntil < 0 || coversUntil > length) return null;
  return { text, coversUntil, at: typeof at === "number" ? at : 0 };
}

/** The conversation with its newest summary recorded. */
export function withSummary(session: ChatSession, summary: ChatSummary): ChatSession {
  return { ...session, summary };
}

/**
 * How much of the transcript a summary covers, when the model kept its newest
 * `keptUserTurns` user turns word for word: everything before the oldest of those.
 */
export function summaryCoverage(transcript: readonly ChatMessage[], keptUserTurns: number): number {
  if (keptUserTurns <= 0) return transcript.length;
  let seen = 0;
  for (let index = transcript.length - 1; index >= 0; index--) {
    if (transcript[index]!.role !== "user") continue;
    seen += 1;
    if (seen === keptUserTurns) return index;
  }
  return 0;
}

/**
 * What the model should see when a saved conversation is picked up again: the summary,
 * then every message after it.
 *
 * The transcript keeps text only - tool calls and their output were never saved - which is
 * also what a model needs to carry on a conversation it did not have. Messages from the same
 * side are merged and a leading assistant greeting is dropped, because providers expect a
 * history that starts with the user and alternates.
 */
export function restoreHistory(session: ChatSession): Message[] {
  const summary = session.summary ?? null;
  const rest = session.messages.slice(summary?.coversUntil ?? 0);
  const history: Message[] = [];
  for (const message of rest) {
    if (message.text.trim().length === 0) continue;
    const last = history[history.length - 1];
    if (last === undefined && message.role === "assistant" && summary === null) continue;
    if (last !== undefined && last.role === message.role) {
      history[history.length - 1] = { role: last.role, content: [...last.content, { type: "text", text: message.text }] };
    } else {
      history.push({ role: message.role, content: [{ type: "text", text: message.text }] });
    }
  }
  return summary === null ? history : compactedHistory(summary.text, history);
}

/** A session with a message added, retitled if it is still using an automatic name. */
export function withMessage(
  session: ChatSession,
  message: ChatMessage,
): ChatSession {
  const messages = [...session.messages, message];

  return {
    ...session,
    messages,
    title: session.renamed ? session.title : titleFor(messages),
    updatedAt: message.at,
  };
}
