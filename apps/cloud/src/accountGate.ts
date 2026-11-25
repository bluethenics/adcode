/**
 * Whether a verified sign-in belongs to a banned account, for the Workers that are not the API.
 *
 * A Firebase token says who somebody is, not whether ADCode still lets them in: the ban lives in
 * the API's `users` table (`services/api/src/auth.ts`). The API checks it on every request, but
 * two Workers answer signed-in requests without ever reaching the API, and both used to let a
 * banned account straight through:
 *
 * - the web version's own `/api/*` (chat history, GitHub projects, the old sandbox's download),
 *   here in `apps/cloud`;
 * - the projects relay (shared projects, live rooms, Phone link, community publishing), in
 *   `apps/collab-relay`, which imports this file.
 *
 * Each asks once per account and keeps the answer for a few seconds, both ways, so a ban bites
 * within seconds and an unban restores access as fast. When the question cannot be answered
 * (the API is down, or the relay's binding predates `accountStatus`), the answer is "unknown"
 * and the request goes through: these routes cost nothing, and everything that costs money or
 * pays money is behind the API, which refuses a banned account on its own. A ban must not turn
 * an API outage into a web-version outage for everybody else.
 */
import { ACCOUNT_HEADER, BANNED_CLOSE_CODE, bannedResponse } from "../../../services/api/src/accountBan.ts";

export { bannedResponse, BANNED_CLOSE_CODE };

export type AccountStanding = "active" | "banned" | "unknown";

export interface AccountGate {
  standing(uid: string, token: string): Promise<AccountStanding>;
}

export interface GateOptions {
  /** How long one answer is kept, either way. */
  readonly ttlMs?: number;
  readonly max?: number;
  readonly now?: () => number;
}

/** `lookup` throws when it cannot tell; that is "unknown", and is never kept. */
export function createAccountGate(lookup: (uid: string, token: string) => Promise<"active" | "banned">, options: GateOptions = {}): AccountGate {
  const ttlMs = options.ttlMs ?? 5_000, max = options.max ?? 2_000, now = options.now ?? Date.now;
  const known = new Map<string, { standing: "active" | "banned"; at: number }>();
  return {
    async standing(uid, token) {
      const kept = known.get(uid);
      if (kept !== undefined && now() - kept.at < ttlMs) return kept.standing;
      try {
        const standing = await lookup(uid, token);
        if (known.size >= max) known.delete(known.keys().next().value!);
        known.delete(uid);
        known.set(uid, { standing, at: now() });
        return standing;
      } catch {
        return "unknown";
      }
    },
  };
}

/**
 * Asks the API itself: `GET /v1/me` refuses a banned account with the ban header, and answers
 * anybody else. Through the service binding, so it never leaves Cloudflare.
 */
export function standingFromApi(api: { fetch(request: Request): Promise<Response> }, origin = "https://adcode.bluethenics.com"): (uid: string, token: string) => Promise<"active" | "banned"> {
  return async (_uid, token) => {
    const response = await api.fetch(new Request(`${origin}/v1/me`, { headers: { authorization: `Bearer ${token}`, "x-adcode-platform": "web" }, redirect: "manual" }));
    await response.body?.cancel();
    if (response.status === 403 && response.headers.get(ACCOUNT_HEADER) === "banned") return "banned";
    if (response.ok) return "active";
    throw new Error(`account status unavailable (${response.status})`);
  };
}
