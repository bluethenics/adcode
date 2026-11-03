/**
 * The runtime behind visible fork chats.
 *
 * A fork is an ordinary conversation in the session store, plus three things the pure
 * module cannot provide: a running turn, a mailbox shared by the family, and a record of
 * which forks are still working. This service owns those, and the runner below hands its
 * tools to the agent while keeping the same tool result contract as every other tool.
 *
 * No Electron and no fs calls: the session list and writing are injected, so the whole
 * coordination path is tested without a window or a disk.
 */
import { randomUUID } from "node:crypto";
import {
  CHAT_FORK_REPORT_CHARS,
  FORK_CHATS_NAME,
  MAX_CHAT_FORK_MESSAGES,
  READ_CHAT_MESSAGES_NAME,
  SEND_CHAT_MESSAGE_NAME,
  STOP_CHAT_NAME,
  WAIT_FOR_CHAT_FORKS_NAME,
  LIST_CHAT_FORKS_NAME,
  createTeamMailbox,
  formatInbox,
  forkChatSession,
  isChatForkTool,
  parseChatForkTasks,
  type ChatSession,
  type TeamMailbox,
  type ToolRunResult,
  type ToolRunner,
} from "@adcode/ai";

/** A family can grow over several turns; this keeps the sidebar from becoming a tree. */
export const MAX_FORKS_PER_CHAT = 6;

interface ForkRunRecord {
  outcome: "running" | "finished" | "stopped" | "failed";
  detail?: string;
  promise: Promise<void>;
}

export interface ChatForkServiceDeps {
  readonly sessions: () => Promise<readonly ChatSession[]>;
  readonly write: (session: ChatSession) => Promise<void>;
  readonly isRunning: (sessionId: string) => boolean;
  /** Start one turn for a chat; resolves true when it finished normally. */
  readonly startTurn: (sessionId: string, text: string) => Promise<boolean>;
  readonly cancel: (sessionId: string) => void;
  /** Chat slots that can start a turn now, shared with every other chat. */
  readonly freeSlots: () => number;
  readonly now?: () => number;
  readonly id?: () => string;
  readonly mailbox?: TeamMailbox;
  /** How long one wait_for_chat_forks call may hold the main chat; defaults to ten minutes. */
  readonly maxWaitMs?: number;
}

/**
 * One wait returns after this long even if forks are still working. Without it a fork that
 * hangs keeps the main chat - and its chat slot - waiting until someone presses Stop; with it
 * the main chat gets the reports so far and decides whether to wait again, message, or stop.
 */
export const MAX_FORK_WAIT_MS = 10 * 60_000;

export interface ChatForkService {
  create(parent: ChatSession, input: unknown): Promise<ToolRunResult>;
  send(from: ChatSession, input: unknown): Promise<ToolRunResult>;
  read(from: ChatSession): Promise<ToolRunResult>;
  wait(parent: ChatSession, input: unknown, signal: AbortSignal): Promise<ToolRunResult>;
  list(session: ChatSession): Promise<ToolRunResult>;
  stop(from: ChatSession, input: unknown): Promise<ToolRunResult>;
  /** Unread messages for a chat, as the text a model reads after a tool result. */
  deliver(session: ChatSession): Promise<string | null>;
}

const fail = (content: string): ToolRunResult => ({ content, isError: true });
const done = (content: string): ToolRunResult => ({ content, isError: false });

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function oneLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/** Only what this fork itself said, not the parent's transcript it copied. */
function ownMessages(session: ChatSession): readonly ChatSession["messages"][number][] {
  const since = session.forkedAt;
  if (since === undefined) return session.messages;
  return session.messages.filter((message) => message.at > since);
}

function latestReport(session: ChatSession): string {
  const reply = [...ownMessages(session)].reverse().find((message) => message.role === "assistant");
  if (reply === undefined) return "(no report yet)";
  return reply.text.length > CHAT_FORK_REPORT_CHARS
    ? `${reply.text.slice(0, CHAT_FORK_REPORT_CHARS)}\n[report cut at ${String(CHAT_FORK_REPORT_CHARS)} characters]`
    : reply.text;
}

function familyRoot(session: ChatSession): string {
  return session.parentId ?? session.id;
}

function sameFamily(session: ChatSession, rootId: string): boolean {
  return session.id === rootId || session.parentId === rootId;
}

