/**
 * The shared room around a live artifact: who is here, what each person's agent is doing,
 * the one plan, the shared Brain, comments, advisory path locks, and the handoff baton.
 *
 * The file text itself travels through the existing host/guest document protocol. This module
 * is the coordination layer around it: the context that used to live in five people's heads
 * and five separate chat windows, kept in one place every participant can read.
 */

import { CURSOR_COLOURS } from "./colours.ts";

export type ArtifactRoomRole = "owner" | "editor" | "commenter" | "viewer";

export const ARTIFACT_ROOM_ROLES: readonly ArtifactRoomRole[] = ["owner", "editor", "commenter", "viewer"];

export function isArtifactRoomRole(value: unknown): value is ArtifactRoomRole {
  return typeof value === "string" && (ARTIFACT_ROOM_ROLES as readonly string[]).includes(value);
}

export type LaneStatus = "idle" | "working" | "waiting" | "awaiting" | "handoff" | "offline";

export const LANE_STATUSES: readonly LaneStatus[] = ["idle", "working", "waiting", "awaiting", "handoff", "offline"];

export function isLaneStatus(value: unknown): value is LaneStatus {
  return typeof value === "string" && (LANE_STATUSES as readonly string[]).includes(value);
}

export interface ArtifactLane {
  readonly provider: string;
  readonly model: string;
  readonly sponsorUid: string | null;
  readonly status: LaneStatus;
  readonly task: string;
  readonly updatedAt: number;
}

export interface ArtifactPresence {
  readonly path: string | null;
  readonly line: number | null;
}

export interface ArtifactRoomMember {
  readonly uid: string;
  readonly name: string;
  readonly role: ArtifactRoomRole;
  readonly colour: string;
  readonly watching: boolean;
  readonly present: boolean;
  readonly joinedAt: number;
  readonly lastSeen: number;
  readonly presence: ArtifactPresence;
  readonly lane: ArtifactLane;
  /** Null until the client has checked: there may be no provider or CLI installed. */
  readonly hasAgent?: boolean;
  /** Null until the client has checked whether this account can push the branch. */
  readonly pushAccess?: boolean;
}

export type PlanStepStatus = "todo" | "doing" | "done" | "blocked";

export const PLAN_STEP_STATUSES: readonly PlanStepStatus[] = ["todo", "doing", "done", "blocked"];

export function isPlanStepStatus(value: unknown): value is PlanStepStatus {
  return typeof value === "string" && (PLAN_STEP_STATUSES as readonly string[]).includes(value);
}

export interface ArtifactPlanStep {
  readonly id: string;
  readonly title: string;
  readonly ownerUid: string | null;
  readonly status: PlanStepStatus;
  readonly updatedAt: number;
  /** Files this step expects to touch, for overlap warnings before a prompt runs. */
  readonly paths?: readonly string[];
}

export interface ArtifactBrainNote {
  readonly id: string;
  readonly path: string;
  readonly anchor: string | null;
  readonly text: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly retired: boolean;
  /** The commit the note was written against, when the author knew it. */
  readonly commit?: string | null;
  /** True when the file's current fingerprint no longer matches the note's anchor. */
  readonly stale?: boolean;
}

export type ArtifactCommentAnchorKind = "session" | "file" | "hunk" | "transcript";

export const ARTIFACT_COMMENT_ANCHORS: readonly ArtifactCommentAnchorKind[] = ["session", "file", "hunk", "transcript"];

export type ArtifactCommentLinkKind = "plan" | "suggestion" | "prompt";

export interface ArtifactRoomComment {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly endLine: number;
  readonly text: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly resolved: boolean;
  readonly at: number;
  readonly anchorKind?: ArtifactCommentAnchorKind;
  /** A transcript moment or diff hunk the comment is attached to. */
  readonly hunk?: string | null;
  /** File fingerprint when the comment was written, so a later edit can be labelled. */
  readonly anchor?: string | null;
  readonly stale?: boolean;
  readonly linkedKind?: ArtifactCommentLinkKind | null;
  readonly linkedId?: string | null;
}

export interface ArtifactPathLock {
  readonly path: string;
  readonly uid: string;
  readonly name: string;
  readonly at: number;
}

export type ArtifactRoomActivityKind =
  | "room.opened" | "room.closed" | "room.joined" | "room.left" | "room.role"
  | "room.watch" | "room.session" | "room.synced"
  | "plan.added" | "plan.moved" | "plan.removed" | "plan.claimed" | "plan.requested"
  | "brain.added" | "brain.updated" | "brain.retired"
  | "comment.added" | "comment.resolved" | "comment.linked"
  | "path.locked" | "path.unlocked"
  | "lane.takeover" | "lane.handoff" | "lane.awaiting"
  | "approval.requested" | "approval.approved" | "approval.declined"
  | "handoff.offered" | "handoff.accepted"
  | "live.started" | "live.ended";

