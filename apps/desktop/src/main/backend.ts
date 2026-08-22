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
import { createFirebaseAuth, type Clock, type FileStore, type HttpTransport, type TokenProvider } from "@adcode/ads";

/** Production. Overridden by `ADCODE_AD_SERVER`, which is how the mock server is used. */
export const DEFAULT_API_ORIGIN = "https://api.adcode.bluethenics.com";

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
  const devServer = process.env["ADCODE_AD_SERVER"];
  const firebaseKey = process.env["ADCODE_FIREBASE_API_KEY"];

  if (devServer !== undefined || firebaseKey === undefined) return staticTokenProvider("dev-token");

  return createFirebaseAuth({ ...deps, apiKey: firebaseKey });
}
