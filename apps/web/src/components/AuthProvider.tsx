"use client";
import { EmailVerificationNotice } from "./EmailVerificationNotice";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthContext as Ctx, type AuthState } from "./AuthContext";
export { useAuth } from "./AuthContext";
import { apiFetch, type ApiError } from "@/lib/api";
import { watchUser, firebaseConfigured, type User } from "@/lib/firebase";
import { excludeBrowserByDefault } from "@/lib/websiteAnalytics";

/**
 * Who is signed in, and a fresh ID token on demand.
 *
 * `token()` is a function rather than a value because Firebase ID tokens expire after an
 * hour. Holding one in state means the first request after a long-open tab fails with a
 * 401 that looks like a bug; asking the SDK each time lets it refresh transparently.
 *
 * Tokens are deliberately never written to localStorage or a cookie by this app. Firebase
 * manages its own refresh-token storage; a second copy would be a second thing to leak.
 */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<ApiError | null>(null);
  const [adminAttempt, setAdminAttempt] = useState(0);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    return watchUser((next) => {
      userRef.current = next;
      setUser(next);
      setLoading(false);
    });
  }, []);

  /*
   * Ask the server, because the browser cannot work this out.
   *
   * This used to read a Firebase custom claim called `admin`. That was right until
   * administrators moved into a database table, and nothing has written the claim
   * since - so it read `undefined`, every account was told it was not an admin, and
   * the founding administrator could reach every admin endpoint while never being
   * shown the link to them.
   *
   * `/v1/me` returns what `authenticate` already computed for this request. It still
   * only decides what the UI offers: the API re-checks on every admin route, because
   * a client-side check is a convenience, never a control.
   *
   * A failed question is not a "no". When the API or the database behind it is down,
   * the answer is `adminError`, and the gate offers a retry instead of telling a real
   * administrator that she is not one.
   */
  useEffect(() => {
    if (user === null) {
      setIsAdmin(false);
      setAdminLoading(false);
      setAdminError(null);
      return;
    }

    let active = true;
    setAdminLoading(true);
    setAdminError(null);

    void (async () => {
      try {
        const token = await user.getIdToken();
        const result = await apiFetch<{ uid: string; isAdmin: boolean }>({ path: "/me", token });

        // Only the answer for whoever is signed in now: a slow reply for the previous
        // account must not decide what this one is shown.
        if (!active || userRef.current !== user) return;

        if (!result.ok) {
          setIsAdmin(false);
          // `not-admin` is an answer. Everything else - offline, a 500, an expired
          // token - is a question that went unanswered.
          setAdminError(result.error === "not-admin" ? null : result.error);
          return;
        }

        const admin = result.value.isAdmin === true;
        setIsAdmin(admin);
        // An administrator's own visits are not an audience. Excluded on this browser
        // from here on, unless Admin > Analytics was told to count it.
        if (admin) excludeBrowserByDefault();
      } catch {
        if (!active || userRef.current !== user) return;
        setIsAdmin(false);
        setAdminError("offline");
      } finally {
        if (active && userRef.current === user) setAdminLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user, adminAttempt]);

  const retryAdmin = useCallback(() => setAdminAttempt((attempt) => attempt + 1), []);

  const token = useCallback(async () => {
    const current = userRef.current;
    if (current === null) return null;
    try {
      return await current.getIdToken();
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, configured: firebaseConfigured, token, isAdmin, adminLoading, adminError, retryAdmin }),
    [user, loading, token, isAdmin, adminLoading, adminError, retryAdmin],
  );

  return <Ctx.Provider value={value}><EmailVerificationNotice />{children}</Ctx.Provider>;
}