export interface ArtifactRoomActivity {
  readonly id: string;
  readonly kind: ArtifactRoomActivityKind;
  readonly text: string;
  readonly uid: string;
  readonly at: number;
}

export type ArtifactMessageKind = "member" | "agent" | "system";

export interface ArtifactRoomMessage {
  readonly seq: number;
  readonly id: string;
  readonly uid: string;
  readonly name: string;
  readonly kind: ArtifactMessageKind;
  readonly text: string;
  readonly at: number;
}

export interface ArtifactOverlapWarning {
  readonly path: string;
  readonly kind: "locked" | "same-file" | "planned" | "adjacent";
  readonly uid: string;
  readonly name: string;
  /** The plan step or task that produced a planned/adjacent warning. */
  readonly stepId?: string;
  readonly detail?: string;
}

export type ArtifactApprovalKind = "push" | "network" | "command" | "plan-transfer" | "handoff";

export const ARTIFACT_APPROVAL_KINDS: readonly ArtifactApprovalKind[] = ["push", "network", "command", "plan-transfer", "handoff"];

export type ArtifactApprovalStatus = "pending" | "approved" | "declined";

export interface ArtifactApproval {
  readonly id: string;
  readonly kind: ArtifactApprovalKind;
  readonly title: string;
  readonly detail: string;
  readonly paths: readonly string[];
  readonly capabilities: readonly string[];
  readonly requestedBy: string;
  readonly requestedName: string;
  readonly status: ArtifactApprovalStatus;
  readonly decidedBy: string | null;
  readonly decidedName: string | null;
  readonly decidedAt: number;
  readonly at: number;
  /** The plan step a `plan-transfer` approval would move. */
  readonly stepId?: string | null;
}

export interface ArtifactHandoff {
  readonly id: string;
  readonly fromUid: string;
  readonly fromName: string;
  readonly toUid: string | null;
  readonly toName: string | null;
  readonly note: string;
  readonly branch: string;
  readonly planDone: number;
  readonly planTotal: number;
  readonly noteIds: readonly string[];
  readonly at: number;
  readonly acceptedAt: number;
  readonly acceptedBy: string | null;
}

export interface ArtifactJoinCheck {
  readonly id: "role" | "seat" | "push" | "agent";
  readonly label: string;
  /** Null means it could not be checked, which is not the same as a failure. */
  readonly ok: boolean | null;
  readonly detail: string;
}

/** One session card in Mission Control: the present, not the git history. */
export interface ArtifactRoomCard {
  readonly artifactId: string;
  readonly title: string;
  readonly task: string;
  readonly hostName: string;
  readonly branch: string;
  readonly open: boolean;
  readonly memberCount: number;
  readonly planDone: number;
  readonly planTotal: number;
  readonly percent: number;
  readonly files: readonly string[];
  readonly approvals: number;
  readonly handoffs: number;
  readonly warnings: number;
  readonly updatedAt: number;
}

export interface ArtifactRoomSelf {
  readonly uid: string;
  readonly name: string;
  readonly role: ArtifactRoomRole;
}

export interface ArtifactRoomSnapshot {
  readonly artifactId: string;
  readonly title: string;
  readonly hostUid: string;
  readonly open: boolean;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly liveInvite: string | null;
  /** The one branch this session works on. */
  readonly branch: string;
  /** The one task this session is for. */
  readonly task: string;
  readonly lastSyncedAt: number;
  readonly selfId: string;
  readonly self: ArtifactRoomSelf;
  readonly checks: readonly ArtifactJoinCheck[];
  readonly members: readonly ArtifactRoomMember[];
  readonly plan: readonly ArtifactPlanStep[];
  readonly notes: readonly ArtifactBrainNote[];
  readonly comments: readonly ArtifactRoomComment[];
  readonly locks: readonly ArtifactPathLock[];
  readonly approvals: readonly ArtifactApproval[];
  readonly handoffs: readonly ArtifactHandoff[];
  readonly messages: readonly ArtifactRoomMessage[];
  readonly activity: readonly ArtifactRoomActivity[];
  readonly warnings: readonly ArtifactOverlapWarning[];
}

export const ARTIFACT_ROOM_LIMITS = {
  members: 30,
  steps: 100,
  notes: 100,
  comments: 200,
  messages: 500,
  activity: 200,
  locks: 50,
  approvals: 50,
  handoffs: 50,
  files: 500,
  text: 4000,
  task: 200,
  note: 2000,
  approval: 2000,
  hunk: 240,
  branch: 120,
  path: 240,
  paths: 20,
  name: 64,
  provider: 40,
  model: 100,
  capability: 40,
} as const;

