/**
 * Noticing that this account has been banned, and noticing when it no longer is.
 *
 * Pure: no Electron, no DOM, so the desktop's main process and the web version's Web Worker
 * host (`browserHost/hostMain.ts`, through `accountBan.ts`) share it and a test can drive it.
 *
 * How a ban is noticed: every API refusal of a banned account carries `x-adcode-account: banned`
 * on a 403 (`services/api/src/accountBan.ts`), whichever route refused it - ads, AI, earnings,
 * the account check. So one wrapper around `fetch` catches all of them, including routes added
 * after this was written, instead of each caller having to remember to look. Only responses
 * from the API's own origin count: a page this machine previews must not be able to put up the
 * banned screen by sending the header.
 *
 * How it ends: only by asking. `GET /v1/me` once a minute while banned, and at once when the
 * person presses "Check again". A 2xx from some other route would also mean "unbanned", but
 * public routes answer anybody, so it proves nothing.
 */
export const BAN_HEADER = "x-adcode-account";

import type { AccountBanState } from "../shared/api.ts";
export type { AccountBanState };

export type Standing = "active" | "banned" | "unknown";

/** True for the API's refusal of a banned account, and nothing else. */
export function isBanRefusal(status: number, headers: { get(name: string): string | null }): boolean {
  return status === 403 && headers.get(BAN_HEADER) === "banned";
}

/** The URL a `fetch` call was made with, whatever form it was given in. */
export function requestUrl(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (typeof input === "object" && input !== null && typeof (input as { url?: unknown }).url === "string") return (input as { url: string }).url;
  return null;
}

/**
 * `fetch`, reporting every ban refusal from `isApi` origins. The response is handed back
 * untouched - the caller still sees its 403 and handles it as it always did.
 */
export function watchFetch(inner: typeof fetch, isApi: (url: string) => boolean, onBanned: () => void): typeof fetch {
  const watched = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const response = await inner(input, init);
    try {
      const url = requestUrl(input);
      if (url !== null && isBanRefusal(response.status, response.headers) && isApi(url)) onBanned();
    } catch { /* Noticing a ban never breaks a request. */ }
    return response;
  };
  return watched as typeof fetch;
}

/** Same origin as the API, compared as origins rather than string prefixes. */
export function sameOrigin(apiOrigin: string): (url: string) => boolean {
  let origin: string;
  try { origin = new URL(apiOrigin).origin; } catch { return () => false; }
  return (url) => {
    try { return new URL(url).origin === origin; } catch { return false; }
  };
}

export interface BanWatchDeps {
  /** Asks the API whether this account is banned. "unknown" when it could not tell. */
  check(): Promise<Standing>;
  publish(state: AccountBanState): void;
  uid(): string | null;
  now(): number;
  /** Runs `run` after `ms`; returns a cancel. */
  later(run: () => void, ms: number): () => void;
  /** How often to ask again while banned. */
  readonly recheckMs?: number;
}

export interface BanWatch {
  state(): AccountBanState;
  /** A ban refusal was seen. */
  noteBanned(): void;
  /** Ask now, and publish whatever changed. */
  recheck(): Promise<AccountBanState>;
  /** The account on this machine changed (signed out, signed in as someone else). */
  accountChanged(): void;
  stop(): void;
}

export function createBanWatch(deps: BanWatchDeps): BanWatch {
  const recheckMs = deps.recheckMs ?? 60_000;
  let state: AccountBanState = { banned: false };
  let cancel: (() => void) | null = null;
  let stopped = false;

  const schedule = (): void => {
    cancel?.();
    cancel = null;
    if (stopped || !state.banned) return;
    cancel = deps.later(() => { void watch.recheck(); }, recheckMs);
  };
  const set = (next: AccountBanState): void => {
    const changed = next.banned !== state.banned || (next.banned && state.banned && next.uid !== state.uid);
    state = next;
    if (changed) deps.publish(state);
    schedule();
  };

  const watch: BanWatch = {
    state: () => state,
    noteBanned() {
      if (state.banned && state.uid === deps.uid()) return;
      set({ banned: true, uid: deps.uid(), since: deps.now() });
    },
    async recheck() {
      const standing = await deps.check().catch((): Standing => "unknown");
      if (standing === "banned") { if (!state.banned || state.uid !== deps.uid()) set({ banned: true, uid: deps.uid(), since: deps.now() }); else schedule(); }
      else if (standing === "active") set({ banned: false });
      else schedule();
      return state;
    },
    accountChanged() {
      // A ban belongs to an account: another one on this machine starts unbanned, and asks.
      if (state.banned && state.uid !== deps.uid()) { set({ banned: false }); void watch.recheck(); }
    },
    stop() { stopped = true; cancel?.(); cancel = null; },
  };
  return watch;
}