export function createChatForkService(deps: ChatForkServiceDeps): ChatForkService {
  const now = deps.now ?? Date.now;
  const id = deps.id ?? randomUUID;
  const mailbox = deps.mailbox ?? createTeamMailbox();
  const runs = new Map<string, ForkRunRecord>();
  const starting = new Set<string>();
  const exchanges = new Map<string, number>();

  function working(sessionId: string): boolean {
    return starting.has(sessionId) || deps.isRunning(sessionId) || runs.get(sessionId)?.outcome === "running";
  }

  function titleMap(sessions: readonly ChatSession[]): (roleId: string) => string {
    const titles = new Map(sessions.map((session) => [session.id, session.title]));
    return (roleId) => titles.get(roleId) ?? roleId;
  }

  async function family(session: ChatSession): Promise<readonly ChatSession[]> {
    const root = familyRoot(session);
    const all = await deps.sessions();
    return all.filter((candidate) => sameFamily(candidate, root));
  }

  function start(session: ChatSession, text: string): void {
    if (working(session.id)) return;
    starting.add(session.id);
    const record: ForkRunRecord = {
      outcome: "running",
      promise: Promise.resolve(),
    };
    record.promise = (async () => {
      try {
        const finished = await deps.startTurn(session.id, text);
        record.outcome = finished ? "finished" : "stopped";
      } catch (error) {
        record.outcome = "failed";
        record.detail = errorText(error).slice(0, 500);
      } finally {
        starting.delete(session.id);
      }
    })();
    runs.set(session.id, record);
  }

  function spendMessage(familyId: string): boolean {
    const used = exchanges.get(familyId) ?? 0;
    if (used >= MAX_CHAT_FORK_MESSAGES) return false;
    exchanges.set(familyId, used + 1);
    return true;
  }

  function statusOf(session: ChatSession): string {
    if (working(session.id)) return "working";
    return runs.get(session.id)?.outcome ?? "idle";
  }

  function outcomeDetail(session: ChatSession): string {
    const detail = runs.get(session.id)?.detail;
    return detail === undefined ? "" : ` (${oneLine(detail, 200)})`;
  }

  function rosterLine(session: ChatSession, labelFor: (roleId: string) => string): string {
    const latest = latestReport(session);
    const state = statusOf(session);
    const suffix = state === "working" ? "working" : `${state}${outcomeDetail(session)}`;
    return `- [${session.id}] ${labelFor(session.id)} - ${suffix} - ${oneLine(latest, 180)}`;
  }

  function resolveRecipient(
    to: string,
    from: ChatSession,
    sessions: readonly ChatSession[],
  ): { readonly target: ChatSession } | { readonly problem: string } {
    const root = familyRoot(from);
    const byName = (value: string): ChatSession | undefined => {
      const needle = value.trim().toLowerCase();
      return sessions.find(
        (session) =>
          session.id === value ||
          session.title.toLowerCase() === needle ||
          (needle.length >= 4 && session.title.toLowerCase().startsWith(needle)),
      );
    };
    if (to === "all") return { problem: "all" };
    if (to === "parent") {
      if (from.parentId === undefined) return { problem: "You are the main chat. Name a fork id or title, or use all." };
      const parent = sessions.find((session) => session.id === root);
      return parent === undefined ? { problem: "The main chat is no longer here." } : { target: parent };
    }
    const target = byName(to);
    if (target === undefined || !sameFamily(target, root)) {
      const others = sessions.filter((session) => session.id !== from.id && sameFamily(session, root));
      return {
        problem: `No chat called ${JSON.stringify(to)} in this fork family. Use one of: ${others.map((session) => `${session.title} (${session.id})`).join(", ") || "the main chat"}, or all.`,
      };
    }
    if (target.id === from.id) return { problem: "You cannot message yourself - message another chat, or all." };
    return { target };
  }

  async function deliverOne(from: ChatSession, target: ChatSession, text: string, available: { count: number }): Promise<string> {
    const root = familyRoot(from);
    if (working(target.id)) {
      mailbox.post(root, from.id, target.id, text, now());
      return `sent to ${target.title}; it is working, so this reaches it at its next step`;
    }
    if (available.count > 0) {
      available.count -= 1;
      start(target, text);
      return `sent to ${target.title}; it was idle, so it is working on that now`;
    }
    mailbox.post(root, from.id, target.id, text, now());
    return `sent to ${target.title}; no chat slot is free, so it waits for its next turn`;
  }

  return {
    async create(parent, input) {
      if (parent.parentId !== undefined) return fail("Only the main chat can create forks. This chat is itself a fork.");
      const tasks = parseChatForkTasks(input);
      if (typeof tasks === "string") return fail(tasks);
      const all = await deps.sessions();
      const existing = all.filter((session) => session.parentId === parent.id).length;
      if (existing + tasks.length > MAX_FORKS_PER_CHAT) {
        return fail(`This chat already has ${String(existing)} fork${existing === 1 ? "" : "s"}. At most ${String(MAX_FORKS_PER_CHAT)} per chat; remove one or do this work here.`);
      }
      const available = deps.freeSlots();
      if (available < tasks.length) {
        return fail(`Only ${String(Math.max(0, available))} chat slot${available === 1 ? " is" : "s are"} free. Wait for a chat to finish, or start fewer forks.`);
      }
      const at = now();
      const created: ChatSession[] = [];
      for (const task of tasks) {
        const child = forkChatSession({
          parent,
          id: id(),
          title: task.title,
          task: task.prompt,
          at,
        });
        await deps.write(child);
        created.push(child);
      }
      for (const child of created) start(child, child.forkTask ?? "Continue the work you were given.");
      return done([
        `Started ${String(created.length)} fork chat${created.length === 1 ? "" : "s"}. They are visible in History and have their own tabs.`,
        ...created.map((child) => `- ${child.title} (${child.id})`),
        "",
        "Use wait_for_chat_forks to wait for their reports. Use send_chat_message to give one more instructions while it works. They can message you and each other.",
      ].join("\n"));
    },

    async send(from, input) {
      const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
      const to = typeof record["to"] === "string" ? record["to"].trim() : "";
      const text = typeof record["text"] === "string" ? record["text"].trim() : "";
      if (to.length === 0) return fail("send_chat_message needs a recipient: a chat id, a title, 'parent', or 'all'.");
      if (text.length === 0) return fail("send_chat_message needs some text.");
      if (text.length > 2_000) return fail("That message is too long. Keep it to about 2,000 characters.");
      const root = familyRoot(from);
      const sessions = (await deps.sessions()).filter((session) => sameFamily(session, root));
      const familySessions = sessions.some((session) => session.id === from.id) ? sessions : [...sessions, from];
      const available = { count: deps.freeSlots() };
      if (to === "all") {
        const targets = familySessions.filter((session) => session.id !== from.id);
        if (targets.length === 0) return fail("There are no other chats in this fork family yet.");
        if (!spendMessage(root)) {
          return fail(`This fork family has exchanged ${String(MAX_CHAT_FORK_MESSAGES)} messages. Finish the work and report back instead of messaging again.`);
        }
        const lines: string[] = [];
        for (const target of targets) lines.push(await deliverOne(from, target, text, available));
        return done(lines.join("\n"));
      }
      const resolved = resolveRecipient(to, from, familySessions);
      if ("problem" in resolved) return fail(resolved.problem);
      if (!spendMessage(root)) {
        return fail(`This fork family has exchanged ${String(MAX_CHAT_FORK_MESSAGES)} messages. Finish the work and report back instead of messaging again.`);
      }
      return done(await deliverOne(from, resolved.target, text, available));
    },

    async read(from) {
      const sessions = await family(from);
      const messages = mailbox.take(familyRoot(from), from.id);
      return done(formatInbox(messages, titleMap(sessions)));
    },

    async wait(parent, input, signal) {
      if (parent.parentId !== undefined) return fail("Only the main chat can wait for forks.");
      const all = await deps.sessions();
      const children = all.filter((session) => session.parentId === parent.id);
      if (children.length === 0) return done("This chat has no fork chats yet.");
      const requested = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["ids"] : undefined;
      let selected = children;
      if (Array.isArray(requested) && requested.length > 0) {
        const ids = requested.filter((value): value is string => typeof value === "string").map((value) => value.trim());
        if (ids.length !== requested.length || ids.some((value) => value.length === 0)) return fail("ids must be a list of fork chat ids.");
        selected = children.filter((session) => ids.includes(session.id));
        if (selected.length !== ids.length) return fail("One of those ids is not a fork chat started from this conversation.");
      }

      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => { stopped = true; };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        await Promise.race([
          Promise.all(selected.map((session) => runs.get(session.id)?.promise ?? Promise.resolve())),
          new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          }),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, deps.maxWaitMs ?? MAX_FORK_WAIT_MS); }),
        ]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }

      const freshAll = await deps.sessions();
      const fresh = freshAll.filter((session) => session.parentId === parent.id && selected.some((picked) => picked.id === session.id));
      const inbox = mailbox.take(parent.id, parent.id);
      const sections = fresh.map((session, index) => [
        `## ${String(index + 1)}. ${session.title} (${session.id}) - ${statusOf(session)}${outcomeDetail(session)}`,
        latestReport(session),
      ].join("\n"));
      const waiting = fresh.filter((session) => working(session.id)).length;
      return done([
        stopped
          ? `Stopped waiting. ${String(waiting)} fork${waiting === 1 ? " is" : "s are"} still working; ask again with wait_for_chat_forks.`
          : waiting > 0
            ? `Waited ${String(Math.round((deps.maxWaitMs ?? MAX_FORK_WAIT_MS) / 60_000))} minutes. ${String(fresh.length - waiting)} of ${String(fresh.length)} fork chat${fresh.length === 1 ? "" : "s"} finished; the rest are still working. Read their progress below, then wait again, send one a message, or stop it.`
            : `${String(fresh.length - waiting)} of ${String(fresh.length)} fork chat${fresh.length === 1 ? "" : "s"} finished.`,
        "",
        ...sections,
        ...(inbox.length === 0 ? [] : ["", "Messages for you:", formatInbox(inbox, titleMap(freshAll))]),
      ].join("\n"));
    },

    async list(session) {
      const sessions = await family(session);
      const root = familyRoot(session);
      const shown = sessions.filter((candidate) => candidate.id !== session.id);
      if (shown.length === 0) {
        return done(session.parentId === undefined ? "This chat has no fork chats yet." : "No other chats in this fork family yet.");
      }
      const labels = titleMap(sessions);
      const rootSession = sessions.find((candidate) => candidate.id === root);
      const main = rootSession === undefined ? [] : [`Main chat: ${rootSession.title} (${rootSession.id})`];
      const forks = shown;
      return done([...main, ...forks.map((candidate) => rosterLine(candidate, labels))].join("\n"));
    },

    async stop(from, input) {
      if (from.parentId !== undefined) return fail("Only the main chat can stop a fork.");
      const targetId = typeof input === "object" && input !== null && typeof (input as Record<string, unknown>)["id"] === "string"
        ? String((input as Record<string, unknown>)["id"]).trim()
        : "";
      if (targetId.length === 0) return fail("stop_chat needs a fork chat id.");
      const sessions = await deps.sessions();
      const target = sessions.find((session) => session.id === targetId && session.parentId === from.id);
      if (target === undefined) return fail("That id is not a fork chat started from this conversation.");
      if (!working(target.id)) return done(`${target.title} is not working.`);
      deps.cancel(target.id);
      return done(`Stopped ${target.title}. Its conversation and any changes it already made stay.`);
    },

    async deliver(session) {
      const messages = mailbox.take(familyRoot(session), session.id);
      if (messages.length === 0) return null;
      const sessions = await deps.sessions();
      return formatInbox(messages, titleMap(sessions));
    },
  };
}

