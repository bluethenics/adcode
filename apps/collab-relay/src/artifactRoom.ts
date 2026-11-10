/**
 * The coordination room around one live artifact.
 *
 * It stores what the file relay deliberately does not: who is here and how they joined, each
 * person's agent lane, the single plan, the shared Brain notes and their anchors, anchored
 * comments, advisory path locks, the room conversation, handoffs and the activity trail.
 * File text keeps travelling through `CollabRoom`; this room never stores the project itself.
 */
import { DurableObject } from "cloudflare:workers";
import {
  ARTIFACT_APPROVAL_KINDS, ARTIFACT_COMMENT_ANCHORS, ARTIFACT_ROOM_LIMITS, commentIsStale, colourForUid,
  isArtifactRoomRole, isLaneStatus, joinChecks, laneOpenForTakeover, noteIsStale, overlapWarnings, planProgress,
  roomBranch, roomPath, roomPaths, roomText, sanitiseRoomName, stepClaimable, stepTransferable,
  type ArtifactApproval, type ArtifactApprovalKind, type ArtifactApprovalStatus, type ArtifactBrainNote,
  type ArtifactCommentAnchorKind, type ArtifactCommentLinkKind, type ArtifactHandoff, type ArtifactLane,
  type ArtifactMessageKind, type ArtifactPathLock, type ArtifactPlanStep,
  type ArtifactRoomActivityKind, type ArtifactRoomCard, type ArtifactRoomComment, type ArtifactRoomMember,
  type ArtifactRoomRole, type ArtifactRoomSnapshot, type LaneStatus, type PlanStepStatus,
} from "../../../packages/collab/src/index.ts";

type Env = CollabRelayEnv;

type RoomRow = { id: number; artifactId: string; title: string; hostUid: string; open: number; startedAt: number; endedAt: number; liveInvite: string | null; branch: string; task: string; lastSyncedAt: number };
type MemberRow = {
  uid: string; name: string; role: string; colour: string; watching: number; present: number; joinedAt: number; lastSeen: number;
  path: string | null; line: number | null; provider: string; model: string; sponsorUid: string | null; status: string; task: string; laneAt: number;
  hasAgent: number | null; pushAccess: number | null;
};
type StepRow = { id: string; title: string; ownerUid: string | null; status: string; updatedAt: number; ord: number; paths: string };
type NoteRow = { id: string; path: string; anchor: string | null; text: string; authorId: string; authorName: string; createdAt: number; updatedAt: number; retired: number; commitRef: string | null };
type CommentRow = {
  id: string; path: string; line: number; endLine: number; text: string; authorId: string; authorName: string; resolved: number; at: number;
  anchorKind: string; hunk: string | null; commentAnchor: string | null; linkedKind: string | null; linkedId: string | null;
};
type MessageRow = { seq: number; id: string; uid: string; name: string; kind: string; text: string; at: number };
type ActivityRow = { seq: number; id: string; kind: string; text: string; uid: string; at: number };
type LockRow = { path: string; uid: string; name: string; at: number };
type ApprovalRow = {
  id: string; kind: string; title: string; detail: string; paths: string; capabilities: string; requestedBy: string;
  requestedName: string; status: string; decidedBy: string | null; decidedName: string | null; decidedAt: number; at: number;
  stepId: string | null;
};
type HandoffRow = {
  id: string; fromUid: string; fromName: string; toUid: string | null; toName: string | null; note: string; branch: string;
  planDone: number; planTotal: number; noteIds: string; at: number; acceptedAt: number; acceptedBy: string | null;
};
type FileRow = { path: string; fingerprint: string; at: number };

const deny = (status: number, message: string): never => { throw new Error(`[${status}] ${message}`); };
const newId = (): string => crypto.randomUUID().replaceAll("-", "").slice(0, 20);
const now = (): number => Date.now();

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) return deny(400, `${label} is not valid.`);
  return value;
}

function optionalUid(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : deny(400, "Choose a participant.");
}

function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : deny(400, `${label} is not valid.`);
}

function optionalBoolean(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") return deny(400, `${label} must be true or false.`);
  return value ? 1 : 0;
}

function stringList(value: unknown, label: string, maximum: number, length = 80): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) return deny(400, `Use up to ${maximum} ${label}.`);
  return [...new Set(value.map((one) => roomText(one, 1, length) ?? deny(400, `Each ${label.replace(/s$/, "")} must be 1-${length} characters.`)))].slice(0, maximum);
}

function pathsOf(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === "string") : [];
  } catch { return []; }
}

const linkedKind = (value: unknown): ArtifactCommentLinkKind | null =>
  value === "plan" || value === "suggestion" || value === "prompt" ? value : null;

