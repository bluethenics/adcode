/*
 * The browser's connection to its sandbox.
 *
 * Networks drop. When one does mid-way through an agent's turn, the turn keeps running in the
 * sandbox - so what matters is what the tab does with the calls it had in flight. A read is
 * safe to ask again. A write is not: re-sending `ai.send` would start a second agent turn, and
 * re-sending a commit could commit twice. These tests pin that difference, and that a refused
 * sign-in stops the reconnect loop instead of hammering the server.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "../src/shared/api.ts";
import { READ_CHANNELS, createHostSocket, type WebSocketLike } from "../src/web/socket.ts";
import { createWebApi } from "../src/web/webApi.ts";
import { decodeFrame, encodeFrame, type ClientFrame, type ServerFrame } from "../src/web/wire.ts";

const HELLO: ServerFrame = { t: "ready", host: { version: "1", surface: "web", projectsHome: "/home/adcode/projects" } };

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: ClientFrame[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  send(text: string): void {
    this.sent.push(decodeFrame(text) as ClientFrame);
  }
  close(): void {
    this.drop(1000);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
    this.deliver(HELLO);
  }
  deliver(frame: ServerFrame): void {
    this.onmessage?.({ data: encodeFrame(frame) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  calls(): Extract<ClientFrame, { t: "call" }>[] {
    return this.sent.filter((frame): frame is Extract<ClientFrame, { t: "call" }> => frame.t === "call");
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const socket = createHostSocket(() => {
    const fake = new FakeSocket();
    sockets.push(fake);
    return fake;
  }, { backoffMs: [0] });
  return { socket, sockets, latest: () => sockets[sockets.length - 1]! };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("host socket", () => {
  it("waits for the host's greeting, then sends and resolves calls", async () => {
    const { socket, latest } = harness();
    const answer = socket.invoke(CHANNELS.settingsRead, []);
    expect(latest().sent).toEqual([]);
    latest().open();
    const [call] = latest().calls();
    expect(call).toMatchObject({ ch: CHANNELS.settingsRead, args: [] });
    latest().deliver({ t: "ret", id: call!.id, ok: true, value: { theme: "dark" } });
    await expect(answer).resolves.toEqual({ theme: "dark" });
  });

  it("rejects a failed call the way Electron words it", async () => {
    const { socket, latest } = harness();
    latest().open();
    const answer = socket.invoke(CHANNELS.gitCommit, ["msg"]);
    latest().deliver({ t: "ret", id: latest().calls()[0]!.id, ok: false, error: "nothing to commit" });
    await expect(answer).rejects.toThrow(`Error invoking remote method '${CHANNELS.gitCommit}': Error: nothing to commit`);
  });

  it("hands broadcasts to every subscriber of that channel, and stops after unsubscribe", () => {
    const { socket, latest } = harness();
    latest().open();
    const seen: unknown[] = [];
    const stop = socket.subscribe(CHANNELS.aiEvent, (...args) => seen.push(args));
    latest().deliver({ t: "evt", ch: CHANNELS.aiEvent, args: [{ kind: "text" }] });
    stop();
    latest().deliver({ t: "evt", ch: CHANNELS.aiEvent, args: [{ kind: "late" }] });
    expect(seen).toEqual([[{ kind: "text" }]]);
  });

  it("asks a read again after a reconnect, and it resolves", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    const answer = socket.invoke(CHANNELS.gitStatus, []);
    sockets[0]!.drop();
    await tick();
    expect(sockets.length).toBe(2);
    latest().open();
    const resent = latest().calls().find((frame) => frame.ch === CHANNELS.gitStatus);
    expect(resent).toBeDefined();
    latest().deliver({ t: "ret", id: resent!.id, ok: true, value: "clean" });
    await expect(answer).resolves.toBe("clean");
  });

  it("rejects a write in flight when the connection drops, and never sends it again", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    const turn = socket.invoke(CHANNELS.aiSend, ["build a snake game"]);
    sockets[0]!.drop();
    await expect(turn).rejects.toThrow("Connection lost before this finished. Try again.");
    await tick();
    latest().open();
    expect(latest().calls().some((frame) => frame.ch === CHANNELS.aiSend)).toBe(false);
  });

  it("sends a write made while disconnected once it is back, because it never left", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    sockets[0]!.drop();
    const commit = socket.invoke(CHANNELS.gitCommit, ["later"]);
    await tick();
    latest().open();
    const sent = latest().calls().find((frame) => frame.ch === CHANNELS.gitCommit);
    expect(sent?.args).toEqual(["later"]);
    latest().deliver({ t: "ret", id: sent!.id, ok: true, value: true });
    await expect(commit).resolves.toBe(true);
  });

  it("keeps only the latest session save while disconnected, and drops other sends", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    sockets[0]!.drop();
    socket.send(CHANNELS.sessionSave, [{ v: 1 }]);
    socket.send(CHANNELS.sessionSave, [{ v: 2 }]);
    socket.send(CHANNELS.milestoneRecord, ["x"]);
    await tick();
    latest().open();
    const sends = latest().sent.filter((frame) => frame.t === "send");
    expect(sends).toEqual([{ t: "send", ch: CHANNELS.sessionSave, args: [{ v: 2 }] }]);
  });

  it("stops reconnecting when the sign-in is refused, and says so", async () => {
    const { socket, sockets, latest } = harness();
    const states: string[] = [];
    socket.onStatus((state) => states.push(state));
    latest().open();
    const pending = socket.invoke(CHANNELS.gitStatus, []);
    sockets[0]!.drop(4401);
    await expect(pending).rejects.toThrow();
    await tick();
    expect(sockets.length).toBe(1);
    expect(states).toContain("auth-failed");
  });

  it("answers the host's questions with the browser's answer", async () => {
    const { socket, latest } = harness();
    socket.onAsk(async (kind, payload) => (kind === "pickFolder" ? { path: "/p/snake", payload } : null));
    latest().open();
    latest().deliver({ t: "ask", id: 7, kind: "pickFolder", payload: { title: "Open" } });
    await tick();
    expect(latest().sent.find((frame) => frame.t === "answer")).toEqual({ t: "answer", id: 7, ok: true, value: { path: "/p/snake", payload: { title: "Open" } } });
  });

  it("treats only reads as safe to repeat", () => {
    for (const read of [CHANNELS.gitStatus, CHANNELS.settingsRead, CHANNELS.aiSessions, CHANNELS.searchRun, CHANNELS.quickOpen]) expect(READ_CHANNELS.has(read)).toBe(true);
    for (const write of [CHANNELS.aiSend, CHANNELS.gitCommit, CHANNELS.gitPush, CHANNELS.aiClearSessions, CHANNELS.gitSetIdentity, CHANNELS.workspaceClearRecents, CHANNELS.fsWrite, CHANNELS.workspaceOpen]) {
      expect(READ_CHANNELS.has(write)).toBe(false);
    }
  });

  it("passes cloud status to its listeners", () => {
    const { socket, latest } = harness();
    const seen: unknown[] = [];
    socket.onCloud((status) => seen.push(status.state));
    latest().open();
    latest().deliver({ t: "cloud", status: { state: "ready", allowanceMs: 1, usedMs: 0, resetsAt: 0 } });
    expect(seen).toEqual(["ready"]);
  });
});

describe("web api", () => {
  it("puts fixed arguments ahead of the caller's", () => {
    const { socket, latest } = harness();
    latest().open();
    const api = createWebApi(socket, {});
    void api.debug.resume();
    expect(latest().calls()[0]).toMatchObject({ ch: CHANNELS.debugControl, args: ["resume"] });
  });

  it("uses the browser's own answer where one is given", async () => {
    const { socket } = harness();
    const api = createWebApi(socket, { "clipboard.readText": async () => "from the browser" });
    await expect(api.clipboard.readText()).resolves.toBe("from the browser");
  });

  it("routes fire-and-forget methods as sends and listeners as subscriptions", () => {
    const { socket, latest } = harness();
    latest().open();
    const api = createWebApi(socket, {});
    api.milestones.record("project_created");
    const seen: unknown[] = [];
    api.settings.onChanged((settings) => seen.push(settings));
    latest().deliver({ t: "evt", ch: CHANNELS.settingsChanged, args: [{ a: 1 }] });
    expect(latest().sent.at(-1)).toEqual({ t: "send", ch: CHANNELS.milestoneRecord, args: ["project_created"] });
    expect(seen).toEqual([{ a: 1 }]);
  });
});

describe("web-only operations over the socket", () => {
  it("resolves an op with the host's answer", async () => {
    const { socket, latest } = harness();
    latest().open();
    const answer = socket.op("projects", []);
    const sent = latest().sent.find((frame) => frame.t === "op") as Extract<ClientFrame, { t: "op" }>;
    latest().deliver({ t: "opRet", id: sent.id, ok: true, value: ["snake"] });
    await expect(answer).resolves.toEqual(["snake"]);
  });

  it("rejects in-flight project operations when authentication is refused", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    const operations = [socket.op("cloneProject", ["https://github.com/example/project"]), socket.op("projects", [])];
    const settled = Promise.allSettled(operations);
    latest().drop(4401);

    expect(await settled).toEqual([
      { status: "rejected", reason: new Error("Signed out. Sign in again to continue.") },
      { status: "rejected", reason: new Error("Signed out. Sign in again to continue.") },
    ]);
    await tick();
    expect(socket.state()).toBe("auth-failed");
    expect(sockets).toHaveLength(1);
  });

  it("rejects in-flight project operations after a network drop without replaying them", async () => {
    const { socket, sockets, latest } = harness();
    latest().open();
    const operation = socket.op("cloneProject", ["https://github.com/example/project"]);
    const settled = Promise.allSettled([operation]);
    latest().drop();

    expect(await settled).toEqual([
      { status: "rejected", reason: new Error("Connection lost before this finished. Try again.") },
    ]);
    await tick();
    latest().open();
    expect(sockets).toHaveLength(2);
    expect(latest().sent.some((frame) => frame.t === "op")).toBe(false);
    socket.close();
  });
});

describe("pausing", () => {
  it("does not reconnect on its own after the cloud put the sandbox to sleep, until resumed", async () => {
    const { socket, sockets, latest } = harness();
    const states: string[] = [];
    socket.onStatus((state) => states.push(state));
    latest().open();
    sockets[0]!.drop(4408);
    await tick();
    expect(sockets.length).toBe(1);
    expect(socket.state()).toBe("paused");
    socket.resume();
    await tick();
    expect(sockets.length).toBe(2);
    latest().open();
    expect(socket.state()).toBe("open");
    expect(states).toEqual(["open", "paused", "connecting", "open"]);
  });

  it("treats a spent allowance and a full month as paused too", async () => {
    for (const code of [4429, 4402]) {
      const { socket, sockets, latest } = harness();
      latest().open();
      sockets[0]!.drop(code);
      await tick();
      expect(socket.state()).toBe("paused");
      expect(sockets.length).toBe(1);
    }
  });

  it("waits and tries again when every sandbox is busy", async () => {
    const sockets: FakeSocket[] = [];
    const socket = createHostSocket(() => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    }, { backoffMs: [0], busyRetryMs: 5 });
    sockets[0]!.open();
    sockets[0]!.drop(4503);
    expect(socket.state()).toBe("reconnecting");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sockets.length).toBe(2);
  });

  it("checks busy capacity promptly, backs off with jitter, and resets after admission", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const sockets: FakeSocket[] = [];
    const socket = createHostSocket(() => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    });
    for (const delay of [4_500, 9_000, 13_500, 13_500]) {
      const count = sockets.length;
      sockets.at(-1)!.drop(4503);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(count + 1);
    }
    sockets.at(-1)!.open();
    sockets.at(-1)!.drop(4503);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(sockets).toHaveLength(6);
    socket.close();
  });

  it("keeps startup calls queued through capacity retries and sends them once admitted", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const socket = createHostSocket(() => {
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    }, { busyRetryMs: 5 });
    const answer = socket.invoke(CHANNELS.settingsRead, []);
    for (let retry = 0; retry < 3; retry += 1) {
      sockets.at(-1)!.drop(4503);
      await vi.advanceTimersByTimeAsync(5);
      expect(sockets.flatMap((fake) => fake.calls())).toEqual([]);
    }
    const admitted = sockets.at(-1)!;
    admitted.open();
    expect(admitted.calls()).toHaveLength(1);
    admitted.deliver({ t: "ret", id: admitted.calls()[0]!.id, ok: true, value: { theme: "dark" } });
    await expect(answer).resolves.toEqual({ theme: "dark" });
    socket.close();
  });
});
