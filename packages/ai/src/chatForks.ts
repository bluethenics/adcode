/**
 * Fork chats: one conversation starts others that stay visible.
 *
 * A helper (`delegate_task`) is a fresh agent the parent owns and whose report is folded
 * back into one tool result. A fork is different: it is a real conversation with its own
 * tab, its own history and its own lifetime. The parent starts it from a copy of the
 * conversation so it already knows the task, then talks to it like a teammate. Forks can
 * message each other while they work, which is what makes a divided task feel like a team
 * rather than four isolated prompts.
 *
 * This module is the pure part: the tools, the task validation, the fork record and the
 * briefing a fork reads. Running agents, mailboxes and files belong to the shell.
 */
import type { ChatSession } from "./sessions.ts";
import type { ToolDefinition } from "./types.ts";

/** How many forks one call may start. The chat runner has four slots in total. */
export const MAX_CHAT_FORKS = 3;
/** How many messages one fork family may exchange before it is told to finish. */
export const MAX_CHAT_FORK_MESSAGES = 40;
/** What one fork's final report may add to the parent's context. */
export const CHAT_FORK_REPORT_CHARS = 6_000;

export const FORK_CHATS_NAME = "fork_chats";
export const SEND_CHAT_MESSAGE_NAME = "send_chat_message";
export const READ_CHAT_MESSAGES_NAME = "read_chat_messages";
export const WAIT_FOR_CHAT_FORKS_NAME = "wait_for_chat_forks";
export const LIST_CHAT_FORKS_NAME = "list_chat_forks";
export const STOP_CHAT_NAME = "stop_chat";

export interface ChatForkTask {
  readonly title: string;
  readonly prompt: string;
}

/** The tasks a fork call asks for, or why they cannot run. */
export function parseChatForkTasks(input: unknown): readonly ChatForkTask[] | string {
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>)["tasks"] : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return `Pass tasks: a list of one to ${String(MAX_CHAT_FORKS)} { title, prompt } objects.`;
  if (raw.length > MAX_CHAT_FORKS) return `At most ${String(MAX_CHAT_FORKS)} fork chats per call. Group the work, or start the rest after these finish.`;
  const tasks: ChatForkTask[] = [];
  for (const [index, item] of raw.entries()) {
    const fields = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const title = typeof fields["title"] === "string" ? fields["title"].trim() : "";
    const prompt = typeof fields["prompt"] === "string" ? fields["prompt"].trim() : "";
    if (title === "" || prompt === "") return `Task ${String(index + 1)} needs a title and a prompt.`;
    tasks.push({ title: title.slice(0, 120), prompt: prompt.slice(0, 20_000) });
  }
  return tasks;
}

export interface ForkChatSessionInput {
  readonly parent: ChatSession;
  readonly id: string;
  readonly title: string;
  readonly task?: string;
  readonly at: number;
}

/**
 * A fork's saved conversation: the parent's transcript, then a new identity.
 *
 * The history is copied rather than referenced because the two conversations diverge from
 * this point. `parentId` always names the family's main chat, so a fork of a fork still
 * finds every sibling it is allowed to message.
 */
export function forkChatSession(input: ForkChatSessionInput): ChatSession {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) throw new Error("Fork chat id is invalid");
  if (!Number.isFinite(input.at) || input.at < 0) throw new Error("Fork chat time is invalid");
  const title = input.title.trim().slice(0, 120);
  if (title.length === 0) throw new Error("Fork chat title is invalid");
  const task = input.task?.trim() ?? "";
  return {
    id: input.id,
    title,
    renamed: true,
    createdAt: input.at,
    updatedAt: input.at,
    messages: input.parent.messages.map((message) => ({ ...message })),
    summary: input.parent.summary ?? null,
    parentId: input.parent.parentId ?? input.parent.id,
    forkedAt: input.at,
    ...(task.length === 0 ? {} : { forkTask: task.slice(0, 2_000) }),
  };
}

/**
 * What a fork is told before its first task: who it is, who its siblings are, and how to
 * talk to them without involving the person. This is context, not a transcript message -
 * the task itself is the first thing that appears in the fork's chat.
 */
export function chatForkBriefing(input: {
  readonly parentTitle: string;
  readonly task: string;
  readonly siblings: readonly string[];
}): string {
  const siblings = input.siblings.filter((title) => title.trim().length > 0);
  return [
    `You are a fork chat started by "${input.parentTitle}". You share the same project and files, but this is your own conversation.`,
    input.task.trim().length === 0 ? null : `Your part: ${input.task.trim()}`,
    siblings.length === 0 ? null : `Your sibling chats are: ${siblings.join(", ")}.`,
    `Use send_chat_message to ask a sibling or the main chat something, or to warn them about a shared file. Messages from them arrive between your tool calls; read_chat_messages shows anything still unread.`,
    `When your part is done, finish with a short report: what you changed or found (with file paths), how you checked it, and anything left undone. The main chat is waiting for it.`,
  ].filter((line): line is string => line !== null).join("\n");
}