export interface ArtifactRoomCapabilities {
  readonly comment: boolean;
  readonly editPlan: boolean;
  readonly editBrain: boolean;
  readonly lockPath: boolean;
  readonly writeFiles: boolean;
  readonly manage: boolean;
}

export function roomCapabilities(role: ArtifactRoomRole): ArtifactRoomCapabilities {
  const editor = role === "owner" || role === "editor";
  return {
    comment: role !== "viewer",
    editPlan: editor,
    editBrain: editor,
    lockPath: editor,
    writeFiles: editor,
    manage: role === "owner",
  };
}

export function canComment(role: ArtifactRoomRole): boolean {
  return roomCapabilities(role).comment;
}

export function canEditRoom(role: ArtifactRoomRole): boolean {
  return roomCapabilities(role).writeFiles;
}

export function canManageRoom(role: ArtifactRoomRole): boolean {
  return roomCapabilities(role).manage;
}

export function roomRoleFor(access: "owner" | "viewer", watch: boolean): ArtifactRoomRole {
  if (access === "owner") return "owner";
  return watch ? "viewer" : "editor";
}

export function colourForUid(uid: string): string {
  let hash = 0;
  for (let index = 0; index < uid.length; index++) hash = (hash * 31 + uid.charCodeAt(index)) >>> 0;
  return CURSOR_COLOURS[hash % CURSOR_COLOURS.length]!;
}

export function contentFingerprint(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function noteIsStale(
  note: Pick<ArtifactBrainNote, "path" | "anchor" | "retired">,
  files: readonly { readonly path: string; readonly content?: string; readonly fingerprint?: string }[],
): boolean {
  if (note.retired || note.anchor === null) return false;
  const file = files.find((one) => one.path === note.path);
  if (file === undefined) return true;
  const fingerprint = file.fingerprint ?? (file.content === undefined ? null : contentFingerprint(file.content));
  return fingerprint !== note.anchor;
}

export interface PlanProgress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
  readonly blocked: number;
}

export function planProgress(steps: readonly ArtifactPlanStep[]): PlanProgress {
  const total = steps.length;
  const done = steps.filter((step) => step.status === "done").length;
  const blocked = steps.filter((step) => step.status === "blocked").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100), blocked };
}

export function stepTransferable(step: ArtifactPlanStep): boolean {
  return step.status === "todo";
}

/** Work nobody has started: unowned steps, or steps already yours, can be claimed at once. */
export function stepClaimable(step: ArtifactPlanStep, uid: string): boolean {
  return step.status === "todo" && (step.ownerUid === null || step.ownerUid === uid);
}

/** A live session card for Mission Control, computed from the room, never from a guess. */
export function roomCardFromSnapshot(snapshot: ArtifactRoomSnapshot): ArtifactRoomCard {
  const progress = planProgress(snapshot.plan);
  const files = new Set<string>();
  for (const member of snapshot.members) if (member.present && member.presence.path !== null) files.add(member.presence.path);
  for (const step of snapshot.plan) for (const path of step.paths ?? []) files.add(path);
  const updatedAt = snapshot.members.reduce((latest, member) => Math.max(latest, member.lane.updatedAt, member.lastSeen), snapshot.lastSyncedAt);
  return {
    artifactId: snapshot.artifactId,
    title: snapshot.title,
    task: snapshot.task,
    hostName: snapshot.members.find((member) => member.uid === snapshot.hostUid)?.name ?? "The owner",
    branch: snapshot.branch,
    open: snapshot.open,
    memberCount: snapshot.members.filter((member) => member.present).length,
    planDone: progress.done,
    planTotal: progress.total,
    percent: progress.percent,
    files: [...files].sort().slice(0, 20),
    approvals: snapshot.approvals.filter((approval) => approval.status === "pending").length,
    handoffs: snapshot.handoffs.filter((handoff) => handoff.acceptedAt === 0).length,
    warnings: snapshot.warnings.length,
    updatedAt,
  };
}

export function laneOpenForTakeover(lane: ArtifactLane): boolean {
  return lane.status === "handoff" || lane.status === "awaiting" || lane.status === "offline";
}

const ADJACENT_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "into", "your", "our", "are", "was", "were", "have", "has", "will", "can", "not", "but", "its", "it's", "all", "any", "one", "two", "new", "old"]);

function taskWords(value: string | null | undefined): Set<string> {
  return new Set((value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !ADJACENT_STOP_WORDS.has(word)));
}

