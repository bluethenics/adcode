/**
 * Who is calling, and are they allowed to?
 *
 * Spec §7: identity comes from the token, never from a body field. Ban status comes from
 * the store, because a ban has to take effect on the next request rather than whenever the
 * token happens to refresh (decision #6).
 *
 * Admin used to come from a Firebase custom claim, which was free to read but could only
 * be *written* from Google Cloud Shell - so there was no way to build a screen for
 * appointing administrators without handing this service a service-account private key.
 * It now comes from the `admins` table instead. That costs nothing extra: the ban check
 * above already reads this database on every single request.
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

  return { ok: true, uid: verified.uid, isAdmin: await adminFromEmail(deps, verified) };
}

/**
 * Whether this token belongs to an administrator.
 *
 * Two conditions, and the second is the one that matters. The address must be in the
 * `admins` table, **and the token must say the provider verified it**. Email/Password
 * sign-up is enabled, so without that check anyone could register an account claiming the
 * founding administrator's address and be handed the admin panel - the account would be
 * useless for reading that person's mail and perfectly sufficient for taking over the site.
 *
 * Strict equality against `true` throughout: a claim of the string `"true"` is not a
 * verified email, and a truthiness check here would make it one.
 */
async function adminFromEmail(deps: AuthDeps, verified: VerifiedToken): Promise<boolean> {
  if (verified.claims["email_verified"] !== true) return false;

  const claimed = verified.claims["email"];
  if (typeof claimed !== "string" || claimed.length === 0) return false;

  return deps.store.isAdmin(claimed.toLowerCase());
}
