import type { AiPlanState } from "./aiPlans.ts";

/** Max shares the top rank with the retired Unlimited: it is the highest plan on sale. */
export const REQUEST_PRIORITY = { free: 0, weekly: 1, monthly: 2, pro: 3, max: 5, unlimited: 5 } as const;
export type RequestTier = keyof typeof REQUEST_PRIORITY;
export function requestTier(state: Pick<AiPlanState,"plan">, now: number): RequestTier {
  return state.plan && state.plan.endsAt > now && Object.hasOwn(REQUEST_PRIORITY,state.plan.id) ? state.plan.id : "free";
}
/** Ten seconds of waiting gives Free the same rank as a newly queued Unlimited request. */
export function priorityOrder(enqueuedAt: number, tier: RequestTier): number { return enqueuedAt - REQUEST_PRIORITY[tier]*2000; }

/** Provider slots one queue serves at once. */
export const QUEUE_SLOTS = 16;
/**
 * Requests one account may run at once: Free matches the four chats the desktop runs in parallel.
 * Free was 2, and 23 accounts were refused 1,928 times in eleven hours on 2-3 November 2026
 * while the providers had room - one person's own parallel chats and helpers, not a busy service.
 */
export const activeCap = (rank: number): number => rank === REQUEST_PRIORITY.free ? 4 : 8;
/** Running plus waiting requests one account may hold; only beyond this is a request refused. */
export const QUEUED_PER_ACCOUNT = 16;

/**
 * Which waiting tickets start now. `waiting` is in queue order (priorityOrder, then id). A ticket
 * whose account already runs its share waits in place - it is skipped, not refused - so the next
 * account's request can use a free slot. Pure, so the Worker's queue and its tests agree.
 */
export function ticketsToAdmit(waiting: readonly { id: string; uid: string; rank: number }[], active: ReadonlyMap<string, number>, slots: number): string[] {
  const running = new Map(active);
  const admitted: string[] = [];
  for (const ticket of waiting) {
    if (admitted.length >= slots) break;
    const mine = running.get(ticket.uid) ?? 0;
    if (mine >= activeCap(ticket.rank)) continue;
    running.set(ticket.uid, mine + 1);
    admitted.push(ticket.id);
  }
  return admitted;
}
export interface PriorityLease { release(): Promise<void>; readonly signal?: AbortSignal }
export interface RequestPriority {
  acquire(input: { uid: string; pool: string; plan: AiPlanState["plan"]; signal: AbortSignal }): Promise<PriorityLease>;
}

/** Preserve streaming and cancellation while keeping the queue slot until the response ends. */
export async function releaseWithResponse(response: Response, lease: PriorityLease): Promise<Response> {
  if (!response.body || !response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
    await lease.release().catch(()=>{}); return response;
  }
  const reader=response.body.getReader();
  const stream=new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const part=await reader.read(); if(part.done) { await lease.release().catch(()=>{}); controller.close(); } else controller.enqueue(part.value); }
      catch(error) { await lease.release().catch(()=>{}); controller.error(error); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } finally { await lease.release().catch(()=>{}); } },
  });
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
}
