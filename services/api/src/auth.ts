/**
 * Who is calling, and are they allowed to?
 *
 * Spec §7: identity comes from the token, never from a body field. Roles come from
 * Firebase custom claims, which live inside the verified token, so authorising a request
 * costs no reads. Ban status comes from the store instead, because a ban has to take
 * effect on the next request rather than whenever the token happens to refresh
 * (decision #6).
 */
import type { Clock, Store } from "./store.ts";

export interface VerifiedToken {
  uid: string;
  claims: Record<string, unknown>;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedToken | null>;
}

export interface AuthDeps {
  store: Store;
  verifier: TokenVerifier;
  clock: Clock;
}

export type AuthFailure = "missing-token" | "bad-token" | "banned" | "not-admin";

export type AuthResult =
  | { ok: true; uid: string; isAdmin: boolean }
  | { ok: false; failure: AuthFailure };

export function bearerFrom(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export async function authenticate(
  deps: AuthDeps,
  header: string | undefined,
): Promise<AuthResult> {
  const token = bearerFrom(header);
  if (token === null) return { ok: false, failure: "missing-token" };

  const verified = await deps.verifier.verify(token);
  if (verified === null) return { ok: false, failure: "bad-token" };

  // First sight of an anonymous UID creates its record. Brief §8.4 promises first launch
  // performs anonymous auth "with no UI and no wall", so there is no signup call in which
  // to do this.
  let user = await deps.store.getUser(verified.uid);
  if (user === null) {
    user = { uid: verified.uid, status: "active", createdAt: deps.clock.now() };
    await deps.store.putUser(user);
  }

  if (user.status === "banned") return { ok: false, failure: "banned" };

  // Strict equality against `true`: a claim of the string "true" is not an admin claim,
  // and a truthiness check here would make it one.
  return { ok: true, uid: verified.uid, isAdmin: verified.claims["admin"] === true };
}
