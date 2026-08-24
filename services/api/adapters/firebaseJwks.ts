/**
 * `TokenVerifier` against Firebase, using only Web Crypto.
 *
 * This replaces the `firebase-admin` verifier for one hard reason: the service now runs on
 * Cloudflare's runtime, and `firebase-admin` needs Node's crypto and gRPC, neither of
 * which exist there. Everything here is `fetch`, `crypto.subtle` and string handling, so
 * the same file runs unchanged in Node 24 for the test suite and in workerd in production.
 *
 * **What it checks**, all of which Firebase's own documentation requires and any of which
 * being skipped turns "verified" into a word without meaning:
 *
 * - the signature, against Google's published public keys for the securetoken service;
 * - `alg` is RS256, read from the header - a token declaring `none` must not be trusted
 *   to tell us it needs no signature;
 * - `aud` is exactly this Firebase project, so a token minted for somebody else's project
 *   is not a token for ours;
 * - `iss` is `https://securetoken.google.com/<project>`;
 * - `exp` is in the future and `iat` is not, both with a small allowance for clock skew;
 * - `sub` is present and non-empty, because it becomes the uid that owns the money.
 *
 * **What it deliberately cannot check: revocation.** `firebase-admin`'s
 * `verifyIdToken(token, true)` asks Firebase whether the session was revoked, which costs
 * a network round trip and is not expressible from a signature check. So a token belonging
 * to an account that signed out stays valid until it expires, at most an hour. The case
 * that actually matters - a banned account - is closed elsewhere and immediately:
 * `authenticate()` in `src/auth.ts` loads the user record on every single request and
 * refuses a `banned` status there. That was already true before this file existed.
 */
import type { TokenVerifier, VerifiedToken } from "../src/auth.ts";

/** Google's public keys for Firebase ID tokens, in JWK form Web Crypto can import directly. */
const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** Tolerated clock difference between us and Google, in seconds. */
const SKEW_SECONDS = 60;

/** Used only when Google's response carries no usable `Cache-Control: max-age`. */
const FALLBACK_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
}

interface Header {
  alg?: unknown;
  kid?: unknown;
}

interface Claims {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  [claim: string]: unknown;
}

export interface FirebaseJwksOptions {
  /** The Firebase project id. Falls back to `FIREBASE_PROJECT_ID`. */
  projectId?: string;
  /** Injectable for tests, so verification can be exercised with no network. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests, in milliseconds. */
  now?: () => number;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const full = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(full);
  // Backed by an explicit ArrayBuffer: `new Uint8Array(n)` is typed over ArrayBufferLike,
  // which includes SharedArrayBuffer and so is not a BufferSource `crypto.subtle` accepts.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as unknown;
}

/** Seconds from a `Cache-Control` header, or null when it says nothing useful. */
function maxAgeMs(header: string | null): number | null {
  if (header === null) return null;
  const match = /max-age\s*=\s*(\d+)/i.exec(header);
  if (match?.[1] === undefined) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function createFirebaseJwksVerifier(options: FirebaseJwksOptions = {}): TokenVerifier {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  let keys = new Map<string, CryptoKey>();
  let expiresAt = 0;
  /** In-flight refresh, so a burst of requests on a cold worker fetches the keys once. */
  let refreshing: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    const response = await fetchImpl(JWKS_URL);
    if (!response.ok) throw new Error(`jwks fetch failed: ${response.status}`);

    const body = (await response.json()) as { keys?: Jwk[] };
    const next = new Map<string, CryptoKey>();

    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== "RSA") continue;
      // Only the three fields the algorithm needs. Passing Google's extra members
      // (`use`, `alg`) through can make `importKey` reject the key on some runtimes.
      const imported = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      next.set(jwk.kid, imported);
    }

    if (next.size === 0) throw new Error("jwks response contained no usable keys");

    keys = next;
    expiresAt = now() + (maxAgeMs(response.headers.get("cache-control")) ?? FALLBACK_TTL_MS);
  };

  /**
   * The key for this `kid`.
   *
   * A miss forces one refresh even when the cache looks fresh, because that is exactly
   * what a key rotation looks like from here. The `refreshed` flag stops that becoming a
   * fetch per request when the `kid` is simply bogus.
   */
  const keyFor = async (kid: string): Promise<CryptoKey | null> => {
    let refreshed = false;

    if (now() >= expiresAt || keys.size === 0) {
      refreshing ??= refresh().finally(() => {
        refreshing = null;
      });
      await refreshing;
      refreshed = true;
    }

    const found = keys.get(kid);
    if (found !== undefined) return found;
    if (refreshed) return null;

    refreshing ??= refresh().finally(() => {
      refreshing = null;
    });
    await refreshing;
    return keys.get(kid) ?? null;
  };

  return {
    async verify(idToken: string): Promise<VerifiedToken | null> {
      try {
        const projectId = options.projectId ?? process.env["FIREBASE_PROJECT_ID"];
        if (projectId === undefined || projectId === "") {
          throw new Error("FIREBASE_PROJECT_ID is required to verify a token");
        }

        const parts = idToken.split(".");
        if (parts.length !== 3) return null;
        const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

        const header = decodeJson(headerPart) as Header;
        // Read the algorithm rather than trusting it: `alg: "none"` is a forgery, not a
        // configuration, and so is a token signed with a symmetric key we also hold.
        if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

        const key = await keyFor(header.kid);
        if (key === null) return null;

        const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
        const signature = base64UrlToBytes(signaturePart);
        const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
        if (!valid) return null;

        const claims = decodeJson(payloadPart) as Claims;
        const seconds = Math.floor(now() / 1000);

        if (claims.aud !== projectId) return null;
        if (claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
        if (typeof claims.sub !== "string" || claims.sub === "") return null;
        if (typeof claims.exp !== "number" || claims.exp + SKEW_SECONDS <= seconds) return null;
        if (typeof claims.iat !== "number" || claims.iat - SKEW_SECONDS > seconds) return null;

        return { uid: claims.sub, claims: claims as Record<string, unknown> };
      } catch {
        // A token that fails verification for any reason is simply not a token. The caller
        // maps this to 401; distinguishing 'expired' from 'forged' in the response would
        // tell an attacker which of the two they achieved.
        return null;
      }
    },
  };
}
