import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths, ensureDir } from "../util/paths.ts";
import { titleFrom } from "../util/format.ts";

/**
 * Conversations that survive the terminal.
 *
 * One JSON file per conversation, written atomically. The directory is the index: a saved
 * session is a file, deleting one is deleting a file, and there is no second list to fall
 * out of step with the first.
 */

export interface ChatMessageRecord {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly at: number;
  readonly provider?: string;
  readonly model?: string;
  readonly includedRequestId?: string;
  /** Optional provider reasoning, kept so a resumed transcript still shows the work. */
  readonly thinking?: string;
  readonly thinkingMs?: number;
}

export interface ChatSession {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly messages: readonly ChatMessageRecord[];
  readonly provider: string | null;
  readonly model: string | null;
}

const ID_PATTERN = /^s-[a-z0-9-]{6,80}$/;

export function isSessionId(value: string): boolean {
  return ID_PATTERN.test(value);
}

function sessionDir(): string {
  return ensureDir(cliPaths.sessions());
}

function sessionPath(id: string): string {
  return join(sessionDir(), `${id}.json`);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseMessage(raw: unknown): ChatMessageRecord | null {
  const entry = record(raw);
  if (entry["role"] !== "user" && entry["role"] !== "assistant") return null;
  if (typeof entry["text"] !== "string") return null;
  if (typeof entry["at"] !== "number" || !Number.isFinite(entry["at"])) return null;
  return {
    role: entry["role"],
    text: entry["text"],
    at: entry["at"],
    ...(typeof entry["provider"] === "string" ? { provider: entry["provider"] } : {}),
    ...(typeof entry["model"] === "string" ? { model: entry["model"] } : {}),
    ...(typeof entry["includedRequestId"] === "string" ? { includedRequestId: entry["includedRequestId"] } : {}),
    ...(typeof entry["thinking"] === "string" && entry["thinking"].trim().length > 0 ? { thinking: entry["thinking"] } : {}),
    ...(typeof entry["thinkingMs"] === "number" && Number.isFinite(entry["thinkingMs"]) && entry["thinkingMs"] > 0
      ? { thinkingMs: entry["thinkingMs"] }
      : {}),
  };
}

export function parseSession(raw: unknown): ChatSession | null {
  const entry = record(raw);
  const id = typeof entry["id"] === "string" ? entry["id"] : "";
  if (!isSessionId(id)) return null;
  const messages = Array.isArray(entry["messages"])
    ? entry["messages"].map(parseMessage).filter((message): message is ChatMessageRecord => message !== null)
    : [];
  const createdAt = typeof entry["createdAt"] === "number" ? entry["createdAt"] : Date.now();
  return {
    id,
    title: typeof entry["title"] === "string" && entry["title"].length > 0 ? entry["title"] : "New conversation",
    createdAt,
    updatedAt: typeof entry["updatedAt"] === "number" ? entry["updatedAt"] : createdAt,
    messages,
    provider: typeof entry["provider"] === "string" ? entry["provider"] : null,
    model: typeof entry["model"] === "string" ? entry["model"] : null,
  };
}

export function readSession(id: string): ChatSession | null {
  if (!isSessionId(id)) return null;
  try {
    return parseSession(JSON.parse(readFileSync(sessionPath(id), "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function listSessions(): ChatSession[] {
  let names: string[] = [];
  try {
    names = readdirSync(sessionDir()).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const sessions: ChatSession[] = [];
  for (const name of names) {
    const session = readSession(name.slice(0, -".json".length));
    if (session !== null) sessions.push(session);
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function latestSession(): ChatSession | null {
  return listSessions()[0] ?? null;
}

let counter = 0;

export function newSessionId(): string {
  counter += 1;
  return `s-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createSession(provider: string | null = null, model: string | null = null): ChatSession {
  const now = Date.now();
  return {
    id: newSessionId(),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [],
    provider,
    model,
  };
}

export function withMessage(session: ChatSession, message: ChatMessageRecord): ChatSession {
  const messages = [...session.messages, message];
  const firstUser = messages.find((entry) => entry.role === "user");
  return {
    ...session,
    title: session.title === "New conversation" && firstUser !== undefined ? titleFrom(firstUser.text) : session.title,
    messages,
    updatedAt: Math.max(session.updatedAt, message.at),
  };
}

export function saveSession(session: ChatSession): ChatSession {
  const path = sessionPath(session.id);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  return session;
}

export function deleteSession(id: string): boolean {
  if (!isSessionId(id)) return false;
  const path = sessionPath(id);
  if (!existsSync(path)) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function renameSession(id: string, title: string): ChatSession | null {
  const session = readSession(id);
  if (session === null) return null;
  const next = { ...session, title: title.trim().length > 0 ? title.trim() : session.title, updatedAt: Date.now() };
  return saveSession(next);
}

export function exportSession(id: string): string | null {
  const session = readSession(id);
  if (session === null) return null;
  const lines = [`# ${session.title}`, ""];
  for (const message of session.messages) {
    lines.push(`## ${message.role === "user" ? "You" : "ADCode"}`, "", message.text, "");
  }
  return lines.join("\n");
}