/**
 * What the main chat is told when it may fork without being asked. The tool's own description
 * says what forks are; this says when to reach for them, so a model splits a large independent
 * job by itself instead of grinding through it serially (owner's request, 3 November 2026).
 */
export const AUTO_FORK_GUIDANCE = [
  "Parallel work: when the user's request has two or more independent parts that each need several steps of real work - separate features, separate files or areas, an investigation alongside a build, tests alongside the code - start them as fork chats with fork_chats instead of doing them one after another, and say in one line which forks you started.",
  "Keep small, quick or tightly connected work in this chat, and do not fork just to read a few files. Give each fork the files it owns so two forks never edit the same file, then collect their reports with wait_for_chat_forks, check the result, and summarise it for the user.",
].join(" ");

export const FORK_CHATS: ToolDefinition = {
  name: FORK_CHATS_NAME,
  description: [
    "Split a task into visible fork chats that work at the same time.",
    "A fork is a real conversation with its own tab, not a hidden helper: it starts with a copy of this conversation and its own task, and you can send it more instructions, read its report or stop it later.",
    "Use it when the parts can run independently - research several areas, build separate files or features, write tests while another part is built. Give each fork everything it needs in its prompt: it cannot see what happens here after the fork unless you message it.",
    "Fork chats can message you and each other with send_chat_message. Collect their reports with wait_for_chat_forks before you tell the user the work is done.",
    `Up to ${String(MAX_CHAT_FORKS)} forks per call. Do small or tightly connected work yourself instead.`,
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_CHAT_FORKS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "A few words naming the fork, shown as its chat title" },
            prompt: { type: "string", description: "Everything the fork needs: the goal, files or area, constraints, and what to report back" },
          },
          required: ["title", "prompt"],
        },
      },
    },
    required: ["tasks"],
  },
  mutating: true,
};

export const SEND_CHAT_MESSAGE: ToolDefinition = {
  name: SEND_CHAT_MESSAGE_NAME,
  description:
    "Send a short message to the main chat, one fork, or every fork in this family. Use it to hand over a decision, warn about a file another chat is editing, ask a question, or give a fork its next instruction. A message to a chat that is idle starts it working on that message; one to a chat that is busy reaches it at its next step. Keep it to what the recipient needs.",
  inputSchema: {
    type: "object",
    properties: {
      to: { type: "string", description: "A chat id, a fork title, 'parent', or 'all'" },
      text: { type: "string", description: "The message, one or two sentences" },
    },
    required: ["to", "text"],
  },
  mutating: false,
};

export const READ_CHAT_MESSAGES: ToolDefinition = {
  name: READ_CHAT_MESSAGES_NAME,
  description: "Read messages from the main chat or sibling forks that you have not seen yet.",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
  concurrent: true,
};

export const WAIT_FOR_CHAT_FORKS: ToolDefinition = {
  name: WAIT_FOR_CHAT_FORKS_NAME,
  description:
    "Wait until some or all fork chats in this family are no longer working, then return their status and final reports. Use it after starting forks, and again after sending one a follow-up. Waiting does not stop them; you can still be messaged while you wait.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        description: "Fork chat ids to wait for. Omit to wait for every fork started from this chat.",
      },
    },
  },
  mutating: false,
  concurrent: true,
};

export const LIST_CHAT_FORKS: ToolDefinition = {
  name: LIST_CHAT_FORKS_NAME,
  description: "List the chats in this fork family: their ids, titles, whether they are working, and their latest reply.",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
  concurrent: true,
};

export const STOP_CHAT: ToolDefinition = {
  name: STOP_CHAT_NAME,
  description: "Stop a fork chat that is working. Its conversation and any changes it already made stay.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "The fork chat id" } },
    required: ["id"],
  },
  mutating: false,
};

/** What the main chat is offered: starts forks and manages them. */
export const CHAT_FORK_TOOLS: readonly ToolDefinition[] = [
  FORK_CHATS,
  SEND_CHAT_MESSAGE,
  READ_CHAT_MESSAGES,
  WAIT_FOR_CHAT_FORKS,
  LIST_CHAT_FORKS,
  STOP_CHAT,
];

/** What a fork is offered: talks to its family, but cannot start more forks. */
export const CHAT_FORK_PARTICIPANT_TOOLS: readonly ToolDefinition[] = [
  SEND_CHAT_MESSAGE,
  READ_CHAT_MESSAGES,
  LIST_CHAT_FORKS,
];

const CHAT_FORK_TOOL_NAMES: ReadonlySet<string> = new Set([
  FORK_CHATS_NAME,
  SEND_CHAT_MESSAGE_NAME,
  READ_CHAT_MESSAGES_NAME,
  WAIT_FOR_CHAT_FORKS_NAME,
  LIST_CHAT_FORKS_NAME,
  STOP_CHAT_NAME,
]);

export function isChatForkTool(name: string): boolean {
  return CHAT_FORK_TOOL_NAMES.has(name);
}
