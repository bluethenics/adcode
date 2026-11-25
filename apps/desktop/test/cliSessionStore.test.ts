import { describe, expect, it } from "vitest";
import { CLI_AGENTS, STALE_SESSION, createCliProvider, type CliProcess, type CliSpawn } from "@adcode/ai";
import { createCliSessionStore, type CliSessionIo } from "../src/main/cliSessionStore.ts";

function memoryIo(initial: string | null = null): CliSessionIo & { text: string | null; writes: number } {
  const io = {
    text: initial,
    writes: 0,
    read: () => io.text,
    write: (text: string) => { io.text = text; io.writes += 1; },
  };
  return io;
}

function manualTimers() {
  const queue: (() => void)[] = [];
  return { later: (run: () => void) => { queue.push(run); }, run: () => { for (const job of queue.splice(0)) job(); } };
}

describe("CLI sessions kept across restarts", () => {
  it("saves a chat's CLI session and gives it back after a restart", () => {
    const io = memoryIo();
    const timers = manualTimers();
    const first = createCliSessionStore(io, { later: timers.later, now: () => 10 });
    first.forCli("claude").set("claude:opus:chat:c1", { id: "sess-1", messages: 4 });
    expect(io.writes).toBe(0);
    timers.run();
    expect(io.writes).toBe(1);

    const restarted = createCliSessionStore(io);
    expect(restarted.forCli("claude").get("claude:opus:chat:c1")).toEqual({ id: "sess-1", messages: 4 });
    expect(restarted.forCli("codex").size).toBe(0);
  });

  it("hands every provider the same map, and forgets deleted sessions", () => {
    const io = memoryIo();
    const timers = manualTimers();
    const store = createCliSessionStore(io, { later: timers.later });
    const map = store.forCli("codex");
    expect(store.forCli("codex")).toBe(map);
    map.set("k", { id: "t-1", messages: 2 });
    map.delete("k");
    timers.run();
    expect(createCliSessionStore(io).forCli("codex").has("k")).toBe(false);
  });

  it("keeps only the newest chats per CLI", () => {
    const io = memoryIo();
    const timers = manualTimers();
    let clock = 0;
    const store = createCliSessionStore(io, { later: timers.later, now: () => ++clock, max: 2 });
    const map = store.forCli("claude");
    for (const key of ["a", "b", "c"]) map.set(key, { id: key, messages: 1 });
    timers.run();
    expect([...createCliSessionStore(io).forCli("claude").keys()].sort()).toEqual(["b", "c"]);
  });

  it("starts empty from a damaged file, and flush writes at once", () => {
    const io = memoryIo("{not json");
    const store = createCliSessionStore(io, { later: () => undefined });
    expect(store.forCli("claude").size).toBe(0);
    store.forCli("claude").set("k", { id: "s", messages: 1 });
    store.flush();
    expect(io.writes).toBe(1);
  });
});

describe("a saved session the CLI no longer has", () => {
  it("recognises the CLIs' own words for a missing session", () => {
    expect(STALE_SESSION.test("No conversation found with session ID: 6808f6e8")).toBe(true);
    expect(STALE_SESSION.test("thread 01a1 not found")).toBe(true);
    expect(STALE_SESSION.test("Not logged in · Please run /login")).toBe(false);
  });

  it("forgets the session and says to send again, instead of failing the same way forever", async () => {
    const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
    const sessions = new Map([["claude:default:chat:c1", { id: "gone", messages: 2 }]]);
    const lines = [`{"type":"result","subtype":"error_during_execution","is_error":true,"result":"No conversation found with session ID: gone"}`];
    const spawn: CliSpawn = () => ({ lines: (async function* () { yield* lines; })(), exit: Promise.resolve(1), stderr: () => "No conversation found with session ID: gone", kill: () => undefined }) satisfies CliProcess;
    const provider = createCliProvider({ spec: claude, models: ["default"], spawn, cwd: () => "E:/p", sessions, conversation: () => "c1" });
    const request = { model: "default", system: "", tools: [], maxTokens: 100, messages: [
      { role: "user" as const, content: [{ type: "text" as const, text: "start" }] },
      { role: "assistant" as const, content: [{ type: "text" as const, text: "ok" }] },
      { role: "user" as const, content: [{ type: "text" as const, text: "continue" }] },
    ] };
    await expect((async () => { for await (const event of provider.stream(request, new AbortController().signal)) void event; })()).rejects.toThrow(/no longer has this chat's earlier session/);
    expect(sessions.has("claude:default:chat:c1")).toBe(false);
  });
});