export interface ChatForkRunnerOptions {
  readonly service: ChatForkService;
  /** The current thread's conversation. */
  readonly session: () => ChatSession | null;
}

/**
 * A chat's tool runner with the fork tools and automatic message delivery.
 *
 * Unread messages ride along with the result of whatever tool runs next. That is what
 * makes two forks feel like they are talking while both are mid-turn: neither has to stop
 * and poll, and a message cannot be lost between steps.
 */
export function withChatForks(inner: ToolRunner, options: ChatForkRunnerOptions): ToolRunner {
  return {
    async run(call, signal) {
      if (isChatForkTool(call.name)) {
        const session = options.session();
        if (session === null) return fail("This conversation is no longer open.");
        try {
          switch (call.name) {
            case FORK_CHATS_NAME: return await options.service.create(session, call.input);
            case SEND_CHAT_MESSAGE_NAME: return await options.service.send(session, call.input);
            case READ_CHAT_MESSAGES_NAME: return await options.service.read(session);
            case WAIT_FOR_CHAT_FORKS_NAME: return await options.service.wait(session, call.input, signal);
            case LIST_CHAT_FORKS_NAME: return await options.service.list(session);
            case STOP_CHAT_NAME: return await options.service.stop(session, call.input);
            default: return fail(`${call.name} is not available here.`);
          }
        } catch (error) {
          return fail(`The fork chats could not be reached: ${errorText(error)}`);
        }
      }
      const result = await inner.run(call, signal);
      const session = options.session();
      if (session === null) return result;
      const inbox = await options.service.deliver(session).catch(() => null);
      return inbox === null ? result : { ...result, content: `${result.content}\n\n${inbox}` };
    },
  };
}
