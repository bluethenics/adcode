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
const UPDATE_URL = "https://identitytoolkit.googleapis.com/v1/accounts:update";
const IDP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp";
const LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";
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

/**
 * What a linked account looks like.
 *
 * Every field is optional at the provider's discretion - a Google account without a
 * picture returns no `photoUrl`, and the UI has to survive that rather than render a
 * broken image.
 */
export interface LinkedProfile {
  readonly email: string | null;
  readonly displayName: string | null;
  readonly photoUrl: string | null;
  /** e.g. `["google.com"]`. Empty means the account is still anonymous. */
  readonly providers: readonly string[];
}

export interface FirebaseAuth extends TokenProvider {
  /** The stable pseudonymous identifier earnings accrue against. */
  uid(): string | null;
  /** Rehydrate a persisted identity, so a restart does not create a second one. */
  load(): Promise<void>;
  /** Forfeits any unclaimed balance. The settings screen must warn before calling. */
  reset(): Promise<void>;

  /**
   * Attach an email and password to the anonymous account.
   *
   * The UID is preserved, which is the whole point: earnings already accrued against it
   * carry over with no ledger merge. If the provider ever returns a different UID the
   * link is refused rather than accepted, because accepting it would strand the balance.
   */
  linkPassword(email: string, password: string): Promise<Result<LinkedProfile, AuthError>>;

  /**
   * The same, with a credential from an identity provider.
   *
   * The two providers hand back different things and Firebase wants them named
   * differently: Google issues an OpenID `id_token`, GitHub issues an OAuth
   * `access_token`. The host's OAuth flow obtains one; this attaches it.
   */
  linkGoogle(googleIdToken: string): Promise<Result<LinkedProfile, AuthError>>;
  linkGitHub(githubAccessToken: string): Promise<Result<LinkedProfile, AuthError>>;

  /** Null when the account is still anonymous. */
  profile(): Promise<Result<LinkedProfile | null, AuthError>>;
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


