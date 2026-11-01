import { describe, expect, it } from "vitest";
import type { ChatSession, ToolRunner } from "@adcode/ai";
import {
  MAX_FORKS_PER_CHAT,
  createChatForkService,
  withChatForks,
  type ChatForkService,
} from "../src/main/aiChatForks.ts";

const parent: ChatSession = {
  id: "main",
  title: "Ship checkout",
  renamed: false,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { role: "user", text: "Fix checkout", at: 1 },
    { role: "assistant", text: "Plan ready", at: 2 },
  ],
};

interface PendingTurn {
  readonly sessionId: string;
  readonly text: string;
  finish(ok?: boolean): Promise<void>;
  fail(detail: string): Promise<void>;
}

function harness(options: { readonly free?: () => number } = {}) {
  let sessions: ChatSession[] = [parent];
  const running = new Set<string>();
  const pending: PendingTurn[] = [];
  const cancelled: string[] = [];
  let nextId = 0;

  const write = async (session: ChatSession): Promise<void> => {
    sessions = [...sessions.filter((one) => one.id !== session.id), session];
  };
  const service = createChatForkService({
    sessions: async () => sessions,
    write,
    isRunning: (id) => running.has(id),
    startTurn: (sessionId, text) => new Promise<boolean>((resolve) => {
      running.add(sessionId);
      pending.push({
        sessionId,
        text,
        async finish(ok = true) {
          running.delete(sessionId);
          const found = sessions.find((one) => one.id === sessionId);
          if (found !== undefined) {
            await write({
              ...found,
              updatedAt: 100,
              messages: [...found.messages, { role: "assistant", text: `report from ${sessionId}`, at: 100 }],
            });
          }
          resolve(ok);
        },
        async fail(detail) {
          running.delete(sessionId);
          resolve(false);
          void detail;
        },
      });
    }),
    cancel: (id) => { cancelled.push(id); },
    freeSlots: options.free ?? (() => 4),
    id: () => `fork-${String(++nextId)}`,
    now: () => 50,
  });

  return {
    service,
    get sessions() { return sessions; },
    pending,
    cancelled,
    running,
    write,
  };
}

const tasks = (count = 2) => ({
  tasks: Array.from({ length: count }, (_, index) => ({
    title: `Part ${String(index + 1)}`,
    prompt: `Do part ${String(index + 1)}`,
  })),
});

async function started(service: ChatForkService, parentSession: ChatSession, count = 2) {
  const result = await service.create(parentSession, tasks(count));
  expect(result.isError).toBe(false);
  return result;
}

