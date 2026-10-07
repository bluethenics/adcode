"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
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
interface AuthState {
  user: User | null;
  loading: boolean;
  configured: boolean;
  token: () => Promise<string | null>;
  isAdmin: boolean;
  /**
   * True while the server is still being asked whether this account is an admin. Signing in
   * finishes first, so without this an administrator was told "Not an admin account" for the
   * moment between the two.
   */
  adminLoading: boolean;
}

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  configured: false,
  token: async () => null,
  isAdmin: false,
  adminLoading: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const userRef = useRef<User | null>(null);

  useEffect(() => {
    return watchUser((next) => {
      userRef.current = next;
      setUser(next);
      setLoading(false);

      if (next === null) {
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }
      setAdminLoading(true);

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
       */
      void next
        .getIdToken()
        .then((token) => apiFetch<{ uid: string; isAdmin: boolean }>({ path: "/me", token }))
        .then((result) => {
          // Only the answer for whoever is signed in now: a slow reply for the previous
          // account must not decide what this one is shown.
          if (userRef.current !== next) return;
          const admin = result.ok && result.value.isAdmin;
          setIsAdmin(admin);
          // An administrator's own visits are not an audience. Excluded on this browser
          // from here on, unless Admin > Analytics was told to count it.
          if (admin) excludeBrowserByDefault();
        })
        .catch(() => { if (userRef.current === next) setIsAdmin(false); })
        .finally(() => { if (userRef.current === next) setAdminLoading(false); });
    });
  }, []);

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
    () => ({ user, loading, configured: firebaseConfigured, token, isAdmin, adminLoading }),
    [user, loading, token, isAdmin, adminLoading],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = (): AuthState => useContext(Ctx);