  /** Providers Firebase reports for the current user, as plain strings. */
  function providersOf(body: Record<string, unknown> | null): string[] {
    const info = body?.["providerUserInfo"];
    if (!Array.isArray(info)) return [];
    return info
      .map((entry) => (typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)["providerId"] : null))
      .filter((id): id is string => typeof id === "string");
  }

  const asText = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

  /**
   * Adopt the tokens a link call returns.
   *
   * Linking rotates the refresh token, so the stored identity has to be replaced. Keeping
   * the old one would work until the next restart and then silently sign the user out.
   */
  async function adoptTokens(body: Record<string, unknown>): Promise<boolean> {
    const idToken = body["idToken"];
    const refreshToken = body["refreshToken"];
    const localId = body["localId"];
    const expiresIn = body["expiresIn"];

    if (typeof idToken !== "string" || typeof refreshToken !== "string" || typeof localId !== "string") {
      return false;
    }

    identity = { uid: localId, refreshToken };
    const seconds = typeof expiresIn === "string" ? Number(expiresIn) : 3600;
    cached = {
      idToken,
      expiresAt: deps.clock.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
    };
    await persist();
    return true;
  }

  /** A token for the account as it stands, so a link call can name who is linking. */
  async function currentToken(): Promise<Result<string, AuthError>> {
    if (!loaded) await load();
    if (cached !== null && deps.clock.now() < cached.expiresAt - REFRESH_SKEW_MS) return ok(cached.idToken);
    return identity === null ? signUp() : refresh();
  }

  /**
   * Attach an identity-provider credential.
   *
   * `requestUri` is required by the endpoint and unused when the credential arrives in a
   * post body, so any absolute URL satisfies it.
   */
  async function linkIdp(
    providerId: string,
    field: "id_token" | "access_token",
    credential: string,
  ): Promise<Result<LinkedProfile, AuthError>> {
    return link(IDP_URL, {
      postBody: `${field}=${encodeURIComponent(credential)}&providerId=${providerId}`,
      requestUri: "http://localhost",
      returnIdpCredential: true,
    });
  }

  async function link(
    url: string,
    payload: Record<string, unknown>,
  ): Promise<Result<LinkedProfile, AuthError>> {
    const token = await currentToken();
    if (!token.ok) return token;

    const before = identity?.uid ?? null;

    let response;
    try {
      response = await deps.http.request({
        method: "POST",
        url: `${url}?key=${encodeURIComponent(deps.apiKey)}`,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, idToken: token.value, returnSecureToken: true }),
        timeoutMs: AUTH_TIMEOUT_MS,
      });
    } catch (error) {
      return authError(error instanceof Error ? error.message : "link transport failure");
    }

    const body = readJson(response.body);
    if (response.status < 200 || response.status >= 300) {
      return authError(errorMessage(body, response.status));
    }
    if (body === null) return authError("the sign-in service returned something unreadable");

    /*
     * A 200 that is not a link.
     *
     * `returnIdpCredential` makes this endpoint answer "that email already belongs to a
     * different sign-in method" with HTTP 200, `needConfirmation: true`, and no tokens -
     * not with an error status. Falling through to the token check reported it as a
     * malformed response, which names a bug in this client instead of the one thing the
     * person can actually do something about.
     */
    if (body["needConfirmation"] === true) {
      return authError(
        "that email already signs in a different way - use that method instead, or pick another account",
      );
    }

    /*
     * The UID must not change.
     *
     * If it did, the link created or switched to a different account and everything this
     * machine has earned is now attached to a UID nobody is signed in as. Refusing keeps
     * the anonymous identity intact so the balance is still reachable.
     */
    const localId = body["localId"];
    if (before !== null && typeof localId === "string" && localId !== before) {
      return authError(
        "that account is already in use, so linking it would strand this machine's earnings",
      );
    }

    if (!(await adoptTokens(body))) {
      // Name the fields that were missing. "Malformed" sent whoever hit this reading this
      // client's parsing code, when the answer is always in what the service sent back.
      const absent = ["idToken", "refreshToken", "localId"].filter((key) => typeof body[key] !== "string");
      return authError(`the sign-in service did not return ${absent.join(", ")}`);
    }

    return ok({
      email: asText(body["email"]),
      displayName: asText(body["displayName"]),
      photoUrl: asText(body["photoUrl"]),
      providers: providersOf(body),
    });
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

    async linkPassword(email: string, password: string): Promise<Result<LinkedProfile, AuthError>> {
      return link(UPDATE_URL, { email, password });
    },

    async linkGoogle(googleIdToken: string): Promise<Result<LinkedProfile, AuthError>> {
      return linkIdp("google.com", "id_token", googleIdToken);
    },

    async linkGitHub(githubAccessToken: string): Promise<Result<LinkedProfile, AuthError>> {
      return linkIdp("github.com", "access_token", githubAccessToken);
    },

    async profile(): Promise<Result<LinkedProfile | null, AuthError>> {
      const token = await currentToken();
      if (!token.ok) return token;

      let response;
      try {
        response = await deps.http.request({
          method: "POST",
          url: `${LOOKUP_URL}?key=${encodeURIComponent(deps.apiKey)}`,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken: token.value }),
          timeoutMs: AUTH_TIMEOUT_MS,
        });
      } catch (error) {
        return authError(error instanceof Error ? error.message : "lookup transport failure");
      }

      const body = readJson(response.body);
      if (response.status < 200 || response.status >= 300) {
        return authError(errorMessage(body, response.status));
      }

      const users = body?.["users"];
      const user = Array.isArray(users) ? users[0] : null;
      if (typeof user !== "object" || user === null) return ok(null);

      const record = user as Record<string, unknown>;
      const providers = providersOf(record);

      // No provider means the account is still anonymous, which is not an error - it is
      // the state every account starts in.
      if (providers.length === 0) return ok(null);

      return ok({
        email: asText(record["email"]),
        displayName: asText(record["displayName"]),
        photoUrl: asText(record["photoUrl"]),
        providers,
      });
    },

    async reset(): Promise<void> {
      identity = null;
      cached = null;
      loaded = true;
      await deps.store.delete(STORE_KEY);
    },
  };
}
