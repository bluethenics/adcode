import { describe, expect, it } from "vitest";
import {
  canComment, canEditRoom, canManageRoom, colourForUid, commentIsStale, contentFingerprint, joinChecks,
  laneOpenForTakeover, noteIsStale, overlapWarnings, planProgress, roomBranch, roomCapabilities, roomCardFromSnapshot,
  roomPath, roomPaths, roomRoleFor, roomText, sanitiseRoomName, stepClaimable, stepTransferable,
  type ArtifactLane, type ArtifactPlanStep, type ArtifactRoomMember, type ArtifactRoomSnapshot,
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

  it("claims unowned or own todo work, never a started step", () => {
    expect(stepClaimable(step({ id: "a", status: "todo", ownerUid: null }), "ben")).toBe(true);
    expect(stepClaimable(step({ id: "a", status: "todo", ownerUid: "ben" }), "ben")).toBe(true);
    expect(stepClaimable(step({ id: "a", status: "todo", ownerUid: "ana" }), "ben")).toBe(false);
    expect(stepClaimable(step({ id: "a", status: "doing", ownerUid: null }), "ben")).toBe(false);
  });
});

describe("coordination context", () => {
  it("warns about a planned file and a related task, not only an open file", () => {
    const members = [
      member({ uid: "ana", name: "Ana", lane: { ...lane("working"), task: "Rewrite the parser" } }),
      member({ uid: "ben", name: "Ben", presence: { path: "src/app.ts", line: 1 }, lane: { ...lane("working"), task: "Fix the parser error" } }),
    ];
    const warnings = overlapWarnings({
      uid: "ana", presence: { path: "src/app.ts", line: 1 }, members, locks: [], task: "Rewrite the parser",
      plan: [{ id: "step-one", title: "Touch the app entry", ownerUid: "ben", status: "todo", updatedAt: 1, paths: ["src/app.ts"] }],
    });
    expect(warnings).toContainEqual({ path: "src/app.ts", kind: "planned", uid: "ben", name: "Ben", stepId: "step-one", detail: "Touch the app entry" });
    expect(warnings).toContainEqual({ path: "src/app.ts", kind: "adjacent", uid: "ben", name: "Ben", detail: "Fix the parser error" });
  });

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
    expect(laneOpenForTakeover(lane("awaiting"))).toBe(true);
    expect(laneOpenForTakeover(lane("offline"))).toBe(true);
    expect(laneOpenForTakeover(lane("working"))).toBe(false);
    expect(laneOpenForTakeover(lane("idle"))).toBe(false);
  });
});

describe("joining", () => {
  it("reports role, seat, push access and agent availability without inventing a check", () => {
    expect(joinChecks({ role: "editor", presentCount: 2, seatLimit: 30, hasAgent: true, pushAccess: null })).toEqual([
      { id: "role", label: "Role", ok: true, detail: "You are joining as editor." },
      { id: "seat", label: "Seat", ok: true, detail: "There is a free seat." },
      { id: "push", label: "Push access", ok: null, detail: "Push access has not been checked." },
      { id: "agent", label: "Agent", ok: true, detail: "An agent is available on this computer." },
    ]);
    expect(joinChecks({ role: "viewer", presentCount: 30, seatLimit: 30, hasAgent: false, pushAccess: false })[1]!.ok).toBe(false);
    expect(joinChecks({ role: "viewer", presentCount: 30, seatLimit: 30, hasAgent: false, pushAccess: false })[3]!.detail).toMatch(/watch, comment/);
  });
});

describe("anchored comments", () => {
  const files = [{ path: "src/app.ts", content: "one" }, { path: "src/new.ts", content: "two" }];

  it("labels a comment stale only when its file moved on", () => {
    const anchor = contentFingerprint("one");
    expect(commentIsStale({ path: "src/app.ts", anchor, anchorKind: "file", resolved: false }, files)).toBe(false);
    expect(commentIsStale({ path: "src/app.ts", anchor: "deadbeef", anchorKind: "file", resolved: false }, files)).toBe(true);
    expect(commentIsStale({ path: "src/gone.ts", anchor: anchor, anchorKind: "file", resolved: false }, files)).toBe(true);
    expect(commentIsStale({ path: "src/app.ts", anchor: "deadbeef", anchorKind: "hunk", resolved: true }, files)).toBe(false);
    expect(commentIsStale({ path: "src/app.ts", anchor: "deadbeef", anchorKind: "session", resolved: false }, files)).toBe(false);
  });
});

describe("session cards", () => {
  it("reads the task, branch, people, plan, files and waiting work from the snapshot", () => {
    const snapshot = {
      artifactId: "artifactroom1", title: "Todo app", hostUid: "ana", open: true, startedAt: 1, endedAt: 0,
      liveInvite: null, branch: "feat/live", task: "Add live editing", lastSyncedAt: 4, selfId: "ana",
      self: { uid: "ana", name: "Ana", role: "owner" }, checks: [],
      members: [
        member({ uid: "ana", name: "Ana", role: "owner", lastSeen: 5, presence: { path: "src/app.ts", line: 1 }, lane: { ...lane("working"), updatedAt: 6 } }),
        member({ uid: "ben", name: "Ben", present: false }),
      ],
      plan: [{ id: "a", title: "One", ownerUid: "ana", status: "done" as const, updatedAt: 1, paths: ["src/plan.ts"] }, { id: "b", title: "Two", ownerUid: null, status: "todo" as const, updatedAt: 1 }],
      notes: [], comments: [], locks: [],
      approvals: [{ id: "ap", kind: "push" as const, title: "Push", detail: "", paths: [], capabilities: [], requestedBy: "ben", requestedName: "Ben", status: "pending" as const, decidedBy: null, decidedName: null, decidedAt: 0, at: 2 }],
      handoffs: [{ id: "h", fromUid: "ben", fromName: "Ben", toUid: "ana", toName: "Ana", note: "", branch: "feat/live", planDone: 1, planTotal: 2, noteIds: [], at: 2, acceptedAt: 0, acceptedBy: null }],
      messages: [], activity: [], warnings: [{ path: "src/app.ts", kind: "same-file" as const, uid: "ben", name: "Ben" }],
    } satisfies ArtifactRoomSnapshot;
    expect(roomCardFromSnapshot(snapshot)).toEqual({
      artifactId: "artifactroom1", title: "Todo app", task: "Add live editing", hostName: "Ana", branch: "feat/live",
      open: true, memberCount: 1, planDone: 1, planTotal: 2, percent: 50, files: ["src/app.ts", "src/plan.ts"],
      approvals: 1, handoffs: 1, warnings: 1, updatedAt: 6,
    });
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

  it("accepts a branch name and a short list of project paths", () => {
    expect(roomBranch(" feat/live ")).toBe("feat/live");
    expect(roomBranch("a\\b")).toBeNull();
    expect(roomBranch("")).toBeNull();
    expect(roomPaths(["src/app.ts", "src/app.ts", "README.md"])).toEqual(["src/app.ts", "README.md"]);
    expect(roomPaths(["../secret"])).toBeNull();
    expect(roomPaths("src/app.ts")).toBeNull();
  });
});