export function overlapWarnings(input: {
  readonly uid: string;
  readonly presence: ArtifactPresence;
  readonly members: readonly ArtifactRoomMember[];
  readonly locks: readonly ArtifactPathLock[];
  readonly plan?: readonly ArtifactPlanStep[];
  readonly task?: string | null;
}): ArtifactOverlapWarning[] {
  const warnings: ArtifactOverlapWarning[] = [];
  const seen = new Set<string>();
  const path = input.presence.path;
  if (path !== null) {
    for (const lock of input.locks) {
      if (lock.uid === input.uid || lock.path !== path) continue;
      const key = `locked:${lock.uid}:${lock.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({ path, kind: "locked", uid: lock.uid, name: lock.name });
    }
    for (const member of input.members) {
      if (!member.present || member.uid === input.uid || member.presence.path !== path) continue;
      const key = `same-file:${member.uid}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({ path, kind: "same-file", uid: member.uid, name: member.name });
    }
    for (const step of input.plan ?? []) {
      if (step.ownerUid === input.uid || step.status === "done" || !(step.paths ?? []).includes(path)) continue;
      const key = `planned:${step.id}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const owner = input.members.find((member) => member.uid === step.ownerUid);
      warnings.push({ path, kind: "planned", uid: step.ownerUid ?? "", name: owner?.name ?? "An unclaimed plan step", stepId: step.id, detail: step.title });
    }
  }
  const mine = taskWords(input.task);
  if (mine.size > 0) {
    for (const member of input.members) {
      if (!member.present || member.uid === input.uid) continue;
      const theirs = taskWords(member.lane.task);
      const shared = [...mine].filter((word) => theirs.has(word));
      if (shared.length === 0) continue;
      const key = `adjacent:${member.uid}:${shared.sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({ path: member.presence.path ?? "", kind: "adjacent", uid: member.uid, name: member.name, detail: member.lane.task });
    }
  }
  return warnings.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
}

export function joinChecks(input: {
  readonly role: ArtifactRoomRole;
  readonly presentCount: number;
  readonly seatLimit: number;
  readonly hasAgent: boolean | null;
  readonly pushAccess: boolean | null;
}): ArtifactJoinCheck[] {
  const seatOpen = input.presentCount < input.seatLimit;
  return [
    { id: "role", label: "Role", ok: true, detail: `You are joining as ${input.role}.` },
    { id: "seat", label: "Seat", ok: seatOpen, detail: seatOpen ? "There is a free seat." : `All ${input.seatLimit} seats are taken. Watch, or try again when somebody leaves.` },
    {
      id: "push", label: "Push access",
      ok: input.pushAccess,
      detail: input.pushAccess === true ? "You can push the session branch." : input.pushAccess === false ? "This account cannot push the branch yet. You can still work locally and comment." : "Push access has not been checked.",
    },
    {
      id: "agent", label: "Agent",
      ok: input.hasAgent,
      detail: input.hasAgent === true ? "An agent is available on this computer." : input.hasAgent === false ? "No agent is connected. You can watch, comment, hold work and hand it on." : "Agent availability has not been checked.",
    },
  ];
}

export function commentIsStale(
  comment: Pick<ArtifactRoomComment, "path" | "anchor" | "anchorKind" | "resolved">,
  files: readonly { readonly path: string; readonly content?: string; readonly fingerprint?: string }[],
): boolean {
  if (comment.resolved || comment.anchor === null || comment.anchor === undefined) return false;
  if (comment.anchorKind === "session" || comment.anchorKind === "transcript") return false;
  const file = files.find((one) => one.path === comment.path);
  if (file === undefined) return true;
  const fingerprint = file.fingerprint ?? (file.content === undefined ? null : contentFingerprint(file.content));
  return fingerprint !== comment.anchor;
}

export function roomBranch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const branch = value.trim();
  if (branch.length === 0 || branch.length > ARTIFACT_ROOM_LIMITS.branch) return null;
  return /[\u0000-\u001f\u007f\\]/.test(branch) ? null : branch;
}

export function roomPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > ARTIFACT_ROOM_LIMITS.paths) return null;
  const paths: string[] = [];
  for (const one of value) {
    const path = roomPath(one);
    if (path === null) return null;
    if (!paths.includes(path)) paths.push(path);
  }
  return paths;
}

export function roomPath(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > ARTIFACT_ROOM_LIMITS.path) return null;
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[a-z]:/i.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) return null;
  return value;
}

export function roomText(value: unknown, minimum: number, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) return null;
  return text;
}

export function sanitiseRoomName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name.length === 0 || name.length > ARTIFACT_ROOM_LIMITS.name ? null : name;
}
