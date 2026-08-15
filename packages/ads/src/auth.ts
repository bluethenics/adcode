/**
 * Firebase Anonymous Auth, over the REST endpoints.
 *
 * Brief §8.4: first launch performs anonymous auth with no UI and no wall, yielding a
 * UID and an ID token. Earnings accrue against that UID server-side, and at cash-out
 * `linkWithCredential` upgrades the same UID to a real account so the balance carries
 * over with no ledger-merge logic.
 *
 * Spec deviation D2: §8.4 says to use the Firebase Auth SDK directly. This uses the
 * REST endpoints the SDK itself calls, for two reasons. The SDK's auth layer expects
 * browser storage for persistence, and it would be the only runtime dependency in a
 * package whose value proposition (§2) is having none. The security posture is
 * unchanged: identity still comes from a Firebase ID token, and no signing key ships in
 * the binary - §1 is explicit that a key shipped with the app can be extracted by
 * anyone, so client-side signing would be security theatre.
 */
import {
  err,
  ok,
  type AuthError,
  type Clock,
  type FileStore,
  type HttpTransport,
  type Result,
  type TokenProvider,
} from "./types.ts";

const SIGN_UP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signUp";
const REFRESH_URL = "https://securetoken.googleapis.com/v1/token";
const STORE_KEY = "ads/identity.json";

/**
 * Refresh this long before the token actually expires.
 *
 * A token that is valid when the request is built but expired when it arrives produces
 * a 401 that looks like a bug and costs the user an earning.
 */
export const REFRESH_SKEW_MS = 60_000;

const AUTH_TIMEOUT_MS = 10_000;

const decoder = new TextDecoder();

interface Identity {
  uid: string;
  refreshToken: string;
}

interface CachedToken {
  idToken: string;
  expiresAt: number;
}

const authError = (detail: string): Result<never, AuthError> => err({ kind: "auth", detail });

function readJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(decoder.decode(bytes));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Firebase reports failures as `{ error: { message } }`; surface that message. */
function errorMessage(body: Record<string, unknown> | null, status: number): string {
  const error = body?.["error"];
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  return `HTTP ${status}`;
}

export interface FirebaseAuthDeps {
  readonly http: HttpTransport;
  readonly clock: Clock;
  readonly store: FileStore;
  readonly apiKey: string;
}

export interface FirebaseAuth extends TokenProvider {
  /** The stable pseudonymous identifier earnings accrue against. */
  uid(): string | null;
  /** Rehydrate a persisted identity, so a restart does not create a second one. */
  load(): Promise<void>;
  /** Forfeits any unclaimed balance. The settings screen must warn before calling. */
  reset(): Promise<void>;
}

export function createFirebaseAuth(deps: FirebaseAuthDeps): FirebaseAuth {
  let identity: Identity | null = null;
  let cached: CachedToken | null = null;
  let loaded = false;

  async function persist(): Promise<void> {
    if (identity === null) return;
    await deps.store.write(STORE_KEY, new TextEncoder().encode(JSON.stringify(identity)));
  }

  async function load(): Promise<void> {
    loaded = true;
    const bytes = await deps.store.read(STORE_KEY);
    if (bytes === null) return;

    const parsed = readJson(bytes);
    const uid = parsed?.["uid"];
    const refreshToken = parsed?.["refreshToken"];
    if (typeof uid === "string" && typeof refreshToken === "string") {
      identity = { uid, refreshToken };
    }
  }

  async function signUp(): Promise<Result<string, AuthError>> {
    let response;
    try {
      response = await deps.http.request({
        method: "POST",
        url: `${SIGN_UP_URL}?key=${encodeURIComponent(deps.apiKey)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnSecureToken: true }),
        timeoutMs: AUTH_TIMEOUT_MS,
      });
    } catch (error) {
      return authError(error instanceof Error ? error.message : "sign-up transport failure");
    }

    const body = readJson(response.body);
    if (response.status < 200 || response.status >= 300) {
      return authError(errorMessage(body, response.status));
    }

    const idToken = body?.["idToken"];
    const refreshToken = body?.["refreshToken"];
    const localId = body?.["localId"];
    const expiresIn = body?.["expiresIn"];

    if (typeof idToken !== "string" || typeof refreshToken !== "string" || typeof localId !== "string") {
      return authError("malformed sign-up response");
    }

    identity = { uid: localId, refreshToken };
    cached = {
      idToken,
      expiresAt: deps.clock.now() + secondsToMs(expiresIn),
    };
    await persist();
    return ok(idToken);
  }

  async function refresh(): Promise<Result<string, AuthError>> {
    if (identity === null) return signUp();

    let response;
    try {
      response = await deps.http.request({
        method: "POST",
        url: `${REFRESH_URL}?key=${encodeURIComponent(deps.apiKey)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(identity.refreshToken)}`,
        timeoutMs: AUTH_TIMEOUT_MS,
      });
    } catch (error) {
      return authError(error instanceof Error ? error.message : "refresh transport failure");
    }

    const body = readJson(response.body);

    // A rejected refresh token means the identity is gone server-side. Signing up again
    // is the only way back, and it is better than leaving the user unable to earn.
    if (response.status < 200 || response.status >= 300) {
      identity = null;
      cached = null;
      return signUp();
    }

    const idToken = body?.["id_token"];
    const refreshToken = body?.["refresh_token"];
    const userId = body?.["user_id"];

    if (typeof idToken !== "string") return authError("malformed refresh response");

    identity = {
      uid: typeof userId === "string" ? userId : identity.uid,
      refreshToken: typeof refreshToken === "string" ? refreshToken : identity.refreshToken,
    };
    cached = { idToken, expiresAt: deps.clock.now() + secondsToMs(body?.["expires_in"]) };
    await persist();
    return ok(idToken);
  }

  function secondsToMs(value: unknown): number {
    const seconds = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 3_600_000;
  }

  return {
    uid: () => identity?.uid ?? null,

    load,

    async getToken(): Promise<Result<string, AuthError>> {
      if (!loaded) await load();

      if (cached !== null && deps.clock.now() < cached.expiresAt - REFRESH_SKEW_MS) {
        return ok(cached.idToken);
      }

      return identity === null ? signUp() : refresh();
    },

    invalidate(): void {
      cached = null;
    },

    async reset(): Promise<void> {
      identity = null;
      cached = null;
      loaded = true;
      await deps.store.delete(STORE_KEY);
    },
  };
}
