import { describe, expect, it } from "vitest";
import {
  canComment, canEditRoom, canManageRoom, colourForUid, contentFingerprint, laneOpenForTakeover, noteIsStale,
  overlapWarnings, planProgress, roomCapabilities, roomPath, roomRoleFor, roomText, sanitiseRoomName, stepTransferable,
  type ArtifactLane, type ArtifactPlanStep, type ArtifactRoomMember,
} from "@adcode/collab";

const lane = (status: ArtifactLane["status"]): ArtifactLane => ({ provider: "claude", model: "sonnet", sponsorUid: null, status, task: "Fix the parser", updatedAt: 1 });

const member = (patch: Partial<ArtifactRoomMember> & Pick<ArtifactRoomMember, "uid">): ArtifactRoomMember => ({
  name: patch.uid, role: "editor", colour: "#34c759", watching: false, present: true, joinedAt: 1, lastSeen: 1,
  presence: { path: null, line: null }, lane: lane("idle"), ...patch,
});

describe("who may do what in a live artifact", () => {
  it("gives viewers a read-only seat and editors the shared plan", () => {
    expect(roomCapabilities("owner")).toEqual({ comment: true, editPlan: true, editBrain: true, lockPath: true, writeFiles: true, manage: true });
    expect(roomCapabilities("commenter")).toEqual({ comment: true, editPlan: false, editBrain: false, lockPath: false, writeFiles: false, manage: false });
    expect(roomCapabilities("viewer").comment).toBe(false);
    expect(canComment("viewer")).toBe(false);
    expect(canComment("commenter")).toBe(true);
    expect(canEditRoom("commenter")).toBe(false);
    expect(canEditRoom("editor")).toBe(true);
    expect(canManageRoom("editor")).toBe(false);
    expect(canManageRoom("owner")).toBe(true);
  });

  it("maps a new participant to their seat", () => {
    expect(roomRoleFor("owner", false)).toBe("owner");
    expect(roomRoleFor("viewer", false)).toBe("editor");
    expect(roomRoleFor("viewer", true)).toBe("viewer");
  });

  it("assigns the same colour on every machine", () => {
    expect(colourForUid("ana")).toBe(colourForUid("ana"));
    expect(colourForUid("ana")).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("the shared Brain", () => {
  const files = [{ path: "src/parser.ts", content: "export function parse() { return 1; }" }, { path: "README.md", content: "# App" }];

  it("flags a note when the file it is pinned to changes or disappears", () => {
    const note = { path: "src/parser.ts", anchor: contentFingerprint(files[0]!.content), retired: false };
    expect(noteIsStale(note, files)).toBe(false);
    expect(noteIsStale(note, [{ ...files[0]!, content: "export function parse() { return 2; }" }])).toBe(true);
    expect(noteIsStale(note, [])).toBe(true);
    expect(noteIsStale({ ...note, retired: true }, [])).toBe(false);
    expect(noteIsStale({ ...note, anchor: null }, [])).toBe(false);
  });
});

describe("the one plan", () => {
  const step = (patch: Partial<ArtifactPlanStep> & Pick<ArtifactPlanStep, "id" | "status">): ArtifactPlanStep =>
    ({ title: patch.id, ownerUid: "ana", updatedAt: 1, ...patch });

  it("counts progress from statuses, never from a guess", () => {
    expect(planProgress([])).toEqual({ done: 0, total: 0, percent: 0, blocked: 0 });
    expect(planProgress([step({ id: "a", status: "done" }), step({ id: "b", status: "doing" }), step({ id: "c", status: "blocked" })])).toEqual({ done: 1, total: 3, percent: 33, blocked: 1 });
  });

  it("transfers only work nobody has started", () => {
    expect(stepTransferable(step({ id: "a", status: "todo" }))).toBe(true);
    expect(stepTransferable(step({ id: "a", status: "doing" }))).toBe(false);
    expect(stepTransferable(step({ id: "a", status: "blocked" }))).toBe(false);
  });
});

describe("coordination context", () => {
  it("warns before two people type in the same file, and names who holds a lock", () => {
    const members = [
      member({ uid: "ana", name: "Ana", presence: { path: "src/app.ts", line: 4 } }),
      member({ uid: "ben", name: "Ben", presence: { path: "src/app.ts", line: 9 } }),
      member({ uid: "eve", name: "Eve", presence: { path: "src/other.ts", line: 1 } }),
    ];
    expect(overlapWarnings({ uid: "ana", presence: { path: "src/app.ts", line: 2 }, members, locks: [] })).toEqual([
      { path: "src/app.ts", kind: "same-file", uid: "ben", name: "Ben" },
    ]);
    expect(overlapWarnings({
      uid: "ana", presence: { path: "src/app.ts", line: 2 }, members,
      locks: [{ path: "src/app.ts", uid: "eve", name: "Eve", at: 3 }],
    })).toEqual([
      { path: "src/app.ts", kind: "locked", uid: "eve", name: "Eve" },
      { path: "src/app.ts", kind: "same-file", uid: "ben", name: "Ben" },
    ]);
    expect(overlapWarnings({ uid: "ana", presence: { path: null, line: null }, members, locks: [] })).toEqual([]);
  });

  it("lets a handoff or a lost agent be taken over", () => {
    expect(laneOpenForTakeover(lane("handoff"))).toBe(true);
    expect(laneOpenForTakeover(lane("offline"))).toBe(true);
    expect(laneOpenForTakeover(lane("working"))).toBe(false);
    expect(laneOpenForTakeover(lane("idle"))).toBe(false);
  });
});

describe("room input", () => {
  it("accepts only relative project paths", () => {
    expect(roomPath("src/app.ts")).toBe("src/app.ts");
    expect(roomPath(null)).toBeNull();
    for (const value of ["", "/etc/passwd", "C:/x", "a\\b", "a/../b", "a//b", "./a", "a/./b"]) expect(roomPath(value)).toBeNull();
  });

  it("trims text and refuses names with control characters", () => {
    expect(roomText("  hello  ", 1, 10)).toBe("hello");
    expect(roomText(" ", 1, 10)).toBeNull();
    expect(roomText("x".repeat(11), 1, 10)).toBeNull();
    expect(sanitiseRoomName(" Ana\u0000 ")).toBe("Ana");
    expect(sanitiseRoomName("   ")).toBeNull();
  });
});
