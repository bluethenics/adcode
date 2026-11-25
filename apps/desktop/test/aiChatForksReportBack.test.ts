import { describe, expect, it } from "vitest";
import { chatForkReportNote, forkChatSession, parseChatForkTasks, type ChatSession } from "@adcode/ai";
import { createChatForkService, REPORT_RETRY_MS } from "../src/main/aiChatForks.ts";

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

interface Turn {
  readonly sessionId: string;
  readonly text: string;
  finish(ok?: boolean): Promise<void>;
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

function harness(options: { readonly maxWakes?: number; readonly free?: () => number } = {}) {
  let sessions: ChatSession[] = [parent];
  const running = new Set<string>();
  const turns: Turn[] = [];
  const timers: { run: () => void; ms: number }[] = [];
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
      turns.push({
        sessionId,
        text,
        async finish(ok = true) {
          running.delete(sessionId);
          const found = sessions.find((one) => one.id === sessionId);
          if (found !== undefined) await write({ ...found, messages: [...found.messages, { role: "assistant", text: `report from ${sessionId}`, at: 100 }] });
          resolve(ok);
          await flush();
        },
      });
    }),
    cancel: () => undefined,
    freeSlots: options.free ?? (() => 4),
    id: () => `fork-${String(++nextId)}`,
    now: () => 50,
    reportBack: { later: (run, ms) => { timers.push({ run, ms }); }, ...(options.maxWakes === undefined ? {} : { maxWakes: options.maxWakes }) },
  });
  return { service, turns, timers, running, get sessions() { return sessions; } };
}

const two = { tasks: [{ title: "API", prompt: "Do the API" }, { title: "Tests", prompt: "Write tests", context: "fresh" }] };

describe("fresh fork chats", () => {
  it("parses context: fresh and refuses other values", () => {
    expect(parseChatForkTasks(two)).toEqual([{ title: "API", prompt: "Do the API" }, { title: "Tests", prompt: "Write tests", fresh: true }]);
    expect(parseChatForkTasks({ tasks: [{ title: "x", prompt: "y", context: "all" }] })).toMatch(/fork" or "fresh/);
  });

  it("starts a fresh fork with no copy of the conversation", () => {
    const fresh = forkChatSession({ parent: { ...parent, summary: { text: "older", replaces: 1 } as never }, id: "f1", title: "Tests", at: 9, fresh: true });
    expect(fresh.messages).toEqual([]);
    expect(fresh.summary).toBeNull();
    expect(forkChatSession({ parent, id: "f2", title: "API", at: 9 }).messages).toEqual(parent.messages);
  });

  it("the service creates the fresh one empty and the other with the transcript", async () => {
    const h = harness();
    await h.service.create(parent, two);
    const children = h.sessions.filter((one) => one.parentId === "main");
    expect(children.find((one) => one.title === "API")?.messages).toHaveLength(2);
    expect(children.find((one) => one.title === "Tests")?.messages).toHaveLength(0);
  });
});

describe("forks report back to an idle main chat", () => {
  it("waits for every fork, then wakes the main chat once with all the reports", async () => {
    const h = harness();
    await h.service.create(parent, two);
    expect(h.turns.map((turn) => turn.sessionId)).toEqual(["fork-1", "fork-2"]);
    await h.turns[0]!.finish();
    expect(h.turns).toHaveLength(2);
    await h.turns[1]!.finish();
    expect(h.turns).toHaveLength(3);
    const wake = h.turns[2]!;
    expect(wake.sessionId).toBe("main");
    expect(wake.text).toContain("Automatic note from ADCode, not from the person");
    expect(wake.text).toContain("## API (fork-1)");
    expect(wake.text).toContain("report from fork-2");
  });

  it("holds the report while the main chat is busy and delivers it when it is idle", async () => {
    const h = harness();
    await h.service.create(parent, { tasks: [{ title: "API", prompt: "Do it" }] });
    h.running.add("main");
    await h.turns[0]!.finish();
    expect(h.turns).toHaveLength(1);
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(REPORT_RETRY_MS);
    h.running.delete("main");
    h.timers[0]!.run();
    await flush();
    expect(h.turns.at(-1)?.sessionId).toBe("main");
  });

  it("does not report again what wait_for_chat_forks already returned", async () => {
    const h = harness();
    await h.service.create(parent, { tasks: [{ title: "API", prompt: "Do it" }] });
    h.running.add("main");
    await h.turns[0]!.finish();
    const result = await h.service.wait(parent, {}, new AbortController().signal);
    expect(result.content).toContain("report from fork-1");
    h.running.delete("main");
    h.timers[0]!.run();
    await flush();
    expect(h.turns.map((turn) => turn.sessionId)).toEqual(["fork-1"]);
  });

  it("stays quiet about a fork the person stopped", async () => {
    const h = harness();
    await h.service.create(parent, { tasks: [{ title: "API", prompt: "Do it" }] });
    await h.turns[0]!.finish(false);
    expect(h.turns).toHaveLength(1);
  });

  it("stops waking the main chat after the cap", async () => {
    const h = harness({ maxWakes: 1 });
    await h.service.create(parent, { tasks: [{ title: "A", prompt: "a" }] });
    await h.turns[0]!.finish();
    expect(h.turns.at(-1)?.sessionId).toBe("main");
    await h.turns.at(-1)!.finish();
    const sent = await h.service.send(parent, { to: "A", text: "one more thing" });
    expect(sent.isError).toBe(false);
    const again = h.turns.at(-1)!;
    expect(again.sessionId).toBe("fork-1");
    await again.finish();
    expect(h.turns.at(-1)).toBe(again);
  });
});

describe("the report note", () => {
  it("names each fork and its outcome", () => {
    const note = chatForkReportNote([{ title: "API", id: "f1", outcome: "finished", report: "Done: src/api.ts" }]);
    expect(note).toContain("your fork chat has finished");
    expect(note).toContain("## API (f1) - finished");
    expect(note).toContain("Done: src/api.ts");
  });
});
