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

export type LaneStatus = "idle" | "working" | "waiting" | "handoff" | "offline";

export const LANE_STATUSES: readonly LaneStatus[] = ["idle", "working", "waiting", "handoff", "offline"];

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
}

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
}

export interface ArtifactPathLock {
  readonly path: string;
  readonly uid: string;
  readonly name: string;
  readonly at: number;
}

export type ArtifactRoomActivityKind =
  | "room.opened" | "room.closed" | "room.joined" | "room.left" | "room.role"
  | "plan.added" | "plan.moved" | "plan.removed"
  | "brain.added" | "brain.updated" | "brain.retired"
  | "comment.added" | "comment.resolved"
  | "path.locked" | "path.unlocked"
  | "lane.takeover" | "lane.handoff"
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
  readonly kind: "locked" | "same-file";
  readonly uid: string;
  readonly name: string;
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
  readonly selfId: string;
  readonly self: ArtifactRoomSelf;
  readonly members: readonly ArtifactRoomMember[];
  readonly plan: readonly ArtifactPlanStep[];
  readonly notes: readonly ArtifactBrainNote[];
  readonly comments: readonly ArtifactRoomComment[];
  readonly locks: readonly ArtifactPathLock[];
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
  text: 4000,
  task: 200,
  note: 2000,
  path: 240,
  name: 64,
  provider: 40,
  model: 100,
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
  files: readonly { readonly path: string; readonly content: string }[],
): boolean {
  if (note.retired || note.anchor === null) return false;
  const file = files.find((one) => one.path === note.path);
  return file === undefined || contentFingerprint(file.content) !== note.anchor;
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

export function laneOpenForTakeover(lane: ArtifactLane): boolean {
  return lane.status === "handoff" || lane.status === "offline";
}

export function overlapWarnings(input: {
  readonly uid: string;
  readonly presence: ArtifactPresence;
  readonly members: readonly ArtifactRoomMember[];
  readonly locks: readonly ArtifactPathLock[];
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
  }
  return warnings.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name));
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
