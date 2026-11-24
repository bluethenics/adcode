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
  /** Opaque included-AI request ID for voluntary feedback, never sent as model context. */
  readonly includedRequestId?: string;
  /**
   * In a team chat, who wrote it (a person) or who asked for it (an AI reply). Absent in a
   * solo chat, where every user message is the person at the keyboard.
   */
  readonly author?: ChatAuthor;
  /** In a team chat, the message's number in the shared session, so it is merged once. */
  readonly seq?: number;
}

export interface ChatAuthor {
  readonly id: string;
  readonly name: string;
  /** The signed-in person on this computer. */
  readonly self: boolean;
}

/**
 * The model one conversation talks to. Each chat keeps its own, so choosing a model in one
 * chat leaves every other chat on the model it was using. Reported for 2.6.5 - "an issue
 * when I try to use new, different models in two different chats" - when the model was one
 * setting for the whole app and the last choice, made in any chat, moved every chat onto it.
 */
export interface ChatModelChoice {
  readonly provider: string;
  readonly model: string;
}

/** A chat that is the local side of a shared project's session (Team). */
export interface ChatTeamLink {
  readonly projectId: string;
  readonly sessionId: string;
  readonly projectName: string;
  /** Whether a message sent here asks the AI as well as the team. */
  readonly aiReplies: boolean;
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
  /**
   * The main chat this conversation was forked from. Forks of forks point at the same
   * root, so one family keeps one parent and every sibling can be found by this field.
   * Absent for a normal conversation.
   */
  readonly parentId?: string;
  /** When the fork was made; the copied history is everything before this. */
  readonly forkedAt?: number;
  /** The part the parent gave this fork, carried into its briefing. */
  readonly forkTask?: string;
  /** Set when this chat is a team chat: the shared session it mirrors. */
  readonly team?: ChatTeamLink;
  /**
   * The model this chat uses. Absent in a chat that has not talked to a model yet, and in
   * conversations saved before 2.6.6: such a chat takes the model chosen last, and keeps it.
   */
  readonly model?: ChatModelChoice;
}

export interface ChatSummary {
  readonly text: string;
  /** How many transcript messages, from the start, the summary replaces. */
  readonly coversUntil: number;
  readonly at: number;
}

/** Long enough to tell two conversations apart, short enough for a narrow list. */
const TITLE_LENGTH = 48;

/** The line the main process appends to a message sent with files: `[Attached: a.png, b.ts]`. */
const ATTACHED_LINE = /\n?\[Attached: ([^\n]*)\]\s*$/;

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

  // A message sent with files is recorded with an `[Attached: ...]` line after it. That is
  // bookkeeping, not the subject - unless the files were all that was sent.
  const attached = ATTACHED_LINE.exec(first.text);
  const own = attached === null ? first.text : first.text.slice(0, attached.index);
  const flattened = (own.trim().length > 0 ? own : attached?.[1] ?? "").replace(/\s+/g, " ").trim();
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
      const requestId = message["includedRequestId"];
      const author = validateAuthor(message["author"]);
      const seq = message["seq"];
      messages.push({ role, text, at: typeof at === "number" ? at : 0,
        ...(role === "assistant" && typeof requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ? { includedRequestId: requestId } : {}),
        ...(author === null ? {} : { author }),
        ...(typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0 ? { seq } : {}) });
    }
  }

  const createdAt = record["createdAt"];
  const updatedAt = record["updatedAt"];
  const title = record["title"];
  const parentId = record["parentId"];
  const forkedAt = record["forkedAt"];
  const forkTask = record["forkTask"];

  return {
    id,
    title: typeof title === "string" && title.length > 0 ? title : titleFor(messages),
    renamed: record["renamed"] === true,
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
    messages,
    summary: validateSummary(record["summary"], messages.length),
    ...(typeof parentId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(parentId) ? { parentId } : {}),
    ...(typeof forkedAt === "number" && Number.isFinite(forkedAt) && forkedAt >= 0 ? { forkedAt } : {}),
    ...(typeof forkTask === "string" && forkTask.trim().length > 0 ? { forkTask: forkTask.slice(0, 2_000) } : {}),
    ...(validateTeam(record["team"]) ?? {}),
    ...(validateModelChoice(record["model"]) ?? {}),
  };
}

/** A provider id and a model id, as the settings hold them; anything else costs only this field. */
function validateModelChoice(raw: unknown): { model: ChatModelChoice } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const provider = record["provider"], model = record["model"];
  if (typeof provider !== "string" || !/^[A-Za-z0-9_.:-]{1,100}$/.test(provider)) return null;
  if (typeof model !== "string" || model.trim().length === 0 || model.length > 200) return null;
  return { model: { provider, model: model.trim() } };
}

function validateAuthor(raw: unknown): ChatAuthor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = record["id"], name = record["name"];
  if (typeof id !== "string" || id.length === 0 || id.length > 128 || typeof name !== "string" || name.trim().length === 0) return null;
  return { id, name: name.trim().slice(0, 80), self: record["self"] === true };
}

function validateTeam(raw: unknown): { team: ChatTeamLink } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const projectId = record["projectId"], sessionId = record["sessionId"], projectName = record["projectName"];
  if (typeof projectId !== "string" || !/^[a-f0-9]{64}$/.test(projectId)) return null;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) return null;
  return { team: { projectId, sessionId, projectName: typeof projectName === "string" ? projectName.slice(0, 120) : "Team", aiReplies: record["aiReplies"] !== false } };
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
  for (const original of rest) {
    if (original.text.trim().length === 0) continue;
    const message = original.role === "user" && original.author !== undefined ? { ...original, text: `${original.author.name}: ${original.text}` } : original;
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
