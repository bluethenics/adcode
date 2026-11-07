import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(protected ctx: unknown, protected env: unknown) {}
  },
}));

import { ArtifactRoom } from "../src/artifactRoom.ts";

function state() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: unknown[]) {
      const statement = db.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? statement.all(...(args as never[])).map((row) => ({ ...row })) : (statement.run(...(args as never[])), []);
      return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error(`Expected one row, got ${rows.length}`); return rows[0]; } };
    },
  };
  const transactionSync = <T>(run: () => T): T => {
    db.exec("SAVEPOINT tx");
    try { const result = run(); db.exec("RELEASE tx"); return result; } catch (error) { db.exec("ROLLBACK TO tx"); db.exec("RELEASE tx"); throw error; }
  };
  return { storage: { sql, transactionSync, deleteAll: async () => {} } };
}

const ID = "artifactroom1";

let room: ArtifactRoom;
beforeEach(() => { room = new ArtifactRoom(state() as never, {} as never); });

describe("artifact live room", () => {
  it("opens with the owner in the room, a live invite and a stable snapshot", () => {
    const opened = room.open("ana", "Ana", ID, "Todo app", "adcollab:abc");
    expect(opened).toMatchObject({ artifactId: ID, title: "Todo app", hostUid: "ana", open: true, liveInvite: "adcollab:abc", selfId: "ana" });
    expect(opened.self).toEqual({ uid: "ana", name: "Ana", role: "owner" });
    expect(opened.members[0]).toMatchObject({ uid: "ana", role: "owner", present: true, watching: false });
    expect(opened.activity[0]!.kind).toBe("live.started");
  });

  it("keeps the joined role when somebody comes back, and refuses viewers a comment", () => {
    room.open("ana", "Ana", ID, "Todo app", null);
    const joined = room.join("ben", "Ben", "editor", false);
    expect(joined.members.find((one) => one.uid === "ben")).toMatchObject({ role: "editor", present: true });
    room.leave("ben");
    const back = room.join("ben", "Ben", "editor", false);
    expect(back.members.find((one) => one.uid === "ben")).toMatchObject({ role: "editor", present: true });
    room.setRole("ana", "ben", "commenter");
    room.commentAction("ben", { action: "add", path: "app.js", line: 2, text: "Should this be const?" });
    room.setRole("ana", "ben", "viewer");
    expect(() => room.commentAction("ben", { action: "add", path: "app.js", line: 2, text: "Still here?" })).toThrow(/\[403\]/);
    expect(() => room.post("ben", "Hello", "member")).toThrow(/\[403\]/);
  });

  it("runs the agent lane: heartbeat, handoff, takeover and the plan transfer", () => {
    room.open("ana", "Ana", ID, "Todo app", null);
    room.join("ben", "Ben", "editor", false);
    room.heartbeat("ben", { status: "working", task: "Rewriting the list", provider: "openai", model: "gpt-5", path: "app.js", line: 3 });
    let snapshot = room.heartbeat("ana", { path: "app.js" });
    expect(snapshot.warnings.map((one) => one.kind)).toContain("same-file");
    room.planAction("ben", { action: "add", id: "step-one", title: "Rewrite the list", ownerUid: "ben" });
    room.handoff("ben");
    snapshot = room.takeover("ana", "ben");
    expect(snapshot.plan.find((one) => one.id === "step-one")!.ownerUid).toBe("ana");
    expect(snapshot.members.find((one) => one.uid === "ana")!.lane.status).toBe("working");
  });

  it("holds one plan, one Brain and anchored comments, and closes read-only", () => {
    room.open("ana", "Ana", ID, "Todo app", null);
    room.join("ben", "Ben", "editor", false);
    room.planAction("ana", { action: "add", id: "step-one", title: "Rewrite the list", ownerUid: "ana" });
    room.planAction("ana", { action: "move", id: "step-one", status: "done" });
    room.noteAction("ana", { action: "add", path: "app.js", anchor: "deadbeef", text: "The list is the source of truth." });
    room.commentAction("ben", { action: "add", path: "app.js", line: 1, endLine: 2, text: "This is the entry point." });
    room.lockAction("ana", { action: "lock", path: "app.js" });
    const locked = room.snapshot("ben");
    expect(locked.plan[0]).toMatchObject({ status: "done" });
    expect(locked.notes[0]).toMatchObject({ anchor: "deadbeef", retired: false });
    expect(locked.comments[0]).toMatchObject({ line: 1, endLine: 2, resolved: false });
    expect(locked.locks[0]).toMatchObject({ path: "app.js", uid: "ana" });

    const closed = room.close("ana");
    expect(closed).toMatchObject({ open: false, liveInvite: null });
    expect(closed.members.every((one) => !one.present)).toBe(true);
    expect(() => room.heartbeat("ben", { status: "working" })).toThrow(/\[409\]/);
  });

  it("only lets the owner share the live invite and change roles", () => {
    room.open("ana", "Ana", ID, "Todo app", null);
    room.join("ben", "Ben", "editor", false);
    expect(() => room.setLive("ben", "adcollab:xyz")).toThrow(/\[403\]/);
    room.setLive("ana", "adcollab:xyz");
    expect(room.snapshot("ben").liveInvite).toBe("adcollab:xyz");
    expect(() => room.setRole("ben", "ana", "viewer")).toThrow(/\[403\]/);
    expect(() => room.setRole("ana", "ana", "editor")).toThrow(/\[409\]/);
  });
});