export class ArtifactRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY CHECK(id=1), artifactId TEXT NOT NULL, title TEXT NOT NULL, hostUid TEXT NOT NULL, open INTEGER NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER NOT NULL, liveInvite TEXT, branch TEXT NOT NULL DEFAULT 'main', task TEXT NOT NULL DEFAULT '', lastSyncedAt INTEGER NOT NULL DEFAULT 0)");
    for (const column of ["branch TEXT NOT NULL DEFAULT 'main'", "task TEXT NOT NULL DEFAULT ''", "lastSyncedAt INTEGER NOT NULL DEFAULT 0"]) {
      try { sql.exec(`ALTER TABLE room ADD COLUMN ${column}`); } catch { /* Already there. */ }
    }
    sql.exec("CREATE TABLE IF NOT EXISTS members(uid TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, colour TEXT NOT NULL, watching INTEGER NOT NULL, present INTEGER NOT NULL, joinedAt INTEGER NOT NULL, lastSeen INTEGER NOT NULL, path TEXT, line INTEGER, provider TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', sponsorUid TEXT, status TEXT NOT NULL DEFAULT 'idle', task TEXT NOT NULL DEFAULT '', laneAt INTEGER NOT NULL DEFAULT 0, hasAgent INTEGER, pushAccess INTEGER)");
    for (const column of ["hasAgent INTEGER", "pushAccess INTEGER"]) {
      try { sql.exec(`ALTER TABLE members ADD COLUMN ${column}`); } catch { /* Already there. */ }
    }
    sql.exec("CREATE TABLE IF NOT EXISTS plan(id TEXT PRIMARY KEY, title TEXT NOT NULL, ownerUid TEXT, status TEXT NOT NULL, updatedAt INTEGER NOT NULL, ord INTEGER NOT NULL, paths TEXT NOT NULL DEFAULT '[]')");
    try { sql.exec("ALTER TABLE plan ADD COLUMN paths TEXT NOT NULL DEFAULT '[]'"); } catch { /* Already there. */ }
    sql.exec("CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, path TEXT NOT NULL, anchor TEXT, text TEXT NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, retired INTEGER NOT NULL DEFAULT 0, commitRef TEXT)");
    try { sql.exec("ALTER TABLE notes ADD COLUMN commitRef TEXT"); } catch { /* Already there. */ }
    sql.exec("CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, path TEXT NOT NULL, line INTEGER NOT NULL, endLine INTEGER NOT NULL, text TEXT NOT NULL, authorId TEXT NOT NULL, authorName TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, anchorKind TEXT NOT NULL DEFAULT 'file', hunk TEXT, commentAnchor TEXT, linkedKind TEXT, linkedId TEXT)");
    for (const column of ["anchorKind TEXT NOT NULL DEFAULT 'file'", "hunk TEXT", "commentAnchor TEXT", "linkedKind TEXT", "linkedId TEXT"]) {
      try { sql.exec(`ALTER TABLE comments ADD COLUMN ${column}`); } catch { /* Already there. */ }
    }
    sql.exec("CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, uid TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS activity(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, uid TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS locks(path TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS file_versions(path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, at INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL, paths TEXT NOT NULL, capabilities TEXT NOT NULL, requestedBy TEXT NOT NULL, requestedName TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decidedBy TEXT, decidedName TEXT, decidedAt INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, stepId TEXT)");
    try { sql.exec("ALTER TABLE approvals ADD COLUMN stepId TEXT"); } catch { /* Already there. */ }
    sql.exec("CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY, fromUid TEXT NOT NULL, fromName TEXT NOT NULL, toUid TEXT, toName TEXT, note TEXT NOT NULL, branch TEXT NOT NULL, planDone INTEGER NOT NULL, planTotal INTEGER NOT NULL, noteIds TEXT NOT NULL, at INTEGER NOT NULL, acceptedAt INTEGER NOT NULL DEFAULT 0, acceptedBy TEXT)");
  }

  private get sql() { return this.ctx.storage.sql; }

  private room(): RoomRow {
    return this.sql.exec<RoomRow>("SELECT * FROM room WHERE id=1").toArray()[0] ?? deny(404, "This live room has not been opened.");
  }

  private member(uid: string): MemberRow {
    return this.sql.exec<MemberRow>("SELECT * FROM members WHERE uid=?", uid).toArray()[0] ?? deny(403, "Join this live room first.");
  }

  private note(kind: ArtifactRoomActivityKind, text: string, uid: string): void {
    this.sql.exec("INSERT INTO activity(id,kind,text,uid,at) VALUES(?,?,?,?,?)", newId(), kind, text.slice(0, 300), uid, now());
    this.sql.exec("DELETE FROM activity WHERE seq NOT IN (SELECT seq FROM activity ORDER BY seq DESC LIMIT ?)", ARTIFACT_ROOM_LIMITS.activity);
  }

  private owner(uid: string): RoomRow {
    const room = this.room();
    if (room.hostUid !== uid) deny(403, "Only the owner can do that in this live room.");
    return room;
  }

  private addApproval(member: MemberRow, input: {
    kind: ArtifactApprovalKind; title: string; detail: string; paths: readonly string[];
    capabilities: readonly string[]; stepId: string | null;
  }): string {
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM approvals").one().n;
    if (count >= ARTIFACT_ROOM_LIMITS.approvals) deny(409, `A room can hold ${ARTIFACT_ROOM_LIMITS.approvals} approval cards.`);
    const id = newId();
    this.sql.exec(
      "INSERT INTO approvals(id,kind,title,detail,paths,capabilities,requestedBy,requestedName,status,decidedBy,decidedName,decidedAt,at,stepId) VALUES(?,?,?,?,?,?,?,?, 'pending',NULL,NULL,0,?,?)",
      id, input.kind, input.title, input.detail, JSON.stringify(input.paths), JSON.stringify(input.capabilities), member.uid, member.name, now(), input.stepId,
    );
    return id;
  }

  open(uid: string, name: string, artifactId: string, title: string, liveInvite: string | null, branchInput?: unknown, taskInput?: unknown): ArtifactRoomSnapshot {
    const display = sanitiseRoomName(name) ?? deny(400, "Choose a display name.");
    if (!/^[a-z0-9]{12,40}$/.test(artifactId)) deny(400, "That is not an artifact.");
    if (liveInvite !== null && (typeof liveInvite !== "string" || liveInvite.length === 0 || liveInvite.length > 2000)) deny(400, "That live invite is not valid.");
    const branch = branchInput === undefined || branchInput === null ? "main" : roomBranch(branchInput) ?? deny(400, "That branch name is not valid.");
    const task = taskInput === undefined || taskInput === null ? title.slice(0, ARTIFACT_ROOM_LIMITS.task) : roomText(taskInput, 3, ARTIFACT_ROOM_LIMITS.task) ?? deny(400, "Describe the session's task in 200 characters or fewer.");
    const when = now();
    this.ctx.storage.transactionSync(() => {
      for (const table of ["members", "plan", "notes", "comments", "messages", "activity", "locks", "file_versions", "approvals", "handoffs"]) this.sql.exec(`DELETE FROM ${table}`);
      this.sql.exec("INSERT OR REPLACE INTO room(id,artifactId,title,hostUid,open,startedAt,endedAt,liveInvite,branch,task,lastSyncedAt) VALUES(1,?,?,?,1,?,0,?,?,?,?)", artifactId, title.slice(0, 120), uid, when, liveInvite, branch, task, when);
      this.sql.exec("INSERT INTO members(uid,name,role,colour,watching,present,joinedAt,lastSeen,path,line,provider,model,sponsorUid,status,task,laneAt,hasAgent,pushAccess) VALUES(?,?,?,?,0,1,?,?,NULL,NULL,'','',NULL,'idle','',?,NULL,NULL)", uid, display, "owner", colourForUid(uid), when, when, when);
      this.note("room.opened", `${display} opened the live room`, uid);
      if (liveInvite !== null) this.note("live.started", "The host started live file sharing", uid);
    });
    return this.snapshot(uid);
  }

  close(uid: string): ArtifactRoomSnapshot {
    this.owner(uid);
    const when = now();
    this.sql.exec("UPDATE room SET open=0,endedAt=?,liveInvite=NULL WHERE id=1", when);
    this.sql.exec("UPDATE members SET present=0,status='offline',laneAt=?", when);
    this.note("room.closed", "The owner closed the live room", uid);
    return this.snapshot(uid);
  }

  join(uid: string, name: string, role: ArtifactRoomRole, watching: boolean, hasAgentInput?: unknown, pushAccessInput?: unknown): ArtifactRoomSnapshot {
    const room = this.room();
    if (!room.open) deny(409, "This live room has ended.");
    const display = sanitiseRoomName(name) ?? deny(400, "Choose a display name.");
    const previous = this.sql.exec<MemberRow>("SELECT * FROM members WHERE uid=?", uid).toArray()[0];
    if (previous === undefined) {
      const present = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM members WHERE present=1").one().n;
      if (present >= ARTIFACT_ROOM_LIMITS.members) deny(409, "This live room is full. Watch, or try again when somebody leaves.");
    }
    const seat: ArtifactRoomRole = uid === room.hostUid ? "owner" : role === "owner" ? "editor" : watching ? "viewer" : role;
    const hasAgent = optionalBoolean(hasAgentInput, "Agent availability");
    const pushAccess = optionalBoolean(pushAccessInput, "Push access");
    const when = now();
    if (previous === undefined) {
      this.sql.exec("INSERT INTO members(uid,name,role,colour,watching,present,joinedAt,lastSeen,path,line,provider,model,sponsorUid,status,task,laneAt,hasAgent,pushAccess) VALUES(?,?,?,?,?,1,?,?,NULL,NULL,'','',NULL,'idle','',?,?,?)", uid, display, seat, colourForUid(uid), watching ? 1 : 0, when, when, when, hasAgent, pushAccess);
      this.note("room.joined", `${display} joined${watching ? " to watch" : ""}`, uid);
    } else {
      this.sql.exec("UPDATE members SET name=?,present=1,watching=?,lastSeen=?,role=?,hasAgent=?,pushAccess=? WHERE uid=?", display, watching ? 1 : 0, when, seat === "owner" ? "owner" : watching ? "viewer" : previous.role === "viewer" ? "editor" : previous.role, hasAgent ?? previous.hasAgent, pushAccess ?? previous.pushAccess, uid);
      this.note("room.joined", `${display} came back${watching ? " to watch" : ""}`, uid);
    }
    return this.snapshot(uid);
  }

  leave(uid: string): ArtifactRoomSnapshot {
    const room = this.room();
    if (room.hostUid === uid) return this.close(uid);
    const member = this.member(uid);
    this.sql.exec("UPDATE members SET present=0,status='offline',laneAt=? WHERE uid=?", now(), uid);
    this.sql.exec("DELETE FROM locks WHERE uid=?", uid);
    this.note("room.left", `${member.name} left`, uid);
    return this.snapshot(uid);
  }

  heartbeat(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    const room = this.room();
    if (!room.open) deny(409, "This live room has ended.");
    this.member(uid);
    const when = now();
    const patch: string[] = [];
    const args: unknown[] = [];
    if ("watching" in input) { if (typeof input["watching"] !== "boolean") deny(400, "watching must be true or false."); patch.push("watching=?"); args.push(input["watching"] ? 1 : 0); }
    if ("path" in input) {
      const path = input["path"] === null ? null : roomPath(input["path"]);
      if (input["path"] !== null && path === null) deny(400, "That file path is not inside the project.");
      patch.push("path=?"); args.push(path);
    }
    if ("line" in input) {
      const line = input["line"] === null ? null : integer(input["line"], "The line", 1, 2_000_000);
      patch.push("line=?"); args.push(line);
    }
    if ("provider" in input) {
      const value = input["provider"];
      if (typeof value !== "string" || value.length > ARTIFACT_ROOM_LIMITS.provider) deny(400, "That provider name is not valid.");
      patch.push("provider=?"); args.push(value);
    }
    if ("model" in input) {
      const value = input["model"];
      if (typeof value !== "string" || value.length > ARTIFACT_ROOM_LIMITS.model) deny(400, "That model name is not valid.");
      patch.push("model=?"); args.push(value);
    }
    if ("sponsorUid" in input) { patch.push("sponsorUid=?"); args.push(optionalUid(input["sponsorUid"])); }
    if ("status" in input) {
      const status = isLaneStatus(input["status"]) ? input["status"] : deny(400, "That agent status is not valid.");
      patch.push("status=?"); args.push(status);
    }
    if ("task" in input) {
      const task = input["task"];
      if (typeof task !== "string" || task.length > ARTIFACT_ROOM_LIMITS.task) return deny(400, "Describe the task in 200 characters or fewer.");
      patch.push("task=?"); args.push(task.trim());
    }
    if ("hasAgent" in input) { patch.push("hasAgent=?"); args.push(optionalBoolean(input["hasAgent"], "Agent availability")); }
    if ("pushAccess" in input) { patch.push("pushAccess=?"); args.push(optionalBoolean(input["pushAccess"], "Push access")); }
    if ("files" in input) {
      const files = Array.isArray(input["files"]) ? input["files"] as unknown[] : deny(400, `Share up to ${ARTIFACT_ROOM_LIMITS.files} open files.`);
      if (files.length > ARTIFACT_ROOM_LIMITS.files) deny(400, `Share up to ${ARTIFACT_ROOM_LIMITS.files} open files.`);
      for (const one of files) {
        if (typeof one !== "object" || one === null) deny(400, "Each file needs a path and a fingerprint.");
        const value = one as Record<string, unknown>;
        const path = roomPath(value["path"]);
        const fingerprint = value["fingerprint"];
        if (path === null || typeof fingerprint !== "string" || !/^[a-f0-9]{8,16}$/.test(fingerprint)) deny(400, "Each file needs a project path and a fingerprint.");
        this.sql.exec("INSERT OR REPLACE INTO file_versions(path,fingerprint,at) VALUES(?,?,?)", path, fingerprint, when);
      }
      this.sql.exec("UPDATE room SET lastSyncedAt=? WHERE id=1", when);
    }
    patch.push("lastSeen=?", "laneAt=?");
    args.push(when, when, uid);
    this.sql.exec(`UPDATE members SET ${patch.join(",")} WHERE uid=?`, ...args);
    return this.snapshot(uid);
  }

  post(uid: string, text: string, kindInput: unknown): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role === "viewer") deny(403, "Join as a commenter or editor to post in this room.");
    const message = roomText(text, 1, ARTIFACT_ROOM_LIMITS.text) ?? deny(400, "Write a message under 4,000 characters.");
    const kind: ArtifactMessageKind = kindInput === "agent" ? "agent" : "member";
    this.sql.exec("INSERT INTO messages(id,uid,name,kind,text,at) VALUES(?,?,?,?,?,?)", newId(), uid, member.name, kind, message, now());
    this.sql.exec("DELETE FROM messages WHERE seq NOT IN (SELECT seq FROM messages ORDER BY seq DESC LIMIT ?)", ARTIFACT_ROOM_LIMITS.messages);
    return this.snapshot(uid);
  }

  planAction(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can change the plan.");
    const action = input["operation"] ?? input["action"];
    if (action === "add") {
      const title = roomText(input["title"], 3, 200) ?? deny(400, "Give the step a title of 3-200 characters.");
      const ownerUid = optionalUid(input["ownerUid"]);
      const id = typeof input["id"] === "string" && /^[a-z0-9-]{8,32}$/.test(input["id"]) ? input["id"] : newId();
      const paths = input["paths"] === undefined ? [] : roomPaths(input["paths"]) ?? deny(400, "Use up to 20 project paths for the step.");
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM plan").one().n;
      if (count >= ARTIFACT_ROOM_LIMITS.steps) deny(409, `A plan can hold ${ARTIFACT_ROOM_LIMITS.steps} steps.`);
      const order = this.sql.exec<{ n: number }>("SELECT COALESCE(MAX(ord),0)+1 n FROM plan").one().n;
      this.sql.exec("INSERT INTO plan(id,title,ownerUid,status,updatedAt,ord,paths) VALUES(?,?,?,'todo',?,?,?)", id, title, ownerUid, now(), order, JSON.stringify(paths));
      this.note("plan.added", `Plan: ${title}`, uid);
    } else if (action === "move") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a step.");
      const step = this.sql.exec<StepRow>("SELECT * FROM plan WHERE id=?", id).toArray()[0] ?? deny(404, "That step is not in the plan.");
      const status: PlanStepStatus = choice(input["status"], ["todo", "doing", "done", "blocked"], "That step status");
      const ownerUid = "ownerUid" in input ? optionalUid(input["ownerUid"]) : step.ownerUid;
      const paths = "paths" in input ? roomPaths(input["paths"]) ?? deny(400, "Use up to 20 project paths for the step.") : pathsOf(step.paths);
      this.sql.exec("UPDATE plan SET status=?,ownerUid=?,paths=?,updatedAt=? WHERE id=?", status, ownerUid, JSON.stringify(paths), now(), id);
      this.note("plan.moved", `Plan: ${step.title} is ${status}`, uid);
    } else if (action === "claim") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a step.");
      const step = this.sql.exec<StepRow>("SELECT * FROM plan WHERE id=?", id).toArray()[0] ?? deny(404, "That step is not in the plan.");
      if (!stepClaimable({ id: step.id, title: step.title, ownerUid: step.ownerUid, status: step.status as PlanStepStatus, updatedAt: step.updatedAt } as ArtifactPlanStep, uid)) {
        deny(409, step.status === "todo" ? "That step belongs to someone else. Ask them to hand it over." : "That step has already started. Ask its owner to hand it over.");
      }
      this.sql.exec("UPDATE plan SET ownerUid=?,updatedAt=? WHERE id=?", uid, now(), id);
      this.note("plan.claimed", `${member.name} took ${step.title}`, uid);
    } else if (action === "request") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a step.");
      const step = this.sql.exec<StepRow>("SELECT * FROM plan WHERE id=?", id).toArray()[0] ?? deny(404, "That step is not in the plan.");
      if (step.ownerUid === null || step.ownerUid === uid) deny(409, "Claim this step; nobody else owns it.");
      const note = input["note"] === undefined || input["note"] === null ? "" : roomText(input["note"], 0, ARTIFACT_ROOM_LIMITS.approval) ?? deny(400, "Keep the note under 2,000 characters.");
      this.addApproval(member, {
        kind: "plan-transfer", title: `Take over: ${step.title}`.slice(0, 200), detail: note,
        paths: pathsOf(step.paths), capabilities: [], stepId: step.id,
      });
      this.note("plan.requested", `${member.name} asked to take over ${step.title}`, uid);
    } else if (action === "remove") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a step.");
      const step = this.sql.exec<StepRow>("SELECT * FROM plan WHERE id=?", id).toArray()[0] ?? deny(404, "That step is not in the plan.");
      this.sql.exec("DELETE FROM plan WHERE id=?", id);
      this.note("plan.removed", `Plan: ${step.title} was removed`, uid);
    } else deny(400, "Choose add, move, claim, request or remove.");
    return this.snapshot(uid);
  }

  noteAction(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can change the shared Brain.");
    const action = input["operation"] ?? input["action"];
    if (action === "add") {
      const path = roomPath(input["path"]) ?? deny(400, "Pin the note to a file inside the project.");
      const text = roomText(input["text"], 3, ARTIFACT_ROOM_LIMITS.note) ?? deny(400, `Write the note in 3-${ARTIFACT_ROOM_LIMITS.note} characters.`);
      const anchor = typeof input["anchor"] === "string" && /^[a-f0-9]{8,16}$/.test(input["anchor"]) ? input["anchor"] : null;
      const commit = input["commit"] === undefined || input["commit"] === null ? null : (typeof input["commit"] === "string" && /^[A-Za-z0-9._/-]{4,64}$/.test(input["commit"]) ? input["commit"] : deny(400, "That commit reference is not valid."));
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM notes WHERE retired=0").one().n;
      if (count >= ARTIFACT_ROOM_LIMITS.notes) deny(409, `The shared Brain can hold ${ARTIFACT_ROOM_LIMITS.notes} notes.`);
      const when = now();
      this.sql.exec("INSERT INTO notes(id,path,anchor,text,authorId,authorName,createdAt,updatedAt,retired,commitRef) VALUES(?,?,?,?,?,?,?,?,0,?)", newId(), path, anchor, text, uid, member.name, when, when, commit);
      this.note("brain.added", `${member.name} pinned a note to ${path}`, uid);
    } else if (action === "update" || action === "retire") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a note.");
      const row = this.sql.exec<NoteRow>("SELECT * FROM notes WHERE id=?", id).toArray()[0] ?? deny(404, "That note is not in the shared Brain.");
      if (row.authorId !== uid && member.role !== "owner") deny(403, "Only its author or the owner can change this note.");
      if (action === "retire") {
        this.sql.exec("UPDATE notes SET retired=1,updatedAt=? WHERE id=?", now(), id);
        this.note("brain.retired", `${member.name} retired a note on ${row.path}`, uid);
      } else {
        const text = roomText(input["text"], 3, ARTIFACT_ROOM_LIMITS.note) ?? deny(400, "Write the note in 3-2,000 characters.");
        const anchor = typeof input["anchor"] === "string" && /^[a-f0-9]{8,16}$/.test(input["anchor"]) ? input["anchor"] : row.anchor;
        const commit = input["commit"] === undefined ? row.commitRef : input["commit"] === null ? null : (typeof input["commit"] === "string" && /^[A-Za-z0-9._/-]{4,64}$/.test(input["commit"]) ? input["commit"] : deny(400, "That commit reference is not valid."));
        this.sql.exec("UPDATE notes SET text=?,anchor=?,commitRef=?,updatedAt=? WHERE id=?", text, anchor, commit, now(), id);
        this.note("brain.updated", `${member.name} updated a note on ${row.path}`, uid);
      }
    } else deny(400, "Choose add, update or retire.");
    return this.snapshot(uid);
  }

  commentAction(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role === "viewer") deny(403, "Join as a commenter or editor to comment.");
    const action = input["operation"] ?? input["action"];
    if (action === "add") {
      const path = roomPath(input["path"]) ?? deny(400, "Comment on a file inside the project.");
      const line = integer(input["line"], "The line", 1, 2_000_000);
      const endLine = input["endLine"] === undefined ? line : integer(input["endLine"], "The end line", line, 2_000_000);
      const text = roomText(input["text"], 1, 2000) ?? deny(400, "Write the comment in 1-2,000 characters.");
      const anchorKind: ArtifactCommentAnchorKind = input["anchorKind"] === undefined ? "file" : choice(input["anchorKind"], ARTIFACT_COMMENT_ANCHORS, "That anchor");
      const hunk = input["hunk"] === undefined || input["hunk"] === null ? null : roomText(input["hunk"], 1, ARTIFACT_ROOM_LIMITS.hunk) ?? deny(400, `Keep the anchored excerpt under ${ARTIFACT_ROOM_LIMITS.hunk} characters.`);
      if (anchorKind === "hunk" && hunk === null) deny(400, "Paste the diff hunk this comment is about.");
      const anchor = typeof input["anchor"] === "string" && /^[a-f0-9]{8,16}$/.test(input["anchor"]) ? input["anchor"] : null;
      const linkInput = input["linkedKind"];
      const linkKind = linkInput === undefined || linkInput === null ? null : linkedKind(linkInput) ?? deny(400, "Link the comment to a plan step, a suggestion or a prompt.");
      const linkId = linkKind === null || linkKind === "prompt" || linkKind === "suggestion" ? null : typeof input["linkedId"] === "string" && /^[a-z0-9-]{8,32}$/.test(input["linkedId"]) ? input["linkedId"] : deny(400, "Choose what the comment is linked to.");
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM comments").one().n;
      if (count >= ARTIFACT_ROOM_LIMITS.comments) deny(409, `A room can hold ${ARTIFACT_ROOM_LIMITS.comments} comments.`);
      this.sql.exec(
        "INSERT INTO comments(id,path,line,endLine,text,authorId,authorName,resolved,at,anchorKind,hunk,commentAnchor,linkedKind,linkedId) VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?,?)",
        newId(), path, line, endLine, text, uid, member.name, now(), anchorKind, hunk, anchor, linkKind, linkId,
      );
      this.note("comment.added", `${member.name} commented on ${path}:${line}`, uid);
    } else if (action === "resolve") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a comment.");
      const row = this.sql.exec<CommentRow>("SELECT * FROM comments WHERE id=?", id).toArray()[0] ?? deny(404, "That comment does not exist.");
      if (row.authorId !== uid && member.role !== "owner") deny(403, "Only its author or the owner can resolve this comment.");
      this.sql.exec("UPDATE comments SET resolved=1 WHERE id=?", id);
      this.note("comment.resolved", `${member.name} resolved a comment on ${row.path}`, uid);
    } else if (action === "link") {
      const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a comment.");
      const row = this.sql.exec<CommentRow>("SELECT * FROM comments WHERE id=?", id).toArray()[0] ?? deny(404, "That comment does not exist.");
      if (row.authorId !== uid && member.role !== "owner") deny(403, "Only its author or the owner can link this comment.");
      const kind = linkedKind(input["linkedKind"]) ?? deny(400, "Link the comment to a plan step, a suggestion or a prompt.");
      const linkedId = kind === "prompt" || kind === "suggestion" ? null : typeof input["linkedId"] === "string" && /^[a-z0-9-]{8,32}$/.test(input["linkedId"]) ? input["linkedId"] : deny(400, "Choose what the comment is linked to.");
      this.sql.exec("UPDATE comments SET linkedKind=?,linkedId=? WHERE id=?", kind, linkedId, id);
      this.note("comment.linked", `${member.name} turned a comment on ${row.path} into a ${kind}`, uid);
    } else deny(400, "Choose add, resolve or link.");
    return this.snapshot(uid);
  }

  lockAction(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can lock a file.");
    const action = input["operation"] ?? input["action"];
    const path = roomPath(input["path"]) ?? deny(400, "Choose a file inside the project.");
    if (action === "lock") {
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM locks").one().n;
      if (count >= ARTIFACT_ROOM_LIMITS.locks && this.sql.exec("SELECT 1 FROM locks WHERE path=?", path).toArray().length === 0) deny(409, `A room can hold ${ARTIFACT_ROOM_LIMITS.locks} locks.`);
      this.sql.exec("INSERT OR REPLACE INTO locks VALUES(?,?,?,?)", path, uid, member.name, now());
      this.note("path.locked", `${member.name} locked ${path}`, uid);
    } else {
      const lock = this.sql.exec<LockRow>("SELECT * FROM locks WHERE path=?", path).toArray()[0];
      if (lock === undefined) return this.snapshot(uid);
      if (lock.uid !== uid && member.role !== "owner") deny(403, "Only its holder or the owner can unlock this file.");
      this.sql.exec("DELETE FROM locks WHERE path=?", path);
      this.note("path.unlocked", `${member.name} unlocked ${path}`, uid);
    }
    return this.snapshot(uid);
  }

  setRole(uid: string, target: string, roleInput: unknown): ArtifactRoomSnapshot {
    const room = this.owner(uid);
    const member = this.member(target);
    const role = isArtifactRoomRole(roleInput) && roleInput !== "owner" ? roleInput : deny(400, "Choose editor, commenter or viewer.");
    if (target === room.hostUid) deny(409, "The host keeps the owner role.");
    this.sql.exec("UPDATE members SET role=?,watching=?,status=CASE WHEN ?='viewer' THEN 'offline' ELSE status END WHERE uid=?", role, role === "viewer" ? 1 : 0, role, target);
    this.note("room.role", `${member.name} is now ${role}`, uid);
    return this.snapshot(uid);
  }

  requestApproval(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can ask the room for approval.");
    const kind: ArtifactApprovalKind = choice(input["kind"], ARTIFACT_APPROVAL_KINDS, "That approval kind");
    const title = roomText(input["title"], 3, 200) ?? deny(400, "Name the exact action in 3-200 characters.");
    const detail = input["detail"] === undefined || input["detail"] === null ? "" : roomText(input["detail"], 0, ARTIFACT_ROOM_LIMITS.approval) ?? deny(400, "Keep the detail under 2,000 characters.");
    const paths = input["paths"] === undefined ? [] : roomPaths(input["paths"]) ?? deny(400, "Use up to 20 project paths.");
    const capabilities = stringList(input["capabilities"], "capabilities", 12, ARTIFACT_ROOM_LIMITS.capability);
    const stepId = typeof input["stepId"] === "string" && /^[a-z0-9-]{8,32}$/.test(input["stepId"]) ? input["stepId"] : null;
    this.addApproval(member, { kind, title, detail, paths, capabilities, stepId });
    this.note("approval.requested", `${member.name} asked to ${title.toLowerCase()}`, uid);
    return this.snapshot(uid);
  }

  decideApproval(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can answer an approval.");
    const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose an approval card.");
    const row = this.sql.exec<ApprovalRow>("SELECT * FROM approvals WHERE id=?", id).toArray()[0] ?? deny(404, "That approval card does not exist.");
    if (row.status !== "pending") deny(409, "That approval has already been answered.");
    if (row.requestedBy === uid) deny(409, "Another person on the team answers your request.");
    if (typeof input["accept"] !== "boolean") deny(400, "Approve or decline the request.");
    const accepted = input["accept"];
    this.sql.exec("UPDATE approvals SET status=?,decidedBy=?,decidedName=?,decidedAt=? WHERE id=? AND status='pending'", accepted ? "approved" : "declined", uid, member.name, now(), id);
    if (accepted && row.kind === "plan-transfer" && row.stepId !== null) {
      const step = this.sql.exec<StepRow>("SELECT * FROM plan WHERE id=?", row.stepId).toArray()[0];
      if (step !== undefined && step.status === "todo") {
        this.sql.exec("UPDATE plan SET ownerUid=?,updatedAt=? WHERE id=?", row.requestedBy, now(), step.id);
        this.note("plan.claimed", `${member.name} handed ${step.title} to ${row.requestedName}`, uid);
      }
    }
    this.note(accepted ? "approval.approved" : "approval.declined", `${member.name} ${accepted ? "approved" : "declined"} ${row.title}`, uid);
    return this.snapshot(uid);
  }

  handoff(uid: string): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    this.sql.exec("UPDATE members SET status='awaiting',task=?,laneAt=? WHERE uid=?", "Waiting for someone to take this lane", now(), uid);
    this.note("lane.awaiting", `${member.name} is waiting for someone to take their lane`, uid);
    return this.snapshot(uid);
  }

  offerHandoff(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    const room = this.room();
    const member = this.member(uid);
    if (member.role === "viewer") deny(403, "Join as a commenter or editor to offer a handoff.");
    const target = this.member(optionalUid(input["toUid"]) ?? deny(400, "Choose who should take the session."));
    if (target.uid === uid) deny(409, "Choose somebody else.");
    const note = input["note"] === undefined || input["note"] === null ? "" : roomText(input["note"], 0, 1000) ?? deny(400, "Keep the handoff note under 1,000 characters.");
    const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) n FROM handoffs").one().n;
    if (count >= ARTIFACT_ROOM_LIMITS.handoffs) deny(409, `A room can hold ${ARTIFACT_ROOM_LIMITS.handoffs} handoffs.`);
    const plan = this.sql.exec<StepRow>("SELECT * FROM plan").toArray();
    const progress = planProgress(plan.map((row) => ({ id: row.id, title: row.title, ownerUid: row.ownerUid, status: row.status as PlanStepStatus, updatedAt: row.updatedAt })));
    const noteIds = this.sql.exec<{ id: string }>("SELECT id FROM notes WHERE retired=0 ORDER BY updatedAt DESC LIMIT 20").toArray().map((row) => row.id);
    this.sql.exec(
      "INSERT INTO handoffs(id,fromUid,fromName,toUid,toName,note,branch,planDone,planTotal,noteIds,at,acceptedAt,acceptedBy) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,NULL)",
      newId(), uid, member.name, target.uid, target.name, note, room.branch, progress.done, progress.total, JSON.stringify(noteIds), now(),
    );
    this.sql.exec("UPDATE members SET status='awaiting',task=?,laneAt=? WHERE uid=?", `Handing off to ${target.name}`, now(), uid);
    this.note("handoff.offered", `${member.name} offered the session to ${target.name}`, uid);
    return this.snapshot(uid);
  }

  acceptHandoff(uid: string, input: Record<string, unknown>): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    const id = typeof input["id"] === "string" ? input["id"] : deny(400, "Choose a handoff.");
    const row = this.sql.exec<HandoffRow>("SELECT * FROM handoffs WHERE id=?", id).toArray()[0] ?? deny(404, "That handoff does not exist.");
    if (row.toUid !== uid) deny(403, "This handoff was offered to somebody else.");
    if (row.acceptedAt !== 0) deny(409, "That handoff has already been accepted.");
    this.sql.exec("UPDATE handoffs SET acceptedAt=?,acceptedBy=? WHERE id=? AND acceptedAt=0", now(), uid, id);
    for (const step of this.sql.exec<StepRow>("SELECT * FROM plan WHERE ownerUid=?", row.fromUid).toArray()) {
      if (step.status === "todo") this.sql.exec("UPDATE plan SET ownerUid=?,updatedAt=? WHERE id=?", uid, now(), step.id);
    }
    this.sql.exec("UPDATE members SET status='working',task=?,laneAt=? WHERE uid=?", `Took over from ${row.fromName}`, now(), uid);
    this.sql.exec("UPDATE members SET status='idle',task='',laneAt=? WHERE uid=? AND status='awaiting'", now(), row.fromUid);
    this.note("handoff.accepted", `${member.name} accepted the session from ${row.fromName}`, uid);
    return this.snapshot(uid);
  }

  takeover(uid: string, targetInput: unknown): ArtifactRoomSnapshot {
    this.room();
    const member = this.member(uid);
    if (member.role !== "owner" && member.role !== "editor") deny(403, "Only an owner or editor can take over a lane.");
    const target = this.member(optionalUid(targetInput) ?? deny(400, "Choose whose lane to take over."));
    if (target.uid === uid) deny(409, "You already hold that lane.");
    if (!laneOpenForTakeover({ status: target.status as LaneStatus } as ArtifactLane)) deny(409, "That lane is still working. Ask them to hand it over first.");
    const steps = this.sql.exec<StepRow>("SELECT * FROM plan WHERE ownerUid=?", target.uid).toArray();
    for (const step of steps) {
      if (stepTransferable({ status: step.status as PlanStepStatus } as ArtifactPlanStep)) this.sql.exec("UPDATE plan SET ownerUid=?,updatedAt=? WHERE id=?", uid, now(), step.id);
    }
    this.sql.exec("UPDATE members SET status='idle',task='',laneAt=? WHERE uid=?", now(), target.uid);
    this.sql.exec("UPDATE members SET status='working',task=?,laneAt=? WHERE uid=?", `Taking over ${target.name}'s lane`, now(), uid);
    this.note("lane.takeover", `${member.name} took over ${target.name}'s lane`, uid);
    return this.snapshot(uid);
  }

  setLive(uid: string, invite: string | null): ArtifactRoomSnapshot {
    this.owner(uid);
    if (invite !== null && (typeof invite !== "string" || invite.length === 0 || invite.length > 2000)) deny(400, "That live invite is not valid.");
    this.sql.exec("UPDATE room SET liveInvite=? WHERE id=1", invite);
    this.note(invite === null ? "live.ended" : "live.started", invite === null ? "Live file sharing stopped" : "Live file sharing started", uid);
    return this.snapshot(uid);
  }

  removeAccount(uid: string): void {
    const room = this.room();
    if (room.hostUid === uid) { this.close(uid); return; }
    this.sql.exec("DELETE FROM members WHERE uid=?", uid);
    this.sql.exec("DELETE FROM locks WHERE uid=?", uid);
  }

  snapshot(uid: string): ArtifactRoomSnapshot {
    const room = this.room();
    const self = this.member(uid);
    const members = this.sql.exec<MemberRow>("SELECT * FROM members ORDER BY present DESC, joinedAt").toArray();
    const plan = this.sql.exec<StepRow>("SELECT * FROM plan ORDER BY ord, updatedAt").toArray();
    const notes = this.sql.exec<NoteRow>("SELECT * FROM notes ORDER BY updatedAt DESC LIMIT ?", ARTIFACT_ROOM_LIMITS.notes).toArray();
    const comments = this.sql.exec<CommentRow>("SELECT * FROM comments ORDER BY at DESC LIMIT ?", ARTIFACT_ROOM_LIMITS.comments).toArray();
    const locks = this.sql.exec<LockRow>("SELECT * FROM locks ORDER BY at").toArray();
    const files = this.sql.exec<FileRow>("SELECT * FROM file_versions ORDER BY at").toArray();
    const messageRows = this.sql.exec<MessageRow>("SELECT * FROM messages ORDER BY seq DESC LIMIT 200").toArray();
    const activity = this.sql.exec<ActivityRow>("SELECT * FROM activity ORDER BY seq DESC LIMIT 60").toArray();
    const approvalRows = this.sql.exec<ApprovalRow>("SELECT * FROM approvals ORDER BY at DESC LIMIT ?", ARTIFACT_ROOM_LIMITS.approvals).toArray();
    const handoffRows = this.sql.exec<HandoffRow>("SELECT * FROM handoffs ORDER BY at DESC LIMIT ?", ARTIFACT_ROOM_LIMITS.handoffs).toArray();
    const mappedMembers: ArtifactRoomMember[] = members.map((row) => ({
      uid: row.uid, name: row.name, role: row.role as ArtifactRoomRole, colour: row.colour, watching: row.watching === 1,
      present: row.present === 1, joinedAt: row.joinedAt, lastSeen: row.lastSeen,
      presence: { path: row.path, line: row.line },
      lane: { provider: row.provider, model: row.model, sponsorUid: row.sponsorUid, status: row.status as LaneStatus, task: row.task, updatedAt: row.laneAt },
      ...(row.hasAgent === null ? {} : { hasAgent: row.hasAgent === 1 }),
      ...(row.pushAccess === null ? {} : { pushAccess: row.pushAccess === 1 }),
    }));
    const mappedPlan: ArtifactPlanStep[] = plan.map((row) => ({
      id: row.id, title: row.title, ownerUid: row.ownerUid, status: row.status as PlanStepStatus,
      updatedAt: row.updatedAt, paths: pathsOf(row.paths),
    }));
    const mappedNotes: ArtifactBrainNote[] = notes.map((row) => ({
      id: row.id, path: row.path, anchor: row.anchor, text: row.text, authorId: row.authorId, authorName: row.authorName,
      createdAt: row.createdAt, updatedAt: row.updatedAt, retired: row.retired === 1, commit: row.commitRef,
      stale: noteIsStale({ path: row.path, anchor: row.anchor, retired: row.retired === 1 }, files),
    }));
    const mappedComments: ArtifactRoomComment[] = comments.map((row) => ({
      id: row.id, path: row.path, line: row.line, endLine: row.endLine, text: row.text, authorId: row.authorId,
      authorName: row.authorName, resolved: row.resolved === 1, at: row.at,
      anchorKind: row.anchorKind as ArtifactCommentAnchorKind, hunk: row.hunk, anchor: row.commentAnchor,
      linkedKind: row.linkedKind as ArtifactCommentLinkKind | null, linkedId: row.linkedId,
      stale: commentIsStale({ path: row.path, anchor: row.commentAnchor, anchorKind: row.anchorKind as ArtifactCommentAnchorKind, resolved: row.resolved === 1 }, files),
    }));
    const mappedLocks: ArtifactPathLock[] = locks.map((row) => ({ path: row.path, uid: row.uid, name: row.name, at: row.at }));
    const mappedApprovals: ArtifactApproval[] = approvalRows.map((row) => ({
      id: row.id, kind: row.kind as ArtifactApprovalKind, title: row.title, detail: row.detail,
      paths: pathsOf(row.paths), capabilities: pathsOf(row.capabilities), requestedBy: row.requestedBy,
      requestedName: row.requestedName, status: row.status as ArtifactApprovalStatus, decidedBy: row.decidedBy,
      decidedName: row.decidedName, decidedAt: row.decidedAt, at: row.at, stepId: row.stepId,
    }));
    const mappedHandoffs: ArtifactHandoff[] = handoffRows.map((row) => ({
      id: row.id, fromUid: row.fromUid, fromName: row.fromName, toUid: row.toUid, toName: row.toName, note: row.note,
      branch: row.branch, planDone: row.planDone, planTotal: row.planTotal, noteIds: pathsOf(row.noteIds),
      at: row.at, acceptedAt: row.acceptedAt, acceptedBy: row.acceptedBy,
    }));
    const present = members.filter((row) => row.present === 1).length;
    return {
      artifactId: room.artifactId, title: room.title, hostUid: room.hostUid, open: room.open === 1, startedAt: room.startedAt,
      endedAt: room.endedAt, liveInvite: room.open === 1 ? room.liveInvite : null,
      branch: room.branch, task: room.task, lastSyncedAt: room.lastSyncedAt, selfId: uid,
      self: { uid, name: self.name, role: self.role as ArtifactRoomRole },
      checks: joinChecks({
        role: self.role as ArtifactRoomRole,
        presentCount: Math.max(0, present - (self.present === 1 ? 1 : 0)),
        seatLimit: ARTIFACT_ROOM_LIMITS.members,
        hasAgent: self.hasAgent === null ? null : self.hasAgent === 1,
        pushAccess: self.pushAccess === null ? null : self.pushAccess === 1,
      }),
      members: mappedMembers,
      plan: mappedPlan,
      notes: mappedNotes,
      comments: mappedComments,
      locks: mappedLocks,
      approvals: mappedApprovals,
      handoffs: mappedHandoffs,
      messages: messageRows.reverse().map((row) => ({ seq: row.seq, id: row.id, uid: row.uid, name: row.name, kind: row.kind as ArtifactMessageKind, text: row.text, at: row.at })),
      activity: activity.map((row) => ({ id: row.id, kind: row.kind as ArtifactRoomActivityKind, text: row.text, uid: row.uid, at: row.at })),
      warnings: overlapWarnings({
        uid,
        presence: { path: self.path, line: self.line },
        members: mappedMembers,
        locks: mappedLocks,
        plan: mappedPlan,
        task: room.task,
      }),
    };
  }
}
