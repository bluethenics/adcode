/**
 * The editor's side of invites: reading your own, and claiming one.
 *
 * No Electron here - the clipboard, the identity and the disk come in as functions - so the
 * rules about what is sent and when are tested without launching anything. `referrals.ts`
 * next to this wires it to the real clipboard, the backend token and `userData`.
 *
 * Three promises, each held by a test in `apps/desktop/test/invite.test.ts`:
 *
 * - Clipboard text that is not an invite line or link never leaves the machine.
 * - A code is tried once, not every time the welcome opens, unless the network was the
 *   reason it failed.
 * - Once this account has a claim, or is too old to make one, the clipboard is never read
 *   for an invite again.
 */
import type { ClipboardInviteResult, InviteClaimError, InviteClaimResult, ReferralView } from "../shared/api.ts";
import { parseInviteInput, parseInviteText } from "../shared/invite.ts";

export interface ReferralLocalState {
  /** Every account this machine has used, so a reset cannot invite itself. */
  heldUids: string[];
  /** Codes already sent from the clipboard. */
  tried: string[];
  /** No more clipboard checks: claimed, or past the window. */
  done: boolean;
}

export const EMPTY_REFERRAL_STATE: ReferralLocalState = { heldUids: [], tried: [], done: false };

export interface ReferralClientDeps {
  apiBaseUrl: () => string;
  token: () => Promise<string | null>;
  currentUid: () => string | null;
  readClipboard: () => string;
  load: () => Promise<ReferralLocalState>;
  save: (state: ReferralLocalState) => Promise<void>;
  fetch: typeof fetch;
}

export interface ReferralClient {
  get(): Promise<ReferralView | null>;
  claim(text: string): Promise<InviteClaimResult>;
  checkClipboard(): Promise<ClipboardInviteResult>;
  setShowName(show: boolean): Promise<ReferralView | null>;
}

const TIMEOUT_MS = 10_000;
const MAX_TRIED = 20;
const MAX_HELD = 20;
const SERVER_ERRORS: ReadonlySet<string> = new Set(["unknown-code", "already-claimed", "too-late", "own-code"]);

class Offline extends Error {}

export function createReferralClient(deps: ReferralClientDeps): ReferralClient {
  /** Loads local state with the current account remembered in it. */
  async function state(): Promise<ReferralLocalState> {
    const current = { ...EMPTY_REFERRAL_STATE, ...(await deps.load()) };
    const uid = deps.currentUid();
    if (uid !== null && !current.heldUids.includes(uid)) {
      current.heldUids = [...current.heldUids, uid].slice(-MAX_HELD);
      await deps.save(current);
    }
    return current;
  }

  const earlierUids = (local: ReferralLocalState): string[] => {
    const uid = deps.currentUid();
    return local.heldUids.filter((held) => held !== uid);
  };

  async function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const token = await deps.token();
    if (token === null) throw new Offline("no identity");
    let response: Response;
    try {
      response = await deps.fetch(`${deps.apiBaseUrl()}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new Offline("unreachable");
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      // A body that is not JSON is only a problem for a 200, and the callers check that.
    }
    return { status: response.status, json };
  }

  async function sendClaim(code: string, how: "clipboard" | "paste", local: ReferralLocalState): Promise<InviteClaimResult> {
    let reply: { status: number; json: unknown };
    try {
      reply = await request("POST", "/referrals/claim", { code, how, heldUids: earlierUids(local) });
    } catch {
      return { ok: false, error: "offline" };
    }
    const json = (reply.json ?? {}) as Record<string, unknown>;
    if (reply.status === 200 && json["ok"] === true) {
      return { ok: true, inviterName: typeof json["inviterName"] === "string" ? json["inviterName"] : null };
    }
    const error = json["error"];
    if (reply.status === 409 && typeof error === "string" && SERVER_ERRORS.has(error)) {
      return { ok: false, error: error as InviteClaimError };
    }
    return { ok: false, error: reply.status === 400 ? "invalid" : "unavailable" };
  }

  /** A claim that ended the question for this account, one way or the other. */
  const settles = (result: InviteClaimResult): boolean =>
    result.ok || result.error === "already-claimed" || result.error === "too-late";

  return {
    async get() {
      const local = await state();
      try {
        const reply = await request("GET", "/referrals");
        if (reply.status !== 200) return null;
        const view = reply.json as ReferralView;
        if ((view.claimed || !view.canClaim) && !local.done) await deps.save({ ...local, done: true });
        return view;
      } catch {
        return null;
      }
    },

    async claim(text) {
      const code = parseInviteInput(text);
      if (code === null) return { ok: false, error: "invalid" };
      const local = await state();
      const result = await sendClaim(code, "paste", local);
      if (settles(result)) await deps.save({ ...local, done: true });
      return result;
    },

    async checkClipboard() {
      const local = await state();
      if (local.done) return { claimed: false };

      let text = "";
      try {
        text = deps.readClipboard();
      } catch {
        return { claimed: false };
      }
      const code = parseInviteText(text);
      if (code === null || local.tried.includes(code)) return { claimed: false };

      const tried = { ...local, tried: [...local.tried, code].slice(-MAX_TRIED) };
      await deps.save(tried);
      const result = await sendClaim(code, "clipboard", tried);

      if (!result.ok && result.error === "offline") {
        // Not the code's fault: let the next look try it again.
        await deps.save({ ...tried, tried: tried.tried.filter((t) => t !== code) });
        return { claimed: false };
      }
      if (settles(result)) await deps.save({ ...tried, done: true });
      return result.ok ? { claimed: true, inviterName: result.inviterName } : { claimed: false };
    },

    async setShowName(show) {
      try {
        const reply = await request("PATCH", "/referrals", { showName: show });
        return reply.status === 200 ? (reply.json as ReferralView) : null;
      } catch {
        return null;
      }
    },
  };
}
