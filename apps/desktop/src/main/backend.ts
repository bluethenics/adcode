/**
 * Where the backend is, and how to prove who we are to it.
 *
 * Both the ad client and the bug reporter talk to `services/api`, and before this module
 * existed each resolved the origin itself. Two copies of a default URL is one copy too
 * many: the day one of them changes, the other keeps talking to the old host and the
 * failure looks like an auth bug.
 *
 * §9's rule still governs anything built on this: the worst permitted outcome of the
 * backend being unreachable is that a feature quietly does nothing.
 */
import {
  createFirebaseAuth,
  type Clock,
  type FileStore,
  type FirebaseAuth,
  type HttpTransport,
  type TokenProvider,
} from "@adcode/ads";

/** Production. Overridden by `ADCODE_AD_SERVER`, which is how the mock server is used. */
/*
 * The site's origin, not an `api.` subdomain: the service is served by the same Cloudflare
 * Worker as the marketing site, at `/v1/*`. One deployment, one hostname, one certificate.
 *
 * **This is the workers.dev hostname on purpose.** It used to be
 * `https://adcode.bluethenics.com`, which is the domain the site is *intended* to answer
 * on and does not resolve yet - the custom domain needs `bluethenics.com`'s nameservers
 * moved to Cloudflare, and a Workers custom domain cannot be a CNAME, so it cannot be
 * done from the registrar. Until then that hostname has no DNS record at all.
 *
 * Every single thing this app does over the network went through it: ad serving,
 * receipts, the balance, account linking, notices, releases, activity, and the feedback
 * form - which is where it finally surfaced, as "Could not reach the server. Check your
 * connection." That message was accurate and pointed at the user's network instead of at
 * a hostname that has never existed.
 *
 * Change this back the day step 13 of SETUP.md is done. It is read at build time, so a
 * packaged installer carries whatever was set when `npm run package` ran.
 */
export const DEFAULT_API_ORIGIN = "https://adcode.bluethenics01.workers.dev";

/**
 * The Firebase web API key for `adcode-idle`.
 *
 * Committed on purpose. A Firebase web API key is a public project identifier, not a
 * credential - it ships in the bundle of every Firebase web app ever built, and it is
 * already in `apps/web/apphosting.yaml` for exactly that reason. What guards the data is
 * token verification in `services/api` and `firestore.rules` denying every direct client
 * read.
 *
 * It lives here rather than only in an environment variable because requiring one meant
 * `npm start` silently hid every sign-in surface, and a developer could not see the
 * feature they had just built. Env still overrides, for anyone pointing at another
 * project.
 */
const DEFAULT_FIREBASE_API_KEY = "AIzaSyATZzX5Fw2HjR34VxB3UQWTmljprA5uXqE";

export function apiOrigin(): string {
  return process.env["ADCODE_AD_SERVER"] ?? DEFAULT_API_ORIGIN;
}

export function apiBaseUrl(): string {
  return `${apiOrigin()}/v1`;
}

function staticTokenProvider(token: string): TokenProvider {
  return {
    getToken: async () => ({ ok: true, value: token }),
    invalidate: () => undefined,
  };
}

/**
 * One Firebase identity for the whole main process.
 *
 * Memoised deliberately. The ad client, the feedback reporter, the notice poller and the
 * account screen all need a token, and before this they each built their own
 * `createFirebaseAuth`. That was survivable while the only operation was "read the
 * identity file" - but linking an account rotates the refresh token, so a second instance
 * would keep using the revoked one and start failing at its next refresh.
 */
let shared: FirebaseAuth | null = null;

/**
 * Real Firebase identity in production; a fixed string against a dev server.
 *
 * The mock server checks only that a bearer token is present, so pointing at it must not
 * require a Firebase project to exist - that is what makes the whole client runnable on a
 * laptop with no credentials.
 */
export function createBackendTokens(deps: {
  http: HttpTransport;
  clock: Clock;
  store: FileStore;
}): TokenProvider {
  return backendAccount(deps) ?? staticTokenProvider("dev-token");
}

/**
 * The account itself, for linking and profile reads.
 *
 * Null against a dev server or with no Firebase key: there is no real account to link,
 * and the caller should say so rather than offer a button that cannot work.
 */
export function backendAccount(deps: {
  http: HttpTransport;
  clock: Clock;
  store: FileStore;
}): FirebaseAuth | null {
  if (shared !== null) return shared;

  // A dev server means the mock, which has no Firebase behind it and nothing to link to.
  if (process.env["ADCODE_AD_SERVER"] !== undefined) return null;

  const apiKey = process.env["ADCODE_FIREBASE_API_KEY"] ?? DEFAULT_FIREBASE_API_KEY;
  if (apiKey.length === 0) return null;

  shared = createFirebaseAuth({ ...deps, apiKey });
  return shared;
}
