/** Account project limits. Invitations do not consume an ownership slot. */
export const PROJECT_PLANS = {
  free: { projects: 1, members: 3 }, weekly: { projects: 3, members: 5 },
  monthly: { projects: 5, members: 8 }, pro: { projects: 15, members: 15 },
  max: { projects: 50, members: 30 }, unlimited: { projects: 100, members: 50 },
} as const;
export type ProjectPlan = keyof typeof PROJECT_PLANS;
export interface ProjectEntitlement { plan: ProjectPlan; endsAt: number }
export function projectLimits(entitlement: ProjectEntitlement | null, now: number) {
  const plan = entitlement && entitlement.endsAt > now && Object.hasOwn(PROJECT_PLANS, entitlement.plan) ? entitlement.plan : "free";
  return { plan, ...PROJECT_PLANS[plan] };
}
export interface SharedProjectSummary { id: string; name: string; repository: string; ownerId: string; archived: boolean; memberCount: number; memberLimit: number }
export interface SharedProjectMember { uid: string; name: string; joinedAt: number; messages: number; sessions: number }
export interface ProjectChatSession { id: string; title: string; createdBy: string; createdAt: number; updatedAt: number; pending: boolean }
export interface ProjectChatMessage { seq: number; id: string; sessionId: string; authorId: string; authorName: string; kind: "member" | "assistant" | "error"; text: string; at: number }
export interface SharedProjectSnapshot extends SharedProjectSummary {
  selfId: string; members: SharedProjectMember[]; sessions: ProjectChatSession[]; messages: ProjectChatMessage[];
  invite: string | null; liveInvite: string | null; selectedSession: string | null; hasOlder: boolean;
}
export interface SharedProjectLibrary { projects: SharedProjectSummary[]; limits: ReturnType<typeof projectLimits>; owned: number }
export const PROJECT_INVITE = /^adproject:([a-f0-9]{64}):([a-f0-9]{64})$/;
export const validRepository = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && value.length <= 200;
