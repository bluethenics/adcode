import type { AiPlanState } from "../src/aiPlans.ts";

/** Per-account plan snapshots. Entitlement boundaries override both the TTL and stale fallback.
 * Never share an in-flight fetch between Cloudflare requests (see dbGuard.ts).
 */
export function createAiPlanCache(load: (uid: string, now: number) => Promise<AiPlanState>, clock: () => number = Date.now) {
  const entries = new Map<string, { data: AiPlanState | null; loadedAt: number }>();
  const valid = (state: AiPlanState, now: number): boolean => state.validUntil == null || state.validUntil > now;
  return {
    async get(uid: string, now: number): Promise<AiPlanState> {
      let entry = entries.get(uid);
      if (entry === undefined) {
        if (entries.size >= 5_000) entries.delete(entries.keys().next().value!);
        entry = { data: null, loadedAt: 0 }; entries.set(uid, entry);
      }
      if (entry.data !== null && valid(entry.data, now) && clock() - entry.loadedAt < 30_000) return entry.data;
      try {
        const data = await load(uid, now);
        // A webhook/admin write may have invalidated this copy while its read was running.
        if (entries.get(uid) === entry) { entry.data = data; entry.loadedAt = clock(); }
        return data;
      } catch (error) {
        if (entry.data !== null && valid(entry.data, now) && clock() - entry.loadedAt < 600_000) return entry.data;
        throw error;
      }
    },
    forget(uid: string) { entries.delete(uid); },
    clear() { entries.clear(); },
  };
}
