import { describe, expect, it } from "vitest";
import {
  CHAT_FORK_PARTICIPANT_TOOLS,
  CHAT_FORK_TOOLS,
  FORK_CHATS_NAME,
  MAX_CHAT_FORKS,
  STOP_CHAT_NAME,
  chatForkBriefing,
  forkChatSession,
  isChatForkTool,
  parseChatForkTasks,
} from "../src/chatForks.ts";
import { validateSession, type ChatSession } from "../src/sessions.ts";

const parent: ChatSession = {
  id: "main",
  title: "Ship the checkout",
  renamed: false,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { role: "user", text: "Fix checkout", at: 1 },
    { role: "assistant", text: "Here is the plan", at: 2 },
  ],
};

describe("fork tasks", () => {
  it("accepts one to three titled tasks", () => {
    expect(parseChatForkTasks({ tasks: [{ title: "API", prompt: "Document the routes" }] })).toEqual([
      { title: "API", prompt: "Document the routes" },
    ]);
  });

  it("refuses a call with no tasks, too many, or a blank field", () => {
    expect(parseChatForkTasks({})).toMatch(/one to 3/);
    expect(parseChatForkTasks({ tasks: [] })).toMatch(/one to 3/);
    expect(parseChatForkTasks({
      tasks: Array.from({ length: MAX_CHAT_FORKS + 1 }, (_, index) => ({ title: `T${String(index)}`, prompt: "work" })),
    })).toMatch(/At most 3/);
    expect(parseChatForkTasks({ tasks: [{ title: " ", prompt: "work" }] })).toMatch(/Task 1/);
    expect(parseChatForkTasks({ tasks: [{ title: "API", prompt: "" }] })).toMatch(/Task 1/);
  });

  it("bounds a title but keeps a long prompt", () => {
    const parsed = parseChatForkTasks({ tasks: [{ title: "x".repeat(300), prompt: "y".repeat(30_000) }] });
    expect(Array.isArray(parsed)).toBe(true);
    if (!Array.isArray(parsed)) return;
    expect(parsed[0]?.title).toHaveLength(120);
    expect(parsed[0]?.prompt).toHaveLength(20_000);
  });
});

describe("forkChatSession", () => {
  it("copies the conversation and names the main chat as the parent", () => {
    const child = forkChatSession({ parent, id: "fork-1", title: "Docs", task: "Write the API docs", at: 10 });
    expect(child).toMatchObject({
      id: "fork-1",
      title: "Docs",
      renamed: true,
      parentId: "main",
      forkedAt: 10,
      forkTask: "Write the API docs",
    });
    expect(child.messages).toEqual(parent.messages);
    // The copy is a copy: later divergence cannot change the parent.
    expect(child.messages).not.toBe(parent.messages);
    expect(child.messages[0]).not.toBe(parent.messages[0]);
  });

  it("points a fork of a fork at the same root", () => {
    const child = forkChatSession({ parent, id: "fork-1", title: "Docs", at: 10 });
    const grandchild = forkChatSession({ parent: child, id: "fork-2", title: "Tests", at: 11 });
    expect(grandchild.parentId).toBe("main");
  });

  it("rejects an id or time a session file could not hold", () => {
    expect(() => forkChatSession({ parent, id: "bad id", title: "Docs", at: 1 })).toThrow(/id/);
    expect(() => forkChatSession({ parent, id: "fork-1", title: "  ", at: 1 })).toThrow(/title/);
    expect(() => forkChatSession({ parent, id: "fork-1", title: "Docs", at: Number.NaN })).toThrow(/time/);
  });
});

describe("fork briefing", () => {
  it("says what the fork is, its part, and who its siblings are", () => {
    const text = chatForkBriefing({
      parentTitle: "Ship the checkout",
      task: "Write the API docs",
      siblings: ["Tests", "Migration"],
    });
    expect(text).toContain('fork chat started by "Ship the checkout"');
    expect(text).toContain("Your part: Write the API docs");
    expect(text).toContain("Tests, Migration");
    expect(text).toContain("send_chat_message");
    expect(text).toContain("short report");
  });

  it("leaves out a part and siblings that do not exist", () => {
    const text = chatForkBriefing({ parentTitle: "Main", task: " ", siblings: [] });
    expect(text).not.toContain("Your part");
    expect(text).not.toContain("sibling chats are");
  });
});

describe("fork tool access", () => {
  it("gives the main chat the tools to start and stop forks", () => {
    expect(CHAT_FORK_TOOLS.map((tool) => tool.name)).toContain(FORK_CHATS_NAME);
    expect(CHAT_FORK_TOOLS.map((tool) => tool.name)).toContain(STOP_CHAT_NAME);
  });

  it("never gives a fork the tools to start another", () => {
    const names = CHAT_FORK_PARTICIPANT_TOOLS.map((tool) => tool.name);
    expect(names).not.toContain(FORK_CHATS_NAME);
    expect(names).not.toContain(STOP_CHAT_NAME);
    expect(names).toContain("send_chat_message");
  });

  it("recognises every fork tool and nothing else", () => {
    for (const tool of CHAT_FORK_TOOLS) expect(isChatForkTool(tool.name)).toBe(true);
    expect(isChatForkTool("read_file")).toBe(false);
  });
});

describe("session validation", () => {
  it("keeps fork metadata and drops a malformed field", () => {
    const valid = validateSession({ ...parent, parentId: "main", forkedAt: 9, forkTask: "Docs" });
    expect(valid).toMatchObject({ parentId: "main", forkedAt: 9, forkTask: "Docs" });
    const invalid = validateSession({ ...parent, parentId: "bad id", forkedAt: -1, forkTask: "  " });
    expect(invalid?.parentId).toBeUndefined();
    expect(invalid?.forkedAt).toBeUndefined();
    expect(invalid?.forkTask).toBeUndefined();
  });
});
