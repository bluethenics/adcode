/**
 * `TokenVerifier` against Firebase Admin.
 *
 * The client signs in anonymously over the Identity Toolkit REST endpoints
 * (`packages/ads/src/auth.ts`); this verifies the ID token that produces. Roles arrive as
 * custom claims inside the verified token, so a role check costs no read.
 *
 * `firebase-admin` is imported dynamically and is an optional dependency: nothing under
 * `src/` touches it, so the unit and conformance suites keep running when it is absent.
 */
import type { TokenVerifier, VerifiedToken } from "../src/auth.ts";

export function createFirebaseVerifier(): TokenVerifier {
  return {
    async verify(idToken: string): Promise<VerifiedToken | null> {
      try {
        const { getAuth } = await import("firebase-admin/auth");
        const { initializeApp, getApps } = await import("firebase-admin/app");
        if (getApps().length === 0) initializeApp();

        // `true` checks the token against revocation, so a signed-out or disabled account
        // stops working immediately rather than when the token would have expired.
        const decoded = await getAuth().verifyIdToken(idToken, true);
        return { uid: decoded.uid, claims: decoded as unknown as Record<string, unknown> };
      } catch {
        // A token that fails verification for any reason is simply not a token. The
        // caller maps this to 401; distinguishing 'expired' from 'forged' in the response
        // would tell an attacker which of the two they achieved.
        return null;
      }
    },
  };
}