describe("chat fork service", () => {
  it("creates visible conversations that inherit the parent and start their part", async () => {
    const h = harness();
    const result = await started(h.service, parent);
    expect(result.content).toContain("Started 2 fork chats");
    const children = h.sessions.filter((one) => one.parentId === "main");
    expect(children.map((one) => one.title)).toEqual(["Part 1", "Part 2"]);
    expect(children[0]?.messages).toEqual(parent.messages);
    expect(children[0]?.forkTask).toBe("Do part 1");
    expect(h.pending.map((turn) => [turn.sessionId, turn.text])).toEqual([
      ["fork-1", "Do part 1"],
      ["fork-2", "Do part 2"],
    ]);
  });

  it("refuses a fork starting workers, too many forks, or no free chat slots", async () => {
    const h = harness();
    const fork = { ...parent, id: "fork-9", parentId: "main" };
    expect((await h.service.create(fork, tasks(1))).content).toMatch(/Only the main chat/);

    h.sessions.push(...Array.from({ length: MAX_FORKS_PER_CHAT }, (_, index) => ({
      ...parent,
      id: `existing-${String(index)}`,
      parentId: "main",
    })));
    expect((await h.service.create(parent, tasks(1))).content).toMatch(/At most 6/);

    const tight = harness({ free: () => 1 });
    expect((await tight.service.create(parent, tasks(2))).content).toMatch(/Only 1 chat slot/);
  });

  it("sends to a busy fork through the mailbox and starts an idle one", async () => {
    const h = harness();
    await started(h.service, parent);
    // Both are still working from the spawn: a message waits for the next tool call.
    expect((await h.service.send(parent, { to: "Part 1", text: "Check the tests" })).content).toMatch(/reaches it at its next step/);
    await h.pending[0]?.finish();
    // Part 1 is idle now; the message starts a new turn.
    expect((await h.service.send(parent, { to: "fork-1", text: "Now update the docs" })).content).toMatch(/it is working on that now/);
    expect(h.pending.at(-1)?.text).toBe("Now update the docs");
  });

  it("delivers messages once, with the sender's title", async () => {
    const h = harness();
    await started(h.service, parent, 1);
    // The fork is still working, so the message waits in its mailbox.
    await h.service.send(parent, { to: "Part 1", text: "Use the new endpoint" });
    const fork = { ...parent, id: "fork-1", parentId: "main", title: "Part 1" };
    const inbox = await h.service.deliver(fork);
    expect(inbox).toContain("Ship checkout: Use the new endpoint");
    expect(await h.service.deliver(fork)).toBeNull();
    // Reading through the tool also consumes the mailbox.
    expect((await h.service.read(fork)).content).toMatch(/No new messages/);
  });

  it("waits for the selected forks and returns their reports", async () => {
    const h = harness();
    await started(h.service, parent, 2);
    const waiting = h.service.wait(parent, {}, new AbortController().signal);
    await h.pending[0]?.finish();
    await h.pending[1]?.finish();
    const result = await waiting;
    expect(result.content).toContain("2 of 2 fork chats finished");
    expect(result.content).toContain("report from fork-1");
    expect(result.content).toContain("report from fork-2");
  });

  it("lists the family, stops a named fork and keeps a fork out of the stop tool", async () => {
    const h = harness();
    await started(h.service, parent, 2);
    const list = await h.service.list(parent);
    expect(list.content).toContain("Main chat: Ship checkout (main)");
    expect(list.content).toContain("Part 1");
    expect((await h.service.stop(parent, { id: "fork-1" })).content).toMatch(/Stopped Part 1/);
    expect(h.cancelled).toEqual(["fork-1"]);
    expect((await h.service.stop({ ...parent, id: "fork-1", parentId: "main" }, { id: "fork-2" })).content).toMatch(/Only the main chat/);
  });

  it("refuses a message to itself or a stranger", async () => {
    const h = harness();
    await started(h.service, parent, 1);
    expect((await h.service.send(parent, { to: "main", text: "hello" })).content).toMatch(/yourself/);
    expect((await h.service.send(parent, { to: "nobody", text: "hello" })).content).toMatch(/No chat called/);
  });

  it("limits how many messages a family may exchange", async () => {
    const h = harness();
    await started(h.service, parent, 1);
    // The fork is still working, so every message goes to its mailbox and spends one exchange.
    for (let index = 0; index < 40; index++) {
      expect((await h.service.send(parent, { to: "Part 1", text: `note ${String(index)}` })).isError).toBe(false);
    }
    expect((await h.service.send(parent, { to: "Part 1", text: "one too many" })).content).toMatch(/exchanged 40 messages/);
  });
});

describe("withChatForks", () => {
  const quiet: ChatForkService = {
    create: async () => ({ content: "", isError: false }),
    send: async () => ({ content: "", isError: false }),
    read: async () => ({ content: "", isError: false }),
    wait: async () => ({ content: "", isError: false }),
    list: async () => ({ content: "", isError: false }),
    stop: async () => ({ content: "", isError: false }),
    deliver: async () => null,
  };

  it("appends unread messages to the next tool result", async () => {
    const calls: string[] = [];
    const inner: ToolRunner = {
      async run(call) {
        calls.push(call.name);
        return { content: "read ok", isError: false };
      },
    };
    const service: ChatForkService = {
      ...quiet,
      deliver: async () => "Messages from your teammates:\n- Ship checkout: I renamed the file",
    };
    const runner = withChatForks(inner, { service, session: () => parent });
    const result = await runner.run({ type: "tool-call", id: "1", name: "read_file", input: {} }, new AbortController().signal);
    expect(calls).toEqual(["read_file"]);
    expect(result.content).toContain("read ok");
    expect(result.content).toContain("I renamed the file");
  });

  it("routes a fork tool to the service without touching the file runner", async () => {
    let seen: string | null = null;
    const inner: ToolRunner = {
      async run(call) {
        seen = call.name;
        return { content: "file runner", isError: false };
      },
    };
    const service: ChatForkService = {
      ...quiet,
      list: async () => ({ content: "fork roster", isError: false }),
    };
    const runner = withChatForks(inner, { service, session: () => parent });
    const result = await runner.run({ type: "tool-call", id: "1", name: "list_chat_forks", input: {} }, new AbortController().signal);
    expect(result.content).toBe("fork roster");
    expect(seen).toBeNull();
  });

  it("answers for a closed conversation instead of running a fork tool", async () => {
    const runner = withChatForks(
      { run: async () => ({ content: "should not run", isError: false }) },
      { service: quiet, session: () => null },
    );
    const result = await runner.run({ type: "tool-call", id: "1", name: "fork_chats", input: tasks(1) }, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no longer open/);
  });
});
